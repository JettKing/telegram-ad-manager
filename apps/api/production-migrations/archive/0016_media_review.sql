ALTER TABLE creative_media ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE creative_media ADD COLUMN review_note TEXT;
ALTER TABLE creative_media ADD COLUMN reviewed_by TEXT;
ALTER TABLE creative_media ADD COLUMN reviewed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_creative_media_review ON creative_media(tenant_id, workspace_id, review_status, created_at);
