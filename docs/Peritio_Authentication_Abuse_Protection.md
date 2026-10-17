# Durable verification-code protection (Batch 9E.1)

Implementation is local pending independent audit. Do not push until staging auto-deploy is verified disabled. No shared-database migration or deployment was performed for this batch.

## Enforcement

Dashboard sign-in and shared dashboard/mobile email verification use dedicated `auth_verification_accounts` and `auth_verification_challenges` tables. An atomic PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` creates/locks the account row in one statement, closing the cleanup race. Independent API instances share counters. Failed verification never writes app-state or rebuilds employee-ID claims. Successful authentication still commits existing account/session/token changes before returning success, rechecking current identity and eligibility. If that final commit fails, the code remains consumed; request a fresh code after cooldown. There is no fallback to legacy pending codes.

Account keys use HMAC-SHA256 over trimmed, lowercased email, matching existing identity rules without merging dot/plus aliases. Code HMACs use a separate versioned domain and include random challenge UUID, account key, purpose, user ID, organization ID and code. Neither table contains plaintext email or code. Creation/expiry and enforcement use PostgreSQL time; clock injection exists only for test-created stores/test-mode API instances.

- Five incorrect guesses invalidate a challenge. Consumed, invalidated, expired and undelivered challenges cannot authenticate.
- Replacement invalidates earlier pending challenges for the same account/user/organization/purpose. Consumption never reactivates them.
- Ten incorrect guesses actually tested against live, delivered, currently authorized challenges in the preceding 15 minutes lock verification and issuance for 15 minutes. Missing, expired, undelivered, consumed and invalidated challenges contribute no failures. Blocked requests never extend the lock. Replacement does not reset legitimate failures; successful verification clears them without resetting issuance limits. Lockout logs contain only event type, opaque challenge ID, purpose and expiration, emitted after commit.
- One issuance per 60 seconds; at most five reserved/successful issuances in the preceding 15 minutes, shared across dashboard/mobile and purposes. Codes expire after 15 minutes.
- Delivery runs outside SQL transactions and the process-wide app-state lock. Brand-new mobile users/tokens are persisted first, with no provider call on a failed commit. A later onboarding retry reuses the pending account. Resend has a hard 10-second bound with cancellation, including a race guard if a transport ignores abort. No automatic email retry is performed.
- Confirmed delivery rejection invalidates/refunds only its own reservation. Transport errors/timeouts are ambiguous: the code is invalidated but the issuance debit is retained because the email may have been accepted. Later reservations and verification failures are never refunded. The 60-second cooldown remains. An uncertain/crashed reservation expires from the 15-minute window normally.
- Public dashboard request-code acknowledgements remain identical for unknown, ineligible and temporarily limited accounts. Verification failures are generic. Mobile resend keeps its token requirement and response shape; throttling is a generic 429. Existing onboarding/profile/organization checks remain.
- The mobile App Review credential is still restricted to its exact normalized reviewer email and valid interim/current token. It requires a live, delivered, bound challenge and obeys the same limits and consumption. It is not a dashboard sign-in override.
- Legacy app-state challenge records remain untouched but are never read to authenticate or imported into the new store.

Pending challenges are canceled in the same PostgreSQL transaction as existing credential-invalidating app-state changes (deactivation/reactivation, organization disable/enable, deletion, email and role/scope changes), including token revocation and Manager-qualification changes. Established session-revocation rules are unchanged. A cancellation error aborts that mutation; there is no reported success with partially committed authority. Local file mode cancels before and after saving to close its cross-file window, failing closed if a save fails.

Each HTTP-issued reservation also holds an opaque, domain-separated authority HMAC in the existing bounded issuance JSON. It binds current identity/organization context, update timestamps, token and direct-team context. Issuance, delivery confirmation and verification re-read authoritative app-state while holding the account lock. Stale requests and previously issued codes cannot become valid after an authority cycle or bypass cleanup with the reviewer override. This adds no column or migration. The mobile verification route explicitly rechecks active user/enterprise organization even for signed onboarding tokens; platform dashboard eligibility remains independently supported.

Read-only profile normalization deterministically clears invalid manager references without stamping a new user revision. Persisted user/organization timestamps and all authority fingerprint fields remain bound; real mutations still cancel challenges transactionally. Missing legacy verification dates use the stored creation date or null, never a newly generated verification time. Master Utility manager deletion clears affected reports and stamps their revisions in the same authoritative update, preserving unrelated relationships. An issuance whose authority changed returns a generic 409 on mobile, while dashboard issuance retains its uniform public acknowledgement; genuine cooldowns/limits retain 429 where previously exposed.

PostgreSQL API test harnesses explicitly apply migration 024 through the shared `applyAuthenticationTestSchema` helper. The authentication harness deliberately tests missing-schema startup before applying it; production startup still never applies this migration automatically. Store-only PostgreSQL suites retain their isolated component-schema setup.

### Remaining denial and delivery risks

The no-challenge lockout attack is closed. A determined attacker can still request genuinely delivered codes for a known email and make five guesses against two successive challenges, triggering another fixed temporary lock. Cooldown/rolling issuance bounds constrain this but do not eliminate repeated targeted denial. No permanent lock or new identity challenge was added. Supplemental IP trust remains deferred below.

Replacement still invalidates the prior code when its reservation is created. If delivery fails or is ambiguous, the previous code is **not** revived; request a fresh code after cooldown/temporary limits. Preserving a working code until replacement delivery is confirmed would require a separate in-flight delivery state and a change to migration 024's one-pending-challenge index (or a larger encrypted-code delivery design). That redesign is outside this correction and no migration is changed. A late email from an uncertain request may arrive with an unusable code; quota debit is retained to bound retries.

Startup checks the schema before listening. Startup/hourly unref'd cleanup removes challenge history 24 hours after expiration and inactive abuse records 24 hours after last activity (up to one additional cleanup interval). Cleanup is idempotent and logs only a fixed failure message. The separate atomic file implementation is for local development/tests; staging/production require PostgreSQL and cannot fall back to it.

## Configuration and release order

1. Obtain independent audit approval. Verify actual Render branch/revision and disable staging auto-deploy before pushing. Repository statements do not prove current provider settings. Production main remains frozen; production needs separate cutover approval.
2. Verify `STORAGE_PROVIDER=postgres`, the intended database/environment, and stable random **`WEB_AUTH_TOKEN_SECRET` of at least 32 characters**, identical across instances. This existing required secret is reused with domain separation; no additional secret variable is required. Missing, short or recognized placeholder keys fail startup. Do not put real secrets in repository files or logs. Verify existing Resend credentials, sender and delivery-provider overrides. `log_only` now suppresses delivery and redacts logs; use a configured test email provider for manual development login.
3. Explicitly apply the additive migration before deploying the API, using the approved operator connection. From the repository root in PowerShell, with `DATABASE_URL` scoped to that operator process:

   ```powershell
   psql --dbname "$env:DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file api/sql/024_auth_verification.sql
   ```

   This creates only new tables/indexes, is repeatable and does not modify existing auth/user/session records. The API does not execute migration 024 automatically. Missing schema fails startup/readiness without legacy fallback. Do not run this command against shared environments during implementation/testing.
4. Deploy the audited revision in a coordinated change after schema/configuration verification, without mixed old/new authentication writers. Verify readiness and fresh-code dashboard/mobile login. Legacy pending codes stop working; users request new codes. Existing installed clients retain endpoint/request/response shapes and need no binary update for these protections. Existing session-token handling is unchanged.
5. Rotate `WEB_AUTH_TOKEN_SECRET` only as a coordinated auth cutover: stop issuance/verification on every instance, allow the 15-minute code/lock windows to expire, replace the secret consistently, then restart with fresh codes. Rotation also invalidates web JWTs and changes abuse lookup keys. Uncoordinated rotation can reset or split enforcement; never use it to bypass lockouts.

Stop release if schema, stable secrets, delivery configuration, audit approval or auto-deploy settings are unverified. Leave additive tables in place on rollback. Do not delete counters or restore legacy code acceptance. Pre-9E.1 authentication reopens unlimited challenge guessing/process-local account throttling. Prefer a forward fix; if necessary stop public code issuance/verification until an approved rollback retaining equivalent protection is available.

## Deferred proxy trust (9E.2)

`getClientIp` and CORS are unchanged. The private/loopback peer heuristic and first-forwarded-address selection remain unverified and potentially spoofable. IP throttling is supplemental; durable account limits do not depend on it.

Obtain actual Render evidence for each environment before changing trust: all ingress paths (custom domain, Render hostname, intermediary/CDN and direct service access), socket peer addresses or documented trusted CIDRs, whether the trusted boundary strips/replaces or appends caller-supplied forwarding headers, the resulting ordered chain, and any bypass path. Correlate a controlled request with forged headers against sanitized socket/header observations. Do not infer trust from private addresses, an unverified hop count or the rightmost value. Never log credentials or bodies during this investigation.

## Local validation

Set `AUTH_VERIFICATION_INTEGRATION_DATABASE_URL` only in the test process to the established disposable localhost test database (or use `FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL`). Both new harnesses require localhost and a test/integration database name, create unique schemas and drop only those schemas. Nonlocal databases are refused.

```powershell
npx tsx --test api/src/storage/authVerificationPostgres.integration.test.ts api/src/authVerificationRoute.integration.test.ts
```
