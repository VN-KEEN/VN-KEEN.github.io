import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUser } from './functions/wallet-service.mjs';

class D1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return this.database.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  run() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class TestD1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Statement(this.database, sql); }
  batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  migrate(includeProducts = true) {
    const files = ['migrations/0001_licensegate.sql', 'migrations/0002_wallet.sql', 'migrations/0003_wallet_auth_orders.sql'];
    if (includeProducts) files.push('migrations/0004_wallet_products.sql');
    for (const file of files) {
      this.database.exec(readFileSync(file, 'utf8'));
    }
  }
}

function request(url, options = {}) { return new Request(url, options); }
async function json(response) { return response.json(); }

for (const origin of ['https://vn-keen.skin', 'https://www.vn-keen.skin']) {
  const preflight = await handleUser(request('https://vn-keen.pages.dev/api/user?action=login', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' }
  }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
}
const rejectedOrigin = await handleUser(request('https://vn-keen.pages.dev/api/user?action=login', {
  method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' }
}), {});
assert.equal(rejectedOrigin.status, 403);

const db = new TestD1();
db.migrate();
const env = { LICENSE_DB: db, SEPAY_ACCOUNT_NUMBER: '123456789', LICENSEGATE_API_KEY: 'test-provider' };

let response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=register', {
  method: 'POST', body: JSON.stringify({ username: 'Alice_1', password: 'correct horse battery staple' }), headers: { 'Content-Type': 'application/json' }
}), env);
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.match(body.token, /^[A-F0-9]{64}$/);
assert.match(body.user.depositCode, /^VNW[A-F0-9]{24}$/);
const token = body.token;

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=me', { headers: { Authorization: `Bearer ${token}` } }), env);
body = await json(response);
assert.equal(body.user.username, 'Alice_1');

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=login', {
  method: 'POST', body: JSON.stringify({ username: 'missing', password: 'correct horse battery staple' }), headers: { 'Content-Type': 'application/json' }
}), env);
assert.equal(response.status, 401);

db.prepare('UPDATE wallet_accounts SET balance=50000 WHERE username=?').bind('alice_1').run();
const originalFetchForPending = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('provider timeout'); };
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-alice-1' }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}), env);
body = await json(response);
assert.equal(response.status, 202);
assert.equal(body.code, 'LICENSE_PENDING');
assert.equal(body.user.balance, 50000);
assert.equal(body.user.reservedBalance, 20000);

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-alice-2' }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}), env);
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.code, 'PURCHASE_PENDING');
assert.equal(body.requestId, 'request-alice-1');

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-alice-1' }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}), env);
body = await json(response);
assert.equal(response.status, 202);
assert.equal(body.status, 'PENDING');
assert.equal(body.user.reservedBalance, 20000);
globalThis.fetch = originalFetchForPending;

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'monthly', requestId: 'request-alice-1' }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}), env);
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.code, 'REQUEST_ID_PLAN_MISMATCH');

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=me', { headers: { Authorization: 'Bearer ' + '0'.repeat(64) } }), env);
assert.equal(response.status, 401);

// A provider-confirmed purchase charges exactly once and is replayable by the
// same request id without another provider call or another ledger row.
const db2 = new TestD1();
db2.migrate();
const env2 = { LICENSE_DB: db2, SEPAY_ACCOUNT_NUMBER: '123456789', LICENSEGATE_API_KEY: 'test-provider' };
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=register', {
  method: 'POST', body: JSON.stringify({ username: 'buyer', password: 'correct horse battery staple' }), headers: { 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
const token2 = body.token;
db2.prepare('UPDATE wallet_accounts SET balance=50000 WHERE username=?').bind('buyer').run();
const originalFetch = globalThis.fetch;
let providerCalls = 0;
const providerInputs = [];
globalThis.fetch = async (_url, options) => {
  providerCalls += 1;
  const input = JSON.parse(options.body);
  providerInputs.push(input);
  return new Response(JSON.stringify({ id: 42, active: true, ipLimit: 1, name: input.name, expirationDate: input.expirationDate, licenseKey: input.licenseKey, licenseScope: input.licenseScope }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-buyer-1' }), headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.status, 'FULFILLED');
assert.match(body.key, /^VN-KEEN-SKIN-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
assert.equal(body.product, 'skin');
assert.equal(providerInputs[0].licenseScope, 'VN-KEEN-SKIN');
assert.equal(body.user.balance, 30000);
assert.equal(body.user.reservedBalance, 0);
assert.equal(db2.prepare("SELECT count(*) AS count FROM wallet_ledger WHERE type='BUY_KEY'").first().count, 1);
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-buyer-1' }), headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
assert.equal(body.status, 'FULFILLED');
assert.equal(providerCalls, 1);

response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ product: 'aim', plan: 'daily', requestId: 'request-buyer-aim-1' }), headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.status, 'FULFILLED');
assert.equal(body.product, 'aim');
assert.match(body.key, /^VN-KEEN-AIM-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
assert.equal(providerCalls, 2);
assert.equal(providerInputs[1].licenseScope, 'VN-KEEN-AIM');
assert.equal(body.user.balance, 10000);
assert.equal(body.user.reservedBalance, 0);
assert.deepEqual(body.user.keys.map(key => key.productId).sort(), ['aim', 'skin']);
assert.equal(db2.prepare('SELECT product FROM wallet_orders WHERE request_id=?').bind('request-buyer-aim-1').first().product, 'aim');

async function buy(input, targetEnv = env2, auth = token2) {
  const result = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
    method: 'POST', body: JSON.stringify(input), headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }
  }), targetEnv);
  return { status: result.status, body: await json(result) };
}

// Replays cannot change a product in either direction, or debit twice.
for (const [requestId, product, expectedProduct] of [
  ['request-buyer-1', 'aim', 'skin'], ['request-buyer-aim-1', 'skin', 'aim']
]) {
  const mismatch = await buy({ requestId, product, plan: 'daily' });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'REQUEST_ID_PRODUCT_MISMATCH');
  assert.equal(mismatch.body.product, expectedProduct);
  assert.equal(mismatch.body.pendingOrder.product, expectedProduct);
}
const replayAim = await buy({ product: 'aim', plan: 'daily', requestId: 'request-buyer-aim-1' });
assert.equal(replayAim.status, 200);
assert.equal(replayAim.body.product, 'aim');
assert.equal(providerCalls, 2);
assert.equal(db2.prepare('SELECT balance FROM wallet_accounts WHERE username=?').bind('buyer').first().balance, 10000);
assert.equal(db2.prepare("SELECT count(*) AS count FROM wallet_ledger WHERE type='BUY_KEY'").first().count, 2);
for (const product of ['both', 'essentials', 'invalid', '', null, {}, '__proto__']) {
  const invalid = await buy({ product, plan: 'daily', requestId: 'invalid-product-1' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVALID_PRODUCT');
}
assert.equal(db2.prepare('SELECT count(*) AS count FROM wallet_orders').first().count, 2);

// Wrong scope from the provider must leave a recoverable pending order, no debit.
db2.prepare('UPDATE wallet_accounts SET balance=50000 WHERE username=?').bind('buyer').run();
globalThis.fetch = async (_url, options) => {
  const input = JSON.parse(options.body);
  assert.equal(input.licenseScope, 'VN-KEEN-AIM');
  return new Response(JSON.stringify({ ...input, id: 99, licenseScope: 'VN-KEEN-SKIN' }), { status: 200 });
};
const wrongScope = await buy({ product: 'aim', plan: 'daily', requestId: 'aim-wrong-scope-1' });
assert.equal(wrongScope.status, 202);
assert.equal(wrongScope.body.product, 'aim');
assert.equal(wrongScope.body.user.balance, 50000);
assert.equal(wrongScope.body.user.reservedBalance, 20000);
assert.equal(wrongScope.body.user.pendingOrders[0].product, 'aim');
assert.equal(db2.prepare("SELECT count(*) AS count FROM wallet_ledger WHERE type='BUY_KEY'").first().count, 2);
const conflictingSkin = await buy({ product: 'skin', plan: 'daily', requestId: 'skin-during-aim-1' });
assert.equal(conflictingSkin.status, 409);
assert.equal(conflictingSkin.body.code, 'PURCHASE_PENDING');
assert.equal(conflictingSkin.body.product, 'aim');
globalThis.fetch = originalFetch;

// Additive migration labels historical orders as SKIN without altering money,
// licenses, reservations, or ledger rows.
const legacy = new TestD1();
legacy.migrate(false);
legacy.database.exec(`
  INSERT INTO wallet_accounts (username,display_name,balance,created_at,updated_at)
    VALUES ('legacy','Legacy',100000,'2026-09-01','2026-09-01');
  INSERT INTO wallet_orders (request_id,username,plan,amount,days,status,license_key,created_at,updated_at)
    VALUES ('legacy-fulfilled','legacy','daily',20000,1,'FULFILLED','VN-KEEN-SKIN-TEST-LEGACY','2026-09-01','2026-09-01');
  INSERT INTO wallet_orders (request_id,username,plan,amount,days,status,license_key,created_at,updated_at)
    VALUES ('legacy-pending','legacy','daily',20000,1,'PROCESSING','VN-KEEN-SKIN-TEST-PENDING','2026-09-01','2026-09-01');
`);
const beforeAccount = legacy.prepare('SELECT * FROM wallet_accounts').first();
const beforeOrders = legacy.prepare('SELECT * FROM wallet_orders ORDER BY request_id').all().results;
legacy.database.exec(readFileSync('migrations/0004_wallet_products.sql', 'utf8'));
assert.deepEqual(legacy.prepare('SELECT * FROM wallet_accounts').first(), beforeAccount);
const afterOrders = legacy.prepare('SELECT * FROM wallet_orders ORDER BY request_id').all().results;
assert(afterOrders.every(order => order.product === 'skin'));
assert.deepEqual(afterOrders.map(({product, ...order}) => order), beforeOrders.map(order => ({...order})));

console.log('wallet-service smoke tests passed');
