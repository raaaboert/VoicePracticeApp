-- Performance Plan Updates.
--
-- Human-written Updates are separate from immutable technical audit events.
-- API startup initializes this table automatically; this SQL companion is
-- idempotent for existing databases and safe to retry.

BEGIN;

DO $$
BEGIN
  IF to_regclass('performance_plans') IS NOT NULL THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS performance_plan_updates (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES performance_plans(id) ON DELETE CASCADE,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        author_actor_type TEXT NOT NULL,
        author_actor_id TEXT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS performance_plan_updates_plan_created_idx
        ON performance_plan_updates (plan_id, created_at ASC, id ASC)
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS performance_plan_updates_org_created_idx
        ON performance_plan_updates (org_id, created_at DESC)
    ';
  END IF;
END $$;

COMMIT;
