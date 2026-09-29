CREATE TABLE IF NOT EXISTS lg_orders (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('skin','aim')),
  plan TEXT NOT NULL CHECK(plan IN ('daily','monthly','lifetime')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  days INTEGER,
  license_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','FULFILLED')),
  created_at INTEGER NOT NULL,
  checkout_expires INTEGER NOT NULL,
  paid_at INTEGER,
  expires_at INTEGER,
  transaction_id TEXT UNIQUE,
  provider_id INTEGER
);
