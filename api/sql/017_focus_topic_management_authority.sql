DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM focus_topic_assignments
    WHERE grants_management = TRUE
      AND audience NOT IN ('individual', 'manager_only')
  ) THEN
    RAISE EXCEPTION
      'focus_topic_assignments contains management grants with an unsupported audience';
  END IF;
END $$;

ALTER TABLE focus_topic_assignments
  DROP CONSTRAINT IF EXISTS focus_topic_assignments_management_check;

ALTER TABLE focus_topic_assignments
  ADD CONSTRAINT focus_topic_assignments_management_check CHECK (
    grants_management = FALSE OR audience IN ('individual', 'manager_only')
  );

DROP INDEX IF EXISTS focus_topic_assignments_active_targeted_uidx;

CREATE UNIQUE INDEX focus_topic_assignments_active_targeted_uidx
  ON focus_topic_assignments (
    org_id,
    topic_id,
    audience,
    subject_user_id,
    grants_management
  )
  WHERE revoked_at IS NULL
    AND audience IN ('manager_only', 'manager_with_team', 'individual');
