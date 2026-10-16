-- Forward-only authentication cutover. Never import pending app_state codes.
CREATE TABLE IF NOT EXISTS auth_verification_accounts (
  account_key TEXT PRIMARY KEY CHECK (length(account_key) = 64),
  failure_times JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(failure_times) = 'array' AND jsonb_array_length(failure_times) <= 10),
  issuances JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issuances) = 'array' AND jsonb_array_length(issuances) <= 5),
  locked_until TIMESTAMPTZ,
  next_issue_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS auth_verification_challenges (
  id UUID PRIMARY KEY,
  account_key TEXT NOT NULL REFERENCES auth_verification_accounts(account_key) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  org_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'email_verification')),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '15 minutes'),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  delivered_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_verification_pending_scope_uidx
  ON auth_verification_challenges(account_key, user_id, purpose, COALESCE(org_id, ''))
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_verification_challenges_expiry_idx ON auth_verification_challenges(expires_at);
CREATE INDEX IF NOT EXISTS auth_verification_challenges_account_idx ON auth_verification_challenges(account_key);
CREATE INDEX IF NOT EXISTS auth_verification_accounts_cleanup_idx ON auth_verification_accounts(updated_at);
