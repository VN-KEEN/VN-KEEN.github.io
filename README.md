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
- `product: "aim"`: VN-KEEN-AIM-ESSENTIALS, LicenseGate scope/key prefix `VN-KEEN-AIM`.
- Both use daily 20,000 VND, monthly 300,000 VND, lifetime 2,000,000 VND.
- Missing product is accepted as SKIN for legacy clients. Unknown products are rejected.
- A request ID is bound to both product and plan. Retrying cannot change either,
  charge twice, or reuse a SKIN key as an AIM license. The UI keeps one retry
  marker per account with its product, matching the single active-order rule.
- My Keys labels each product and links to its corresponding download. The
  historical Essentials ZIP URL retains `SKIN` in the filename for link
  compatibility only; its launcher verifies the AIM scope.

Apply migration 0004 **before deploying this code**. It only adds a product
column/index; all historical wallet orders stay SKIN, and no balances, existing
keys, reservations, or ledger entries are altered. Check `PRAGMA table_info(wallet_orders)`
before applying; do not run its `ALTER TABLE` twice. The older direct checkout
service still uses its separate `AIM_PRICE_*` environment settings.

Regression checks: `node test-wallet-service.mjs`, `node test-wallet-client.mjs`,
and `node test-wallet-webhook.mjs`. These use mocks/local databases, not paid
production purchases.
