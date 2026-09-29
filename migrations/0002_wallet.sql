CREATE TABLE IF NOT EXISTS wallet_accounts (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('TOPUP','BUY_KEY')),
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
