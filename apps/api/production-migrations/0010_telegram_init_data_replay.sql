-- Production contract 0009: durable Telegram Mini App initData replay records.
-- Apply only to the independent production schema after live-schema review.
CREATE TABLE IF NOT EXISTS telegram_init_data_replays (
  replay_key TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  auth_date INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_init_replays_expiry
  ON telegram_init_data_replays(expires_at);
