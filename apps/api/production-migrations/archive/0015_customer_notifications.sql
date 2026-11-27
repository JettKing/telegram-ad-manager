CREATE TABLE IF NOT EXISTS customer_notification_outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  destination_ref TEXT NOT NULL,
  message TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_customer_notification_outbox_due ON customer_notification_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_notification_outbox_scope ON customer_notification_outbox(tenant_id, workspace_id, created_at);
