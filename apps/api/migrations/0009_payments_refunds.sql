-- TG Ad Manager V1.1 / Migration 0009
-- Finance review and refund ledger.

CREATE TABLE IF NOT EXISTS ad_order_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  method TEXT,
  transaction_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  requested_by TEXT REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_payments_review ON ad_order_payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_refunds_review ON ad_order_refunds(status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON ad_order_refunds(order_id, created_at);
