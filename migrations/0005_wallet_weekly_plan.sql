-- Preserve all orders and retain a rollback snapshot; add weekly plan.
CREATE TABLE wallet_orders_backup_weekly_20261021 AS SELECT * FROM wallet_orders;
CREATE TABLE wallet_orders_new_weekly_20261021 (
  request_id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES wallet_accounts(username) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('daily','weekly','monthly','lifetime')),
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
, product TEXT NOT NULL DEFAULT 'skin'
  CHECK(product IN ('skin','aim')));
INSERT INTO wallet_orders_new_weekly_20261021 SELECT * FROM wallet_orders;
DROP TRIGGER wallet_order_reserve_check;
DROP TRIGGER wallet_order_reserve_apply;
DROP TRIGGER wallet_buy_ledger_check;
DROP TRIGGER wallet_buy_ledger_order;
DROP TABLE wallet_orders;
ALTER TABLE wallet_orders_new_weekly_20261021 RENAME TO wallet_orders;
CREATE INDEX wallet_orders_user_idx
  ON wallet_orders(username, created_at DESC);
CREATE INDEX wallet_orders_pending_idx
  ON wallet_orders(username, status);
CREATE UNIQUE INDEX wallet_orders_one_processing_per_user
  ON wallet_orders(username) WHERE status = 'PROCESSING';
CREATE INDEX wallet_orders_product_idx
  ON wallet_orders(username, product, created_at DESC);
CREATE TRIGGER wallet_order_reserve_check
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
CREATE TRIGGER wallet_order_reserve_apply
AFTER INSERT ON wallet_orders
WHEN NEW.status = 'PROCESSING'
BEGIN
  UPDATE wallet_accounts
    SET reserved_balance = reserved_balance + NEW.amount,
        updated_at = NEW.created_at
    WHERE username = NEW.username;
END;
CREATE TRIGGER wallet_buy_ledger_check
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
CREATE TRIGGER wallet_buy_ledger_order
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
