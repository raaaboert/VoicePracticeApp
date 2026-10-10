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

CREATE TABLE IF NOT EXISTS customer_practice_scenario_events (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  comment TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT customer_practice_scenario_events_type_check CHECK (
    event_type IN ('created', 'submitted', 'approved', 'rejected', 'published', 'archived')
  ),
  CONSTRAINT customer_practice_scenario_events_status_check CHECK (
    status IN ('draft', 'in_review', 'approved', 'rejected', 'published', 'archived')
  ),
  CONSTRAINT customer_practice_scenario_events_scenario_fk FOREIGN KEY (org_id, scenario_id)
    REFERENCES customer_practice_scenarios (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_practice_scenario_events_version_fk FOREIGN KEY (org_id, scenario_id, version_id)
    REFERENCES customer_practice_scenario_versions (org_id, scenario_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_practice_scenario_events_natural_unique UNIQUE
    (scenario_id, version_id, event_type, actor_id, created_at)
);

CREATE INDEX IF NOT EXISTS customer_practice_scenario_events_scenario_idx
  ON customer_practice_scenario_events (org_id, scenario_id, created_at, id);

-- Earlier 019 deployments derived events on every application boot.  A rejected
-- version that was subsequently archived then looked approved because its current
-- status was no longer "rejected".  Remove only that provably fabricated duplicate:
-- it has the same review metadata as an existing rejection for the same version.
DELETE FROM customer_practice_scenario_events fabricated
USING customer_practice_scenario_versions version
WHERE fabricated.org_id = version.org_id
  AND fabricated.scenario_id = version.scenario_id
  AND fabricated.version_id = version.id
  AND fabricated.event_type = 'approved'
  AND version.status = 'archived'
  AND fabricated.actor_id = version.reviewed_by_actor_id
  AND fabricated.created_at = version.reviewed_at
  AND fabricated.comment IS NOT DISTINCT FROM version.review_note
  AND EXISTS (
    SELECT 1 FROM customer_practice_scenario_events rejected
    WHERE rejected.org_id = version.org_id
      AND rejected.scenario_id = version.scenario_id
      AND rejected.version_id = version.id
      AND rejected.event_type = 'rejected'
      AND rejected.actor_id = version.reviewed_by_actor_id
      AND rejected.created_at = version.reviewed_at
      AND rejected.comment IS NOT DISTINCT FROM version.review_note
  );

CREATE TABLE IF NOT EXISTS customer_practice_scenario_event_migration_state (
  migration_key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historical backfill is deliberately one-time.  New lifecycle operations append
-- their own events through the store; initialization must never reconstruct them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_practice_scenario_event_migration_state
    WHERE migration_key = '019_customer_practice_scenario_event_backfill_v2'
  ) THEN
    INSERT INTO customer_practice_scenario_events
      (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
    SELECT org_id,scenario_id,id,'created','draft',created_by_actor_id,NULL,created_at
    FROM customer_practice_scenario_versions
    ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING;

    INSERT INTO customer_practice_scenario_events
      (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
    SELECT org_id,scenario_id,id,'submitted','in_review',submitted_by_actor_id,NULL,submitted_at
    FROM customer_practice_scenario_versions WHERE submitted_at IS NOT NULL AND submitted_by_actor_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING;

    -- An archived historical version no longer reveals whether its review was an
    -- approval or rejection.  Do not invent either event in that ambiguous case.
    INSERT INTO customer_practice_scenario_events
      (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
    SELECT org_id,scenario_id,id,
      CASE WHEN status='rejected' THEN 'rejected' ELSE 'approved' END,
      CASE WHEN status='rejected' THEN 'rejected' ELSE 'approved' END,
      reviewed_by_actor_id,review_note,reviewed_at
    FROM customer_practice_scenario_versions
    WHERE reviewed_at IS NOT NULL AND reviewed_by_actor_id IS NOT NULL
      AND status IN ('rejected', 'approved', 'published')
    ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING;

    INSERT INTO customer_practice_scenario_events
      (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
    SELECT org_id,scenario_id,id,'published','published',published_by_actor_id,NULL,published_at
    FROM customer_practice_scenario_versions WHERE published_at IS NOT NULL AND published_by_actor_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING;

    INSERT INTO customer_practice_scenario_events
      (org_id,scenario_id,version_id,event_type,status,actor_id,comment,created_at)
    SELECT org_id,id,current_version_id,'archived','archived',archived_by_actor_id,NULL,archived_at
    FROM customer_practice_scenarios WHERE archived_at IS NOT NULL AND archived_by_actor_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT customer_practice_scenario_events_natural_unique DO NOTHING;

    INSERT INTO customer_practice_scenario_event_migration_state (migration_key)
    VALUES ('019_customer_practice_scenario_event_backfill_v2');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_customer_practice_scenario_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'customer Practice Scenario lifecycle history is append-only'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_practice_scenario_event_append_only
  ON customer_practice_scenario_events;
CREATE TRIGGER customer_practice_scenario_event_append_only
  BEFORE UPDATE OR DELETE ON customer_practice_scenario_events
  FOR EACH ROW EXECUTE FUNCTION prevent_customer_practice_scenario_event_mutation();

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
