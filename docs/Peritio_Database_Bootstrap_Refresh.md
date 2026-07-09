# Peritio Database Bootstrap And Refresh

This is the operator checklist for keeping Peritio staging and production databases separate.

Hard rules:

- Staging API: `https://voicepractice-api-dev.onrender.com`
- Staging DB: `voicepractice_db`
- Production API: `https://peritio-api-prod.onrender.com`
- Production DB: `peritio-db-prod`
- Staging must never use the production `DATABASE_URL`.
- Production must never use the staging `DATABASE_URL`.
- Production auto-deploy stays off. Production deploys are manual only.
- Do not run restore or sanitizer commands against production without an explicit approval checkpoint.

## Tooling

The sanitizer command is dry-run by default:

```bash
npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile prod-bootstrap
npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile staging-refresh
```

Add `--apply` only after reviewing the JSON inventory report:

```bash
npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile prod-bootstrap --apply
```

The sanitizer removes session/auth/operational state and safely identifiable local/demo/test records while preserving:

- app config
- real orgs and users
- divisions
- org trainings
- training packs
- training/scenario attachments
- training assignment configuration
- prompt/model/config state

It clears:

- `web_auth_sessions`
- mobile auth tokens
- email verification / OTP records
- web auth challenges
- admin active sessions
- `usage_sessions`
- `simulation_sessions`
- `score_records`
- `ai_usage_events`
- `support_cases`
- `audit_events`
- safely identifiable demo/local/test users and orgs

## One-Time Production Bootstrap

Goal: copy the useful current staging/live-ish content from `voicepractice_db` into `peritio-db-prod` without sharing databases or carrying staging sessions/tokens/history into production.

Recommended flow:

1. Put staging/content changes on hold.
2. Export `voicepractice_db`.
3. Restore the export into a scratch Postgres database, not production.
4. Run sanitizer dry-run against scratch.
5. Review counts, removed records, preserved records, and warnings.
6. Run sanitizer apply against scratch.
7. Export the sanitized scratch database.
8. Restore the sanitized dump into `peritio-db-prod` only after explicit approval.
9. Verify `peritio-db-prod`.
10. Manually deploy production API when ready.

Command template:

```bash
pg_dump --dbname "<staging-external-database-url>" --format=custom --no-owner --no-privileges --file voicepractice_db.raw.dump

pg_restore --dbname "<scratch-database-url>" --clean --if-exists --no-owner --no-privileges --verbose voicepractice_db.raw.dump

npm run db:sanitize-bootstrap -- --database-url "<scratch-database-url>" --profile prod-bootstrap

npm run db:sanitize-bootstrap -- --database-url "<scratch-database-url>" --profile prod-bootstrap --apply

pg_dump --dbname "<scratch-database-url>" --format=custom --no-owner --no-privileges --file peritio-prod-bootstrap.sanitized.dump

pg_restore --dbname "<prod-external-database-url>" --clean --if-exists --no-owner --no-privileges --verbose peritio-prod-bootstrap.sanitized.dump
```

Do not run `prod-bootstrap` directly against `voicepractice_db`; the tool refuses obvious staging URLs for this profile.

## Refresh Staging From Production

Goal: make staging realistic from production content while removing production sessions/tokens/history/support data.

Recommended flow:

1. Export `peritio-db-prod`.
2. Restore into a scratch database.
3. Run sanitizer dry-run with `staging-refresh`.
4. Review warnings and counts.
5. Run sanitizer apply against scratch.
6. Export sanitized scratch.
7. Restore sanitized dump into `voicepractice_db` during a staging maintenance window.
8. Verify staging API still points at `voicepractice_db`.

Command template:

```bash
pg_dump --dbname "<prod-external-database-url>" --format=custom --no-owner --no-privileges --file peritio-db-prod.raw.dump

pg_restore --dbname "<scratch-database-url>" --clean --if-exists --no-owner --no-privileges --verbose peritio-db-prod.raw.dump

npm run db:sanitize-bootstrap -- --database-url "<scratch-database-url>" --profile staging-refresh

npm run db:sanitize-bootstrap -- --database-url "<scratch-database-url>" --profile staging-refresh --apply

pg_dump --dbname "<scratch-database-url>" --format=custom --no-owner --no-privileges --file voicepractice_db.refresh.sanitized.dump

pg_restore --dbname "<staging-external-database-url>" --clean --if-exists --no-owner --no-privileges --verbose voicepractice_db.refresh.sanitized.dump
```

Do not run `staging-refresh` against `peritio-db-prod`; the tool refuses obvious production URLs for this profile.

## Verification

Before touching production, verify the sanitized scratch database:

```sql
SELECT COUNT(*) FROM app_state WHERE id = 'primary';
SELECT COUNT(*) FROM training_packs;
SELECT COUNT(*) FROM web_auth_sessions;
SELECT COUNT(*) FROM usage_sessions;
SELECT COUNT(*) FROM simulation_sessions;
SELECT COUNT(*) FROM score_records;
SELECT COUNT(*) FROM ai_usage_events;
SELECT COUNT(*) FROM support_cases;
```

Expected:

- `app_state` has exactly one `primary` row.
- `training_packs` exists and contains the expected content rows.
- operational/session/history/support tables are empty after sanitizer apply.
- sanitizer warnings have been reviewed.
- no staging service points at the production database URL.
- production API is deployed manually only after the production DB restore is approved and verified.

