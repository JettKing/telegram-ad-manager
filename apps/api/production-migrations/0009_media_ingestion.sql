-- Production contract 0009: Telegram media idempotency and album settlement.
-- Apply only after reviewing the live production schema. This is intentionally
-- separate from the development migration directory because production already
-- has an independent migration history.

ALTER TABLE creative_media ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE creative_media ADD COLUMN source_chat_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_media_telegram_source
  ON creative_media(bot_identity_id, source_chat_id, telegram_message_id)
  WHERE bot_identity_id IS NOT NULL
    AND source_chat_id IS NOT NULL
    AND telegram_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  bot_identity_id TEXT NOT NULL,
  telegram_media_group_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'collecting' CHECK (state IN ('collecting', 'settling', 'pending_confirmation', 'completed', 'failed')),
  version INTEGER NOT NULL DEFAULT 1,
  last_received_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (bot_identity_id, telegram_media_group_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (bot_identity_id) REFERENCES telegram_bot_identities(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS media_group_items (
  media_group_id TEXT NOT NULL,
  media_asset_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (media_group_id, media_asset_id),
  FOREIGN KEY (media_group_id) REFERENCES media_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (media_asset_id) REFERENCES creative_media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_groups_scope_state
  ON media_groups(tenant_id, workspace_id, state, last_received_at);
CREATE INDEX IF NOT EXISTS idx_media_group_items_message
  ON media_group_items(media_group_id, message_id);
