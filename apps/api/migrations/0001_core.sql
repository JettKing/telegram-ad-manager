-- TG Ad Manager V1.1 / Migration 0001
-- D1/SQLite compatible. Every tenant-owned table carries tenant_id.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'editor', 'finance', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'editor', 'finance', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT REFERENCES tenants(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_bot_identities (
  id TEXT PRIMARY KEY,
  bot_username TEXT,
  token_secret_ref TEXT NOT NULL,
  webhook_secret_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_channels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id),
  telegram_chat_id TEXT NOT NULL,
  username TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'active', 'permission_error', 'unbound')),
  can_post INTEGER NOT NULL DEFAULT 0 CHECK (can_post IN (0, 1)),
  can_pin INTEGER NOT NULL DEFAULT 0 CHECK (can_pin IN (0, 1)),
  can_delete INTEGER NOT NULL DEFAULT 0 CHECK (can_delete IN (0, 1)),
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bot_identity_id, telegram_chat_id)
);

CREATE TABLE IF NOT EXISTS telegram_channel_permissions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES telegram_channels(id),
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0, 1)),
  checked_at TEXT NOT NULL,
  UNIQUE (channel_id, permission)
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  bot_identity_id TEXT NOT NULL REFERENCES telegram_bot_identities(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  actor_user_id TEXT REFERENCES users(id),
  actor_admin_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_summary_json TEXT,
  after_summary_json TEXT,
  source TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channels_tenant_workspace ON telegram_channels(tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_updates_status ON telegram_updates(status, received_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at);
