-- Keep wallet purchases on separate LicenseGate products. Existing orders are
-- legacy skin orders and remain valid with the default scope.
ALTER TABLE wallet_orders ADD COLUMN product TEXT NOT NULL DEFAULT 'skin'
  CHECK(product IN ('skin','aim'));

CREATE INDEX IF NOT EXISTS wallet_orders_product_idx
  ON wallet_orders(username, product, created_at DESC);
