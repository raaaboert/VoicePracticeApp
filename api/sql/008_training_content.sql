CREATE TABLE IF NOT EXISTS org_module_entitlements (
  org_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_actor_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, module_key)
);

CREATE INDEX IF NOT EXISTS org_module_entitlements_enabled_idx
  ON org_module_entitlements (module_key, enabled, org_id);

CREATE TABLE IF NOT EXISTS org_content_items (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  focus_topic_id TEXT NULL,
  focus_topic_name_snapshot TEXT NULL,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('native', 'external_url', 'video', 'audio', 'pdf', 'docx', 'image')),
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_state IN ('draft', 'published', 'archived')),
  native_body TEXT NULL,
  external_url TEXT NULL,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version > 0),
  created_by_actor_id TEXT NOT NULL,
  updated_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  CHECK (CHAR_LENGTH(BTRIM(title)) BETWEEN 1 AND 200),
  CHECK (content_type = 'native' OR native_body IS NULL),
  CHECK (content_type = 'external_url' OR external_url IS NULL),
  CHECK (native_body IS NULL OR external_url IS NULL)
);

CREATE INDEX IF NOT EXISTS org_content_items_org_state_updated_idx
  ON org_content_items (org_id, publication_state, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS org_content_items_org_focus_topic_idx
  ON org_content_items (org_id, focus_topic_id, publication_state, id);
CREATE INDEX IF NOT EXISTS org_content_items_org_type_idx
  ON org_content_items (org_id, content_type, publication_state, id);

CREATE TABLE IF NOT EXISTS org_content_assets (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  asset_role TEXT NOT NULL CHECK (asset_role IN ('primary', 'thumbnail', 'inline')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  upload_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_state IN ('pending', 'uploaded', 'processing', 'ready', 'rejected', 'superseded', 'expired')),
  storage_provider TEXT NULL,
  temporary_object_key TEXT NULL,
  final_object_key TEXT NULL,
  original_filename TEXT NULL,
  declared_mime_type TEXT NULL,
  detected_mime_type TEXT NULL,
  file_extension TEXT NULL,
  byte_size BIGINT NULL CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum_or_etag TEXT NULL,
  upload_expires_at TIMESTAMPTZ NULL,
  finalized_at TIMESTAMPTZ NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  UNIQUE (org_id, content_id, asset_role, version),
  FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS org_content_assets_org_content_idx
  ON org_content_assets (org_id, content_id, asset_role, version DESC);
CREATE INDEX IF NOT EXISTS org_content_assets_pending_expiration_idx
  ON org_content_assets (upload_expires_at, org_id)
  WHERE upload_state IN ('pending', 'uploaded', 'processing');

CREATE TABLE IF NOT EXISTS org_content_assignments (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  assignment_type TEXT NOT NULL
    CHECK (assignment_type IN ('organization', 'user', 'manager', 'manager_team')),
  subject_user_id TEXT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by_actor_id TEXT NULL,
  revoked_at TIMESTAMPTZ NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id) ON DELETE RESTRICT,
  CHECK (
    (assignment_type = 'organization' AND subject_user_id IS NULL)
    OR
    (assignment_type IN ('user', 'manager', 'manager_team') AND subject_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS org_content_assignments_active_org_unique_idx
  ON org_content_assignments (org_id, content_id, assignment_type)
  WHERE revoked_at IS NULL AND assignment_type = 'organization';
CREATE UNIQUE INDEX IF NOT EXISTS org_content_assignments_active_subject_unique_idx
  ON org_content_assignments (org_id, content_id, assignment_type, subject_user_id)
  WHERE revoked_at IS NULL AND assignment_type IN ('user', 'manager', 'manager_team');
CREATE INDEX IF NOT EXISTS org_content_assignments_active_subject_idx
  ON org_content_assignments (org_id, subject_user_id, assignment_type, content_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS org_content_assignments_content_idx
  ON org_content_assignments (org_id, content_id, revoked_at);

CREATE TABLE IF NOT EXISTS org_content_scenario_links (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  focus_topic_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by_actor_id TEXT NULL,
  removed_at TIMESTAMPTZ NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS org_content_scenario_links_active_unique_idx
  ON org_content_scenario_links (org_id, content_id, scenario_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS org_content_scenario_links_scenario_idx
  ON org_content_scenario_links (org_id, scenario_id, content_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS org_content_scenario_links_topic_idx
  ON org_content_scenario_links (org_id, focus_topic_id, content_id)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS org_content_usage (
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  first_opened_at TIMESTAMPTZ NULL,
  last_opened_at TIMESTAMPTZ NULL,
  open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  completion_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (completion_state IN ('not_started', 'in_progress', 'completed')),
  completion_method TEXT NULL
    CHECK (completion_method IS NULL OR completion_method IN ('manual', 'media_threshold')),
  completed_at TIMESTAMPTZ NULL,
  completed_content_version INTEGER NULL
    CHECK (completed_content_version IS NULL OR completed_content_version > 0),
  media_position_seconds DOUBLE PRECISION NULL
    CHECK (media_position_seconds IS NULL OR media_position_seconds >= 0),
  media_duration_seconds DOUBLE PRECISION NULL
    CHECK (media_duration_seconds IS NULL OR media_duration_seconds >= 0),
  unique_media_seconds DOUBLE PRECISION NULL
    CHECK (unique_media_seconds IS NULL OR unique_media_seconds >= 0),
  media_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, content_id, user_id),
  FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS org_content_usage_user_activity_idx
  ON org_content_usage (org_id, user_id, last_opened_at DESC, content_id);
CREATE INDEX IF NOT EXISTS org_content_usage_content_completion_idx
  ON org_content_usage (org_id, content_id, completion_state, last_opened_at DESC);

CREATE TABLE IF NOT EXISTS org_content_usage_sessions (
  id UUID NOT NULL,
  org_id TEXT NOT NULL,
  content_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  client_session_id TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  app_foreground BOOLEAN NOT NULL DEFAULT FALSE,
  viewer_active BOOLEAN NOT NULL DEFAULT FALSE,
  media_playing BOOLEAN NOT NULL DEFAULT FALSE,
  credited_active_seconds BIGINT NOT NULL DEFAULT 0 CHECK (credited_active_seconds >= 0),
  last_media_position_seconds DOUBLE PRECISION NULL
    CHECK (last_media_position_seconds IS NULL OR last_media_position_seconds >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (org_id, id),
  UNIQUE (org_id, client_session_id),
  FOREIGN KEY (org_id, content_id)
    REFERENCES org_content_items (org_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS org_content_usage_sessions_user_heartbeat_idx
  ON org_content_usage_sessions (org_id, user_id, last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS org_content_usage_sessions_content_heartbeat_idx
  ON org_content_usage_sessions (org_id, content_id, last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS org_content_usage_sessions_open_idx
  ON org_content_usage_sessions (last_heartbeat_at, org_id)
  WHERE ended_at IS NULL;
