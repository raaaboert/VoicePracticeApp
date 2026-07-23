-- Performance Plans (downstream from usage_sessions and score_records).
-- No Performance metadata is written onto simulation/session source tables.

CREATE TABLE IF NOT EXISTS performance_plans (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_by_actor_type TEXT NOT NULL,
  created_by_actor_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by_actor_type TEXT NULL,
  cancelled_by_actor_id TEXT NULL,
  cancellation_reason TEXT NULL,
  activity_goal_enabled BOOLEAN NOT NULL,
  activity_metric_type TEXT NULL,
  activity_target_value DOUBLE PRECISION NULL,
  performance_goal_enabled BOOLEAN NOT NULL,
  performance_metric_type TEXT NULL,
  target_score DOUBLE PRECISION NULL,
  improvement_amount DOUBLE PRECISION NULL,
  comparison_month_count INTEGER NULL,
  baseline_start_at TIMESTAMPTZ NULL,
  baseline_end_at TIMESTAMPTZ NULL,
  baseline_average DOUBLE PRECISION NULL,
  baseline_session_count INTEGER NULL,
  derived_target_score DOUBLE PRECISION NULL,
  all_assigned_scenarios BOOLEAN NOT NULL,
  selected_focus_topic_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_scenario_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_snapshot JSONB NOT NULL,
  baseline_snapshot JSONB NULL,
  final_result_snapshot JSONB NULL,
  definition_signature TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT performance_plans_status_chk
    CHECK (status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT performance_plans_date_order_chk
    CHECK (start_date <= end_date),
  CONSTRAINT performance_plans_goal_enabled_chk
    CHECK (activity_goal_enabled IS TRUE OR performance_goal_enabled IS TRUE),
  CONSTRAINT performance_plans_activity_target_chk
    CHECK (activity_target_value IS NULL OR activity_target_value >= 0),
  CONSTRAINT performance_plans_score_target_chk
    CHECK (target_score IS NULL OR (target_score >= 0 AND target_score <= 100)),
  CONSTRAINT performance_plans_improvement_amount_chk
    CHECK (improvement_amount IS NULL OR improvement_amount >= 0),
  CONSTRAINT performance_plans_derived_target_chk
    CHECK (derived_target_score IS NULL OR (derived_target_score >= 0 AND derived_target_score <= 100)),
  CONSTRAINT performance_plans_comparison_month_chk
    CHECK (comparison_month_count IS NULL OR comparison_month_count IN (1, 2, 3, 6))
);

ALTER TABLE performance_plans
  ADD COLUMN IF NOT EXISTS definition_signature TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx
  ON performance_plans (org_id, user_id, definition_signature)
  WHERE status = 'active' AND definition_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS performance_plans_org_user_status_idx
  ON performance_plans (org_id, user_id, status);

CREATE INDEX IF NOT EXISTS performance_plans_user_dates_idx
  ON performance_plans (org_id, user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS performance_plans_org_status_dates_idx
  ON performance_plans (org_id, status, start_date, end_date);

CREATE TABLE IF NOT EXISTS performance_plan_scope_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_display_name TEXT NOT NULL,
  scenario_source TEXT NOT NULL,
  segment_id TEXT NULL,
  segment_label TEXT NULL,
  focus_topic_id TEXT NULL,
  focus_topic_name TEXT NULL,
  selection_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT performance_plan_scope_source_chk
    CHECK (scenario_source IN ('standard', 'custom', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS performance_plan_scope_items_plan_scenario_idx
  ON performance_plan_scope_items (plan_id, scenario_id);

CREATE INDEX IF NOT EXISTS performance_plan_scope_items_org_user_scenario_idx
  ON performance_plan_scope_items (org_id, user_id, scenario_id);

CREATE INDEX IF NOT EXISTS performance_plan_scope_items_plan_idx
  ON performance_plan_scope_items (plan_id);

CREATE TABLE IF NOT EXISTS performance_plan_audit_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,
  action TEXT NOT NULL,
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  old_values JSONB NULL,
  new_values JSONB NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS performance_plan_audit_events_plan_created_idx
  ON performance_plan_audit_events (plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS performance_plan_audit_events_org_created_idx
  ON performance_plan_audit_events (org_id, created_at DESC);

-- Additive read indexes for Performance calculations. These do not change write semantics.
CREATE INDEX IF NOT EXISTS idx_usage_sessions_org_user_ended_at
  ON usage_sessions (org_id, user_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_sessions_org_user_scenario_ended_at
  ON usage_sessions (org_id, user_id, scenario_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_score_records_org_user_ended_at
  ON score_records (org_id, user_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS idx_score_records_org_user_scenario_ended_at
  ON score_records (org_id, user_id, scenario_id, ended_at DESC);
