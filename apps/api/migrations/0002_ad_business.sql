-- TG Ad Manager V1.1 / Migration 0002
-- Business entities and state-machine records.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  telegram_user_id TEXT,
  telegram_username TEXT,
  name TEXT NOT NULL,
  contact TEXT,
  source TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'normal', 'long_term', 'vip', 'potential', 'risk', 'inactive')),
  total_spend_minor INTEGER NOT NULL DEFAULT 0,
  last_order_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_tags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS customer_tag_relations (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  tag_id TEXT NOT NULL REFERENCES customer_tags(id),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE TABLE IF NOT EXISTS ad_packages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  ad_type TEXT NOT NULL,
  publish_count INTEGER NOT NULL DEFAULT 1 CHECK (publish_count > 0),
  display_duration_seconds INTEGER,
  pin_duration_seconds INTEGER,
  publish_interval_seconds INTEGER,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  discount_price_minor INTEGER CHECK (discount_price_minor IS NULL OR discount_price_minor >= 0),
  auto_unpin INTEGER NOT NULL DEFAULT 0 CHECK (auto_unpin IN (0, 1)),
  attempt_auto_delete INTEGER NOT NULL DEFAULT 0 CHECK (attempt_auto_delete IN (0, 1)),
  delete_failure_policy TEXT NOT NULL DEFAULT 'manual' CHECK (delete_failure_policy IN ('ignore', 'notify', 'manual')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id),
  media_type TEXT NOT NULL CHECK (media_type IN ('text', 'photo', 'video', 'album', 'animation', 'document')),
  file_id TEXT,
  file_unique_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  duration_seconds INTEGER,
  media_group_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed', 'archived', 'deleted')),
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id),
  telegram_media_group_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'collecting' CHECK (state IN ('collecting', 'settling', 'pending_confirmation', 'completed', 'failed')),
  version INTEGER NOT NULL DEFAULT 1,
  last_received_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (bot_identity_id, telegram_media_group_id)
);

CREATE TABLE IF NOT EXISTS media_group_items (
  media_group_id TEXT NOT NULL REFERENCES media_groups(id),
  media_asset_id TEXT NOT NULL REFERENCES media_assets(id),
  message_id INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (media_group_id, media_asset_id)
);

CREATE TABLE IF NOT EXISTS ad_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  channel_id TEXT NOT NULL REFERENCES telegram_channels(id),
  package_id TEXT NOT NULL REFERENCES ad_packages(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  receivable_minor INTEGER NOT NULL CHECK (receivable_minor >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending_review', 'paid', 'rejected', 'refunded', 'partially_refunded')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'paid', 'pending_review', 'approved', 'scheduled', 'publishing', 'published', 'completed', 'cancelled', 'refunded', 'partially_refunded', 'failed')),
  content_json TEXT NOT NULL,
  planned_publish_at TEXT,
  actual_publish_at TEXT,
  planned_end_at TEXT,
  actual_end_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_order_revisions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  actor_user_id TEXT REFERENCES users(id),
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_order_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  method TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  transaction_ref TEXT,
  proof_asset_id TEXT REFERENCES media_assets(id),
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_schedules (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel_id TEXT NOT NULL REFERENCES telegram_channels(id),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'daily', 'weekly', 'custom')),
  planned_at TEXT NOT NULL,
  paused_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_publish_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  schedule_id TEXT REFERENCES ad_schedules(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'uncertain', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_publish_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ad_publish_tasks(id),
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER,
  result TEXT NOT NULL CHECK (result IN ('succeeded', 'failed', 'uncertain')),
  error_code TEXT,
  error_message TEXT,
  retry_after_seconds INTEGER,
  executed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_name ON customers(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_media_tenant_status ON media_assets(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON ad_orders(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_channel_time ON ad_schedules(channel_id, planned_at);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_status_next ON ad_publish_tasks(status, next_attempt_at);
