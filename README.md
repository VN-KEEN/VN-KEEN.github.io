# VN-KEEN

Website: https://vn-keen.pages.dev/

## LicenseGate checkout deployment

The public checkout is served from the static site and calls the Cloudflare Pages
API at `https://vn-keen.pages.dev/api/licensegate/`. Before accepting payments,
configure these Cloudflare Pages bindings for every deployed environment:

- D1 database binding: `LICENSE_DB` (apply `migrations/0001_licensegate.sql`,
  `migrations/0002_wallet.sql`, `migrations/0003_wallet_auth_orders.sql`, and
  `migrations/0004_wallet_products.sql` in
  order)
- Secret `LICENSEGATE_API_KEY`
- Variable `LICENSEGATE_USER_ID` (LicenseGate public user code)
- Secret `SEPAY_WEBHOOK_SECRET`
- Variable `SEPAY_ACCOUNT_NUMBER`
- Variable `LICENSEGATE_CHECKOUT_ENABLED=true`

Wallet account registration, bearer sessions, deposit-code top-ups, and
balance purchases require all four migrations. Existing rows in
`wallet_accounts` without a `wallet_credentials` row are intentionally locked
until an operator verifies and migrates them; a new browser registration must
not claim a legacy balance.

Set the SePay webhook URL to (this route handles both checkout orders and
authenticated wallet deposit codes):

`https://vn-keen.pages.dev/api/licensegate/webhook`

The browser only receives an order token. It never receives the LicenseGate or
SePay secrets, and it shows a key only after the authenticated order status is
`FULFILLED`.

Production configuration is managed in the Cloudflare Pages project settings;
environment changes take effect on the next deployment.

## Separate wallet products

- `product: "skin"`: VN-KEEN-SKIN-VANTIX, LicenseGate scope/key prefix `VN-KEEN-SKIN`.
- `product: "aim"`: VN-KEEN-ESSENTIALS, LicenseGate scope/key prefix `VN-KEEN-AIM`.
- Both use daily 20,000 VND, monthly 300,000 VND, lifetime 2,000,000 VND.
- Missing product is accepted as SKIN for legacy clients. Unknown products are rejected.
- A request ID is bound to both product and plan. Retrying cannot change either,
  charge twice, or reuse a SKIN key as an AIM license. The UI keeps one retry
  marker per account with its product, matching the single active-order rule.
- My Keys labels each product and links to its corresponding download. Essentials
  uses the versioned `VN-KEEN-ESSENTIALS-20261003-LicenseGate-14188.zip` download with one
  launcher EXE; its launcher verifies the LicenseGate AIM scope.

## Download release integrity

`downloads.json` records release file names, byte lengths and SHA-256 digests.
The Essentials page links to this metadata for an independent hash comparison.
Ordinary Essentials download clicks on the homepage and Essentials page fetch the
metadata and verify the ZIP's size and SHA-256 before offering a Blob download.
The verifier fails closed on missing metadata, oversized/truncated files, unsupported
Web Crypto, or a hash mismatch; SKIN downloads are unchanged. Direct URLs and
JavaScript-disabled browsers do not run this client-side verification.
A matching hash establishes that a download matches the published release; it is
not an antivirus verdict or an Authenticode signature. Do not disable the launcher
payload hash checks or antivirus protection to work around a mismatch.

Essentials links use a versioned file name so existing CDN or browser caches cannot
reuse a differently packaged release. `_redirects` routes both historic Essentials
ZIP URLs to this release with a temporary redirect. `_headers` makes the versioned
release immutable and revalidates metadata and stable aliases. Verify redirects
and the remote ZIP hash after deploying; old CDN objects may require a scoped
cache purge. `VN-KEEN-ESSENTIALS.zip` remains a byte-identical compatibility alias.

Apply migration 0004 **before deploying this code**. It only adds a product
column/index; all historical wallet orders stay SKIN, and no balances, existing
keys, reservations, or ledger entries are altered. Check `PRAGMA table_info(wallet_orders)`
before applying; do not run its `ALTER TABLE` twice. The older direct checkout
service still uses its separate `AIM_PRICE_*` environment settings.

Regression checks: `node test-wallet-service.mjs`, `node test-wallet-client.mjs`,
`node test-wallet-webhook.mjs`, and `node test-download-release.mjs`. These use
mocks/local files and databases, not paid production purchases.
