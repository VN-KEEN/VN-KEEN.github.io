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
  migrate() {
    for (const file of ['migrations/0001_licensegate.sql', 'migrations/0002_wallet.sql', 'migrations/0003_wallet_auth_orders.sql']) {
      this.database.exec(readFileSync(file, 'utf8'));
    }
  }
}

function request(url, options = {}) { return new Request(url, options); }
async function json(response) { return response.json(); }

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
globalThis.fetch = async (_url, options) => {
  providerCalls += 1;
  const input = JSON.parse(options.body);
  return new Response(JSON.stringify({ id: 42, active: true, ipLimit: 1, name: input.name, expirationDate: input.expirationDate, licenseKey: input.licenseKey, licenseScope: input.licenseScope }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-buyer-1' }), headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.status, 'FULFILLED');
assert.match(body.key, /^VN-KEEN-SKIN-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
assert.equal(body.user.balance, 30000);
assert.equal(body.user.reservedBalance, 0);
assert.equal(db2.prepare("SELECT count(*) AS count FROM wallet_ledger WHERE type='BUY_KEY'").first().count, 1);
response = await handleUser(request('https://vn-keen.pages.dev/api/user?action=buy_with_balance', {
  method: 'POST', body: JSON.stringify({ plan: 'daily', requestId: 'request-buyer-1' }), headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
}), env2);
body = await json(response);
assert.equal(body.status, 'FULFILLED');
assert.equal(providerCalls, 1);
globalThis.fetch = originalFetch;

console.log('wallet-service smoke tests passed');
