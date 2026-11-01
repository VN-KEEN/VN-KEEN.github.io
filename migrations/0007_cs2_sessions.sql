CREATE TABLE IF NOT EXISTS cs2_sessions (
 key_hash TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 instance_id TEXT NOT NULL,
 provider_id INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 license_expires_at INTEGER NOT NULL,
 provider_checked_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cs2_policy_jobs (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'PENDING',
 phase TEXT NOT NULL DEFAULT 'DISCOVER',
 cursor INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT 0,
 error TEXT
);
CREATE TABLE IF NOT EXISTS cs2_policy_items (
 provider_id INTEGER PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'PENDING',
 previous_scope TEXT,
 previous_policy TEXT,
 previous_ip_limit INTEGER,
 expiration_date TEXT,
 updated_at INTEGER NOT NULL DEFAULT 0,
 error TEXT
);
