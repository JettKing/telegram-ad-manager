-- TG Ad Manager V1.1 / Migration 0004
-- Durable Telegram webhook and Mini App replay-protection records.

CREATE TABLE IF NOT EXISTS telegram_webhook_logs (
  id TEXT PRIMARY KEY,
  bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id),
  update_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'duplicate', 'processed', 'failed')),
  error_code TEXT,
  error_message TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_init_data_replays (
  replay_key TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  auth_date INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_update ON telegram_webhook_logs(update_id, received_at);
CREATE INDEX IF NOT EXISTS idx_init_replays_expiry ON telegram_init_data_replays(expires_at);
