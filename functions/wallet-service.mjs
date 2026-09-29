const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PROCESSING_LEASE_SECONDS = 60;
// Keep within the default Cloudflare Workers PBKDF2 ceiling while still using
// a per-account random salt and a deliberately expensive derivation.
const PASSWORD_ITERATIONS = 100000;
const MAX_BODY_BYTES = 8192;
const AUTH_WINDOW_SECONDS = 15 * 60;

export const PLANS = Object.freeze({
  daily: Object.freeze({ id: 'daily', name: 'Gói Thuê 1 Ngày (24H)', amount: 20000, days: 1 }),
  monthly: Object.freeze({ id: 'monthly', name: 'Gói Thuê 30 Ngày (1 Tháng)', amount: 300000, days: 30 }),
  lifetime: Object.freeze({ id: 'lifetime', name: 'Gói Bản Quyền Vĩnh Viễn', amount: 2000000, days: null })
});

const ORIGINS = new Set(['https://vn-keen.github.io', 'https://vn-keen.pages.dev']);

function fail(status, code, message, details = {}) {
  throw Object.assign(new Error(message || code), { status, code, ...details });
}

function getDb(env) {
  if (!env?.LICENSE_DB) fail(503, 'NOT_CONFIGURED', 'Ví chưa được cấu hình trên máy chủ.');
  return env.LICENSE_DB;
}

function hex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength) {
  return hex(crypto.getRandomValues(new Uint8Array(byteLength))).toUpperCase();
}

function newLeaseToken() {
  return randomHex(16);
}

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,32}$/.test(username)) fail(400, 'INVALID_USERNAME', 'Tên tài khoản gồm 3–32 ký tự a-z, 0-9 hoặc _.');
  return username;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    fail(400, 'INVALID_PASSWORD', 'Mật khẩu phải dài từ 10 đến 128 ký tự.');
  }
  return value;
}

function validateRequestId(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 80 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(400, 'INVALID_REQUEST_ID', 'Mã yêu cầu mua không hợp lệ.');
  }
  return value;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) fail(413, 'BODY_TOO_LARGE');
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) fail(413, 'BODY_TOO_LARGE');
  try {
    const body = JSON.parse(text || '{}');
    if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'INVALID_JSON');
    return body;
  } catch {
    fail(400, 'INVALID_JSON');
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return hex(new Uint8Array(digest));
}

async function pbkdf2(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  if (!/^[a-f0-9]{32}$/.test(saltHex || '') || !Number.isInteger(iterations) || iterations < 100000 || iterations > PASSWORD_ITERATIONS) fail(503, 'AUTH_CONFIGURATION_ERROR');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const salt = new Uint8Array((saltHex.match(/.{2}/g) || []).map(pair => parseInt(pair, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return hex(new Uint8Array(bits));
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

async function passwordRecord(password) {
  const salt = randomHex(16).toLowerCase();
  return { salt, hash: await pbkdf2(password, salt) };
}

async function limitAuth(request, env, username, now) {
  // Cloudflare sets CF-Connecting-IP; never trust X-Forwarded-For here.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucketTime = Math.floor(now / AUTH_WINDOW_SECONDS);
  const db = getDb(env);
  const buckets = [
    { key: `ip:${await sha256(ip)}:${bucketTime}`, limit: 40 },
    { key: `user:${await sha256(username)}:${bucketTime}`, limit: 12 }
  ];
  const results = await db.batch(buckets.map(bucket => db.prepare(`INSERT INTO wallet_auth_limits (bucket,attempts,expires_at)
    VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`)
    .bind(bucket.key, (bucketTime + 1) * AUTH_WINDOW_SECONDS)));
  for (let i = 0; i < buckets.length; i += 1) {
    if (Number(rows(results[i])[0]?.attempts || 0) > buckets[i].limit) fail(429, 'AUTH_RATE_LIMITED', 'Quá nhiều lần thử. Vui lòng đợi 15 phút rồi thử lại.');
  }
  await db.prepare('DELETE FROM wallet_auth_limits WHERE expires_at<?').bind(now - AUTH_WINDOW_SECONDS).run();
}

async function newSession(env, username, now) {
  const db = getDb(env);
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expires = now + SESSION_TTL_SECONDS;
  await db.prepare('INSERT INTO wallet_sessions (token_hash,username,created_at,last_seen_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)')
    .bind(tokenHash, username, now, now, expires).run();
  return { token, expiresAt: expires };
}

export async function sessionUser(request, env, now = Math.floor(Date.now() / 1000)) {
  const header = request.headers.get('Authorization') || '';
  const token = /^Bearer ([A-F0-9]{64})$/i.exec(header)?.[1];
  if (!token) fail(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ.');
  const tokenHash = await sha256(token);
  const db = getDb(env);
  const record = await db.prepare(`SELECT s.username,s.expires_at,s.revoked_at,a.username AS account_username,
      a.display_name,a.deposit_code,a.balance,a.reserved_balance,c.contact
    FROM wallet_sessions s
    JOIN wallet_accounts a ON a.username=s.username
    JOIN wallet_credentials c ON c.username=s.username
    WHERE s.token_hash=?`).bind(tokenHash).first();
  if (!record || record.revoked_at != null || Number(record.expires_at) <= now) {
    fail(401, 'UNAUTHORIZED', 'Phiên đăng nhập đã hết hạn.');
  }
  try { await db.prepare('UPDATE wallet_sessions SET last_seen_at=? WHERE token_hash=?').bind(now, tokenHash).run(); } catch {}
  return { ...record, tokenHash };
}

export async function accountForUser(env, username) {
  const db = getDb(env);
  return db.prepare(`SELECT a.username,a.display_name,a.deposit_code,a.balance,a.reserved_balance,c.contact
    FROM wallet_accounts a JOIN wallet_credentials c ON c.username=a.username WHERE a.username=?`).bind(username).first();
}

export async function userData(env, account, now = Math.floor(Date.now() / 1000)) {
  const db = getDb(env);
  const [keyResult, ledgerResult, pendingResult] = await Promise.all([
    db.prepare(`SELECT request_id AS id,plan,amount AS price,days,license_key AS key,created_at AS purchasedAt
      FROM wallet_orders WHERE username=? AND status='FULFILLED' ORDER BY created_at DESC`).bind(account.username).all(),
    db.prepare(`SELECT type,amount,description,reference_id AS referenceId,created_at AS createdAt
      FROM wallet_ledger WHERE username=? ORDER BY created_at DESC LIMIT 100`).bind(account.username).all(),
    db.prepare(`SELECT request_id AS requestId,plan,status,created_at AS createdAt
      FROM wallet_orders WHERE username=? AND status='PROCESSING' ORDER BY created_at DESC`).bind(account.username).all()
  ]);
  const total = Number(account.balance || 0);
  const reserved = Number(account.reserved_balance || 0);
  return {
    username: account.display_name || account.username,
    balance: total,
    availableBalance: Math.max(0, total - reserved),
    reservedBalance: reserved,
    depositCode: account.deposit_code || '',
    bank: { account: env.SEPAY_ACCOUNT_NUMBER || '', bank: env.SEPAY_BANK_CODE || 'MB', name: env.SEPAY_ACCOUNT_NAME || 'NGUYEN PHU QUY' },
    contact: account.contact || '',
    keys: rows(keyResult).map(item => ({ ...item, planId: item.plan, plan: PLANS[item.plan]?.name || item.plan })),
    transactions: rows(ledgerResult),
    pendingOrders: rows(pendingResult),
    asOf: now
  };
}

function responseBody(body, status, request) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (!origin || ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin || '*';
  headers['X-Content-Type-Options'] = 'nosniff';
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function register(request, env, now) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = validatePassword(body.password);
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 160) : '';
  const db = getDb(env);
  await limitAuth(request, env, username, now);
  const existing = await db.prepare('SELECT a.username,c.username AS credential_username FROM wallet_accounts a LEFT JOIN wallet_credentials c ON c.username=a.username WHERE a.username=?')
    .bind(username).first();
  if (existing?.credential_username) fail(409, 'USERNAME_TAKEN', 'Tên tài khoản này đã tồn tại.');
  if (existing && !existing.credential_username) fail(409, 'LEGACY_ACCOUNT_UNMIGRATED', 'Tài khoản cũ cần quản trị viên xác minh trước khi khôi phục.');
  const displayName = typeof body.username === 'string' ? body.username.trim() : username;
  const depositCode = 'VNW' + randomHex(12);
  const record = await passwordRecord(password);
  const stamp = new Date(now * 1000).toISOString();
  try {
    const account = db.prepare('INSERT INTO wallet_accounts (username,display_name,deposit_code,balance,reserved_balance,created_at,updated_at) VALUES (?,?,?,0,0,?,?)')
      .bind(username, displayName, depositCode, stamp, stamp);
    const credentials = db.prepare('INSERT INTO wallet_credentials (username,password_hash,password_salt,contact,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(username, record.hash, record.salt, contact, stamp, stamp);
    await db.batch([account, credentials]);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique') || String(error?.message || '').toLowerCase().includes('constraint')) fail(409, 'USERNAME_TAKEN', 'Tên tài khoản này đã tồn tại.');
    throw error;
  }
  const session = await newSession(env, username, now);
  const account = await accountForUser(env, username);
  return { success: true, message: 'Đăng ký tài khoản thành công!', token: session.token, expiresAt: session.expiresAt, user: await userData(env, account, now) };
}

async function login(request, env, now) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 128) fail(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  const db = getDb(env);
  await limitAuth(request, env, username, now);
  const credential = await db.prepare(`SELECT c.username,c.password_hash,c.password_salt,c.password_kdf,c.password_iterations,a.display_name,a.deposit_code,a.balance,a.reserved_balance,c.contact
    FROM wallet_credentials c JOIN wallet_accounts a ON a.username=c.username WHERE c.username=?`).bind(username).first();
  if (!credential) {
    const legacy = await db.prepare('SELECT username FROM wallet_accounts WHERE username=?').bind(username).first();
    if (legacy) fail(409, 'LEGACY_ACCOUNT_UNMIGRATED', 'Tài khoản cũ cần quản trị viên xác minh trước khi khôi phục.');
    fail(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  if (credential.password_kdf !== 'pbkdf2-sha256') fail(503, 'AUTH_CONFIGURATION_ERROR');
  const computed = await pbkdf2(password, credential.password_salt, credential.password_iterations);
  if (!safeEqual(computed, credential.password_hash)) fail(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  const session = await newSession(env, username, now);
  return { success: true, message: 'Đăng nhập thành công!', token: session.token, expiresAt: session.expiresAt, user: await userData(env, credential, now) };
}

async function logout(request, env, now) {
  const session = await sessionUser(request, env, now);
  await getDb(env).prepare('UPDATE wallet_sessions SET revoked_at=?,last_seen_at=? WHERE token_hash=?').bind(now, now, session.tokenHash).run();
  return { success: true, message: 'Đã đăng xuất.' };
}

function makeLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const block = start => Array.from({ length: 4 }, (_, index) => chars[bytes[start + index] % chars.length]).join('');
  return `VN-KEEN-SKIN-${block(0)}-${block(4)}-${block(8)}-${block(12)}`;
}

async function createProviderLicense(env, order) {
  if (!env.LICENSEGATE_API_KEY) fail(202, 'LICENSE_PENDING', 'LicenseGate chưa được cấu hình. Số dư vẫn được giữ nguyên.');
  const expirationDate = order.days == null ? '2099-12-31T23:59:59.000Z' : new Date(Date.parse(order.created_at) + order.days * 86400 * 1000).toISOString();
  const input = { active: true, name: 'WALLET-' + order.request_id, notes: 'VN-KEEN Wallet / ' + order.plan, licenseKey: order.license_key, licenseScope: 'VN-KEEN-SKIN', expirationDate, ipLimit: 1, validationPoints: 1000, validationLimit: 1000, replenishAmount: 1000, replenishInterval: 'DAY' };
  let response;
  try {
    response = await fetch('https://api.licensegate.io/admin/licenses', { method: 'POST', headers: { Authorization: env.LICENSEGATE_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  } catch { fail(202, 'LICENSE_PENDING', 'LicenseGate chưa xác nhận giao dịch. Hãy thử lại bằng đúng yêu cầu này.'); }
  if (!response.ok && response.status === 400) {
    try { response = await fetch('https://api.licensegate.io/admin/licenses/key/' + encodeURIComponent(order.license_key), { headers: { Authorization: env.LICENSEGATE_API_KEY }, signal: AbortSignal.timeout(8000) }); }
    catch { fail(202, 'LICENSE_PENDING', 'LicenseGate chưa xác nhận giao dịch. Hãy thử lại bằng đúng yêu cầu này.'); }
  }
  if (!response.ok) fail(202, 'LICENSE_PENDING', 'LicenseGate chưa xác nhận giao dịch. Hãy thử lại bằng đúng yêu cầu này.');
  let data;
  try { data = await response.json(); } catch { fail(202, 'LICENSE_PENDING', 'LicenseGate chưa xác nhận giao dịch.'); }
  const providerExpiry = data.expirationDate == null ? NaN : Date.parse(data.expirationDate);
  const expectedExpiry = Date.parse(input.expirationDate);
  if (data.licenseKey !== input.licenseKey || data.licenseScope !== input.licenseScope ||
      data.active !== true || data.ipLimit !== 1 || data.name !== input.name ||
      !Number.isInteger(data.id) || !Number.isFinite(providerExpiry) ||
      Math.abs(providerExpiry - expectedExpiry) > 1000) {
    fail(202, 'LICENSE_PENDING', 'LicenseGate chưa xác nhận được key. Số dư vẫn được giữ nguyên.');
  }
  return { providerId: Number.isInteger(data.id) ? data.id : null };
}

async function reserveOrder(env, username, plan, requestId, now) {
  const db = getDb(env);
  const existing = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
  if (existing) {
    if (existing.username !== username) fail(409, 'REQUEST_ID_REUSED', 'Mã yêu cầu mua đã thuộc về tài khoản khác.');
    if (existing.plan !== plan.id) fail(409, 'REQUEST_ID_PLAN_MISMATCH', 'Mã yêu cầu đang chờ cho gói khác. Hãy tiếp tục đúng gói ban đầu.', {
      requestId: existing.request_id, plan: existing.plan,
      pendingOrder: { requestId: existing.request_id, plan: existing.plan, status: existing.status, createdAt: existing.created_at }
    });
    return { order: existing, claimed: false };
  }
  if (!env.LICENSEGATE_API_KEY) fail(503, 'LICENSE_PROVIDER_NOT_CONFIGURED', 'Máy chủ chưa cấu hình LicenseGate. Chưa giữ hoặc trừ tiền.');
  const stamp = new Date(now * 1000).toISOString();
  const leaseToken = newLeaseToken();
  const orderInsert = db.prepare(`INSERT INTO wallet_orders
      (request_id,username,plan,amount,days,status,license_key,lease_token,lease_expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'PROCESSING',?,?,?,?,?)`)
    .bind(requestId, username, plan.id, plan.amount, plan.days, makeLicenseKey(), leaseToken, now + PROCESSING_LEASE_SECONDS, stamp, stamp);
  // The order-insert trigger reserves funds or aborts this same statement.
  // No separate cleanup can be lost if the worker crashes after commit.
  try { await orderInsert.run(); }
  catch (error) {
    const duplicate = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
    if (duplicate) {
      if (duplicate.username !== username) fail(409, 'REQUEST_ID_REUSED', 'Mã yêu cầu mua đã thuộc về tài khoản khác.');
      if (duplicate.plan !== plan.id) fail(409, 'REQUEST_ID_PLAN_MISMATCH', 'Mã yêu cầu đang chờ cho gói khác.', {
        requestId: duplicate.request_id, plan: duplicate.plan,
        pendingOrder: { requestId: duplicate.request_id, plan: duplicate.plan, status: duplicate.status, createdAt: duplicate.created_at }
      });
      return { order: duplicate, claimed: false };
    }
    const pending = await db.prepare("SELECT request_id AS requestId,plan,status,created_at AS createdAt FROM wallet_orders WHERE username=? AND status='PROCESSING' ORDER BY created_at DESC LIMIT 1")
      .bind(username).first();
    if (pending) fail(409, 'PURCHASE_PENDING', 'Đã có một yêu cầu mua đang chờ. Hãy tiếp tục bằng đúng mã yêu cầu đó.', { requestId: pending.requestId, plan: pending.plan, pendingOrder: pending });
    if (String(error?.message || '').includes('INSUFFICIENT_BALANCE')) fail(409, 'INSUFFICIENT_BALANCE', 'Số dư khả dụng không đủ cho gói này.');
    throw error;
  }
  const order = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
  if (!order) fail(503, 'ORDER_UNAVAILABLE');
  return { order, claimed: true, leaseToken };
}

async function finalizeOrder(env, order, providerId, leaseToken) {
  const db = getDb(env);
  const stamp = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("UPDATE wallet_orders SET provider_id=?,updated_at=? WHERE request_id=? AND status='PROCESSING' AND lease_token=?")
        .bind(providerId, stamp, order.request_id, leaseToken),
      // Migration 0003's BUY_KEY trigger atomically debits the reserved wallet
      // and marks this PROCESSING order fulfilled. If either transition fails,
      // the trigger aborts the whole D1 batch and the reservation is retained.
      db.prepare(`INSERT INTO wallet_ledger (id,username,type,amount,description,reference_id,created_at)
        SELECT ?,username,'BUY_KEY',?,?,?,? FROM wallet_orders
        WHERE request_id=? AND username=? AND status='PROCESSING' AND lease_token=?`)
        .bind('BUY-' + order.request_id, -order.amount, `Mua ${PLANS[order.plan].name}`, 'BUY:' + order.request_id, stamp,
          order.request_id, order.username, leaseToken)
    ]);
    // A stale worker may have lost its lease between provider confirmation and
    // this batch. The gated INSERT must be the only statement that can debit.
    // If it inserted no ledger row, leave the current owner's reservation intact.
    const inserted = await db.prepare('SELECT reference_id FROM wallet_ledger WHERE id=?').bind('BUY-' + order.request_id).first();
    if (!inserted) return false;
  } catch (error) {
    const saved = await db.prepare('SELECT status FROM wallet_orders WHERE request_id=?').bind(order.request_id).first();
    if (saved?.status !== 'FULFILLED') throw error;
  }
  return true;
}

async function pendingResponse(env, session, order, now, message) {
  const account = await accountForUser(env, session.username);
  return { success: false, status: 'PENDING', code: 'LICENSE_PENDING', requestId: order.request_id, message: message || 'Đã nhận yêu cầu; hãy thử lại bằng đúng yêu cầu này.', user: await userData(env, account, now) };
}

async function purchase(request, env, now) {
  const session = await sessionUser(request, env, now);
  const body = await readJson(request);
  const plan = typeof body.plan === 'string' && Object.hasOwn(PLANS, body.plan) ? PLANS[body.plan] : null;
  if (!plan) fail(400, 'INVALID_PLAN', 'Gói bản quyền không hợp lệ.');
  const requestId = validateRequestId(body.requestId);
  const db = getDb(env);
  let { order, claimed, leaseToken } = await reserveOrder(env, session.username, plan, requestId, now);
  if (order.status === 'FULFILLED') return { success: true, status: 'FULFILLED', key: order.license_key, requestId, user: await userData(env, await accountForUser(env, session.username), now) };
  if (order.status === 'FAILED') fail(409, order.error_code || 'PURCHASE_FAILED', 'Yêu cầu mua trước đó đã thất bại. Hãy tạo yêu cầu mới.');
  if (!claimed) {
    const leaseExpiry = Number(order.lease_expires_at || 0);
    if (leaseExpiry > now) return pendingResponse(env, session, order, now);
    leaseToken = newLeaseToken();
    const stamp = new Date(now * 1000).toISOString();
    const claimedLease = await db.prepare(`UPDATE wallet_orders
      SET lease_token=?,lease_expires_at=?,updated_at=?
      WHERE request_id=? AND status='PROCESSING' AND lease_expires_at<=?`)
      .bind(leaseToken, now + PROCESSING_LEASE_SECONDS, stamp, requestId, now).run();
    if (Number(claimedLease?.meta?.changes ?? 0) !== 1) {
      order = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
      if (order?.status === 'FULFILLED') return { success: true, status: 'FULFILLED', key: order.license_key, requestId, user: await userData(env, await accountForUser(env, session.username), now) };
      return pendingResponse(env, session, order, now);
    }
    order = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
  }
  let provider;
  try {
    provider = await createProviderLicense(env, order);
  } catch (error) {
    // No provider confirmation means no charge. Keep the reservation and the
    // same deterministic key so a retry can reconcile a timeout safely.
    if (error.code === 'LICENSE_PENDING') return pendingResponse(env, session, order, now, error.message);
    return pendingResponse(env, session, order, now, 'LicenseGate chưa xác nhận giao dịch. Số dư vẫn được giữ nguyên.');
  }
  try {
    const finalized = await finalizeOrder(env, order, provider.providerId, leaseToken);
    if (!finalized) return pendingResponse(env, session, order, now, 'Một phiên xử lý khác đang hoàn tất yêu cầu này. Hãy thử lại bằng đúng mã yêu cầu.');
  } catch {
    // The provider has already accepted this key. A transient D1 failure must
    // not release funds or mark the order failed; retrying the same request id
    // will perform the durable ledger transition.
    return pendingResponse(env, session, order, now, 'Đã tạo key; máy chủ đang hoàn tất lưu giao dịch. Hãy thử lại bằng đúng yêu cầu này.');
  }
  const fulfilled = await db.prepare('SELECT * FROM wallet_orders WHERE request_id=?').bind(requestId).first();
  if (fulfilled?.status !== 'FULFILLED') return pendingResponse(env, session, order, now);
  const account = await accountForUser(env, session.username);
  return { success: true, status: 'FULFILLED', key: fulfilled.license_key, requestId, user: await userData(env, account, now) };
}

export async function handleUser(request, env, forcedAction) {
  const action = forcedAction || new URL(request.url).searchParams.get('action');
  const now = Math.floor(Date.now() / 1000);
  const origin = request.headers.get('Origin');
  if (origin && !ORIGINS.has(origin)) return responseBody({ success: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, request);
  if (request.method === 'OPTIONS') return responseBody({}, 204, request);
  try {
    const methods = { register: 'POST', login: 'POST', me: 'GET', logout: 'POST', buy_with_balance: 'POST' };
    if (!Object.hasOwn(methods, action)) fail(404, 'NOT_FOUND', 'API không tồn tại.');
    if (request.method !== methods[action]) fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.');
    if (action === 'register' && request.method === 'POST') return responseBody(await register(request, env, now), 200, request);
    if (action === 'login' && request.method === 'POST') return responseBody(await login(request, env, now), 200, request);
    if (action === 'me' && request.method === 'GET') {
      const session = await sessionUser(request, env, now);
      return responseBody({ success: true, user: await userData(env, session, now) }, 200, request);
    }
    if (action === 'logout' && request.method === 'POST') return responseBody(await logout(request, env, now), 200, request);
    if (action === 'buy_with_balance' && request.method === 'POST') {
      const result = await purchase(request, env, now);
      return responseBody(result, result?.code === 'LICENSE_PENDING' || result?.status === 'PENDING' ? 202 : 200, request);
    }
    fail(404, 'NOT_FOUND', 'API không tồn tại.');
  } catch (error) {
    const status = Number(error.status) || 503;
    const body = { success: false, code: error.code || 'SERVICE_UNAVAILABLE', message: error.code ? error.message : 'Máy chủ tạm thời không khả dụng. Vui lòng thử lại.' };
    if (error.requestId) body.requestId = error.requestId;
    if (error.plan) body.plan = error.plan;
    if (error.pendingOrder) body.pendingOrder = error.pendingOrder;
    return responseBody(body, status, request);
  }
}
