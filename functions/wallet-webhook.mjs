import { handle as handleLicenseGate, hash } from '../licensegate-service.mjs';

const MAX_BODY_LENGTH = 8192;
const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

function fail(status, code) {
  throw Object.assign(new Error(code), { status, code });
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) fail(413, 'BODY_TOO_LARGE');
  let data;
  try { data = JSON.parse(text); } catch { fail(400, 'INVALID_JSON'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'INVALID_JSON');
  return data;
}

const review = (reason) => ({ success: true, reviewRequired: true, reason });

export async function creditDeposit(env, { depositCode, amount, referenceId }, now) {
  const db = env.LICENSE_DB;
  const account = await db.prepare('SELECT username FROM wallet_accounts WHERE deposit_code=?')
    .bind(depositCode).first();
  if (!account) return review('UNKNOWN_DEPOSIT_CODE');

  // Each delivery receives a unique insertion marker. A retry cannot match an
  // old ledger row, even if another worker handles it at the same time. The
  // migration's TOPUP ledger trigger applies the balance increment inside the
  // same SQLite transaction; no separate balance update can double-credit it.
  const receiptId = 'TOPUP-' + crypto.randomUUID();
  const createdAt = new Date(now * 1000).toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO wallet_ledger
        (id,username,type,amount,description,reference_id,created_at)
        SELECT ?,username,'TOPUP',?,?,?,? FROM wallet_accounts
        WHERE deposit_code=? AND typeof(balance)='integer' AND balance>=0 AND balance<=?
          AND NOT EXISTS (SELECT 1 FROM lg_orders WHERE transaction_id=?)
        ON CONFLICT(reference_id) DO NOTHING`)
        .bind(receiptId, amount, 'Nạp tiền ngân hàng', referenceId, createdAt,
          depositCode, MAX_BALANCE - amount, referenceId)
    ]);
  } catch {
    // A failed D1 batch rolls back the ledger and balance together. A
    // cross-flow transaction race is a review, not an endlessly retryable
    // payment: migration 0003's trigger rejects that race atomically.
    const usedByOrder = await db.prepare('SELECT id FROM lg_orders WHERE transaction_id=?')
      .bind(referenceId).first().catch(() => null);
    if (usedByOrder) return review('TRANSACTION_ALREADY_USED');
    fail(503, 'PAYMENT_RETRY_REQUIRED');
  }

  // D1's meta.changes may include writes performed by AFTER INSERT triggers.
  // The receipt id is unique to this delivery, so checking that exact row is
  // the reliable insertion signal regardless of the provider's change count.
  const receipt = await db.prepare(`SELECT username,type,amount,reference_id
    FROM wallet_ledger WHERE id=? AND reference_id=?`)
    .bind(receiptId, referenceId).first();
  if (receipt) {
    return { success: true, type: 'TOPUP', duplicate: false };
  }

  const ledger = await db.prepare('SELECT username,type,amount FROM wallet_ledger WHERE reference_id=?')
    .bind(referenceId).first();
  if (ledger) {
    if (ledger.username === account.username && ledger.type === 'TOPUP' && ledger.amount === amount) {
      return { success: true, type: 'TOPUP', duplicate: true };
    }
    return review('TRANSACTION_ALREADY_USED');
  }
  const order = await db.prepare('SELECT id FROM lg_orders WHERE transaction_id=?').bind(referenceId).first();
  if (order) return review('TRANSACTION_ALREADY_USED');
  return review('BALANCE_LIMIT_OR_ACCOUNT_CHANGED');
}

export async function handleWalletWebhook(request, env, now = Math.floor(Date.now() / 1000)) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== 'POST') {
    headers.Allow = 'POST';
    return reply({ success: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  }
  try {
    if (!env?.LICENSE_DB || !env.SEPAY_WEBHOOK_SECRET || !env.SEPAY_ACCOUNT_NUMBER) fail(503, 'NOT_CONFIGURED');
    const expected = await hash('Apikey ' + env.SEPAY_WEBHOOK_SECRET);
    if (await hash(request.headers.get('Authorization') || '') !== expected) fail(401, 'UNAUTHORIZED');

    // Keep the intact authenticated payload available for the existing secure
    // direct-checkout handler; never mint or simulate licenses in this endpoint.
    const original = request.clone();
    const body = await readBody(request);
    if (body.transferType !== 'in' || String(body.accountNumber) !== String(env.SEPAY_ACCOUNT_NUMBER)) {
      return reply({ success: true, ignored: true });
    }
    if (!Number.isSafeInteger(body.id) || body.id <= 0 ||
        !Number.isSafeInteger(body.transferAmount) || body.transferAmount <= 0) fail(400, 'INVALID_TRANSACTION');

    const content = typeof body.content === 'string' ? body.content.toUpperCase() : '';
    const deposits = content.match(/\bVNW[A-F0-9]{24}\b/g) || [];
    const orders = content.match(/\bVNK[A-F0-9]{10}\b/g) || [];
    if (deposits.length > 1 || (deposits.length && orders.length)) return reply(review('AMBIGUOUS_PAYMENT_CODE'));
    if (!deposits.length) {
      if (orders.length === 1) {
        const used = await env.LICENSE_DB.prepare('SELECT id FROM wallet_ledger WHERE reference_id=?')
          .bind(String(body.id)).first();
        if (used) return reply(review('TRANSACTION_ALREADY_USED'));
        return handleLicenseGate(original, env, 'webhook', now);
      }
      return reply(review(orders.length > 1 ? 'AMBIGUOUS_PAYMENT_CODE' : 'UNKNOWN_DEPOSIT_CODE'));
    }
    return reply(await creditDeposit(env, {
      depositCode: deposits[0], amount: body.transferAmount, referenceId: String(body.id)
    }, now));
  } catch (error) {
    // Provider / database details can contain confidential data. Do not log or
    // echo the raw exception, webhook body, bank account, or secret.
    return reply({ success: false, code: error.code || 'SERVICE_UNAVAILABLE' }, error.status || 503);
  }
}
