# VN-KEEN

Website: https://VN-KEEN.github.io

## LicenseGate checkout deployment

The public checkout is served from the static site and calls the Cloudflare Pages
API at `https://vn-keen.pages.dev/api/licensegate/`. Before accepting payments,
configure these Cloudflare Pages bindings for every deployed environment:

- D1 database binding: `LICENSE_DB` (apply `migrations/0001_licensegate.sql`)
- Secret `LICENSEGATE_API_KEY`
- Variable `LICENSEGATE_USER_ID` (LicenseGate public user code)
- Secret `SEPAY_WEBHOOK_SECRET`
- Variable `SEPAY_ACCOUNT_NUMBER`
- Variable `LICENSEGATE_CHECKOUT_ENABLED=true`

Set the SePay webhook URL to:

`https://vn-keen.pages.dev/api/licensegate/webhook`

The browser only receives an order token. It never receives the LicenseGate or
SePay secrets, and it shows a key only after the authenticated order status is
`FULFILLED`.
