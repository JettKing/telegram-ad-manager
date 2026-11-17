-- TG Ad Manager V1.1 / Migration 0007
-- Telegram media ingestion metadata and idempotency indexes.

ALTER TABLE media_assets ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE media_assets ADD COLUMN source_chat_id TEXT;
ALTER TABLE media_assets ADD COLUMN text_content TEXT;
ALTER TABLE media_assets ADD COLUMN caption TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_asset_source_message
  ON media_assets(bot_identity_id, source_chat_id, telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_media_groups_scope_state
  ON media_groups(tenant_id, workspace_id, state, last_received_at);
CREATE INDEX IF NOT EXISTS idx_media_group_items_group_message
  ON media_group_items(media_group_id, message_id);
