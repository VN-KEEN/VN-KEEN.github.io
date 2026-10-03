import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { ESSENTIALS_RELEASE, MAX_DOWNLOAD_BYTES, validateRelease, readReleaseBytes, verifyReleaseBytes, verifiedEssentialsDownload } from './download-integrity.mjs';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const release = ESSENTIALS_RELEASE;
const oldFiles = ['VN-KEEN-ESSENTIALS.zip', 'VN-KEEN-SKIN-ESSENTIALS.zip'];
const home = read('./index.html');
const essentials = read('./essentials.html');

for (const [name, html] of [['index.html', home], ['essentials.html', essentials]]) {
  const downloadLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*\bdownload\b[^>]*>/g)]
    .map(match => match[1]);
  assert(downloadLinks.includes(release), `${name} must link to the versioned Essentials release`);
  for (const oldFile of oldFiles) {
    assert(!downloadLinks.includes(oldFile), `${name} must not link to an old Essentials cache key`);
  }
  assert(html.includes('type="module" src="download-integrity.mjs?v=20261003-LicenseGate"'), `${name} must load the download verifier`);
}

assert(home.includes(`file: '${release}'`), 'Product picker and My Keys must use the same versioned release');
assert(home.includes("file: 'VN-KEEN-SKIN-VANTIX.zip'"), 'SKIN download must remain unchanged');
assert(essentials.includes('LicenseGate • Key VN-KEEN-AIM'), 'Essentials must identify its licensing provider and product');
assert(essentials.includes('href="downloads.json"'), 'Essentials must expose the checksum metadata');

const redirects = read('./_redirects').split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
for (const oldFile of oldFiles) {
  assert(redirects.includes(`/${oldFile} /${release} 302`), `${oldFile} must redirect to the current release`);
}
const headers = read('./_headers');
assert(headers.includes(`/${release}\n  Cache-Control: public, max-age=31536000, immutable`), 'Versioned release must be immutable');
assert(headers.includes('/downloads.json\n  Cache-Control: no-cache, max-age=0, must-revalidate'), 'Release metadata must revalidate');

const fixture = new TextEncoder().encode('synthetic zip bytes for offline integrity tests');
const fixtureHash = createHash('sha256').update(fixture).digest('hex');
const fixtureRelease = { file: release, scope: 'VN-KEEN-AIM', sizeBytes: fixture.byteLength, sha256: fixtureHash };
const fixtureManifest = { schemaVersion: 1, products: { aim: fixtureRelease } };
assert.equal(validateRelease(fixtureManifest), fixtureRelease);
for (const invalid of [
  { ...fixtureRelease, file: 'https://other.invalid/file.zip' },
  { ...fixtureRelease, file: oldFiles[0] },
  { ...fixtureRelease, scope: 'VN-KEEN-SKIN' },
  { ...fixtureRelease, sizeBytes: MAX_DOWNLOAD_BYTES + 1 },
  { ...fixtureRelease, sizeBytes: 0 },
  { ...fixtureRelease, sha256: 'not-a-hash' }
]) {
  assert.throws(() => validateRelease({ schemaVersion: 1, products: { aim: invalid } }));
}
assert.throws(() => validateRelease({ schemaVersion: 2, products: { aim: fixtureRelease } }));
assert.throws(() => validateRelease({}));
assert.equal(await verifyReleaseBytes(fixture, fixtureRelease, webcrypto), fixtureHash);
const tampered = fixture.slice();
tampered[0] ^= 1;
await assert.rejects(() => verifyReleaseBytes(tampered, fixtureRelease, webcrypto), /SHA-256 không khớp/);
await assert.rejects(() => verifyReleaseBytes(fixture.subarray(1), fixtureRelease, webcrypto), /Kích thước/);
await assert.rejects(() => verifyReleaseBytes(fixture, fixtureRelease, {}), /chưa hỗ trợ/);
await assert.rejects(() => readReleaseBytes(new Response(fixture, { status: 503 }), fixture.byteLength), /Không tải/);
await assert.rejects(() => readReleaseBytes(new Response(fixture, { headers: { 'Content-Length': String(fixture.byteLength + 1) } }), fixture.byteLength), /Kích thước/);
await assert.rejects(() => readReleaseBytes(new Response(fixture.subarray(1)), fixture.byteLength), /chưa đầy đủ/);
await assert.rejects(() => readReleaseBytes(new Response(fixture), fixture.byteLength - 1), /vượt giới hạn/);
await assert.rejects(() => readReleaseBytes(new Response(fixture), MAX_DOWNLOAD_BYTES + 1), /không hợp lệ/);

const calls = [];
const fetcher = async (url, options) => {
  calls.push({ url: String(url), options });
  return calls.length === 1 ? Response.json(fixtureManifest) : new Response(fixture);
};
const verified = await verifiedEssentialsDownload({ fetcher, cryptoApi: webcrypto, baseUrl: 'https://vn-keen.pages.dev/essentials' });
assert.deepEqual(verified.bytes, fixture);
assert.deepEqual(calls.map(call => call.url), ['https://vn-keen.pages.dev/downloads.json', `https://vn-keen.pages.dev/${release}`]);
assert(calls.every(call => call.options.cache === 'no-store'), 'Both manifest and ZIP must bypass stored browser responses');
let mismatchCalls = 0;
await assert.rejects(() => verifiedEssentialsDownload({
  fetcher: async () => ++mismatchCalls === 1 ? Response.json(fixtureManifest) : new Response(tampered),
  cryptoApi: webcrypto,
  baseUrl: 'https://vn-keen.pages.dev/'
}), /SHA-256 không khớp/);
assert.equal(mismatchCalls, 2, 'Mismatch must fail without a fallback download');
await assert.rejects(() => verifiedEssentialsDownload({
  fetcher: async () => new Response('', { status: 404 }),
  cryptoApi: webcrypto,
  baseUrl: 'https://vn-keen.pages.dev/'
}), /Chưa lấy được/);
console.log('download integrity offline tests passed');

const manifest = JSON.parse(read('./downloads.json'));
const published = validateRelease(manifest);
const archive = fs.readFileSync(new URL(`./${published.file}`, import.meta.url));
assert.equal(archive.length, published.sizeBytes, 'Published ZIP size must match metadata');
assert.equal(createHash('sha256').update(archive).digest('hex'), published.sha256.toLowerCase(), 'Published ZIP hash must match metadata');
const alias = fs.readFileSync(new URL('./VN-KEEN-ESSENTIALS.zip', import.meta.url));
assert(archive.equals(alias), 'Compatibility ZIP must be byte-identical to the versioned release');
console.log('download release link and local artifact tests passed');
