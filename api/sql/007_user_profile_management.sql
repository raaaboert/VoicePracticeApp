-- User management profile fields are stored in the app_state JSON document.
-- Startup normalization backfills these fields idempotently for existing PostgreSQL databases:
--   users[].firstName
--   users[].lastName
--   users[].managerUserId
--   users[].mobileProfileReonboardingRequired
-- This file is intentionally a no-op schema marker so database initialization remains safe
-- for existing app_state-backed PostgreSQL deployments.
SELECT 1;
