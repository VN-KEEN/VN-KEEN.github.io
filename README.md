# VN-KEEN

Website: https://VN-KEEN.github.io

## LicenseGate checkout deployment

The public checkout is served from the static site and calls the Cloudflare Pages
API at `https://vn-keen.pages.dev/api/licensegate/`. Before accepting payments,
configure these Cloudflare Pages bindings for every deployed environment:

- D1 database binding: `LICENSE_DB` (apply `migrations/0001_licensegate.sql`,
  `migrations/0002_wallet.sql`, and `migrations/0003_wallet_auth_orders.sql` in
  order)
- Secret `LICENSEGATE_API_KEY`
- Variable `LICENSEGATE_USER_ID` (LicenseGate public user code)
- Secret `SEPAY_WEBHOOK_SECRET`
- Variable `SEPAY_ACCOUNT_NUMBER`
- Variable `LICENSEGATE_CHECKOUT_ENABLED=true`

Wallet account registration, bearer sessions, deposit-code top-ups, and
balance purchases require all three migrations. Existing rows in
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
