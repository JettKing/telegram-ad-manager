ALTER TABLE audit_logs ADD COLUMN workspace_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
