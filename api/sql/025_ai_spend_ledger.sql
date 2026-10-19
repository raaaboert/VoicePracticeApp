-- Apply explicitly with the migration owner, never from API startup.
-- Requires existing ai_usage_events (initialized by the existing usage store).
-- Runtime role needs SELECT/INSERT/UPDATE/DELETE on these three tables, and
-- existing ai_usage_events permissions. No sequences, extensions or superuser.
BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtextextended('peritio_ai_spend_schema_v1', 0));

CREATE TABLE IF NOT EXISTS ai_provider_attempts (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('development','staging','production')),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  org_id TEXT NULL CHECK (length(org_id) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK (kind IN ('opening','turn','score','transcribe','tts','custom_scenario','customer_scenario_generation')),
  session_id TEXT NULL CHECK (length(session_id) BETWEEN 1 AND 120),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  state TEXT NOT NULL CHECK (state IN ('reserved','dispatched','succeeded','failed','unknown')),
  reserved_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL CHECK (lease_expires_at > reserved_at),
  input_tokens BIGINT NULL CHECK (input_tokens >= 0),
  output_tokens BIGINT NULL CHECK (output_tokens >= 0),
  total_tokens BIGINT NULL CHECK (total_tokens >= 0),
  tts_characters BIGINT NULL CHECK (tts_characters >= 0),
  stt_milliseconds BIGINT NULL CHECK (stt_milliseconds >= 0),
  estimated_cost_microusd BIGINT NULL CHECK (estimated_cost_microusd >= 0),
  provider_request_id TEXT NULL CHECK (length(provider_request_id) <= 200),
  failure_code TEXT NULL CHECK (failure_code IN ('pre_dispatch','provider_failed','provider_unknown','lease_expired')),
  settlement_fingerprint TEXT NULL CHECK (settlement_fingerprint ~ '^[a-f0-9]{64}$'),
  -- Deliberately not an FK: existing account deletion/deidentification may remove
  -- usage events. Never cascade-delete an uncertain spending claim with them.
  usage_event_id TEXT NOT NULL UNIQUE,
  UNIQUE (environment, actor_id, idempotency_key),
  CHECK (state <> 'reserved' OR dispatched_at IS NULL),
  CHECK (state NOT IN ('dispatched','succeeded','unknown') OR dispatched_at IS NOT NULL),
  CHECK (state NOT IN ('succeeded','failed','unknown') OR finished_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_attempts_active_actor_idx ON ai_provider_attempts
  (environment, actor_id, lease_expires_at) WHERE state IN ('reserved','dispatched','unknown');
CREATE INDEX IF NOT EXISTS ai_attempts_active_org_idx ON ai_provider_attempts
  (environment, org_id, lease_expires_at) WHERE state IN ('reserved','dispatched','unknown');
CREATE INDEX IF NOT EXISTS ai_attempts_active_platform_idx ON ai_provider_attempts
  (environment, lease_expires_at) WHERE state IN ('reserved','dispatched','unknown');
CREATE INDEX IF NOT EXISTS ai_attempts_reconcile_idx ON ai_provider_attempts
  (environment, state, reserved_at);

CREATE TABLE IF NOT EXISTS ai_limit_buckets (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('development','staging','production')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user','org','platform')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 200),
  metric TEXT NOT NULL CHECK (metric IN ('requests','calls','text_tokens','tts_characters','stt_milliseconds','estimated_cost_microusd')),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL CHECK (window_end > window_start),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  consumed BIGINT NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  UNIQUE (environment, scope_type, scope_id, metric, window_start, window_end)
);
CREATE INDEX IF NOT EXISTS ai_buckets_expiration_idx ON ai_limit_buckets (window_end);

CREATE TABLE IF NOT EXISTS ai_attempt_claims (
  attempt_id UUID NOT NULL REFERENCES ai_provider_attempts(id),
  bucket_id UUID NOT NULL REFERENCES ai_limit_buckets(id),
  reserved_units BIGINT NOT NULL CHECK (reserved_units >= 0),
  settled_units BIGINT NULL CHECK (settled_units >= 0),
  PRIMARY KEY (attempt_id, bucket_id)
);
CREATE INDEX IF NOT EXISTS ai_claims_bucket_idx ON ai_attempt_claims (bucket_id);
COMMIT;
