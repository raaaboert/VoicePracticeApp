# Peritio Configuration Inventory

This inventory records configuration names and recovery significance. It
contains no values. Secret values belong only in the approved provider secret
store; never put them in Git, reports, tickets, chat, screenshots, or shell
history.

## Status And Ownership

- **Confirmed** means the current repository reads or emits the item.
- **Operator procedure** means the recovery/rotation action described here must
  be performed deliberately.
- **Manual provider verification** means the repository cannot prove the active
  hosted value, scope, retention, branch mapping, or access policy.

Primary owners are API (Render web service), video worker (Render worker), admin
and dashboard (Vercel web projects), mobile (EAS/build-time public config), and
database/R2 (provider resources).

## API Identity, Process, And Database

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `PERITIO_ENV` | Environment identity and safety gates; API/worker | All server environments | Can defeat target checks or point scripts at the wrong environment | Yes, configuration | Must match database and live R2 environment. Never use production for scratch. |
| `NODE_ENV` | Runtime mode; API/web | All deployed services | Wrong validation/default behavior | Yes, configuration | Production runtime normally uses `production`; verify provider value. |
| `PORT` | API listener binding | API | Service cannot bind or health checks fail | Yes, configuration | Usually provider-supplied; do not hardcode a recovery value without checking Render. |
| `STORAGE_PROVIDER` | Selects file or PostgreSQL application storage; API/worker | API, worker | Wrong provider can make durable state appear empty or prevent startup | Yes, configuration | Production must remain `postgres`. |
| `DATABASE_URL` | PostgreSQL connection; API/worker/scripts | API, worker, operational scripts | Wrong DB causes outage or cross-environment writes | Credential is replaceable; endpoint is environment identity | Verify production DB identity before startup or any script. Never disclose the URL. |
| `PRODUCTION_DATABASE_URL` | Optional separation guard; API tooling | Where configured | Missing guard reduces one cross-environment check; wrong value can block startup | Yes, configuration | Not the normal application connection. Verify use before recovery. |
| `DB_PATH` | Local file-storage path | Local development only | Local state appears missing | Yes | Must not be used as production recovery storage. |
| `PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS` | PostgreSQL pool behavior; API/worker | PostgreSQL deployments | Connection exhaustion, slow failure, or instability | Yes | Recover documented values; keep API at one instance independent of pool size. |

## Authentication And Cryptography

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `ADMIN_TOKEN_SECRET` | Signs/verifies admin tokens; API | API | Existing admin sessions fail; wrong/reused secret weakens isolation | **Yes** | Rotate after DB restore to invalidate resurrected admin sessions. Production requires an explicit distinct secret. |
| `WEB_AUTH_TOKEN_SECRET` | Signs/verifies dashboard web tokens; API | API | Dashboard sessions fail | **Yes** | Rotate after DB restore to force dashboard reauthentication. Production requires at least 32 characters. |
| `MOBILE_TOKEN_SECRET` | Protects mobile token hashes, onboarding credentials, and verification hashes; API | API | Existing mobile auth/verification flows fail | **Yes** | Rotate after DB restore to invalidate resurrected mobile sessions. Expect forced reauthentication/pending-code invalidation. |
| `SUPPORT_TRANSCRIPT_SECRET` | Protects stored support transcript content; API | API | Historical transcripts can become unreadable | Emergency rotation only | **Do not casually rotate.** Preserve/recover the exact production value unless compromise requires a separately planned rotation. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Bootstrap admin authentication; API | API/bootstrap | Bootstrap access fails or an unsafe default is accepted outside production guards | Yes | Secret; production validation rejects short/default values. Confirm whether bootstrap remains operationally needed. |
| `ADMIN_TOKEN_TTL_MINUTES` | Admin token lifetime; API | API | Unexpected expiry or overlong sessions | Yes, configuration | Restore the approved duration; rotation of the signing secret is the recovery invalidation control. |
| `MOBILE_REVERIFY_ON_ONBOARD` | Requires mobile email reverification during onboarding; API | API | Wrong value can weaken onboarding assurance or block users | Yes, configuration | Cannot be disabled in staging/production by current code. |
| `APP_REVIEW_EMAIL`, `APP_REVIEW_CODE` | Limited App Store/Play reviewer verification credential; API | Review environments where enabled | Reviewer login fails or an unintended reviewer credential is enabled | **Yes** | Secret/auth configuration. Recover as a pair; never list values. Invalid/missing pair disables the reviewer path. |

After a whole-database restore, rotate the first three token secrets before
reopening production. Preserve `SUPPORT_TRANSCRIPT_SECRET`. All four production
secrets must remain distinct.

## Email Delivery

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `AUTH_CODE_DELIVERY_PROVIDER` | Default auth-code delivery mode; API | API | Codes may not be delivered or may use an unsafe mode | Yes | Production must use `resend`; scratch restore must disable outbound delivery. |
| `WEB_AUTH_CODE_DELIVERY_PROVIDER` | Optional web override; API | API | Dashboard codes fail or use wrong channel | Yes | Effective production mode must be `resend`. |
| `MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER` | Optional mobile override; API | API | Mobile verification emails fail | Yes | Effective production mode must be `resend`. |
| `RESEND_API_KEY` | Resend credential; API | Email-enabled environments | All verification email delivery fails | **Yes** | Rotate at Resend/provider and update API secret atomically. Never provide it to a scratch restore. |
| `AUTH_CODE_FROM_EMAIL` | Verified sender address; API | Email-enabled environments | Provider rejects mail or recipients distrust it | Yes, configuration | Must be configured whenever Resend delivery is used. |
| `AUTH_CODE_FROM_NAME` | Display sender; API | Email-enabled environments | Branding inconsistency | Yes, configuration | Preserve approved sender identity. |
| `AUTH_CODE_REPLY_TO` | Optional reply address; API | Email-enabled environments | Replies route incorrectly | Yes, configuration | Verify address ownership before restoration. |

## OpenAI And AI Controls

| Variable / family | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI provider authentication; API | Remote AI environments | Simulation, scoring, transcription, and TTS provider calls fail | **Yes** | Rotate at provider and update API secret. Do not put a production key in scratch. |
| `OPENAI_CHAT_MODEL`, `OPENAI_CHAT_API_FAMILY`, `OPENAI_CHAT_REASONING_EFFORT` | General chat model selection; API | Remote AI | Behavior/cost/compatibility changes | Yes, configuration | Recover the validated model/family combination. |
| `OPENAI_SIMULATION_MODEL`, `OPENAI_SIMULATION_API_FAMILY`, `OPENAI_SIMULATION_REASONING_EFFORT` | Simulation model selection; API | Remote AI | Simulation opening/turn behavior changes or fails | Yes, configuration | Model family must match code/provider support. |
| `OPENAI_SCORING_MODEL`, `OPENAI_SCORING_API_FAMILY`, `OPENAI_SCORING_REASONING_EFFORT` | Scoring model selection; API | Remote AI | Scoring changes or fails | Yes, configuration | Preserve validated scoring configuration. |
| `OPENAI_TRANSCRIPTION_MODEL` | Speech-to-text model; API | Remote transcription | Audio transcription fails or changes | Yes, configuration | Verify with a bounded audio test after recovery. |
| `OPENAI_TTS_MODEL`, `ENABLE_REMOTE_TTS` | TTS model and feature gate; API | Remote TTS | Voice responses fail or use local/disabled behavior | Yes, configuration | Feature flag and model must be restored together. |
| `OPENAI_SIMULATION_OPENING_REASONING_EFFORT`, `OPENAI_SIMULATION_TURN_REASONING_EFFORT`, `OPENAI_SIMULATION_SCORE_REASONING_EFFORT` | Route-specific reasoning controls; API | Remote AI | Quality, latency, or cost changes | Yes, configuration | Preserve only if present in the approved environment. |
| `OPENAI_SIMULATION_MAX_OUTPUT_TOKENS`, `OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS`, `OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS`, `OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS` | Output limits; API | Remote AI | Truncation, latency, or cost changes | Yes, configuration | Restore validated bounds. |
| `OPENAI_MAX_DAILY_CALLS_PER_USER`, `OPENAI_MAX_DAILY_CALLS_GLOBAL`, `OPENAI_MAX_DAILY_TOKENS_PER_USER`, `OPENAI_MAX_DAILY_TOKENS_GLOBAL` | Abuse/budget limits; API | Remote AI | AI may be unavailable or spend controls may weaken | Yes, configuration | Compare with post-restore usage state; changing config does not reconstruct rolled-back usage. |
| `USE_MODULAR_PROMPT_ARCHITECTURE` | Prompt architecture flag; API | Where enabled | Behavior changes between prompt paths | Yes, configuration | Treat as code-version compatibility config. |
| `ENABLE_INTERNAL_DEBUG_ENDPOINTS` | Internal diagnostics flag; API | Non-public diagnostics | Exposure risk if enabled publicly | Yes, configuration | Keep off in production unless a separately controlled incident procedure requires it. |

## Training Content Live R2

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `TRAINING_CONTENT_STORAGE_PROVIDER` | Selects Training Content storage; API/worker | API, worker | Assets become unavailable or startup/scripts reject config | Yes, configuration | Hosted Training Content uses `r2`; production also requires PostgreSQL application storage. |
| `TRAINING_CONTENT_R2_ENVIRONMENT` | R2 safety identity; API/worker/scripts | Staging/production | Cross-environment operations may be blocked or misdirected | Yes, configuration | Must match `PERITIO_ENV` and database target. |
| `TRAINING_CONTENT_R2_ACCOUNT_ID` | Cloudflare account identity; API/worker | R2 environments | Client cannot address the account | Yes, configuration | Sensitive operational identifier; recover from provider config. |
| `TRAINING_CONTENT_R2_ENDPOINT` | S3-compatible endpoint; API/worker | R2 environments | R2 requests fail or target wrong account | Yes, configuration | Verify endpoint/account pairing; do not publish it in incident output. |
| `TRAINING_CONTENT_R2_BUCKET` | Live object bucket; API/worker | Staging/production | Reads/writes target wrong bucket | Yes, configuration | Expected names: staging `peritio-training-content-staging`; production `peritio-training-content-production`. |
| `TRAINING_CONTENT_R2_ACCESS_KEY_ID` | Live R2 credential ID; API/worker | R2 environments | Live object access fails | **Yes** | Rotate in Cloudflare and update API/worker atomically. Do not expose. |
| `TRAINING_CONTENT_R2_SECRET_ACCESS_KEY` | Live R2 credential secret; API/worker | R2 environments | Live object access fails/credential compromise | **Yes** | Same rotation procedure as access key ID. |

Current bucket access policy, CORS, storage class, and lifecycle rules are manual
Cloudflare verification items. The repository must not be treated as evidence of
their active provider values.

## Training Content Backup R2

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `TRAINING_CONTENT_BACKUP_ENABLED` | Enables automatic/reconciliation backup; API/worker | Staging/production | False/missing leaves ready assets pending; wrong enablement can surprise operators | Yes, configuration | Production is operationally reported enabled; manually verify active provider state. |
| `TRAINING_CONTENT_BACKUP_R2_BUCKET` | Immutable backup destination; API/worker | Staging/production | Copies fail or target wrong retention boundary | Yes, configuration | Expected staging `peritio-training-content-backup-staging`; production `peritio-training-content-backup-production`. |
| `TRAINING_CONTENT_BACKUP_R2_ACCESS_KEY_ID` | Backup credential ID; API/worker | Staging/production | Backup copies/heads fail | **Yes** | Rotate without granting delete capability; update API and worker together. |
| `TRAINING_CONTENT_BACKUP_R2_SECRET_ACCESS_KEY` | Backup credential secret; API/worker | Staging/production | Backup copies/heads fail/credential compromise | **Yes** | Never expose. Preserve least privilege and no backup delete path. |

The backup client reuses the live R2 account/endpoint and region conventions.
Bucket privacy, Standard storage, the bucket-wide `30-day-backup-retention`
lock, and absence of custom lifecycle deletion are validated provider settings,
not repository-enforced facts. Reverify them manually. Do not disable the lock
for recovery.

## Training Content Lifecycle And Worker

| Variable / family | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS`, `TRAINING_CONTENT_DOWNLOAD_URL_TTL_SECONDS`, `TRAINING_CONTENT_MEDIA_ACCESS_URL_TTL_SECONDS` | Signed URL lifetimes; API | R2 environments | Uploads/downloads expire unexpectedly or access lasts too long | Yes, configuration | Restore validated bounded values; these do not reconstruct data. |
| `TRAINING_CONTENT_MAX_PENDING_UPLOAD_BYTES`, `TRAINING_CONTENT_MAX_VIDEO_BYTES`, `TRAINING_CONTENT_MAX_AUDIO_BYTES`, `TRAINING_CONTENT_MAX_PDF_BYTES`, `TRAINING_CONTENT_MAX_DOCX_BYTES`, `TRAINING_CONTENT_MAX_IMAGE_BYTES` | Pending quota and media-specific upload limits; API | R2 environments | Legitimate uploads fail or resource limits weaken | Yes, configuration | Blank media-specific values use code limits; preserve the approved explicit/implicit choice. |
| `TRAINING_CONTENT_FINALIZATION_LEASE_SECONDS`, `TRAINING_CONTENT_ORPHAN_GRACE_SECONDS`, `TRAINING_CONTENT_SUPERSEDED_RETENTION_DAYS` | Finalization and live-object cleanup timing; API/scripts | R2 environments | Lease races, premature cleanup, or accumulated objects | Yes, configuration | Do not run cleanup after DB rollback until DB/R2 consistency is approved. Never apply to backup. |
| `TRAINING_CONTENT_VIDEO_WORKER_CONCURRENCY`, `TRAINING_CONTENT_VIDEO_POLL_INTERVAL_MS`, `TRAINING_CONTENT_VIDEO_MAX_ATTEMPTS`, `TRAINING_CONTENT_VIDEO_JOB_TIMEOUT_SECONDS`, `TRAINING_CONTENT_VIDEO_LEASE_SECONDS` | Durable video job processing; worker | Video worker | Stalls, duplicate lease pressure, or excessive retry | Yes, configuration | Resume worker only after DB/R2 consistency. Current repository blueprint uses concurrency 1 for staging. |
| `TRAINING_CONTENT_VIDEO_MINIMUM_FREE_DISK_BYTES`, `TRAINING_CONTENT_FFMPEG_PATH`, `TRAINING_CONTENT_FFPROBE_PATH`, `TRAINING_CONTENT_MEDIA_TOOL_VERSION_PREFIX` | Worker disk/tool safety; worker | Video worker | Processing fails or unsupported FFmpeg/FFprobe runs | Yes, configuration | Verify deployed image/runtime before reopening jobs. |
| `TRAINING_CONTENT_R2_SMOKE_ORIGIN` | Optional origin for the R2 smoke script | Operator tooling | Smoke test targets an unintended origin or cannot validate CORS | Yes, configuration | Not an application runtime requirement; verify target before running a smoke test. |

## CORS, Hosts, And Client Routing

| Variable | Purpose / owner | Applicability | Loss or wrong value during recovery | Rotatable? | Recovery note |
| --- | --- | --- | --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | API browser-origin allowlist | API | Dashboard/admin requests fail or untrusted origins gain access | Yes, configuration | Production requires at least one origin. Compare exact hosts without exposing unrelated private configuration. |
| `API_BASE_URL` | Server-side admin API target | Admin web | Admin points at wrong API or cannot load | Yes, configuration | Verify in the Vercel admin project. |
| `NEXT_PUBLIC_PERITIO_ENV` | Public admin environment label/behavior | Admin web | Wrong environment presentation/routing | Yes, build/runtime configuration | Public by design; must match deployed surface. |
| `PERITIO_API_BASE_URL` | Dashboard API target | Dashboard web | Dashboard points at wrong API or cannot load | Yes, configuration | Verify in the Vercel dashboard project. |
| `PERITIO_APP_HOST`, `PERITIO_PUBLIC_HOST` | Dashboard/public host routing | Dashboard web | Redirects/cookies/host separation fail | Yes, configuration | Verify current provider domains manually. |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile API route | Mobile build profiles | Installed build points at wrong API | Only by new build/update mechanism | Public by design. Validate each EAS profile before building; it cannot be repaired in an already installed binary unless an existing update path supports it. |
| `EXPO_PUBLIC_REMOTE_AI_ENABLED`, `EXPO_PUBLIC_REMOTE_TTS_ENABLED` | Mobile-visible remote feature flags | Mobile build profiles | Features disappear or call unexpected endpoints | Only by new build/update mechanism | Public, not secrets. Keep aligned with API capabilities. |
| `PERITIO_MOBILE_ENV`, `PERITIO_MOBILE_APP_VARIANT` | Mobile environment/app identity selection | EAS build profiles | Wrong bundle/package/brand/environment | Only by new build | Verify against `mobile/eas.json` and app config before any recovery build. |

## Configuration Recovery Procedure

1. Obtain configuration from the approved Render, Vercel, EAS, Cloudflare,
   Resend, and OpenAI owner accounts or the approved secret escrow. The
   repository's examples describe names, not production values.
2. Verify environment and service ownership before copying anything. Staging and
   production credentials, databases, buckets, endpoints, hosts, and reviewer
   credentials must remain separate.
3. Re-enter secrets directly in the provider secret interface. Do not echo them
   through shell output or place them in an `.env` file inside the repository.
4. Have a second operator compare variable names and scopes, never secret values
   in an ordinary incident log.
5. Start the smallest affected service and confirm only environment identity,
   readiness, and sanitized errors. Do not use debug output that reveals
   credentials or customer identifiers.
6. For a database restore, rotate the three session-token secrets as described
   above; preserve `SUPPORT_TRANSCRIPT_SECRET`.
7. For credential compromise, rotate at the issuing provider first, update every
   consumer atomically, verify service health, then revoke the old credential.

## Non-Variable Provider Controls

These controls are operationally important but are not fully enforced by the
repository. Verify them manually rather than assuming the last known state.

| Provider control | Owner | Recovery consequence | Required verification |
| --- | --- | --- | --- |
| Production PostgreSQL PITR window and logical export access | Render/database owner | No usable recovery point or export path | Confirm the currently available recovery timestamps and authorized operator access. Last validated PITR retention was three days. |
| API instance count | Render/API owner | Multiple processes can violate current process-local snapshot assumptions | Production API must remain one instance. |
| Production API auto-deploy setting and deploy branch | Render/API owner | An unintended deploy can change recovery state | Production API auto-deploy was last validated off; confirm before branch or rollback work. |
| Worker deploy revision and Docker runtime | Render/worker owner | Jobs run incompatible code/tools | Confirm Git SHA, environment, instance count, and FFmpeg/FFprobe runtime before resuming jobs. |
| Node runtime version | Render/Vercel owners | Build/runtime incompatibility | Confirm the service/project runtime matches the validated release; do not infer it from `NODE_ENV`. |
| Vercel project, domain, Git branch, and runtime mappings | Web owners | Wrong surface or environment is promoted | Confirm separately for admin, dashboard, and public website. |
| R2 bucket privacy, storage class, lock, lifecycle, CORS, and credentials policy | Cloudflare/storage owner | Data exposure, premature deletion, or inability to restore | Confirm live/backup bucket identities. Backup was last validated private, Standard, bucket-wide 30-day locked, with no custom lifecycle deletion. |
| EAS project, credentials, profiles, and store rollout state | Mobile owner | Wrong binary identity/environment or inability to issue a corrective build | Verify before any mobile build; do not trigger EAS as part of server recovery. |
| Resend sender/domain verification and key status | Email owner | Verification email outage | Confirm without sending customer email from scratch. |
| OpenAI project/key status and provider limits | AI owner | AI outage or uncontrolled spend | Confirm key scope and limits without exposing the key. |

## Capabilities Not Claimed

This inventory does not claim that Peritio currently has:

- off-provider PostgreSQL backups;
- R2 object versioning;
- automatic regional/database failover;
- a true rollback mechanism for installed mobile binaries;
- automatic reconstruction of usage/billing after PITR; or
- a simple undo for hard-deleted PostgreSQL metadata.

Those capabilities require separate design, implementation, and validation.

## Existing Documentation Notes

- [Peritio Database Bootstrap And Refresh](./Peritio_Database_Bootstrap_Refresh.md)
  remains useful for `pg_dump`/`pg_restore` and sanitized staging refresh, but it
  is not a production PITR runbook and must not be used to mix tables or
  snapshots.
- [Peritio Training Content Storage](./Peritio_Training_Content_Storage.md)
  documents live R2 lifecycle and worker behavior but predates the backup lane;
  use this inventory and the recovery runbook for the current backup buckets.
- [Peritio Staging And Production Runbook](./Peritio_Staging_Production_Runbook.md)
  contains historical branch/deployment assumptions. Manually verify current
  provider mappings before a release or rollback.
