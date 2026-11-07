# API (`/api`)

Express API for Phase 1 development.

## Key Endpoints

- `GET /health`
- `GET /ready`
- `GET /ready/training-content-storage`
- `GET /meta/environment`
- `POST /auth/login`
- `POST /auth/change-password`
- `POST /web/auth/request-code`
- `POST /web/auth/verify-code`
- `GET /web/auth/session`
- `POST /web/auth/logout`
- `GET /dashboard/overview`
- `GET /dashboard/customers`
- `GET /dashboard/customers/:orgId`
- `GET /dashboard/users`
- `GET /dashboard/users/:userId`
- `GET /dashboard/training`
- `GET /dashboard/training/:trainingPackId`
- `GET /dashboard/training/:trainingPackId/assignments/:assignmentId`
- `GET /dashboard/attempts/:attemptId`
- `GET /config`
- `PATCH /config` (admin)
- `GET /users` (admin)
- `POST /users` (admin)
- `PATCH /users/:userId` (admin)
- `GET /users/:userId/entitlements` (admin)
- `POST /mobile/onboard`
- `GET /mobile/users/:userId`
- `PATCH /mobile/users/:userId/settings`
- `GET /mobile/users/:userId/entitlements`
- `POST /mobile/users/:userId/ai/transcribe` (mobile auth)
- `POST /mobile/users/:userId/ai/opening` (mobile auth)
- `POST /mobile/users/:userId/ai/turn` (mobile auth)
- `POST /mobile/users/:userId/ai/score` (mobile auth)
- `POST /mobile/users/:userId/support/cases` (mobile auth)
- `POST /usage/sessions`
- `GET /usage` (admin)
- `GET /audit/events` (admin)
- `GET /support/cases` (admin)
- `GET /support/cases/:caseId` (admin)
- `GET /orgs` / `POST /orgs` / `PATCH /orgs/:orgId` (admin)
  - `POST /orgs` requires a UUID-v4 `Idempotency-Key` header.

## Environment

Create `.env` from `.env.example`:

```bash
PORT=4100
NODE_ENV=development
PERITIO_ENV=development
STORAGE_PROVIDER=file
DB_PATH=./db.local.json
DATABASE_URL=
PG_POOL_MAX=5
PG_CONNECT_TIMEOUT_MS=8000
PG_IDLE_TIMEOUT_MS=30000
CORS_ALLOWED_ORIGINS=http://localhost:3000
ADMIN_BOOTSTRAP_PASSWORD=admin
ADMIN_TOKEN_SECRET=replace_me_for_production
ADMIN_TOKEN_TTL_MINUTES=720
WEB_AUTH_TOKEN_SECRET=replace_me_for_shared_web_auth
AUTH_CODE_DELIVERY_PROVIDER=log_only
WEB_AUTH_CODE_DELIVERY_PROVIDER=
MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER=
RESEND_API_KEY=
AUTH_CODE_FROM_EMAIL=
AUTH_CODE_FROM_NAME=Peritio
AUTH_CODE_REPLY_TO=
MOBILE_TOKEN_SECRET=replace_me_for_mobile_tokens
MOBILE_REVERIFY_ON_ONBOARD=false
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_CHAT_API_FAMILY=responses
OPENAI_CHAT_REASONING_EFFORT=low
OPENAI_SIMULATION_MODEL=gpt-5.4
OPENAI_SIMULATION_API_FAMILY=responses
OPENAI_SIMULATION_REASONING_EFFORT=low
OPENAI_SCORING_MODEL=
OPENAI_SCORING_API_FAMILY=
OPENAI_SCORING_REASONING_EFFORT=
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=
OPENAI_SIMULATION_TURN_REASONING_EFFORT=
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=
OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS=
OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS=
OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS=
OPENAI_SIMULATION_MAX_OUTPUT_TOKENS=
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_TTS_MODEL=tts-1
ENABLE_REMOTE_TTS=false
OPENAI_MAX_DAILY_CALLS_PER_USER=
OPENAI_MAX_DAILY_CALLS_GLOBAL=
OPENAI_MAX_DAILY_TOKENS_PER_USER=
OPENAI_MAX_DAILY_TOKENS_GLOBAL=
SUPPORT_TRANSCRIPT_SECRET=replace_me_for_production
```

## Client IP metadata and rate-limit identity

Rate-limit security does not depend on proxy IP attribution. Render/Vercel egress
may be shared by unrelated users; neither that peer nor caller-supplied XFF/CF
headers selects a customer quota. No new provider setting or infrastructure is
required. Keep the existing single API instance deployment requirement: the
short-term request/overload counters below are process-local.

- Dashboard/mobile OTP issuance and verification retain the existing durable
  AuthVerificationStore account/challenge protections: 5 issuances/15 minutes,
  60-second issuance cooldown, 5 wrong attempts per challenge, and 10 eligible
  failures/15 minutes per account. Invalid or absent challenges do not issue sessions.
- Platform-admin password login has one server-owned durable budget of 12
  attempts per fixed 15-minute window, including successes. It protects the single
  shared platform-admin credential independently of forged headers or restarts.
  An attacker can temporarily exhaust that credential's budget; existing admin
  sessions and customer OTP sign-in remain separate. This does not provide DoS
  immunity or replace strong admin credentials.
- New mobile registrations have a separate durable global budget of 300 per fixed
  15-minute window. Rotating emails cannot create unlimited accounts. Exhaustion
  delays new registrations; existing accounts use their own OTP budgets. Admission
  is reserved once before the app-state write phase, so denied requests never
  republish app_state. Reservations count even if a later write fails.
- Public authentication routes share a short token bucket: burst 200, refill
  100/second, maximum 16 active requests. It does not gate authenticated AI.
  Saturation returns 429 with Retry-After: 1. This public-authentication overload
  guard sheds traffic globally; capacity is an initial policy choice, not a
  load-tested availability guarantee.
- Anonymous /mobile/public/support/errors has a process-local global quota of
  30 requests per fixed hour, with an accurate Retry-After. All attempts count,
  including invalid reports. Authenticated /mobile/users/:userId/support/cases
  does not use that quota. Anonymous auto-error reporting can be starved during
  an attack; authenticated manual support remains separate. Restart resets the
  anonymous quota.
- Invalid/missing AI credentials share a fixed anonymous 120/15-minute bucket.
  Exhausting it does not reject valid AI users. Authenticated AI limits remain
  120/verified user/15 minutes across AI routes, with existing usage controls
  unchanged. At most four AI HTTP requests may be active per verified user;
  other users and anonymous floods cannot spend those slots. Slots release on
  response finish/close, including aborts. Both AI and public-auth slot guards
  attach these listeners, then immediately check response.destroyed: an already
  disconnected response releases its slot and returns without calling next.
  Release is idempotent, including when both finish and close occur.
  Multipart limits, provider deadlines,
  entitlements and accounting remain in place. No shared authenticated-AI gate
  or new spending cap is introduced. This is per-user isolation, not unlimited
  total server capacity.
- Upload/finalization/access limits are 120/verified user/15 minutes (one shared
  principal for platform-admin tokens). Authentication runs before consumption.
  Mobile verification/resend and organization joins use verified users, 20/15
  minutes; reviewer verification retains its separate existing 20-attempt quota.
  Scenario generation retains its existing verified organization/actor quota.

The durable budgets reuse existing auth_verification_accounts transactions and
rows; no new migration is needed. Fixed server-owned budget rows encode
[windowStart, used] in failure_times, within migration 024's ten-element bound.
Legacy timestamp-list budget rows are conservatively adopted; malformed state
fails closed for one window. Ordinary OTP failure lists remain unchanged.
PostgreSQL provides durable serialized account
state. File storage remains local-development-only. Short-term per-user and
anonymous counters reset on process restart, as before; do not treat them as
cluster-wide or durable spending controls. Anonymous overload can still delay
legitimate requests during an attack. Account-targeted OTP lockout remains scoped
to the attacked account, rather than a shared proxy's customers.

Email quota exposure is separate from request throttling. A new registration can
send a verification email; unverified addresses can request further codes under
account issuance/cooldown limits. Rotating emails can produce up to 300 first
emails per window. Unknown dashboard accounts send no mail, but attackers who
know existing addresses can consume their issuance allowances. Confirmed delivery
failures refund only the failed issuance; ambiguous or confirmed sends remain
debited. These controls do not establish a provider-wide daily email budget.

Operational requirement before public signup: verify the actual Resend plan,
remaining daily/monthly allowance and shared staging/production usage; do not
assume Free. At a stated allowance of 100/day, 300/15 minutes is insufficient.
The smallest additional application protection to approve separately is an atomic
daily allowance for unauthenticated new-recipient verification sends, sized from
the verified plan and normal signup volume, leaving headroom for customer OTP.
Do not impose an unverified shared 100-email cap on all customer sign-ins.
Monitor remaining quota and delivery failures. Targeted abuse of known accounts
remains an availability risk even with a new-recipient allowance. This batch
does not claim to solve daily email quota exhaustion and adds no paid service.

For **audit/session IP metadata**, the API ignores forwarded headers by default,
uses the socket peer and leaves Express trust proxy disabled. Private/loopback
addresses are not automatically trusted. Invalid proxy settings stop startup.
Ignored forwarded headers generate a fixed, non-sensitive warning at most once
per five minutes per process when metadata resolution is exercised.

- CLIENT_IP_TRUSTED_PROXY_CIDRS: explicit, operator-verified immediate proxy
  addresses/CIDRs, empty by default. Do not guess Render CIDRs, trust generic
  private networks, or use outbound ranges as an ingress allowlist.
- CLIENT_IP_PROXY_HEADER: x-forwarded-for (default) or cf-connecting-ip.
  Trust CF only if the immediate peer and header sanitation are independently
  verified, including private/direct bypass paths and Worker exceptions.
  Otherwise leave trust empty; metadata will describe the peer.

Render's [PocketBase guidance](https://render.com/articles/host-pocketbase-on-render)
recommends CF-Connecting-IP, but its [private-network documentation](https://render.com/docs/private-network)
allows same-workspace private service access and describes changing instance IPs.
[Cloudflare documents](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
header rewriting and Worker exceptions. These do not establish a verified trusted
ingress CIDR boundary for this deployment. The dashboard server constructs its
own API headers and does not relay browser IPs; forwarding browser headers is
unnecessary for rate-limit identity.

Before production, narrowly review this policy, then verify in staging that two
customer accounts sharing a peer remain isolated, forged headers/claimed IDs
cannot reset quotas, and an authenticated AI user survives an exhausted anonymous
pool. Keep hosted checks low-volume; focused offline regressions cover exhaustion.
Do not enable forwarded-header trust merely to pass this gate.

## Notes

- Storage supports two providers:
  - `file` via `DB_PATH`
  - `postgres` via `DATABASE_URL` (durable, recommended for hosted deployments)
- For the hosted Peritio dashboard, use `postgres`. Training-pack lifecycle/reporting is limited when `STORAGE_PROVIDER=file`.
- `scoreRecords` and `usageSessions` now persist through dedicated stores.
- `usageSessions` now also rely on a lightweight persisted simulation-session ledger:
  normal mobile simulation start registers a recognized `simulationSessionId`, and `/usage/sessions` finalization must match that recognized session before usage is recorded.
- The primary idempotency anchor for new usage writes is the recognized `simulationSessionId`; persisted billed-delta metadata still keeps retries stable and deterministic usage ids remain as compatibility support.
- Treat hosted `usageSessions` and `scoreRecords` storage as `postgres`-preferred. Under `STORAGE_PROVIDER=file`, assume dev/demo/small-scale operation only.
- Extracted `usageSessions` and `scoreRecords` currently serve reads from an in-process snapshot to preserve synchronous entitlement/reporting semantics. Treat hosted deployments as single-process unless a future pass adds explicit refresh/invalidation.
- See [`../docs/Peritio_Persistence_Architecture_Checkpoint_2026-04-01.md`](../docs/Peritio_Persistence_Architecture_Checkpoint_2026-04-01.md) before reopening `usageSessions` extraction.
- For hosted production APIs, prefer direct Postgres (`:5432`) when available, or pooler session mode (`:5432`) if direct routing is unavailable.
- Avoid transaction pooler (`:6543`) for long-lived always-on API instances.
- URL-encode any special characters in `DATABASE_URL` passwords (`!` -> `%21`, `@` -> `%40`, etc.).
- Postgres pool env defaults: `PG_POOL_MAX=5`, `PG_CONNECT_TIMEOUT_MS=8000`, `PG_IDLE_TIMEOUT_MS=30000`.
- In production, set `STORAGE_PROVIDER` explicitly and provide `CORS_ALLOWED_ORIGINS`.
- Set `PERITIO_ENV` to the deployment identity:
  - `development` for local/default
  - `staging` for the Render staging API with `voicepractice_db`
  - `production` for the Render production API with `peritio-db-prod`
- `PERITIO_ENV=production` refuses `STORAGE_PROVIDER=file`, `AUTH_CODE_DELIVERY_PROVIDER=log_only`, placeholder/shared secrets, and obvious staging database URLs.
- `PERITIO_ENV=staging` refuses obvious production database URLs. Staging and production must never share `DATABASE_URL` values.
- If the API is already serving other browser apps, append new origins to `CORS_ALLOWED_ORIGINS`; do not replace existing working origins blindly.
- `AUTH_CODE_DELIVERY_PROVIDER` is the default auth-code delivery mode for all flows unless overridden.
- `WEB_AUTH_CODE_DELIVERY_PROVIDER` applies to the dashboard shared web-auth flow (`/web/auth/*` and dashboard email verification).
- `MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER` applies to mobile onboarding/settings email verification.
- For the lowest-risk dashboard rollout, keep `AUTH_CODE_DELIVERY_PROVIDER=log_only`, set `WEB_AUTH_CODE_DELIVERY_PROVIDER=resend`, and leave `MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER` blank or `log_only`.
- If either the default provider or any override is `resend`, `RESEND_API_KEY` and `AUTH_CODE_FROM_EMAIL` are required.
- `WEB_AUTH_TOKEN_SECRET` is required for shared web OTP sessions and must be strong in hosted environments.
- Dashboard shared web sessions use a fixed trusted 14-day lifetime for returning browsers.
- Mobile user routes require a per-user mobile bearer token issued by `POST /mobile/onboard`.
- `MOBILE_REVERIFY_ON_ONBOARD` defaults to `true` in production and `false` otherwise.
- AI budget caps default in production when `OPENAI_API_KEY` is set (`120` per-user calls/day, `1500` global calls/day, `250000` per-user tokens/day, `2000000` global tokens/day).
- `OPENAI_CHAT_MODEL` applies to admin custom-scenario generation. The recommended deployed profile uses `gpt-5.4-mini`, `OPENAI_CHAT_API_FAMILY=responses`, and `OPENAI_CHAT_REASONING_EFFORT=low`. When these variables are omitted, the compatibility defaults remain `gpt-4o-mini`, `chat_completions`, and no reasoning effort.
- `OPENAI_SIMULATION_MODEL` applies to live simulation routes (`/ai/opening` and `/ai/turn`) and defaults to `gpt-5.4`.
- `OPENAI_SIMULATION_API_FAMILY` accepts `chat_completions` or `responses`. The recommended `gpt-5.4` default uses `responses`; a compatibility fallback also keeps `gpt-5.2-chat-latest` on `responses`.
- `OPENAI_SIMULATION_REASONING_EFFORT` applies to both opening and live turns. Existing `OPENAI_SIMULATION_OPENING_REASONING_EFFORT` and `OPENAI_SIMULATION_TURN_REASONING_EFFORT` values remain supported as fallbacks when the shared setting is omitted.
- `OPENAI_SCORING_MODEL`, `OPENAI_SCORING_API_FAMILY`, and `OPENAI_SCORING_REASONING_EFFORT` independently configure `/ai/score`. When omitted, scoring inherits the simulation model/API family and the legacy `OPENAI_SIMULATION_SCORE_REASONING_EFFORT` fallback.
- Reasoning-effort settings accept `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`; confirm support for the selected model before setting them.
- The `gpt-5.4` compatibility defaults use `low` reasoning for opening, turn, and score. Other explicitly selected models omit reasoning effort unless configured.
- Route-specific simulation cap defaults are `160` for opening, `220` for turn, and `1200` for score. Use `OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS`, `OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS`, and `OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS` to override them independently.
- `OPENAI_SIMULATION_MAX_OUTPUT_TOKENS` remains supported as a legacy aggregate fallback. A route-specific cap takes precedence when both are set.
- `OPENAI_TRANSCRIPTION_MODEL` defaults to `whisper-1`. Optional remote speech synthesis uses `OPENAI_TTS_MODEL` (`tts-1` by default) when `ENABLE_REMOTE_TTS=true`.
- Usage billing increments are 15 seconds (round-down behavior).
- Timezone changes are scheduled for next monthly renewal.
- Remote AI is optional and API-owned. Mobile calls API AI routes; API calls OpenAI.
- Default support behavior stores no transcript. If a user explicitly consents in a support case, transcript data is retained for up to 10 days.
- `/ready` returns `503` while database connectivity is unavailable. All non-health routes are gated behind readiness.
- Audit events are stored in `auditEvents` and exposed via `GET /audit/events` with org/actor/date filters.
- Training Content R2 setup, lifecycle, CORS, cleanup, and smoke-test instructions are in
  [`../docs/Peritio_Training_Content_Storage.md`](../docs/Peritio_Training_Content_Storage.md).

## Database Bootstrap / Refresh

Use the sanitizer runbook before copying data between Render databases:

- [`../docs/Peritio_Database_Bootstrap_Refresh.md`](../docs/Peritio_Database_Bootstrap_Refresh.md)

The sanitizer is dry-run by default:

```bash
npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile prod-bootstrap
npm run db:sanitize-bootstrap -- --database-url "<database-url>" --profile staging-refresh
```

Add `--apply` only after reviewing the inventory report. Production deploy remains manual; do not rely on production auto-deploy for database bootstrap work.
