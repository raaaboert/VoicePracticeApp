-- A management grant is an entitlement of a person. Its historical audience
-- records the creation context only; it must not permit two active grants for
-- the same person and Focus Topic.
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY org_id, topic_id, subject_user_id
      ORDER BY created_at ASC, id ASC
    ) AS ordinal
  FROM focus_topic_assignments
  WHERE grants_management = TRUE
    AND revoked_at IS NULL
)
UPDATE focus_topic_assignments AS assignment
SET revoked_at = NOW(),
    revoked_by = 'system:management-grant-deduplication'
FROM ranked
WHERE assignment.id = ranked.id
  AND ranked.ordinal > 1;

DROP INDEX IF EXISTS focus_topic_assignments_active_targeted_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_assignments_active_learner_targeted_uidx
  ON focus_topic_assignments (org_id, topic_id, audience, subject_user_id)
  WHERE revoked_at IS NULL
    AND grants_management = FALSE
    AND audience IN ('manager_only', 'manager_with_team', 'individual');

CREATE UNIQUE INDEX IF NOT EXISTS focus_topic_assignments_active_management_person_uidx
  ON focus_topic_assignments (org_id, topic_id, subject_user_id)
  WHERE revoked_at IS NULL
    AND grants_management = TRUE;
