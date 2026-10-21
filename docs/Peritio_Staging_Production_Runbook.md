# Peritio Staging / Production Runbook

> ## Temporary modernization supersession — Performance Intelligence / Focus Topic initiative
>
> For the entire modernization initiative, this notice supersedes the normal branch and promotion workflow below when they conflict. `staging` is the modernization development and integration branch. The staging API (`voicepractice-api-dev`) and staging video worker (`peritio-video-worker-staging`) both track `staging` and auto-deploy on commit. The production API (`peritio-api-prod`) and production video worker (`peritio-video-worker-prod`) both track `main`, with production auto-deploy off.
>
> `main` is frozen at `aa79a9d1fbac6704eb1d0033af81c6342538073d`, identified by annotated tag `pre-performance-intelligence-baseline-2026-09-21`. Do not merge, rebase, fast-forward, or otherwise promote Phase 0, Phase 1A, Phase 1B, or any later individual phase into `main`. Production promotion may occur only after the complete modernization initiative is accepted in staging and explicit production-cutover approval is given. [`Peritio_Phase_0_Baseline.md`](./Peritio_Phase_0_Baseline.md) and [`Peritio_Phase_0_Decisions.md`](./Peritio_Phase_0_Decisions.md) are authoritative over this runbook's normal/default workflow during that period.

Last updated: 2026-10-21

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

Batch 9E.1 authentication requires a separately applied additive migration before API deployment and independent audit approval. Keep this batch local until actual staging auto-deploy settings are verified disabled. Follow [Durable authentication release order](./Peritio_Authentication_Abuse_Protection.md); do not rely on historical deployment mappings above.

Production API deploys are manual only. Do not enable production auto-deploy. Do not deploy production unless the operator explicitly asks for a production deploy and the production verification checklist below is complete.

## R1 controlled modernization cutover (owner approval required)

There are currently no paying/live business customers; production history belongs to
friends/family testers. Do not build a historical-data conversion or reset that is
unnecessary for launch. **Nothing here authorizes production writes or data deletion.**
The normal backfill supports an empty legacy assignment inventory without deleting
old test scores/sessions. Whether production actually has an empty inventory remains
unverified until an authorized operator runs PLAN against that database.

The combined candidate enables industry enforcement immediately; there is no
separate enforcement flag. The two-revision/48-hour procedure below remains the
default when existing sessions must continue. A **single-revision maintenance-window
release is a reasonable alternative only with explicit owner approval** to forgo
continuation of obsolete test sessions, no active/in-flight simulations, coordinated
tester inactivity, a verified recovery point, and checks before reopening access.
This is an explicit alternative to the compatibility drain, not proof that it has
already occurred. If anyone needs session continuation or access cannot be held
quiet, use the two-revision procedure instead. Do not silently switch authority mode.

Execute from the repository root using the approved candidate checkout and its
installed dependencies. Commands below are operator instructions, not actions
performed by Batch R1. `DATABASE_URL` must be set **only in the operator process**
to the separately verified production connection; never copy it into a command log.
PLAN, APPLY, VALIDATE and SIGN-OFF are controlled cutover-window operations,
not routine post-cutover maintenance. In particular, post-cutover `--apply` against
modified legacy source can create a new latest run and block readiness. Do not
run it casually or use it to work around a finalized-run refusal.

1. Record the approved candidate's full SHA and confirm its ancestry from frozen
   baseline `aa79a9d1fbac6704eb1d0033af81c6342538073d`. Verify actual API/worker Git
   branches, auto-deploy controls and independently selectable revision support in
   Render; repository mappings are not proof of live settings. Keep auto-deploy off.
2. Verify production service/environment identity, `STORAGE_PROVIDER=postgres`,
   database name/host and separation from staging. Confirm with a read-only
   `SELECT current_database(), current_schema();` using the authorized connection.
   Confirm a usable backup/restore point and a tested scratch restore before writes.
3. Agree the maintenance window and keep testers out until verification finishes,
   using only controls verified to exist. Check actual `simulation_sessions` columns
   with `information_schema.columns` before querying them. Where `status` and
   `last_seen_at` exist, inspect:

   ```sql
   SELECT COUNT(*) AS recently_unfinished
   FROM simulation_sessions
   WHERE status = 'started' AND last_seen_at >= NOW() - INTERVAL '48 hours';
   ```

   Also confirm with testers that no unregistered/older-client simulation or provider
   request is in flight. A table count alone cannot prove this. Stop on active work.
   Do not delete old sessions to make a readiness query pass. If historical unfinished
   tests obstruct the release, ask the owner for a specific disposition; never reset
   production automatically.
4. Verify the actual running authority mode and revision. Run the read-only effective
   industry audit below for every active organization. Stop for an owner decision on
   zero-effective-industry accounts. Record whether this is the approved one-window
   alternative or the independently verified snapshot/mode/48-hour drain path.
5. Apply mandatory authentication migration 024, with separately approved database
   write authorization, **before** starting new API code:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f api/sql/024_auth_verification.sql
   npm run db:migrate-training-packs --workspace api -- --target production
   npm run db:migrate-training-packs --workspace api -- --apply --target production --confirm-production "I understand this writes to production"
   ```

   Review the Training Pack inspection before APPLY. Verify the required independent
   authentication secrets/delivery settings using the linked authentication runbook.
   `AI_SPEND_LEDGER_MODE` stays off. Do **not** apply dormant migration 025.
6. With legacy writers/test activity still quiet, PLAN using the candidate tooling:

   ```bash
   npm run db:backfill-focus-topic-authority --workspace api -- --target production
   ```

   Review `plan.summary`, integrity issues, shadow differences and required-scenario
   subset broadening. Verify the organizations/Topics/users represented and whether
   zero assignments truly means no legacy learner visibility. Do not use a fabricated
   empty inventory or delete relations to bypass issues. PLAN makes no authority writes.
7. Apply only the reviewed current database inventory, then record the returned
   `run.id` as `<runId>`. APPLY initializes the existing additive Topic schema and
   writes deterministic relations in one transaction; it never approves itself:

   ```bash
   npm run db:backfill-focus-topic-authority --workspace api -- --apply --target production --confirm-production "I understand this writes to production"
   npm run db:backfill-focus-topic-authority --workspace api -- --validate <runId> --by "operator name" --target production --confirm-production "I understand this writes to production"
   ```

   Validation rebuilds the current **database** inventory, checks run version,
   environment/database binding, fingerprint, counts and actual applied row identities.
   Source/authority tables are locked during this short operator check (15-second lock
   timeout). Keep the maintenance window quiet. A changed inventory, missing/mismatched
   rows, unresolved integrity issues, invalid run or stale APPLY is not ready.
8. Sign-off is a separate human decision, after reviewing successful validation:

   ```bash
   npm run db:backfill-focus-topic-authority --workspace api -- --sign-off <runId> --by "owner/operator name" --target production --confirm-production "I understand this writes to production"
   ```

   For **zero assignments only**, explicitly acknowledge the verified empty result:

   ```bash
   npm run db:backfill-focus-topic-authority --workspace api -- --sign-off <runId> --by "owner/operator name" --acknowledge-empty --target production --confirm-production "I understand this writes to production"
   ```

   Operator identity/times, successful evidence and the empty acknowledgment are durable
   in the existing backfill record. A **signed-off run is finalized**: subsequent VALIDATE
   and SIGN-OFF commands are refused before any approval write, even after ordinary source
   changes. They do not revoke approval or change its operator/timestamps. Repeated successful
   validation is supported only while the run is unsigned. An identical latest APPLY retains
   its successful review, but this is not permission to re-APPLY changed data after cutover.
   Failed unsigned validation remains durable, cannot be silently overwritten by another
   VALIDATE, and cannot be signed off. Repair the cause, review PLAN, explicitly APPLY again
   within the controlled window, then validate/sign off; prior failures remain recorded.
   Returning to an older inventory after a newer APPLY also requires fresh validation/sign-off.

   Validation and sign-off require an exact set of **active backfill-managed** assignments,
   scenario attachments and content attachments. Unexpected active records from earlier
   backfills are reported with table/row/organization/Topic identities; manual/direct records
   with other actor provenance are excluded. `--acknowledge-empty` cannot bypass stale rows.
   Stop for explicit review and separately authorized correction; the tool does not silently
   delete, revoke or detach records. A failed cutover must stop before assignments authority
   is activated. Startup continues to allow legitimate later revocations while refusing
   unexpected active backfill records for runs with validation evidence.
9. Only after these gates and explicit cutover approval, select the approved production
   revision and set `FOCUS_TOPIC_AUTHORITY=assignments` in the actual service configuration.
   Verify the mode is saved/active. Deploy/restart deliberately; do not use an uncontrolled
   auto-deploy window. The first assignments-mode startup verifies the latest APPLY,
   validation, sign-off, row evidence and (for empty runs) acknowledgment. Subsequent
   revocations remain valid historical rows; deleted/replaced baseline rows fail closed.
10. Watch startup logs and verify `/health`, `/ready`, `/meta/environment`, deployed SHA
    and actual authority mode. Exercise authentication/verification, assigned Topic and
    resource-only visibility, published scenario launch/registration, one bounded
    simulation/score/recovery and reporting under authorized tester accounts. Confirm
    no cross-org access and no unexpected minute/accounting or industry behavior. Only
    reopen tester access after these checks pass.

**Stop/recovery:** no usable restore point, wrong database/environment, active sessions,
unapproved industry gaps, nonzero backfill issues, validation/sign-off failure, readiness
failure or destructive startup warnings means keep access quiet and stop. Prefer a narrow
forward correction. The old baseline's startup repair can change manager relationships
created under the modernized model: rolling code back to `aa79a9d...` against the upgraded
database is **not automatically safe**. Use the reviewed recovery process below; a coordinated
restore of the verified pre-cutover backup and old code may be needed if deep rollback is
chosen, with explicit owner approval and known loss of post-backup test writes. Never
restore or delete production data merely to silence startup checks.

## Retired Focus Topic reminder schedule

Focus Topic assignments have no due dates, and Focus Topic deadline reminders are retired. Disable or delete any external scheduler that invokes `npm run run:focus-topic-reminders --workspace @voicepractice/api`.

The command remains temporarily as a credential-free, side-effect-free compatibility shim so a scheduler that has not yet been removed exits successfully without starting the API, connecting to PostgreSQL, or creating notifications. Remove the shim only after external scheduler cleanup is confirmed.

## Organization-industry enforcement prerequisite

Industry enforcement has **no separate feature flag**. Deploying `c608bf0` or a later combined staging revision activates it immediately, including in legacy authority mode. Such a revision cannot serve as the first, snapshot-only production deployment.

Unless the owner explicitly approves the no-active-session R1 maintenance-window
alternative above, use two independently approved production release revisions:

1. **Snapshot support first:** prepare and validate a production release containing the snapshot schema/runtime prerequisites and corrections, excluding organization-industry enforcement. `ac8fce2` is a source reference for the prerequisites, not an approved production release. Keep enforcement absent from this first revision. Record its exact deployed SHA and healthy startup.
2. **Verify the running mode:** inspect the actual production service Environment and deployed revision. Snapshot continuation requires `FOCUS_TOPIC_AUTHORITY=assignments`. Documentation defaults and a zero NULL count cannot establish this. If production is still `legacy`, stop for a separately approved authority cutover; do not switch it automatically.
3. **Drain:** record when both snapshot-aware code and assignments mode became active. Wait at least 48 hours from the later event, then require zero recently active unfinished NULL-snapshot sessions. Verify the live schema before using the read-only query below (current source uses `status`, `last_seen_at`, and `industry_snapshot`). Do not fabricate snapshots or rewrite historical rows.

   ```sql
   SELECT COUNT(*) AS recent_unfinished_legacy_sessions
   FROM simulation_sessions
   WHERE status = 'started'
     AND last_seen_at >= NOW() - INTERVAL '48 hours'
     AND industry_snapshot IS NULL;
   ```

4. **Audit before enforcement:** read the actual production configuration and identify every active organization with zero effective industries (organization selections intersected with globally enabled definitions). Inspect the live `app_state` JSON shape first. This query reports technical IDs only; obtain an explicit decision for affected accounts before proceeding.

   ```sql
   WITH config AS (
     SELECT state_json FROM app_state WHERE id = 'primary'
   ), enabled AS (
     SELECT industry->>'id' AS id
     FROM config, jsonb_array_elements(COALESCE(state_json->'config'->'industries', '[]'::jsonb)) industry
     WHERE industry->>'enabled' = 'true'
   ), effective AS (
     SELECT organization->>'id' AS org_id,
       ARRAY(SELECT DISTINCT selection.value
             FROM jsonb_array_elements_text(COALESCE(organization->'activeIndustries', '[]'::jsonb)) selection(value)
             JOIN enabled ON enabled.id = selection.value) AS effective_industry_ids
     FROM config, jsonb_array_elements(COALESCE(state_json->'orgs', '[]'::jsonb)) organization
     WHERE organization->>'status' = 'active'
   )
   SELECT org_id, effective_industry_ids,
          cardinality(effective_industry_ids) = 0 AS requires_decision
   FROM effective ORDER BY org_id;
   ```

5. **Enforcement second:** only after revision/mode/drain/audit gates pass and production approval is explicit, deploy the separate tested enforcement revision. Check readiness and authorized new-launch behavior as well as continuation of a legitimate snapshotted session. Preserve the first revision as the rollback reference.

**Two-revision release mechanism gate:** `main` remains frozen and there is no enforcement toggle. For this compatibility-preserving path, the owner must authorize and establish two independently selectable release revisions (a verified provider pinned-revision/artifact mechanism, or an approved release branch with manual deploys). Verify the service can actually deploy each revision independently; do not assume Render supports a particular pinning control. If only “deploy latest tracked branch” is available, stop until the snapshot-only release line exists or the owner explicitly approves the R1 no-active-session maintenance-window alternative. These instructions create neither production releases nor authority cutovers.

Read-only pre-8B.8B.1 observations on 2026-10-14: staging `/meta/environment` served `c608bf0ba1c0364a68eeac9b9432c622e8a5561c`; production served frozen `aa79a9d1fbac6704eb1d0033af81c6342538073d`. The owner separately confirmed active staging assignments mode. Public metadata does not expose authority mode, tracked branch, or auto-deploy controls. The repository `render.yaml` defines a staging video worker, not the API services; verify actual API and worker branch/auto-deploy settings in Render before each production release. The mappings in the supersession notice are intended mappings, not live provider verification.

## Branch / Release Strategy

The normal workflow below is superseded by the modernization freeze above. Do not use its `main` promotion steps during this initiative. Inspect the provider's actual tracked branches and auto-deploy settings; never infer current deployment mappings from this section.

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
