-- Preserve notification history while allowing a recipient to remove a row
-- from their active inbox. Re-running this migration is safe on every boot.
ALTER TABLE user_notifications
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS user_notifications_recipient_active_created_idx
  ON user_notifications (recipient_user_id, created_at DESC, id DESC)
  WHERE dismissed_at IS NULL;
