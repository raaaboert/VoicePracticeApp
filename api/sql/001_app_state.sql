-- Durable storage table for ApiDatabase JSON state.
-- Used when STORAGE_PROVIDER=postgres.
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
