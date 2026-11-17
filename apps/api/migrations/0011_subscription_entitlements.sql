-- Stage 13: SaaS subscription entitlements and metered usage.

CREATE TABLE IF NOT EXISTS subscription_usage (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  used_value INTEGER NOT NULL DEFAULT 0 CHECK (used_value >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period_key, entitlement_key)
);

CREATE TABLE IF NOT EXISTS subscription_usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL UNIQUE,
  period_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_checkout_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly', 'lifetime')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_current_subscription
  ON tenant_subscriptions(tenant_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'frozen');
CREATE INDEX IF NOT EXISTS idx_subscription_usage_tenant_period
  ON subscription_usage(tenant_id, period_key);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_tenant_status
  ON subscription_checkout_requests(tenant_id, status, created_at);

INSERT OR IGNORE INTO subscription_plans (id, code, name, billing_period, price_minor, is_active, created_at, updated_at)
VALUES
  ('plan-free', 'free', 'FREE', 'monthly', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('plan-pro-monthly', 'pro', 'PRO', 'monthly', 7900, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('plan-business-monthly', 'business', 'BUSINESS', 'monthly', 19900, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO subscription_entitlements (plan_id, entitlement_key, limit_value, enabled)
VALUES
  ('plan-free', 'max_workspaces', 1, 1),
  ('plan-free', 'max_channels', 1, 1),
  ('plan-free', 'monthly_orders', 10, 1),
  ('plan-free', 'monthly_publish_tasks', 10, 1),
  ('plan-free', 'max_members', 1, 1),
  ('plan-free', 'max_media_assets', 100, 1),
  ('plan-free', 'advanced_analytics', NULL, 0),
  ('plan-pro-monthly', 'max_workspaces', 3, 1),
  ('plan-pro-monthly', 'max_channels', 5, 1),
  ('plan-pro-monthly', 'monthly_orders', 100, 1),
  ('plan-pro-monthly', 'monthly_publish_tasks', 200, 1),
  ('plan-pro-monthly', 'max_members', 10, 1),
  ('plan-pro-monthly', 'max_media_assets', 5000, 1),
  ('plan-pro-monthly', 'advanced_analytics', NULL, 1),
  ('plan-business-monthly', 'max_workspaces', 20, 1),
  ('plan-business-monthly', 'max_channels', 50, 1),
  ('plan-business-monthly', 'monthly_orders', 1000, 1),
  ('plan-business-monthly', 'monthly_publish_tasks', 3000, 1),
  ('plan-business-monthly', 'max_members', 100, 1),
  ('plan-business-monthly', 'max_media_assets', 50000, 1),
  ('plan-business-monthly', 'advanced_analytics', NULL, 1);
