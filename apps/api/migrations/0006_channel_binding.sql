-- TG Ad Manager V1.1 / Migration 0006
-- Channel binding and permission snapshot indexes.

CREATE INDEX IF NOT EXISTS idx_channels_scope_status ON telegram_channels(tenant_id, workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_permissions_granted ON telegram_channel_permissions(channel_id, permission, granted);
