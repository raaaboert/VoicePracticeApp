ALTER TABLE org_content_items
  ADD COLUMN IF NOT EXISTS external_kind TEXT NULL;

ALTER TABLE org_content_items
  DROP CONSTRAINT IF EXISTS org_content_items_external_kind_check;

ALTER TABLE org_content_items
  ADD CONSTRAINT org_content_items_external_kind_check
  CHECK (
    external_kind IS NULL
    OR (content_type = 'external_url' AND external_kind = 'youtube')
  ) NOT VALID;

ALTER TABLE org_content_items
  VALIDATE CONSTRAINT org_content_items_external_kind_check;

ALTER TABLE org_content_assets
  ADD COLUMN IF NOT EXISTS authorization_scope TEXT NOT NULL DEFAULT 'central',
  ADD COLUMN IF NOT EXISTS authorization_topic_id TEXT NULL;

ALTER TABLE org_content_assets
  DROP CONSTRAINT IF EXISTS org_content_assets_authorization_scope_check;

ALTER TABLE org_content_assets
  ADD CONSTRAINT org_content_assets_authorization_scope_check
  CHECK (
    (authorization_scope = 'central' AND authorization_topic_id IS NULL)
    OR (authorization_scope = 'focus_topic' AND authorization_topic_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE org_content_assets
  VALIDATE CONSTRAINT org_content_assets_authorization_scope_check;

CREATE TABLE IF NOT EXISTS org_content_transcripts (
  id UUID PRIMARY KEY,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  transcript_text TEXT NOT NULL
    CHECK (char_length(btrim(transcript_text)) > 0 AND char_length(transcript_text) <= 200000),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by_actor_id TEXT NULL,
  superseded_at TIMESTAMPTZ NULL,
  removed_by_actor_id TEXT NULL,
  removed_at TIMESTAMPTZ NULL,
  CONSTRAINT org_content_transcripts_content_fkey
    FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT org_content_transcripts_superseded_pair_check
    CHECK ((superseded_by_actor_id IS NULL) = (superseded_at IS NULL)),
  CONSTRAINT org_content_transcripts_removed_pair_check
    CHECK ((removed_by_actor_id IS NULL) = (removed_at IS NULL)),
  CONSTRAINT org_content_transcripts_one_terminal_state_check
    CHECK (NOT (superseded_at IS NOT NULL AND removed_at IS NOT NULL)),
  UNIQUE (org_id, content_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS org_content_transcripts_current_unique_idx
  ON org_content_transcripts (org_id, content_id)
  WHERE superseded_at IS NULL AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS org_content_transcripts_history_idx
  ON org_content_transcripts (org_id, content_id, version DESC);
