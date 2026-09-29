// LicenseGate checkout is isolated from the existing KeyAuth payment flow.
// Secrets are Cloudflare bindings, never browser configuration.
export const PLANS = Object.freeze({
  daily: { amount: 20000, days: 1 },
  monthly: { amount: 300000, days: 30 },
  lifetime: { amount: 2000000, days: null }
});

const SCOPES = { skin: 'VN-KEEN-SKIN', aim: 'VN-KEEN-AIM' };
const ORIGINS = new Set(['https://vn-keen.github.io', 'https://vn-keen.pages.dev']);
const encoder = new TextEncoder();
export async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function newLicenseKey(product = 'skin') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const block = (start) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[buf[start + i] % chars.length];
    return s;
  };
  const prefix = product === 'aim' ? 'VN-KEEN-AIM' : 'VN-KEEN-SKIN';
  return `${prefix}-${block(0)}-${block(4)}-${block(8)}-${block(12)}`;
}
function fail(status, code) { throw Object.assign(new Error(code), { status, code }); }
function ready(env) {
  if (!env.LICENSE_DB || !env.LICENSEGATE_API_KEY || !env.SEPAY_WEBHOOK_SECRET ||
      !env.SEPAY_ACCOUNT_NUMBER || !env.LICENSEGATE_USER_ID) fail(503, 'NOT_CONFIGURED');
}
async function readBody(request) {
  const text = await request.text();
  if (text.length > 8192) fail(413, 'BODY_TOO_LARGE');
  try { const data = JSON.parse(text); if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'INVALID_JSON'); return data; }
  catch { fail(400, 'INVALID_JSON'); }
}
async function provider(env, path, options = {}) {
  return fetch('https://api.licensegate.io' + path, {
    ...options, headers: { Authorization: 'Bearer ' + env.LICENSEGATE_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
}
export async function fulfill(env, order) {
  if (order.status === 'FULFILLED') return;
  if (order.status !== 'PAID') fail(409, 'NOT_PAID');
  // Persist the randomly generated key before any provider call. Retrying after
  // a timeout always uses this same key; duplicate webhooks cannot mint more keys.
  const input = {
    active: true, name: order.id, notes: 'VN-KEEN website / ' + order.product + ' / ' + order.plan,
    licenseKey: order.license_key, licenseScope: SCOPES[order.product],
    expirationDate: order.expires_at === null ? null : new Date(order.expires_at * 1000).toISOString(),
    ipLimit: 1, validationLimit: null
  };
  let response = await provider(env, '/admin/licenses', { method: 'POST', body: JSON.stringify(input) });
  if (response.status === 400) {
    response = await provider(env, '/admin/licenses/key/' + encodeURIComponent(order.license_key));
  }
  if (!response.ok) fail(503, 'LICENSE_PROVIDER_UNAVAILABLE');
  const license = await response.json();
  const expiry = license.expirationDate == null ? null : Date.parse(license.expirationDate);
  if (license.licenseKey !== input.licenseKey || license.licenseScope !== input.licenseScope ||
      license.active !== true || license.ipLimit !== 1 || license.name !== order.id || !Number.isInteger(license.id) ||
      expiry !== (order.expires_at === null ? null : order.expires_at * 1000)) fail(503, 'LICENSE_PROVIDER_MISMATCH');
  await env.LICENSE_DB.prepare("UPDATE lg_orders SET status='FULFILLED', provider_id=? WHERE id=? AND status='PAID'")
    .bind(license.id, order.id).run();
}
async function checkout(request, env, now) {
  if (env.LICENSEGATE_CHECKOUT_ENABLED !== 'true') fail(503, 'CHECKOUT_NOT_ENABLED');
  const body = await readBody(request);
  // AIM prices must be supplied explicitly rather than silently using SKIN prices.
  const plan = Object.hasOwn(PLANS, body.plan) ? PLANS[body.plan] : null;
  if (!plan || !Object.hasOwn(SCOPES, body.product)) fail(400, 'INVALID_PLAN');
  const amount = body.product === 'aim' ? Number(env['AIM_PRICE_' + body.plan.toUpperCase()]) : plan.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) fail(503, 'PRODUCT_NOT_CONFIGURED');
  const id = 'VNK' + randomHex(5), token = randomHex(32);
  await env.LICENSE_DB.prepare(`INSERT INTO lg_orders
    (id,token_hash,product,plan,amount,days,license_key,created_at,checkout_expires)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, await hash(token), body.product, body.plan, amount,
      plan.days, newLicenseKey(body.product), now, now + 1800).run();
  return { success: true, orderId: id, token, amount, product: body.product, plan: body.plan,
    checkoutExpires: now + 1800, bank: { account: env.SEPAY_ACCOUNT_NUMBER, bank: 'MB', name: 'NGUYEN PHU QUY' } };
}
async function status(request, env) {
  const id = new URL(request.url).searchParams.get('orderId');
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (!/^VNK[A-F0-9]{10}$/.test(id || '') || !/^[A-F0-9]{64}$/.test(token)) fail(401, 'INVALID_ORDER_TOKEN');
  const order = await env.LICENSE_DB.prepare('SELECT * FROM lg_orders WHERE id=? AND token_hash=?')
    .bind(id, await hash(token)).first();
  if (!order) fail(404, 'ORDER_NOT_FOUND');
  return { success: true, orderId: order.id, status: order.status, product: order.product, plan: order.plan,
    paidAt: order.paid_at, expiresAt: order.expires_at,
    key: order.status === 'FULFILLED' ? order.license_key : undefined };
}
async function webhook(request, env, now) {
  const expected = await hash('Apikey ' + env.SEPAY_WEBHOOK_SECRET);
  if (await hash(request.headers.get('Authorization') || '') !== expected) fail(401, 'UNAUTHORIZED');
  const body = await readBody(request);
  if (body.transferType !== 'in' || String(body.accountNumber) !== env.SEPAY_ACCOUNT_NUMBER)
    return { success: true, ignored: true };
  if (!Number.isSafeInteger(body.id) || body.id <= 0 || !Number.isSafeInteger(body.transferAmount)) fail(400, 'INVALID_TRANSACTION');
  const matches = String(body.content || '').toUpperCase().match(/\bVNK[A-F0-9]{10}\b/g) || [];
  if (matches.length !== 1) return { success: true, ignored: true };
  const id = matches[0];
  let order = await env.LICENSE_DB.prepare('SELECT * FROM lg_orders WHERE id=?').bind(id).first();
  if (!order) return { success: true, ignored: true };
  if (body.transferAmount !== order.amount) return { success: true, reviewRequired: true, reason: 'AMOUNT_MISMATCH' };
  // Use the bank's transaction time (UTC+7), not webhook arrival time, for expiry
  // and late-delivery validation. The signature protects this payload.
  const date = String(body.transactionDate || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) fail(400, 'INVALID_TRANSACTION_DATE');
  const paidAt = Date.parse(date.replace(' ', 'T') + '+07:00') / 1000;
  if (!Number.isFinite(paidAt) || paidAt < order.created_at - 60 || paidAt > order.checkout_expires || paidAt > now + 60)
    return { success: true, reviewRequired: true, reason: 'PAYMENT_OUTSIDE_ORDER_WINDOW' };
  if (order.transaction_id && order.transaction_id !== String(body.id))
    return { success: true, reviewRequired: true, reason: 'ORDER_ALREADY_PAID' };
  const used = await env.LICENSE_DB.prepare('SELECT id FROM lg_orders WHERE transaction_id=?').bind(String(body.id)).first();
  if (used && used.id !== id) return { success: true, reviewRequired: true, reason: 'TRANSACTION_ALREADY_USED' };
  try {
    await env.LICENSE_DB.prepare(`UPDATE lg_orders SET status='PAID',transaction_id=?,paid_at=?,expires_at=?
      WHERE id=? AND status='PENDING'`).bind(String(body.id), paidAt,
        order.days === null ? null : paidAt + order.days * 86400, id).run();
  } catch { fail(503, 'PAYMENT_RETRY_REQUIRED'); }
  order = await env.LICENSE_DB.prepare('SELECT * FROM lg_orders WHERE id=?').bind(id).first();
  if (order.transaction_id !== String(body.id)) return { success: true, reviewRequired: true };
  await fulfill(env, order);
  return { success: true };
}
export async function handle(request, env, action, now = Math.floor(Date.now() / 1000)) {
  const origin = request.headers.get('Origin');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !ORIGINS.has(origin)) return reply({ success: false, code: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    ready(env);
    if (request.method !== (action === 'status' ? 'GET' : 'POST')) fail(405, 'METHOD_NOT_ALLOWED');
    const handlers = { checkout, status, webhook };
    if (!Object.hasOwn(handlers, action)) fail(404, 'NOT_FOUND');
    return reply(await handlers[action](request, env, now));
  } catch (error) {
    // Provider messages may contain keys: do not echo/log raw errors.
    return reply({ success: false, code: error.code || 'SERVICE_UNAVAILABLE' }, error.status || 503);
  }
}
