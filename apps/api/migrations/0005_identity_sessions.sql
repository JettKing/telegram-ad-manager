-- TG Ad Manager V1.1 / Migration 0005
-- Session lookup indexes for platform authentication and revocation.

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_tenant_members_active_user ON tenant_members(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, created_at);
