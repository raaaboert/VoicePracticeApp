ALTER TABLE org_content_assets
  ADD COLUMN IF NOT EXISTS declared_byte_size BIGINT NULL,
  ADD COLUMN IF NOT EXISTS finalization_nonce TEXT NULL,
  ADD COLUMN IF NOT EXISTS finalization_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS replacement_for_asset_id UUID NULL,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rejection_reason_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS object_deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_storage_provider_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_storage_provider_check
      CHECK (storage_provider IS NULL OR storage_provider = 'r2') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_declared_byte_size_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_declared_byte_size_check
      CHECK (declared_byte_size IS NULL OR declared_byte_size > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_pending_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_pending_state_check
      CHECK (
        upload_state <> 'pending'
        OR (
          storage_provider = 'r2'
          AND temporary_object_key IS NOT NULL
          AND upload_expires_at IS NOT NULL
          AND declared_byte_size IS NOT NULL
          AND finalization_nonce IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_uploaded_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_uploaded_state_check
      CHECK (
        upload_state <> 'uploaded'
        OR (
          storage_provider = 'r2'
          AND temporary_object_key IS NOT NULL
          AND upload_expires_at IS NOT NULL
          AND declared_byte_size IS NOT NULL
          AND finalization_nonce IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_processing_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_processing_state_check
      CHECK (
        upload_state <> 'processing'
        OR (
          storage_provider = 'r2'
          AND temporary_object_key IS NOT NULL
          AND final_object_key IS NOT NULL
          AND finalization_started_at IS NOT NULL
          AND declared_byte_size IS NOT NULL
          AND detected_mime_type IS NOT NULL
          AND byte_size IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_ready_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_ready_state_check
      CHECK (
        upload_state <> 'ready'
        OR (
          storage_provider = 'r2'
          AND final_object_key IS NOT NULL
          AND finalized_at IS NOT NULL
          AND detected_mime_type IS NOT NULL
          AND byte_size IS NOT NULL
          AND byte_size >= 0
          AND object_deleted_at IS NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_superseded_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_superseded_state_check
      CHECK (
        upload_state <> 'superseded'
        OR (
          final_object_key IS NOT NULL
          AND finalized_at IS NOT NULL
          AND superseded_at IS NOT NULL
          AND is_current = FALSE
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_current_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_current_state_check
      CHECK (is_current = FALSE OR upload_state = 'ready') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_object_deleted_state_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_object_deleted_state_check
      CHECK (
        object_deleted_at IS NULL
        OR upload_state IN ('rejected', 'expired', 'superseded')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_replacement_not_self_check'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_replacement_not_self_check
      CHECK (replacement_for_asset_id IS NULL OR replacement_for_asset_id <> id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'org_content_assets'::regclass
      AND conname = 'org_content_assets_replacement_for_asset_fkey'
  ) THEN
    ALTER TABLE org_content_assets
      ADD CONSTRAINT org_content_assets_replacement_for_asset_fkey
      FOREIGN KEY (org_id, replacement_for_asset_id)
      REFERENCES org_content_assets (org_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$$;

ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_storage_provider_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_declared_byte_size_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_pending_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_uploaded_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_processing_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_ready_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_superseded_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_current_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_object_deleted_state_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_replacement_not_self_check;
ALTER TABLE org_content_assets VALIDATE CONSTRAINT org_content_assets_replacement_for_asset_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assets_temporary_object_key_unique_idx
  ON org_content_assets (storage_provider, temporary_object_key)
  WHERE temporary_object_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assets_final_object_key_unique_idx
  ON org_content_assets (storage_provider, final_object_key)
  WHERE final_object_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assets_current_role_unique_idx
  ON org_content_assets (org_id, content_id, asset_role)
  WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assets_active_upload_unique_idx
  ON org_content_assets (org_id, content_id, asset_role)
  WHERE upload_state IN ('pending', 'uploaded', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assets_active_replacement_unique_idx
  ON org_content_assets (org_id, replacement_for_asset_id)
  WHERE replacement_for_asset_id IS NOT NULL
    AND upload_state IN ('pending', 'uploaded', 'processing');

CREATE INDEX IF NOT EXISTS org_content_assets_org_pending_bytes_idx
  ON org_content_assets (org_id, upload_state, upload_expires_at)
  WHERE upload_state IN ('pending', 'uploaded', 'processing');

CREATE INDEX IF NOT EXISTS org_content_assets_cleanup_idx
  ON org_content_assets (upload_state, cleanup_pending, updated_at, org_id)
  WHERE cleanup_pending = TRUE
     OR upload_state IN ('pending', 'rejected', 'expired', 'superseded');
