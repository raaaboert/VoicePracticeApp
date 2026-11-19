# app_state concurrency rules and exclusive maintenance

Scope: Remediation Package 1 (B08 and the Nov 19 review findings F1–F3, F5).
Production runs one API instance, but normal zero-downtime deployments briefly
run old and new instances together. The first deployment of this package must
stop all old, unpatched API processes before any patched API process starts.
An old writer can still overwrite a patched writer's commit unconditionally.
Subsequent patched-to-patched deployments have version-conflict protection,
although temporary request failures remain possible. This does not authorize
permanent multi-instance operation.

## Rules the code now enforces

1. **Version-checked writes.** Cached whole-document API writes of `app_state` use
   `UPDATE … WHERE id = 'primary' AND xmin = <version it was read at>`. If
   another writer committed first, zero rows match, the whole transaction rolls
   back and the request fails with HTTP 409 or the route's own error response.
   Nothing is replayed automatically. Locked migrations instead operate on the
   authoritative row within their transaction.
2. **One lock order.** A transaction that writes `app_state` and employee-ID
   claims takes the `user_employee_id_claims` table lock first, then the
   `app_state` row, on a single transaction client. This applies to request
   commits, startup migration saves, and the locked profile migration.
3. **Claims change only with app_state.** Employee-ID claims are written only
   inside an `app_state` write transaction, or by the locked reconcile that
   runs with the profile migration at startup and on readiness refresh. That
   reconcile writes only when claims differ from the locked, committed users.
   Ordinary reads never write claims.
4. **Startup does not repair suspected orphans.** The orphan inspection counts
   records whose user is missing from its `app_state` snapshot and logs
   `[integrity][startup] found suspected orphaned user-scoped history`. It does
   not repair or delete suspected orphan records, because a second process may
   have created that user moments earlier. The input app-state object is not
   mutated. Store listing can still perform normal transcript-expiration
   cleanup: expired transcript fields may be cleared, but valid support cases
   are preserved. This inspection is not a guarantee of zero database writes.
5. **409 is honest.** A conflict rolls back the `app_state` transaction.
   Effects the request committed or sent outside that transaction (for example
   a consumed sign-in code, an AI call, an uploaded file) may remain, and the
   response says so.

## Exclusive maintenance (required for destructive operations)

The following must only run while **no API process is connected** to the
target database:

- `npm run reset:simulation-baseline --workspace api -- <required target/safety arguments>`
  (`api/scripts/reset-simulation-baseline.ts`; run from the repository root)
- `npm run db:sanitize-bootstrap -- … --apply` (`api/scripts/sanitize-bootstrap.ts`;
  intended for restored scratch databases)
- any destructive orphan cleanup (`repairOrphanedUserScopedHistory`), which
  is no longer run by the API

Procedure:

1. Suspend the API service that uses the target database (Render dashboard →
   service → Suspend) and wait until its instances have stopped.
2. Confirm that no API connections remain (read-only query; exclude yourself):

   ```sql
   SELECT pid, usename, application_name, client_addr, backend_start, state
   FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid();
   ```

   Continue only if no API backends are listed.
3. Run and review the appropriate dry run using the same explicit target and
   all required safety/confirmation arguments:
   - Reset: `npm run reset:simulation-baseline --workspace api -- <required target/safety arguments> --dry-run`.
     To apply, remove `--dry-run`; reset has no `--apply` mode.
   - Sanitizer: `npm run db:sanitize-bootstrap -- <required target/profile/safety arguments>`.
     It defaults to dry-run. To apply, add `--apply`.
   These are syntax templates, not commands to paste with the placeholders.
4. Resume the API.

Both scripts also carry a fail-safe. They record the `app_state` row version
when they read it and refuse to write if the row changed afterwards. This
stops them from silently overwriting newer data, but it is **not** a lock:

- `sanitize-bootstrap` applies its `app_state` update and table deletes in one
  transaction, so a refusal applies nothing.
- `reset-simulation-baseline` clears dedicated-store history before it writes
  `app_state`, so a refusal can leave that history already cleared. Follow the
  procedure above.

`force-mobile-reonboarding` updates `app_state` under a row lock and needs no
exclusive window. The focus-topic backfill only reads `app_state`.

## First rollout: staging, then production (deployment gate)

This is a plan only. No hosted settings, processes, or databases were changed
while preparing it. Production service: `peritio-api-prod`. The owner reports
one instance, autoscaling off, and no persistent disk. Staging has previously
used `voicepractice-api-dev`; verify its current service ID and linked branch
before acting. Live settings and current deployments have not been inspected.

### What Render currently documents

Checked against public Render documentation on 2026-11-19:

- [Normal deploys and restarts](https://render.com/docs/deploys) start a new
  instance while the old instance is still running. One configured instance
  does not prevent this deployment overlap. The overlapping-deploy policy
  controls competing deploy jobs, not an exclusive database-writer guarantee.
- [Maintenance Mode](https://render.com/docs/maintenance-mode) blocks public
  traffic but keeps the process running and reachable privately and via SSH.
  It is not a substitute for stopping the old API.
- [Suspend](https://api-docs.render.com/reference/suspend-service-1) and
  [Resume](https://api-docs.render.com/reference/resume-service-1) exist, but
  their documented API contracts do not specify selecting a new commit on
  resume. A successful suspend request alone is not proof all processes and
  database sessions have terminated.
- [Deploy hooks](https://render.com/docs/deploy-hooks) explicitly return 409
  when a service is suspended. The generic trigger-deploy API also documents
  409 conflicts. No reviewed official contract establishes a supported way to
  deploy a chosen new commit on this existing service while it stays stopped.

**BLOCKER:** Do not execute a guessed "Suspend, push, Resume, Deploy" sequence.
Resume may start the unpatched revision before the manual deployment. Obtain
Render's supported stop-before-start procedure for this existing service,
including exact commit selection, old-instance termination, failure/fallback
behavior, and rollback. Prove that procedure on staging before production.
Do not add a disk, replace the service, alter database credentials, or rely on
killing a supervised process as an unreviewed workaround.

Exact question for Render (owner to submit; not sent automatically):

> For an existing single-instance Git-backed Node web service with no disk and
> autoscaling disabled, how can we stop all instances of the currently live
> commit, then start only a specified new commit, without first restarting the
> old commit? Suspended deploy hooks return 409. Does the dashboard or another
> supported operation allow the target revision to be selected while stopped?
> Please include failure/fallback and rollback behavior. We need to prevent
> overlapping database writers, including startup code, not just public traffic.

### Promotion and deployment order, after separate authorization

1. Before any push that could deploy the package, the owner records current
   live SHAs, service IDs, linked branches, and rollback artifacts. Turn
   Auto-Deploy **Off** for the staging and production API services and verify
   no active or queued deploys remain. Inventory external deploy-hook/CI/
   Blueprint automation and pause any that can deploy these APIs: Auto-Deploy
   Off does not disable manual or deploy-hook triggers. Do not change unrelated
   backup schedules. The local `render.yaml` only declares the video worker;
   it does not establish the live API configuration.
2. Commit only the approved B01/B08 package on the feature branch, excluding
   historical reports. Fetch, verify the staging baseline, normally merge the
   feature branch into staging, and push staging. Record the resulting exact
   SHA. Use required existing CI checks; pushing is not deployment permission.
3. **Resolve the Render blocker above before stopping staging.** Record the
   supported operation that will start only that staging SHA with no old API
   writer. Do not proceed if that operation or its fallback behavior is unclear.
4. In the authorized staging window, stop the old staging API with that
   procedure. Require Render's completed suspension/instance-termination
   evidence, not merely a 202 acknowledgment or an HTTP 503. Check the staging
   database through an authorized read-only observer and confirm old API
   connections/transactions are gone. The query in the maintenance section
   lists candidates; attribute sessions to known services, since connection
   names are not guaranteed unique. Do not terminate unknown sessions. If
   process termination or session attribution cannot be confirmed, stop.
5. Start only the recorded patched staging SHA using the confirmed Render
   operation. Keep automatic triggers disabled. Verify the live SHA in Render
   and API metadata, then run the staging smoke checks below.
6. After staging acceptance, fetch and verify main, normally merge the tested
   staging package into main, inspect the tree for unrelated changes, and push
   main. Record the production merge SHA. Keep production Auto-Deploy Off
   throughout; do not deploy a moving "latest" reference.
7. Repeat steps 3-5 for `peritio-api-prod`, using the production SHA, correct
   database identity, and production smoke checks. No staging database or API
   URL may be substituted. Leave auto-deploys off until acceptance. Re-enable
   only by owner decision once all running API writers are patched and the
   linked branch is confirmed to contain the intended revision.

### Focused smoke checks

- Both environments: `/health` and `/ready` return 200; `/meta/environment`
  identifies the intended environment and expected commit. Confirm normal
  admin login and existing organization listing; inspect startup diagnostics
  for successful migrations/readiness and no repeated conflicts or deadlocks.
- Staging only, after authorization: use synthetic accounts to check normal
  enrollment, employee-ID uniqueness, and persistence across a readiness
  refresh. Exercise a controlled stale-version conflict only in isolated
  tests/staging; confirm the newer write survives and there is no silent
  replay. Confirm existing support cases remain present.
- Production: use existing owner-approved accounts for read-only smoke checks;
  do not deliberately create conflicts, enroll synthetic users, run orphan
  repair, or perform destructive retries. No paid AI call is needed for this
  transition check. B01 request construction remains covered by offline tests.

### Failure and recovery

If startup fails, preserve sanitized error codes and deploy/commit identifiers,
keep automated triggers off, and stop any partially started patched API using
the confirmed procedure. Verify its process and database sessions are gone
before restoring a recorded known-good revision. A rollback to the unpatched
revision requires the same exclusive stop/start window; never roll it back
alongside a patched writer. Do not assume failed deployment automatically
leaves no process running or that suspension undoes committed startup work.
Inspect any committed migration effects before deciding to retry or roll back.
If Render cannot guarantee the required start or recovery sequence, leave the
transition blocked; do not resume an old instance and deploy over it.

During the window, prohibit parallel API shells, manual maintenance scripts,
one-off jobs, or another service that writes `app_state`/employee-ID claims.
Read-only monitoring and unrelated media work are not automatically affected;
verify actual writers rather than stopping every service. No manual SQL migrations,
credential changes, backup/restore operations, or automatic handler retries
are part of this rollout.

## Known remaining limitations

- During patched-to-patched deploy overlap, writes based on a stale cache fail
  visibly (409, or a route's own error) instead of losing data. Users may need
  to retry.
- If a pending legacy migration hits a conflict, startup fails and is retried
  by the platform restart.
- Process-local state (rate limiters, usage/score snapshots, TTS prefetch)
  remains per process. Running more than one API instance is still
  unsupported.
- The file storage provider (local development) has no version check.
