ALTER TABLE org_content_assets
  ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ NULL;

ALTER TABLE org_content_assets
  ADD COLUMN IF NOT EXISTS backup_attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS org_content_assets_backup_pending_idx
  ON org_content_assets (updated_at)
  WHERE upload_state = 'ready' AND backed_up_at IS NULL;
