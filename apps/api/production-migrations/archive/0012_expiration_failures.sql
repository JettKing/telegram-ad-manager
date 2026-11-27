-- Production contract 0009 follow-up: independent compensation state for failed expiration deletes.
CREATE TABLE IF NOT EXISTS publish_expiration_failures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  message_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'succeeded', 'acknowledged')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  first_failed_at TEXT NOT NULL,
  last_attempt_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES ad_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES publish_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES telegram_channels(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_expiration_failures_scope_status ON publish_expiration_failures(tenant_id, workspace_id, status, next_attempt_at);
