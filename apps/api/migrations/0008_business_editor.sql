-- TG Ad Manager V1.1 / Migration 0008
-- Order editor references and CRM/business query indexes.

CREATE TABLE IF NOT EXISTS ad_order_media_refs (
  order_id TEXT NOT NULL REFERENCES ad_orders(id),
  media_asset_id TEXT NOT NULL REFERENCES media_assets(id),
  role TEXT NOT NULL DEFAULT 'content' CHECK (role IN ('content', 'payment_proof', 'attachment')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, media_asset_id, role)
);

CREATE INDEX IF NOT EXISTS idx_customers_workspace_status ON customers(tenant_id, workspace_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_packages_workspace_enabled ON ad_packages(tenant_id, workspace_id, is_enabled, updated_at);
CREATE INDEX IF NOT EXISTS idx_order_media_refs_asset ON ad_order_media_refs(media_asset_id);
CREATE INDEX IF NOT EXISTS idx_revisions_order_created ON ad_order_revisions(order_id, created_at);
