-- TG Ad Manager V1.1 / Migration 0003
-- Subscription, finance, notification and operational recovery records.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly', 'lifetime')),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_entitlements (
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  entitlement_key TEXT NOT NULL,
  limit_value INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (plan_id, entitlement_key)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'frozen', 'expired', 'cancelled')),
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  read_only_after_expiry INTEGER NOT NULL DEFAULT 1 CHECK (read_only_after_expiry IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  tenant_subscription_id TEXT NOT NULL REFERENCES tenant_subscriptions(id),
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor_admin_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('ad_order', 'saas_subscription', 'refund', 'discount', 'adjustment')),
  source_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'reversed')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS system_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES system_jobs(id),
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  is_secret_ref INTEGER NOT NULL DEFAULT 0 CHECK (is_secret_ref IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON tenant_subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_finance_tenant_time ON financial_transactions(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_system_jobs_status_next ON system_jobs(status, next_attempt_at);
