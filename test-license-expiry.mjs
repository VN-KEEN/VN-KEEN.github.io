import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleLicenseExpiry } from './functions/license-expiry-service.mjs';

globalThis.crypto ??= webcrypto;
const key = 'VN-KEEN-SKIN-ABCD-EFGH-JKLM-NPQR';
let attempts = 0;
let providerCalls = 0;
const env = {
  LICENSEGATE_API_KEY: 'test-secret',
  LICENSE_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ attempts: ++attempts }) }) }) }
};
globalThis.fetch = async (url, options) => {
  providerCalls += 1;
  assert.ok(url.startsWith('https://api.licensegate.io/admin/licenses/key/'));
  assert.equal(options.headers.Authorization, 'test-secret');
  return new Response(JSON.stringify({
    licenseKey: key, licenseScope: 'VN-KEEN-SKIN', active: true,
    expirationDate: '2026-10-09T12:00:00.000Z'
  }), { status: 200 });
};
const request = body => new Request('https://vn-keen.skin/api/license-expiry', {
  method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.10', Origin: 'https://vn-keen.skin' },
  body: JSON.stringify(body)
});
let response = await handleLicenseExpiry(request({ key }), env, 1791460800);
assert.equal(response.status, 200);
let data = await response.json();
assert.equal(data.expiresAt, Date.parse('2026-10-09T12:00:00.000Z') / 1000);
assert.equal(data.serverTime, 1791460800);
assert.equal(data.lifetime, false);
assert.equal(data.key, undefined);
assert.equal(providerCalls, 1);

response = await handleLicenseExpiry(request({ key: 'VN-KEEN-AIM-ABCD-EFGH-JKLM-NPQR' }), env);
assert.equal(response.status, 404);
response = await handleLicenseExpiry(request({ key: 'bad' }), env);
assert.equal(response.status, 400);
assert.equal(providerCalls, 2);
attempts = 40;
response = await handleLicenseExpiry(request({ key }), env);
assert.equal(response.status, 429);
assert.equal(providerCalls, 2);
console.log('PASS license expiry API: valid key, scope mismatch, malformed key, rate limit');
