-- Performance multiple-active-plan rollout.
--
-- The API startup path computes and backfills definition_signature with the
-- server-side canonical SHA-256 signature before dropping the old one-active
-- index. This SQL companion is intentionally retry-safe for existing databases:
-- it prepares the column/index shape and drops the old index only after active
-- rows already have signatures.

BEGIN;

DO $$
BEGIN
  IF to_regclass('performance_plans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE performance_plans ADD COLUMN IF NOT EXISTS definition_signature TEXT NULL';

    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS performance_plans_one_active_definition_idx
        ON performance_plans (org_id, user_id, definition_signature)
        WHERE status = ''active'' AND definition_signature IS NOT NULL
    ';

    IF NOT EXISTS (
      SELECT 1
      FROM performance_plans
      WHERE status = 'active'
        AND definition_signature IS NULL
      LIMIT 1
    ) THEN
      EXECUTE 'DROP INDEX IF EXISTS performance_plans_one_active_per_user_idx';
    END IF;
  END IF;
END $$;

COMMIT;
