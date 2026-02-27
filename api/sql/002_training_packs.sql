-- Enterprise training packs (separate from app_state JSON).
-- One active pack per organization is enforced via partial unique index.
CREATE TABLE IF NOT EXISTS training_packs (
  id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  training_topic TEXT NOT NULL,
  learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_behaviors JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_behavioral_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  scoring_weight_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  compliance_constraints TEXT NOT NULL DEFAULT '',
  audience_level TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS training_packs_org_idx
  ON training_packs (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS training_packs_one_active_per_org_idx
  ON training_packs (organization_id)
  WHERE active IS TRUE;
