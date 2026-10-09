CREATE TABLE IF NOT EXISTS customer_practice_scenarios (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  home_focus_topic_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  approved_version_id TEXT NULL,
  published_version_id TEXT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  archived_by_actor_id TEXT NULL,
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT customer_practice_scenarios_status_check CHECK (
    status IN ('draft', 'in_review', 'approved', 'rejected', 'published', 'archived')
  ),
  CONSTRAINT customer_practice_scenarios_archive_check CHECK (
    (status = 'archived' AND archived_by_actor_id IS NOT NULL AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_by_actor_id IS NULL AND archived_at IS NULL)
  ),
  CONSTRAINT customer_practice_scenarios_org_identity_unique UNIQUE (org_id, id)
);

CREATE TABLE IF NOT EXISTS customer_practice_scenario_versions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  desired_outcome TEXT NULL,
  ai_role TEXT NOT NULL,
  scoring_guidance TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  applicable_industry_ids JSONB NOT NULL,
  provenance JSONB NOT NULL,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  submitted_by_actor_id TEXT NULL,
  submitted_at TIMESTAMPTZ NULL,
  reviewed_by_actor_id TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  published_by_actor_id TEXT NULL,
  published_at TIMESTAMPTZ NULL,
  CONSTRAINT customer_practice_scenario_versions_status_check CHECK (
    status IN ('draft', 'in_review', 'approved', 'rejected', 'published', 'archived')
  ),
  CONSTRAINT customer_practice_scenario_versions_industries_array_check CHECK (
    jsonb_typeof(applicable_industry_ids) = 'array'
  ),
  CONSTRAINT customer_practice_scenario_versions_provenance_object_check CHECK (
    jsonb_typeof(provenance) = 'object'
  ),
  CONSTRAINT customer_practice_scenario_versions_sources_array_check CHECK (
    jsonb_typeof(source_references) = 'array'
  ),
  CONSTRAINT customer_practice_scenario_versions_scenario_fk FOREIGN KEY (org_id, scenario_id)
    REFERENCES customer_practice_scenarios (org_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT customer_practice_scenario_versions_number_unique UNIQUE (scenario_id, version_number),
  CONSTRAINT customer_practice_scenario_versions_org_identity_unique UNIQUE (org_id, id),
  CONSTRAINT customer_practice_scenario_versions_scenario_identity_unique UNIQUE (org_id, scenario_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_practice_scenarios_current_version_fk'
      AND conrelid = 'customer_practice_scenarios'::regclass
  ) THEN
    ALTER TABLE customer_practice_scenarios
      ADD CONSTRAINT customer_practice_scenarios_current_version_fk
      FOREIGN KEY (org_id, id, current_version_id)
      REFERENCES customer_practice_scenario_versions (org_id, scenario_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_practice_scenarios_approved_version_fk'
      AND conrelid = 'customer_practice_scenarios'::regclass
  ) THEN
    ALTER TABLE customer_practice_scenarios
      ADD CONSTRAINT customer_practice_scenarios_approved_version_fk
      FOREIGN KEY (org_id, id, approved_version_id)
      REFERENCES customer_practice_scenario_versions (org_id, scenario_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_practice_scenarios_published_version_fk'
      AND conrelid = 'customer_practice_scenarios'::regclass
  ) THEN
    ALTER TABLE customer_practice_scenarios
      ADD CONSTRAINT customer_practice_scenarios_published_version_fk
      FOREIGN KEY (org_id, id, published_version_id)
      REFERENCES customer_practice_scenario_versions (org_id, scenario_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customer_practice_scenarios_topic_idx
  ON customer_practice_scenarios (org_id, home_focus_topic_id, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS customer_practice_scenarios_published_idx
  ON customer_practice_scenarios (org_id, published_version_id)
  WHERE published_version_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_practice_scenario_versions_scenario_idx
  ON customer_practice_scenario_versions (org_id, scenario_id, version_number DESC);

CREATE OR REPLACE FUNCTION prevent_customer_practice_scenario_version_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.org_id IS DISTINCT FROM NEW.org_id
    OR OLD.scenario_id IS DISTINCT FROM NEW.scenario_id
    OR OLD.version_number IS DISTINCT FROM NEW.version_number
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.desired_outcome IS DISTINCT FROM NEW.desired_outcome
    OR OLD.ai_role IS DISTINCT FROM NEW.ai_role
    OR OLD.scoring_guidance IS DISTINCT FROM NEW.scoring_guidance
    OR OLD.segment_id IS DISTINCT FROM NEW.segment_id
    OR OLD.applicable_industry_ids IS DISTINCT FROM NEW.applicable_industry_ids
    OR OLD.provenance IS DISTINCT FROM NEW.provenance
    OR OLD.source_references IS DISTINCT FROM NEW.source_references
    OR OLD.created_by_actor_id IS DISTINCT FROM NEW.created_by_actor_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'customer Practice Scenario version content is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_practice_scenario_version_content_immutable
  ON customer_practice_scenario_versions;
CREATE TRIGGER customer_practice_scenario_version_content_immutable
  BEFORE UPDATE ON customer_practice_scenario_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_customer_practice_scenario_version_content_update();

DO $$
BEGIN
  IF to_regclass('simulation_sessions') IS NOT NULL THEN
    ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS scenario_version_id TEXT NULL;
    CREATE INDEX IF NOT EXISTS idx_simulation_sessions_scenario_version_id
      ON simulation_sessions (scenario_version_id) WHERE scenario_version_id IS NOT NULL;
  END IF;
  IF to_regclass('usage_sessions') IS NOT NULL THEN
    ALTER TABLE usage_sessions ADD COLUMN IF NOT EXISTS scenario_version_id TEXT NULL;
    CREATE INDEX IF NOT EXISTS idx_usage_sessions_scenario_version_id
      ON usage_sessions (scenario_version_id) WHERE scenario_version_id IS NOT NULL;
  END IF;
END $$;
