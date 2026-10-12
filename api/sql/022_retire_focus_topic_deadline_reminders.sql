-- Topic assignment due_date remains as deprecated historical data.  Do not
-- drop it: historical migrations run on every startup and migration 020 keeps
-- the additive column available for existing installations.
--
-- Retire only unresolved notifications emitted by the removed deadline worker.
-- The WHERE clause makes repeated startup initialization idempotent and leaves
-- all unrelated notification history untouched.
DO $$
BEGIN
  IF to_regclass('user_notifications') IS NOT NULL THEN
    UPDATE user_notifications
       SET resolved_at = COALESCE(resolved_at, NOW()),
           resolution = COALESCE(resolution, 'retired_topic_deadline_reminder')
     WHERE resolved_at IS NULL
       AND kind IN ('topic_due_7d', 'topic_due_1d', 'topic_overdue');
  END IF;
END $$;
