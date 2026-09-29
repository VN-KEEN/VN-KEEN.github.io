-- Durable wallet authentication, sessions, idempotent purchases, and
-- deposit-code based top-ups. Apply after 0001_licensegate.sql and
-- 0002_wallet.sql.

ALTER TABLE wallet_accounts ADD COLUMN deposit_code TEXT;
ALTER TABLE wallet_accounts ADD COLUMN reserved_balance INTEGER NOT NULL DEFAULT 0 CHECK(reserved_balance >= 0);

-- Existing wallet rows are retained. They are intentionally not claimable by
-- a new registration; an operator must verify those legacy accounts first.
UPDATE wallet_accounts
SET deposit_code = 'VNW' || upper(hex(randomblob(12)))
WHERE deposit_code IS NULL OR deposit_code = '';

CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_deposit_code_uq
  ON wallet_accounts(deposit_code);

CREATE TABLE IF NOT EXISTS wallet_credentials (
  username TEXT PRIMARY KEY REFERENCES wallet_accounts(username) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_kdf TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  contact TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES wallet_accounts(username) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS wallet_sessions_user_idx ON wallet_sessions(username);
CREATE INDEX IF NOT EXISTS wallet_sessions_expiry_idx ON wallet_sessions(expires_at);

CREATE TABLE IF NOT EXISTS wallet_auth_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_auth_limits_expiry_idx ON wallet_auth_limits(expires_at);

CREATE TABLE IF NOT EXISTS wallet_orders (
  request_id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES wallet_accounts(username) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('daily','monthly','lifetime')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  days INTEGER,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','FULFILLED','FAILED')),
  license_key TEXT UNIQUE,
  provider_id INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS wallet_orders_user_idx
  ON wallet_orders(username, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_orders_pending_idx
  ON wallet_orders(username, status);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_orders_one_processing_per_user
  ON wallet_orders(username) WHERE status = 'PROCESSING';

-- Creating the order is the reservation. The check runs before the INSERT;
-- the update runs after it, and both are part of the same SQLite transaction.
-- Separate one-statement triggers also work in D1 Studio.
CREATE TRIGGER IF NOT EXISTS wallet_order_reserve_check
BEFORE INSERT ON wallet_orders
WHEN NEW.status = 'PROCESSING'
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_BALANCE')
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_accounts
      WHERE username = NEW.username
        AND typeof(balance) = 'integer'
        AND balance - reserved_balance >= NEW.amount
    );
END;

CREATE TRIGGER IF NOT EXISTS wallet_order_reserve_apply
AFTER INSERT ON wallet_orders
WHEN NEW.status = 'PROCESSING'
BEGIN
  UPDATE wallet_accounts
    SET reserved_balance = reserved_balance + NEW.amount,
        updated_at = NEW.created_at
    WHERE username = NEW.username;
END;

-- A bank transaction can settle exactly one checkout flow. These guards also
-- prevent the two legacy payment paths from reusing a transaction id.
CREATE TRIGGER IF NOT EXISTS wallet_ledger_transaction_not_licensegate
BEFORE INSERT ON wallet_ledger
WHEN NEW.reference_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM lg_orders WHERE transaction_id = NEW.reference_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_ALREADY_USED');
END;

CREATE TRIGGER IF NOT EXISTS licensegate_transaction_not_wallet
BEFORE UPDATE OF transaction_id ON lg_orders
WHEN NEW.transaction_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM wallet_ledger WHERE reference_id = NEW.transaction_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_ALREADY_USED');
END;

CREATE TRIGGER IF NOT EXISTS licensegate_transaction_not_wallet_insert
BEFORE INSERT ON lg_orders
WHEN NEW.transaction_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM wallet_ledger WHERE reference_id = NEW.transaction_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_ALREADY_USED');
END;

-- Ledger writes are the durable financial events. Validation and each balance
-- or order transition are separate one-statement triggers so D1 Studio can
-- apply the migration as well as Wrangler's migration runner.
CREATE TRIGGER IF NOT EXISTS wallet_topup_ledger_check
BEFORE INSERT ON wallet_ledger
WHEN NEW.type = 'TOPUP'
BEGIN
  SELECT RAISE(ABORT, 'WALLET_TOPUP_ACCOUNT_UPDATE_FAILED')
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_accounts
      WHERE username = NEW.username
        AND balance >= 0
        AND NEW.amount > 0
        AND typeof(NEW.amount) = 'integer'
        AND typeof(balance) = 'integer'
        AND balance <= 9007199254740991 - NEW.amount
    );
END;

CREATE TRIGGER IF NOT EXISTS wallet_topup_ledger_apply
AFTER INSERT ON wallet_ledger
WHEN NEW.type = 'TOPUP'
BEGIN
  UPDATE wallet_accounts
    SET balance = balance + NEW.amount, updated_at = NEW.created_at
    WHERE username = NEW.username;
END;

CREATE TRIGGER IF NOT EXISTS wallet_buy_ledger_check
BEFORE INSERT ON wallet_ledger
WHEN NEW.type = 'BUY_KEY'
BEGIN
  SELECT RAISE(ABORT, 'WALLET_BUY_ORDER_MISMATCH')
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_orders
      WHERE 'BUY:' || request_id = NEW.reference_id
        AND username = NEW.username
        AND status = 'PROCESSING'
        AND amount = -NEW.amount
        AND provider_id IS NOT NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM wallet_accounts
      WHERE username = NEW.username
        AND NEW.amount < 0
        AND reserved_balance >= -NEW.amount
        AND balance + NEW.amount >= 0
    );
END;

CREATE TRIGGER IF NOT EXISTS wallet_buy_ledger_account
AFTER INSERT ON wallet_ledger
WHEN NEW.type = 'BUY_KEY'
BEGIN
  UPDATE wallet_accounts
    SET balance = balance + NEW.amount,
        reserved_balance = reserved_balance + NEW.amount,
        updated_at = NEW.created_at
    WHERE username = NEW.username;
END;

CREATE TRIGGER IF NOT EXISTS wallet_buy_ledger_order
AFTER INSERT ON wallet_ledger
WHEN NEW.type = 'BUY_KEY'
BEGIN
  UPDATE wallet_orders
    SET status = 'FULFILLED', updated_at = NEW.created_at,
        completed_at = NEW.created_at, error_code = NULL,
        lease_token = NULL, lease_expires_at = NULL
    WHERE 'BUY:' || request_id = NEW.reference_id
      AND username = NEW.username
      AND status = 'PROCESSING';
END;
