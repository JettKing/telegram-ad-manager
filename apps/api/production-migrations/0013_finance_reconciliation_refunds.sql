-- Production contract 0009 follow-up: finance reconciliation, duplicate transaction protection and refunds.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_transaction_unique
  ON payment_submissions(tenant_id, workspace_id, transaction_no)
  WHERE transaction_no IS NOT NULL AND TRIM(transaction_no) <> '';

CREATE TABLE IF NOT EXISTS ad_order_refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  method TEXT,
  transaction_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  requested_by TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES ad_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_refunds_scope_status ON ad_order_refunds(tenant_id, workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON ad_order_refunds(order_id, created_at);
