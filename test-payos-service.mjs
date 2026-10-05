import assert from 'node:assert/strict';
const { createPayosLink, handlePayosWebhook } = await import('./functions/payos-service.mjs');

const env = { PAYOS_CLIENT_ID: 'client-id', PAYOS_API_KEY: 'api-key', PAYOS_CHECKSUM_KEY: 'checksum-key' };
const account = { deposit_code: 'VNW0123456789ABCDEF01234567' };

const originalFetch = globalThis.fetch;
let captured;
globalThis.fetch = async (_url, options) => {
  captured = JSON.parse(options.body);
  return new Response(JSON.stringify({ code: '00', data: { checkoutUrl: 'https://pay.payos.vn/test' } }), { status: 200 });
};

const link = await createPayosLink(env, account, 20000, 1700000000);
assert.equal(link.success, true);
assert.equal(link.checkoutUrl, 'https://pay.payos.vn/test');
assert.equal(captured.amount, 20000);
assert.match(captured.description, /^VNW[A-F0-9]{20}$/);
assert.equal(typeof captured.signature, 'string');
assert.equal(captured.signature.length, 64);

const invalid = await handlePayosWebhook(new Request('https://example.test', { method: 'POST', body: '{}' }), { LICENSE_DB: {} });
assert.equal(invalid.status, 503);

globalThis.fetch = originalFetch;
console.log('payOS service tests passed');
