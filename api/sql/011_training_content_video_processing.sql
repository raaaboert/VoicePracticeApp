ALTER TABLE org_content_assets
  ADD COLUMN IF NOT EXISTS processing_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_lease_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS processing_lease_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS processing_next_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS processing_error_category TEXT NULL;

ALTER TABLE org_content_assets
  DROP CONSTRAINT IF EXISTS org_content_assets_processing_state_check;

ALTER TABLE org_content_assets
  ADD CONSTRAINT org_content_assets_processing_state_check
  CHECK (
    upload_state <> 'processing'
    OR (
      storage_provider = 'r2'
      AND temporary_object_key IS NOT NULL
      AND final_object_key IS NOT NULL
      AND declared_byte_size IS NOT NULL
      AND detected_mime_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND processing_attempt_count >= 0
    )
  ) NOT VALID;

ALTER TABLE org_content_assets
  VALIDATE CONSTRAINT org_content_assets_processing_state_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_processing_lease_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_processing_lease_check
      CHECK (
        (processing_lease_token IS NULL AND processing_lease_expires_at IS NULL)
        OR (
          upload_state = 'processing'
          AND processing_lease_token IS NOT NULL
          AND processing_lease_expires_at IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_processing_attempt_count_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_processing_attempt_count_check
      CHECK (processing_attempt_count >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE org_content_assets
  VALIDATE CONSTRAINT org_content_assets_processing_lease_check;
ALTER TABLE org_content_assets
  VALIDATE CONSTRAINT org_content_assets_processing_attempt_count_check;

CREATE INDEX IF NOT EXISTS org_content_assets_video_processing_claim_idx
  ON org_content_assets (
    processing_next_attempt_at,
    processing_lease_expires_at,
    created_at,
    id
  )
  WHERE upload_state = 'processing';
