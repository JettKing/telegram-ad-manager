-- Production contract 0009 follow-up: support order payment workflow states.
-- SQLite CHECK constraints require rebuilding the table to add pending_payment,
-- pending_review, paid, refunded and partially_refunded states.
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE ad_orders_v0011 (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  customer_name TEXT,
  package_name TEXT,
  content_text TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'plain' CHECK (content_format IN ('plain', 'html', 'markdownv2')),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'paid', 'pending_review', 'approved', 'scheduled', 'publishing', 'published', 'completed', 'cancelled', 'refunded', 'partially_refunded', 'failed')),
  scheduled_at TEXT,
  published_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'photo', 'video', 'document', 'animation', 'media_group')),
  media_file_id TEXT,
  media_items_json TEXT,
  reply_markup_json TEXT,
  parse_mode TEXT CHECK (parse_mode IN ('HTML', 'MarkdownV2') OR parse_mode IS NULL),
  customer_id TEXT,
  package_id TEXT,
  list_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (list_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_due_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_due_minor >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending_payment', 'paid', 'partially_paid', 'refunded', 'partially_refunded')),
  creative_id TEXT REFERENCES ad_creatives(id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (channel_id) REFERENCES telegram_channels(id) ON DELETE RESTRICT
);
INSERT INTO ad_orders_v0011 SELECT * FROM ad_orders;
DROP TABLE ad_orders;
ALTER TABLE ad_orders_v0011 RENAME TO ad_orders;
CREATE INDEX idx_ad_orders_channel_schedule ON ad_orders(channel_id, scheduled_at, status);
CREATE INDEX idx_ad_orders_tenant_status ON ad_orders(tenant_id, workspace_id, status, created_at);
CREATE INDEX idx_orders_customer_payment ON ad_orders(tenant_id, workspace_id, customer_id, payment_status, created_at);
COMMIT;
PRAGMA foreign_keys = ON;
