CREATE TABLE IF NOT EXISTS user_employee_id_claims (
  user_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_id_normalized TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_employee_id_claims_org_employee_id_unique_idx
  ON user_employee_id_claims (org_id, employee_id_normalized)
  WHERE employee_id_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_employee_id_claims_org_idx
  ON user_employee_id_claims (org_id);
