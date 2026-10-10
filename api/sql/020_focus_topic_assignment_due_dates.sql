ALTER TABLE focus_topic_assignments
  ADD COLUMN IF NOT EXISTS due_date DATE NULL;

CREATE INDEX IF NOT EXISTS focus_topic_assignments_due_date_idx
  ON focus_topic_assignments (due_date)
  WHERE revoked_at IS NULL AND grants_management = FALSE AND due_date IS NOT NULL;
