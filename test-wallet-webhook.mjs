import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleWalletWebhook } from './functions/wallet-webhook.mjs';

function localD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['migrations/0001_licensegate.sql', 'migrations/0002_wallet.sql', 'migrations/0003_wallet_auth_orders.sql']) {
    sqlite.exec(readFileSync(file, 'utf8'));
  }
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...next) { return statement(sql, next); },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    }
  });
  const adapter = {
    sqlite,
    prepare: statement,
    async batch(items) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const [index, item] of items.entries()) {
          const changes = Number(sqlite.prepare(item.sql).run(...item.args).changes);
          // Cloudflare D1 may report trigger side effects in meta.changes;
          // make the adapter deliberately differ from node:sqlite here.
          const reported = changes > 0 ? changes + adapter.reportTriggerChanges : changes;
          result.push({ meta: { changes: reported } });
          if (adapter.failAfter === index + 1) throw new Error('TEST_ROLLBACK');
        }
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  adapter.failAfter = null;
  adapter.reportTriggerChanges = 0;
  return adapter;
}

function setup() {
  const LICENSE_DB = localD1();
  const depositCode = 'VNW' + 'A'.repeat(24);
  LICENSE_DB.sqlite.prepare(`INSERT INTO wallet_accounts
    (username,display_name,deposit_code,balance,reserved_balance,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run('alice', 'Alice', depositCode, 0, 0, 'x', 'x');
  const env = { LICENSE_DB, SEPAY_WEBHOOK_SECRET: 'test-secret', SEPAY_ACCOUNT_NUMBER: '123' };
  const request = (body, headers = {}) => new Request('https://example.test/api/webhook', {
    method: 'POST',
    headers: { Authorization: 'Apikey test-secret', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { LICENSE_DB, env, depositCode, request };
}

test('requires POST and the SePay Apikey', async () => {
  const { env, request } = setup();
  const get = await handleWalletWebhook(new Request('https://example.test/api/webhook'), env);
  assert.equal(get.status, 405);
  const unauthorized = await handleWalletWebhook(request({}), { ...env, SEPAY_WEBHOOK_SECRET: 'different' });
  assert.equal(unauthorized.status, 401);
});

test('credits a deposit once, including duplicate delivery', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  const body = { transferType: 'in', accountNumber: '123', id: 42, transferAmount: 50000, content: depositCode };
  const first = await handleWalletWebhook(request(body), env, 1000);
  const second = await handleWalletWebhook(request(body), env, 1000);
  assert.deepEqual(await first.json(), { success: true, type: 'TOPUP', duplicate: false });
  assert.deepEqual(await second.json(), { success: true, type: 'TOPUP', duplicate: true });
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 50000);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_ledger').get().count, 1);
});

test('uses the unique receipt marker instead of D1 meta.changes', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  LICENSE_DB.reportTriggerChanges = 3;
  const body = { transferType: 'in', accountNumber: '123', id: 43, transferAmount: 50000, content: depositCode };
  const first = await handleWalletWebhook(request(body), env, 1000);
  const second = await handleWalletWebhook(request(body), env, 1000);
  assert.deepEqual(await first.json(), { success: true, type: 'TOPUP', duplicate: false });
  assert.deepEqual(await second.json(), { success: true, type: 'TOPUP', duplicate: true });
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 50000);
});

test('parallel duplicate deliveries credit exactly once', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  const body = { transferType: 'in', accountNumber: '123', id: 44, transferAmount: 75000, content: depositCode };
  const responses = await Promise.all(Array.from({ length: 12 }, () => handleWalletWebhook(request(body), env, 1000)));
  const payloads = await Promise.all(responses.map(response => response.json()));
  assert.equal(payloads.filter(payload => payload.duplicate === false).length, 1);
  assert.equal(payloads.filter(payload => payload.duplicate === true).length, 11);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 75000);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_ledger').get().count, 1);
});

test('rolls the ledger and balance back together when the D1 batch fails', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  const body = { transferType: 'in', accountNumber: '123', id: 45, transferAmount: 25000, content: depositCode };
  LICENSE_DB.failAfter = 1;
  const failed = await handleWalletWebhook(request(body), env, 1000);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, 'PAYMENT_RETRY_REQUIRED');
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 0);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_ledger').get().count, 0);
  LICENSE_DB.failAfter = null;
  const retried = await handleWalletWebhook(request(body), env, 1000);
  assert.deepEqual(await retried.json(), { success: true, type: 'TOPUP', duplicate: false });
});

test('does not auto-create an unknown deposit account', async () => {
  const { env, LICENSE_DB, request } = setup();
  const body = { transferType: 'in', accountNumber: '123', id: 43, transferAmount: 50000, content: 'VNW' + 'B'.repeat(24) };
  const response = await handleWalletWebhook(request(body), env);
  assert.deepEqual(await response.json(), { success: true, reviewRequired: true, reason: 'UNKNOWN_DEPOSIT_CODE' });
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_accounts').get().count, 1);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_ledger').get().count, 0);
});

test('reviews invalid, mixed, and repeated payment codes without crediting', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  const cases = [
    ['two deposit codes', `${depositCode} VNW${'B'.repeat(24)}`, 'AMBIGUOUS_PAYMENT_CODE'],
    ['mixed wallet and checkout codes', `${depositCode} VNK${'C'.repeat(10)}`, 'AMBIGUOUS_PAYMENT_CODE'],
    ['malformed hexadecimal code', `VNW${'G'.repeat(24)}`, 'UNKNOWN_DEPOSIT_CODE'],
    ['legacy username code', 'NAP ALICE', 'UNKNOWN_DEPOSIT_CODE']
  ];
  for (const [index, [label, content, reason]] of cases.entries()) {
    const response = await handleWalletWebhook(request({
      transferType: 'in', accountNumber: '123', id: 100 + index,
      transferAmount: 1000, content
    }), env);
    assert.deepEqual(await response.json(), { success: true, reviewRequired: true, reason }, label);
  }
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 0);
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT count(*) AS count FROM wallet_ledger').get().count, 0);
});

test('rejects negative, fractional, string, and unsafe transaction values', async () => {
  const { env, request } = setup();
  const base = { transferType: 'in', accountNumber: '123', content: 'VNW' + 'A'.repeat(24) };
  for (const id of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const response = await handleWalletWebhook(request({ ...base, id, transferAmount: 1000 }), env);
    assert.equal(response.status, 400, `id=${String(id)}`);
  }
  const amounts = [0, -1, 1.5, '1000', Number.MAX_SAFE_INTEGER + 1];
  for (const [index, amount] of amounts.entries()) {
    const response = await handleWalletWebhook(request({ ...base, id: 300 + index, transferAmount: amount }), env);
    assert.equal(response.status, 400, `amount=${String(amount)}`);
  }
});

test('rejects invalid inbound amount/id and ignores another account number', async () => {
  const { env, request } = setup();
  const invalid = await handleWalletWebhook(request({ transferType: 'in', accountNumber: '123', id: 0, transferAmount: 1, content: '' }), env);
  assert.equal(invalid.status, 400);
  const ignored = await handleWalletWebhook(request({ transferType: 'out', accountNumber: '123', id: 0, transferAmount: 0, content: '' }), env);
  assert.deepEqual(await ignored.json(), { success: true, ignored: true });
});

test('does not let a transaction used by LicenseGate fund a wallet', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  LICENSE_DB.sqlite.prepare(`INSERT INTO lg_orders
    (id,token_hash,product,plan,amount,days,license_key,status,created_at,checkout_expires,transaction_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('VNK' + 'D'.repeat(10), 'hash', 'skin', 'daily', 1000, 1, 'license-d', 'PAID', 1, 2000, '501');
  const response = await handleWalletWebhook(request({ transferType: 'in', accountNumber: '123', id: 501, transferAmount: 1000, content: depositCode }), env);
  assert.deepEqual(await response.json(), { success: true, reviewRequired: true, reason: 'TRANSACTION_ALREADY_USED' });
  assert.equal(LICENSE_DB.sqlite.prepare('SELECT balance FROM wallet_accounts WHERE username=?').get('alice').balance, 0);
});

test('does not let a wallet transaction be attached to a LicenseGate order', async () => {
  const { env, LICENSE_DB, depositCode, request } = setup();
  const credited = await handleWalletWebhook(request({ transferType: 'in', accountNumber: '123', id: 502, transferAmount: 1000, content: depositCode }), env);
  assert.deepEqual(await credited.json(), { success: true, type: 'TOPUP', duplicate: false });
  assert.throws(() => LICENSE_DB.sqlite.prepare(`INSERT INTO lg_orders
    (id,token_hash,product,plan,amount,days,license_key,status,created_at,checkout_expires,transaction_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('VNK' + 'E'.repeat(10), 'hash', 'skin', 'daily', 1000, 1, 'license-e', 'PAID', 1, 2000, '502'), /TRANSACTION_ALREADY_USED/);
  LICENSE_DB.sqlite.prepare(`INSERT INTO lg_orders
    (id,token_hash,product,plan,amount,days,license_key,status,created_at,checkout_expires)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('VNK' + 'F'.repeat(10), 'hash', 'skin', 'daily', 1000, 1, 'license-f', 'PENDING', 1, 2000);
  assert.throws(() => LICENSE_DB.sqlite.prepare("UPDATE lg_orders SET transaction_id='502' WHERE id=?").run('VNK' + 'F'.repeat(10)), /TRANSACTION_ALREADY_USED/);
});
