CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolution TEXT NULL,
  CONSTRAINT user_notifications_recipient_dedup_key UNIQUE (recipient_user_id, dedup_key),
  CONSTRAINT user_notifications_resolution_pair_check CHECK (
    (resolved_at IS NULL AND resolution IS NULL)
    OR (resolved_at IS NOT NULL AND resolution IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS user_notifications_recipient_created_idx
  ON user_notifications (recipient_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS user_notifications_recipient_actionable_unread_idx
  ON user_notifications (recipient_user_id, org_id, kind)
  WHERE read_at IS NULL AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS user_notifications_subject_idx
  ON user_notifications (kind, subject_type, subject_id)
  WHERE resolved_at IS NULL;
