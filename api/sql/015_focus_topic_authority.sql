CREATE TABLE IF NOT EXISTS focus_topic_assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  subject_user_id TEXT NULL,
  grants_management BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  revoked_by TEXT NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT focus_topic_assignments_audience_check CHECK (
    audience IN ('organization', 'managers_and_admins', 'manager_only', 'manager_with_team', 'individual')
  ),
  CONSTRAINT focus_topic_assignments_subject_check CHECK (
    (audience IN ('organization', 'managers_and_admins') AND subject_user_id IS NULL)
    OR
    (audience IN ('manager_only', 'manager_with_team', 'individual') AND subject_user_id IS NOT NULL)
  ),
  CONSTRAINT focus_topic_assignments_management_check CHECK (
    grants_management = FALSE OR audience IN ('manager_only', 'manager_with_team', 'individual')
  ),
  CONSTRAINT focus_topic_assignments_revocation_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_assignments_active_broad_uidx
  ON focus_topic_assignments (org_id, topic_id, audience)
  WHERE revoked_at IS NULL AND audience IN ('organization', 'managers_and_admins');

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_assignments_active_targeted_uidx
  ON focus_topic_assignments (org_id, topic_id, audience, subject_user_id)
  WHERE revoked_at IS NULL AND audience IN ('manager_only', 'manager_with_team', 'individual');

CREATE INDEX IF NOT EXISTS focus_topic_assignments_active_lookup_idx
  ON focus_topic_assignments (org_id, topic_id, subject_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS focus_topic_scenario_attachments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  scenario_kind TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  attached_by TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL,
  detached_by TEXT NULL,
  detached_at TIMESTAMPTZ NULL,
  CONSTRAINT focus_topic_scenario_kind_check CHECK (scenario_kind IN ('standard', 'org')),
  CONSTRAINT focus_topic_scenario_detachment_check CHECK (
    (detached_at IS NULL AND detached_by IS NULL) OR (detached_at IS NOT NULL AND detached_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_scenario_attachments_active_uidx
  ON focus_topic_scenario_attachments (org_id, topic_id, scenario_kind, scenario_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS focus_topic_scenario_attachments_topic_idx
  ON focus_topic_scenario_attachments (org_id, topic_id, attached_at, id);

CREATE TABLE IF NOT EXISTS org_content_topic_attachments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  topic_id TEXT NOT NULL,
  attached_by TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL,
  detached_by TEXT NULL,
  detached_at TIMESTAMPTZ NULL,
  CONSTRAINT org_content_topic_attachments_content_fk
    FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT org_content_topic_attachments_detachment_check CHECK (
    (detached_at IS NULL AND detached_by IS NULL) OR (detached_at IS NOT NULL AND detached_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS org_content_topic_attachments_active_uidx
  ON org_content_topic_attachments (org_id, content_id, topic_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS org_content_topic_attachments_topic_idx
  ON org_content_topic_attachments (org_id, topic_id, attached_at, id);

CREATE TABLE IF NOT EXISTS focus_topic_backfill_runs (
  id TEXT PRIMARY KEY,
  run_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  schema_generation TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  result_summary JSONB NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  validated_at TIMESTAMPTZ NULL,
  validated_by TEXT NULL,
  signed_off_at TIMESTAMPTZ NULL,
  signed_off_by TEXT NULL,
  CONSTRAINT focus_topic_backfill_runs_mode_check CHECK (mode IN ('apply')),
  CONSTRAINT focus_topic_backfill_runs_validation_check CHECK (
    (validated_at IS NULL AND validated_by IS NULL) OR (validated_at IS NOT NULL AND validated_by IS NOT NULL)
  ),
  CONSTRAINT focus_topic_backfill_runs_signoff_check CHECK (
    (signed_off_at IS NULL AND signed_off_by IS NULL)
    OR
    (signed_off_at IS NOT NULL AND signed_off_by IS NOT NULL AND validated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_backfill_runs_identity_uidx
  ON focus_topic_backfill_runs (run_version, schema_generation, input_fingerprint);
