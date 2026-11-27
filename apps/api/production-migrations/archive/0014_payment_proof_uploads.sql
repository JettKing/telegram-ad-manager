-- Store metadata for payment proof files uploaded to the dedicated R2 bucket.
CREATE TABLE IF NOT EXISTS payment_proof_uploads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'deleted')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_proof_uploads_scope
  ON payment_proof_uploads(tenant_id, workspace_id, status, created_at);
