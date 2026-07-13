# Peritio Staging / Production Runbook

Last updated: 2026-07-13

## Environment Map

| Surface | Staging | Production |
| --- | --- | --- |
| Render API | `voicepractice-api-dev` | `peritio-api-prod` |
| API URL | `https://voicepractice-api-dev.onrender.com` | `https://peritio-api-prod.onrender.com` |
| Render DB | `voicepractice_db` | `peritio-db-prod` |
| API identity | `PERITIO_ENV=staging` | `PERITIO_ENV=production` |
| Deploy mode | Auto-deploy may be on | Auto-deploy must stay off |
| Admin web | Existing/current admin utility | `peritio-admin-prod.vercel.app` |
| Admin API env | `API_BASE_URL=https://voicepractice-api-dev.onrender.com` | `API_BASE_URL=https://peritio-api-prod.onrender.com` |
| Admin label env | `NEXT_PUBLIC_PERITIO_ENV=staging` | `NEXT_PUBLIC_PERITIO_ENV=production` |
| EAS profile | `preview` | `production` |
| Mobile API target | `https://voicepractice-api-dev.onrender.com` | `https://peritio-api-prod.onrender.com` |

## Manual Production Deploy Rule

Production API deploys are manual only. Do not enable production auto-deploy. Do not deploy production unless the operator explicitly asks for a production deploy and the production verification checklist below is complete.

## Branch / Release Strategy

Current state: staging and production can both deploy from `main`. That works only when production deploys are manual and disciplined, but it has a weak seam: if `main` moves after staging verification, a later manual production deploy can accidentally include untested commits.

Recommended target model:

- Staging tracks `main` and auto-deploys.
- Production deploys either a pinned tested commit/tag, or a dedicated release branch such as `production` / `release`.
- Production auto-deploy remains off.

Safe promotion flow:

1. Merge work to `main`.
2. Let staging auto-deploy from `main`.
3. Verify staging API, staging admin, mobile preview behavior, and any affected flows.
4. Record the exact tested commit SHA.
5. Promote only that commit:
   - preferred short-term: manually deploy production API pinned to the tested commit/tag if Render supports that workflow for the service.
   - preferred long-term: fast-forward a production/release branch to the tested commit, then manually deploy production from that branch.
6. Before deploying production, verify the production service still points to `peritio-db-prod` and production auto-deploy is still off.
7. After deployment, verify production `/health`, `/ready`, `/meta/environment`, admin target warnings, and one safe read-only app flow.

Do not manually deploy production from "latest main" unless the latest `main` commit is the same commit that passed staging verification.

## Environment Variable Matrix

### Render Staging API

Required identity and storage:

```bash
PERITIO_ENV=staging
NODE_ENV=production
STORAGE_PROVIDER=postgres
DATABASE_URL=<voicepractice_db internal/external URL>
```

Important runtime vars:

```bash
CORS_ALLOWED_ORIGINS=<comma-separated staging browser origins>
ADMIN_BOOTSTRAP_PASSWORD=<staging admin password>
ADMIN_TOKEN_SECRET=<staging-only secret>
WEB_AUTH_TOKEN_SECRET=<staging-only secret>
MOBILE_TOKEN_SECRET=<staging-only secret>
SUPPORT_TRANSCRIPT_SECRET=<staging-only secret>
AUTH_CODE_DELIVERY_PROVIDER=<staging choice>
WEB_AUTH_CODE_DELIVERY_PROVIDER=<staging choice>
MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER=<staging choice>
RESEND_API_KEY=<staging/resend key if resend is enabled>
AUTH_CODE_FROM_EMAIL=<required if resend is enabled>
AUTH_CODE_FROM_NAME=Peritio
AUTH_CODE_REPLY_TO=<optional>
OPENAI_API_KEY=<staging key if AI routes are enabled>
ENABLE_REMOTE_TTS=<true|false>
OPENAI_CHAT_MODEL=<model>
OPENAI_CHAT_API_FAMILY=<chat_completions|responses>
OPENAI_CHAT_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_MODEL=<model>
OPENAI_SIMULATION_API_FAMILY=<chat_completions|responses>
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_TURN_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=<optional>
```

### Render Production API

Required identity and storage:

```bash
PERITIO_ENV=production
NODE_ENV=production
STORAGE_PROVIDER=postgres
DATABASE_URL=<peritio-db-prod internal/external URL>
```

Production must use strong, unique, production-only secrets:

```bash
CORS_ALLOWED_ORIGINS=<comma-separated production browser origins>
ADMIN_BOOTSTRAP_PASSWORD=<production admin password>
ADMIN_TOKEN_SECRET=<production-only secret>
WEB_AUTH_TOKEN_SECRET=<production-only secret>
MOBILE_TOKEN_SECRET=<production-only secret>
SUPPORT_TRANSCRIPT_SECRET=<production-only secret>
AUTH_CODE_DELIVERY_PROVIDER=resend
WEB_AUTH_CODE_DELIVERY_PROVIDER=resend
MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER=resend
RESEND_API_KEY=<production resend key>
AUTH_CODE_FROM_EMAIL=<production sender>
AUTH_CODE_FROM_NAME=Peritio
AUTH_CODE_REPLY_TO=<optional>
OPENAI_API_KEY=<production key>
ENABLE_REMOTE_TTS=<true|false>
OPENAI_CHAT_MODEL=<model>
OPENAI_CHAT_API_FAMILY=<chat_completions|responses>
OPENAI_CHAT_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_MODEL=<model>
OPENAI_SIMULATION_API_FAMILY=<chat_completions|responses>
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_TURN_REASONING_EFFORT=<optional>
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=<optional>
```

Production refuses file storage, `log_only` auth-code delivery, obvious staging database URLs, placeholder secrets, and shared fallback secrets.

### Staging Admin-Web Vercel

```bash
API_BASE_URL=https://voicepractice-api-dev.onrender.com
NEXT_PUBLIC_PERITIO_ENV=staging
```

### Production Admin-Web Vercel

```bash
API_BASE_URL=https://peritio-api-prod.onrender.com
NEXT_PUBLIC_PERITIO_ENV=production
```

Current production admin URL:

```bash
https://peritio-admin-prod.vercel.app
```

### Peritio-Web / Dashboard

Local:

```bash
PERITIO_API_BASE_URL=http://localhost:4100
PERITIO_APP_HOST=app.peritio.ai
PERITIO_PUBLIC_HOST=peritio.ai
```

Staging, if/when a staging dashboard deployment exists:

```bash
PERITIO_API_BASE_URL=https://voicepractice-api-dev.onrender.com
PERITIO_APP_HOST=<intentional staging app host>
PERITIO_PUBLIC_HOST=<intentional staging public host>
```

Production, before customer dashboard use:

```bash
PERITIO_API_BASE_URL=https://peritio-api-prod.onrender.com
PERITIO_APP_HOST=app.peritio.ai
PERITIO_PUBLIC_HOST=peritio.ai
```

### Mobile EAS

Preview profile:

```bash
EXPO_PUBLIC_REMOTE_AI_ENABLED=true
EXPO_PUBLIC_REMOTE_TTS_ENABLED=true
EXPO_PUBLIC_API_BASE_URL=https://voicepractice-api-dev.onrender.com
```

Production profile:

```bash
EXPO_PUBLIC_REMOTE_AI_ENABLED=true
EXPO_PUBLIC_REMOTE_TTS_ENABLED=true
EXPO_PUBLIC_API_BASE_URL=https://peritio-api-prod.onrender.com
```

Also check Expo/EAS remote environment settings for stale values before building.

## What Not To Do

- Do not point staging at the production `DATABASE_URL`.
- Do not point production at the staging `DATABASE_URL`.
- Do not share one Render database between staging and production.
- Do not put database URLs in Vercel admin or dashboard projects.
- Do not run destructive database scripts against production without an explicit, current approval.
- Do not build or submit a production mobile app until the production API, database, admin utility, CORS, and baseline content are verified.
- Do not rely on localhost or auto-detected API URLs for EAS builds.
- Do not replace existing CORS origins blindly; append new origins.

## Verify Render API

Staging:

```bash
curl https://voicepractice-api-dev.onrender.com/health
curl https://voicepractice-api-dev.onrender.com/ready
curl https://voicepractice-api-dev.onrender.com/meta/environment
```

Expected: healthy responses, `/ready` is `200`, and `/meta/environment` reports `PERITIO_ENV=staging`.

Production:

```bash
curl https://peritio-api-prod.onrender.com/health
curl https://peritio-api-prod.onrender.com/ready
curl https://peritio-api-prod.onrender.com/meta/environment
```

Expected: healthy responses, `/ready` is `200`, and `/meta/environment` reports `PERITIO_ENV=production`.

## Verify Render DB

In Render, verify the API service environment variables, not by connecting from local tooling unless explicitly approved:

- Staging API `DATABASE_URL` points to `voicepractice_db`.
- Production API `DATABASE_URL` points to `peritio-db-prod` / `peritio_db_prod`.
- Both APIs use `STORAGE_PROVIDER=postgres`.
- Production does not use dev-only settings such as `AUTH_CODE_DELIVERY_PROVIDER=log_only`, placeholder secrets, shared fallback secrets, or file storage.

## Verify Admin Web

Staging admin:

- Deployed from the existing/current admin utility Vercel project.
- `API_BASE_URL=https://voicepractice-api-dev.onrender.com`.
- `NEXT_PUBLIC_PERITIO_ENV=staging`.
- UI shows a visible `STAGING` label.
- UI shows the staging API base URL.
- UI has no localhost warning and no API environment mismatch warning.

Production admin:

- Deployed from a separate Vercel project.
- Current URL: `https://peritio-admin-prod.vercel.app`.
- `API_BASE_URL=https://peritio-api-prod.onrender.com`.
- `NEXT_PUBLIC_PERITIO_ENV=production`.
- UI shows a visible `PRODUCTION` label.
- UI shows the production API base URL.
- UI has no localhost warning and no API environment mismatch warning.

Recommended custom domains:

- `admin-staging.peritio.ai` for staging admin.
- `admin.peritio.ai` for production admin.

## Verify Mobile / EAS

`mobile/eas.json` is the checked-in source for the profile API targets:

- `preview` uses `EXPO_PUBLIC_API_BASE_URL=https://voicepractice-api-dev.onrender.com`.
- `production` uses `EXPO_PUBLIC_API_BASE_URL=https://peritio-api-prod.onrender.com`.

Before any production mobile build, also check the Expo/EAS project environment settings for stale remote env vars that could override or conflict with the checked-in profile values.

## Peritio Web / Dashboard Status

`peritio-web` is the customer-facing web/dashboard app, but it is not currently staged/live for customer use. Do not treat the dashboard as production-ready for customers until its deployment, API target, host behavior, CORS, auth delivery, and dashboard user access are verified.

It uses:

- `PERITIO_API_BASE_URL`
- `PERITIO_APP_HOST`
- `PERITIO_PUBLIC_HOST`

Current docs/examples still show hosted dashboard values pointed at staging:

```bash
PERITIO_API_BASE_URL=https://voicepractice-api-dev.onrender.com
```

Before customer dashboard use:

- Production must set `PERITIO_API_BASE_URL=https://peritio-api-prod.onrender.com`.
- `PERITIO_APP_HOST` and `PERITIO_PUBLIC_HOST` must be set intentionally for the deployment.
- The production dashboard origin, for example `https://app.peritio.ai`, must be appended to production API `CORS_ALLOWED_ORIGINS`.
- Dashboard OTP/email delivery and trusted web-session secrets must be production-ready.

## CORS Origins

API CORS is controlled by `CORS_ALLOWED_ORIGINS`, a comma-separated list with no trailing slash. Native mobile requests do not need CORS, but browser apps do.

Staging API should include:

- staging admin origin, for example `https://admin-staging.peritio.ai`
- any staging dashboard origin currently in use
- local origins only when needed for development

Production API should include:

- production admin origin, currently `https://peritio-admin-prod.vercel.app`
- production admin custom domain if added later, for example `https://admin.peritio.ai`
- production dashboard origin if/when production dashboard is live, for example `https://app.peritio.ai`

Append new origins to the existing list instead of replacing known-working origins.

## Backup / Restore Reminder

Before any production database restore, migration, content import, or destructive cleanup:

- Take a fresh Render Postgres backup or export.
- Confirm which DB is the source and which DB is the target.
- Confirm production and staging `DATABASE_URL` values remain separate.
- Prefer dry-run tooling first.
- Keep rollback steps and the backup location written down before applying changes.

For sanitizer/bootstrap details, see:

- [`Peritio_Database_Bootstrap_Refresh.md`](./Peritio_Database_Bootstrap_Refresh.md)

## Destructive Script Guard Reminder

Sanitizer and bootstrap tooling must remain dry-run by default. Use `--apply` only after reviewing the inventory report and receiving explicit approval for the exact target database.

Profile intent:

- `prod-bootstrap`: must not run directly against `voicepractice_db`.
- `staging-refresh`: must not run directly against `peritio-db-prod`.

Production write confirmation:

```bash
--target production --confirm-production "I understand this writes to production"
```

Ops scripts are fail-closed:

- recognized local/development targets may proceed normally.
- recognized staging targets may proceed normally.
- recognized production targets require the confirmation above.
- unknown targets are refused by default.
- unknown targets may proceed only through the same explicit production confirmation path.
- `--target staging` never overrides an unknown or production-looking target.

This matters for future vanity domains or changed provider URLs. A future target such as `https://api.peritio.ai` must either be classified in the script guard or invoked with the explicit production confirmation until it is classified.

The production-safety logic exists in both `api/src/productionSafety.ts` and `scripts/ops/production-safety.mjs`. Keep them aligned: the ops helper is duplicated because standalone `.mjs` scripts should not depend on importing API TypeScript source at runtime.

Production data is real data. Treat every production write, restore, and cleanup as a manual change window.

### Script Guard Audit

| Script | Purpose | Current guard | Remaining gap / recommendation |
| --- | --- | --- | --- |
| `npm run db:sanitize-bootstrap` / `api/scripts/sanitize-bootstrap.ts` | Sanitized DB bootstrap/refresh cleanup | Requires explicit `--database-url` and `--profile`; dry-run by default; rejects `prod-bootstrap` against known staging DB names; rejects `staging-refresh` against known production DB names; production or unknown targets require the exact production confirmation phrase before any DB access | Name-marker checks are helpful but brittle if DB names change. Future improvement: support explicit non-secret expected/forbidden DB identifiers. |
| `npm run reset:simulation-baseline --workspace api` / `api/scripts/reset-simulation-baseline.ts` | Clears simulation-derived disposable history | Defaults to file/local behavior; refuses Postgres unless `--allow-postgres`; supports `--dry-run`; production or unknown Postgres targets require the exact production confirmation phrase before any DB access | Keep hosted use rare. Future improvement: support explicit non-secret expected/forbidden DB identifiers. |
| `npm run reset:pretester-history --workspace api` / `api/scripts/reset-pretester-history.ts` | Older pretester reset path | NPM script forces `--local-file`; script refuses non-file storage unless local-file override is present | Acceptable for local file use. Keep it file-only; do not add Postgres support. |
| `npm run seed:dashboard-local --workspace api` / `api/scripts/seed-dashboard-local.mjs` | Seeds local dashboard identities | Loads local env, requires `STORAGE_PROVIDER=file`, writes only local JSON DB path | Acceptable for local setup. Keep it local-only; do not reuse for staging/prod baseline accounts. |
| `scripts/launch-local-stack.ps1` | Starts local API/admin/mobile terminals | Uses local dev commands | Local-only helper. No hosted DB risk unless local env files are misconfigured. |
| `scripts/stop-local-stack.ps1` | Stops local listeners on ports `4100`, `3000`, `8081` | Operates on local processes only | Not a DB risk. Use with care because it kills local processes on those ports. |
| `scripts/ops/upsert-training-pack.mjs` | Directly upserts Postgres training-pack content | Prints target host/db and detected environment; production or unknown DB targets require `--target production` plus the exact confirmation phrase before connecting | No dry-run yet. Use only with a backup and reviewed target. |
| `scripts/ops/assign-enterprise-user.mjs` | Mutates user/org state through the API | Defaults to localhost; prints detected target environment; production or unknown API targets require `--target production` plus the exact confirmation phrase before login/API calls | Use staging/admin UI for routine changes; reserve script use for deliberate operator workflows. |

Do not run any of the DB-writing or API-writing scripts against production without a fresh backup, target review, and explicit approval.

## Database-Separation Guard Recommendation

`api/src/runtimeConfig.ts` currently has two layers of database-separation checks:

- optional exact-match check: staging refuses to boot if `DATABASE_URL` exactly equals `PRODUCTION_DATABASE_URL`.
- built-in marker checks: staging refuses URLs containing `peritio-db-prod` / `peritio_db_prod`; production refuses URLs containing `voicepractice_db` / `voicepractice-db`.

Staging does not need `PRODUCTION_DATABASE_URL` set for the current guard to catch the known production DB names. Setting `PRODUCTION_DATABASE_URL` in staging would improve the exact-match check, but it would require placing full production DB credentials in staging, which is not recommended.

Better direction: replace or supplement `PRODUCTION_DATABASE_URL` with non-secret identifiers, for example:

```bash
EXPECTED_DATABASE_NAME=voicepractice_db
FORBIDDEN_DATABASE_NAMES=peritio_db_prod,peritio-db-prod
EXPECTED_DATABASE_HOST_FINGERPRINT=<non-secret stable host marker>
```

For production:

```bash
EXPECTED_DATABASE_NAME=peritio_db_prod
FORBIDDEN_DATABASE_NAMES=voicepractice_db,voicepractice-db
```

Recommended next hardening: add an API boot-time DB allowlist guard.

- Prefer `EXPECTED_DATABASE_NAME` per environment.
- At boot, when using Postgres, the API should query `current_database()` or the provider equivalent and compare it to `EXPECTED_DATABASE_NAME`.
- Keep forbidden-name checks as a secondary belt-and-suspenders guard.
- Do not put full `PRODUCTION_DATABASE_URL` credentials into staging just to compare URLs.

That keeps staging from needing production credentials while still making the boot guard explicit and configurable if database names, hosts, poolers, or vanity connection URLs change.

## Outstanding Before Production Mobile Build

- Confirm production API `/health`, `/ready`, and `/meta/environment`.
- Confirm production DB schema and required baseline content/accounts are present.
- Confirm production API has strict production env vars and unique secrets.
- Confirm production admin utility exists, points to production, and shows no mismatch warning.
- Confirm production CORS includes only required production browser origins.
- Confirm EAS project remote env vars do not conflict with `mobile/eas.json`.
- Confirm support, OTP/email delivery, AI, and TTS production settings are intentional.
- Confirm a fresh production DB backup exists before any final data changes.

## Before-Customer Checklist

- Production DB backups are confirmed and restorable.
- One test restore into a scratch database has been completed successfully.
- Resend key has been rotated if needed and updated intentionally in staging and production.
- First production mobile build has been verified at runtime to call `https://peritio-api-prod.onrender.com`.
- Production admin utility is verified against production API with no environment mismatch warning.
- Production dashboard envs are verified before any customer dashboard use.
- Production dashboard origin is appended to production API CORS before browser dashboard traffic starts.
- Production release is deployed from a pinned tested commit/tag or an explicit production/release branch.
