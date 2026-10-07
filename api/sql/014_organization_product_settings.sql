CREATE TABLE IF NOT EXISTS organization_product_settings (
  org_id TEXT PRIMARY KEY,
  allow_customer_scenario_creation BOOLEAN NOT NULL DEFAULT FALSE,
  require_org_admin_scenario_approval BOOLEAN NOT NULL DEFAULT TRUE,
  allow_user_admin_focus_topic_management BOOLEAN NOT NULL DEFAULT FALSE,
  allow_manager_focus_topic_management BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_admin_session_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
