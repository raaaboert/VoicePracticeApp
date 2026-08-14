# Peritio Recovery Runbook

This runbook covers production recovery for Peritio's PostgreSQL state and
Training Content objects. It is an operator procedure, not an automated
failover design.

## Scope And Source Of Truth

The following is confirmed by the current code at `59ff92a`:

- production application state uses PostgreSQL;
- `app_state` is one JSONB row with ID `primary`;
- usage, simulation sessions, scores, support cases, performance data, and
  Training Content also use dedicated PostgreSQL tables;
- Training Content ready objects are copied server-side from the live R2 bucket
  to the backup R2 bucket under the same immutable `final_object_key`;
- backup failure does not fail customer finalization, and reconciliation can
  retry pending backups;
- normal Training Content cleanup has no backup-bucket delete path; and
- startup integrity cleanup removes user-scoped rows whose user is absent from
  `app_state.users`.

The following provider state was operationally validated for the current
production environment but cannot be proved from this repository. Verify it in
the provider consoles during an incident:

- Render-managed production PostgreSQL has three-day point-in-time recovery
  and logical export capability;
- the production API has one instance, auto-deploy is off, and it is connected
  to the production database;
- `peritio-training-content-backup-production` is private, Standard storage,
  protected by bucket-wide lock `30-day-backup-retention`, and has no custom
  lifecycle deletion rule; and
- production Training Content backup is enabled and the last validated
  reconciliation had no pending assets.

Keep the production API at one instance. Some `app_state` read/modify/write
behavior and snapshot protection remain process-local; see
[Peritio Persistence Architecture Checkpoint](./Peritio_Persistence_Architecture_Checkpoint_2026-04-01.md).

Related procedures:

- [Peritio Rollback Procedure](./Peritio_Rollback_Procedure.md)
- [Peritio Config Inventory](./Peritio_Config_Inventory.md)
- [Peritio Database Bootstrap And Refresh](./Peritio_Database_Bootstrap_Refresh.md)
- [Peritio Training Content Storage](./Peritio_Training_Content_Storage.md)

## Immediate Incident Checklist

1. Name one incident commander and record UTC time, symptoms, affected
   environments, and the last known-good time.
2. Stop writes. Suspend or stop the production API before a database restore.
   Stop the production video worker when Training Content data or jobs may be
   involved. Do not leave any old or new API instance writing during recovery.
3. Preserve evidence: application/worker logs, deployed Git SHA, current
   database identity, provider incident status, and aggregate usage totals.
   Never copy secrets, signed URLs, object keys, filenames, or customer content
   into the incident log.
4. Decide whether this is a code rollback, database recovery, object recovery,
   or provider outage. **Do not restore the database merely to roll back code.**
5. Before any database action, verify the target is production, the requested
   recovery point is inside the provider's available PITR window, and a current
   logical export can be retained if the database is readable.
6. If the database must be restored, restore the whole database to one
   consistent point. Never restore only `app_state`, individual dedicated
   tables, or tables from different snapshots.
7. Do not run Training Content cleanup after a database rollback until database
   metadata and both R2 lanes have been reconciled.
8. Require a second operator to confirm destructive targets and the recovery
   point before applying a production restore.

## Why Partial Database Restore Is Prohibited

`app_state` contains the authoritative user collection while several kinds of
user history live in dedicated tables. At startup the API treats a dedicated
row whose user is absent from `app_state.users` as invalid and removes or
deactivates it. Restoring an older `app_state` beside newer dedicated tables can
therefore destroy otherwise recoverable history.

The warning begins:

```text
[integrity][startup] cleaned invalid user-scoped history
```

A non-zero warning after recovery is a serious consistency signal. Preserve the
logs, stop the API again, and investigate before accepting traffic.

## Full Production Database Recovery

### 1. Establish The Recovery Point

1. Identify the last known-good UTC timestamp from application symptoms,
   deploy history, audit data, and provider metrics.
2. Capture pre-restore aggregate counts and usage/billing totals if the current
   database remains readable.
3. Prefer testing the selected point in an isolated scratch restore before
   changing production.
4. Record the Render database, production API, worker, current Git SHA, chosen
   recovery point, approvers, and rollback reason.

### 2. Quiesce Production

1. Stop/suspend the production API. Confirm there is only one instance and no
   process is accepting traffic.
2. Stop/suspend the production video worker.
3. Confirm no administrative script, reconciliation, cleanup, migration, or
   manual database session is writing.
4. Keep public clients in a controlled unavailable/maintenance state until the
   verification steps finish.

### 3. Preserve The Pre-Restore State

If PostgreSQL is readable, create a complete logical export using the
provider-issued production connection string. Store it in the approved secure
incident location, not the repository:

```bash
pg_dump --dbname "<production-external-database-url>" --format=custom --no-owner --no-privileges --file "peritio-production-pre-restore.dump"
```

Verify the command succeeded and record the artifact checksum and access
restrictions. This export is evidence and a fallback; it is not permission to
mix individual tables into the selected recovery point.

### 4. Restore One Complete PostgreSQL Point

Use Render's supported PITR/restore operation for the selected UTC point. The
provider workflow may restore in place or provide a recovered database. Follow
the current provider instructions and record the resulting database identity.
If a new database endpoint is created, update only the production API and
worker `DATABASE_URL` through the approved provider procedure while both
services remain stopped.

Do not improvise a table-level restore. Do not run application migrations until
the recovered schema is inspected against the code version that will start.

### 5. Verify The Restored Database Before Startup

Connect read-only to the recovered database and first verify its identity. Then
run representative consistency counts in one session:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), current_user, now();
SELECT id, updated_at FROM app_state;
SELECT jsonb_array_length(state_json -> 'users') AS app_state_users
FROM app_state
WHERE id = 'primary';

SELECT 'usage_sessions' AS relation, count(*) FROM usage_sessions
UNION ALL SELECT 'simulation_sessions', count(*) FROM simulation_sessions
UNION ALL SELECT 'score_records', count(*) FROM score_records
UNION ALL SELECT 'support_cases', count(*) FROM support_cases
UNION ALL SELECT 'org_content_items', count(*) FROM org_content_items
UNION ALL SELECT 'org_content_assets', count(*) FROM org_content_assets;

COMMIT;
```

Required checks:

- exactly one `app_state` row exists and its ID is `primary`;
- the recovery timestamp and aggregate counts are plausible for the chosen
  recovery point;
- required dedicated tables exist;
- a sample of organizations, users, sessions, scores, support cases, and
  Training Content metadata is internally consistent; and
- no staging database or R2 identity is present in production configuration.

If a query does not match the restored schema, stop and inspect rather than
altering the recovered data ad hoc.

### 6. Reconcile PostgreSQL And R2 Before Cleanup

A database rollback does not roll back R2. Live and backup objects created
after the database recovery point can remain and appear orphaned. Therefore:

1. Keep Training Content cleanup and all manual object deletion disabled.
2. Compare ready `org_content_assets.final_object_key` metadata with live R2.
3. Check whether required live objects exist in the backup bucket under the
   same key.
4. Classify objects newer than the database snapshot. Do not delete them during
   incident recovery; preserve them for possible metadata recovery.
5. Never run cleanup against the backup bucket. Its retention lock remains
   unchanged.
6. Resume normal cleanup only after an approved consistency review.

### 7. Invalidate Resurrected Sessions

Before serving traffic, rotate these three server-only secrets through the
approved Render secret-management process:

- `MOBILE_TOKEN_SECRET`
- `WEB_AUTH_TOKEN_SECRET`
- `ADMIN_TOKEN_SECRET`

Restarted services must all receive the same newly approved values for their
environment. Rotation intentionally forces mobile, dashboard, and admin
reauthentication and prevents sessions resurrected by the database restore from
remaining valid.

**Do not rotate `SUPPORT_TRANSCRIPT_SECRET` as a routine recovery step.** It is
used for historical support transcript protection; changing it can make
existing transcripts unreadable. Escalate separately if compromise of that key
is suspected.

### 8. Start And Observe

1. Start the production API at one instance using the selected known-good code.
2. Watch startup from its first log line. Treat any non-zero
   `[integrity][startup] cleaned invalid user-scoped history` message as a stop
   condition: stop the API again and investigate the snapshot.
3. Verify health/readiness and environment metadata identify production and the
   intended Git SHA.
4. Test administrator, dashboard, and mobile authentication after the planned
   forced reauthentication.
5. Verify read paths before writes, then perform one bounded non-customer test
   transaction through each critical workflow.
6. Start the production video worker only after Training Content database/R2
   consistency is approved. Verify its lease/job startup logs.
7. Continue heightened monitoring for database errors, integrity cleanup,
   authorization failures, usage anomalies, email failures, AI failures, and
   Training Content backup failures.

### 9. Usage And Billing Review

A database rollback can remove legitimate completed sessions and AI usage,
reduce recorded usage, reset daily consumption, or resurrect temporary overage
state. Compare the pre-restore capture with restored totals by organization and
user. Record the discrepancy and make an explicit commercial decision about
credits, limits, or manual reconciliation. There is no repository-supported
automatic billing reconstruction; do not invent one during an incident.

## Safe Scratch Restore Test

Use a separate, disposable scratch PostgreSQL database. It must not share a
connection string with production or staging.

1. Restore the selected full PITR/export into scratch.
2. Deploy or run one isolated API instance that cannot receive public traffic.
3. Set `PERITIO_ENV=development` for the isolated scratch instance and point
   `DATABASE_URL` only to scratch.
4. Disable outbound email delivery. Do not provide a production `RESEND_API_KEY`.
5. Do not provide an OpenAI key.
6. Disable Training Content R2, or use isolated throwaway buckets and credentials
   that cannot access production or backup buckets.
7. Supply throwaway, mutually distinct auth secrets. Never reuse production
   `ADMIN_TOKEN_SECRET`, `WEB_AUTH_TOKEN_SECRET`, `MOBILE_TOKEN_SECRET`, or
   `SUPPORT_TRANSCRIPT_SECRET`.
8. Keep internal debug endpoints private/off unless the isolated test explicitly
   requires them.
9. Run the read-only SQL checks above, start the API once, and inspect the first
   startup logs for integrity cleanup.
10. Exercise read-only representative routes. Do not send email, invoke AI, copy
    or delete R2 objects, or write production data.
11. Record results, then destroy the scratch service/database through the
    approved provider process.

## Recover A Missing Live Training Content Object

Use this procedure only when PostgreSQL metadata is intact and a required object
is missing from `peritio-training-content-production`.

1. Stop any cleanup affecting the asset.
2. Identify the asset row and its immutable `final_object_key` without putting
   the key or customer filename into tickets or general logs.
3. Verify that the same key exists in
   `peritio-training-content-backup-production` and compare recorded byte size,
   checksum/ETag where meaningful, and content type.
4. Use an approved server-side R2 copy from backup to the live production bucket
   under exactly the same key. Do not download customer content through an
   operator workstation or the API process.
5. Verify the live object's size and checksum against the backup and database
   metadata, then test the authorized read path.
6. Normally no database change is required. If `object_deleted_at` is set or the
   asset is marked for cleanup, stop: an approved surgical metadata repair may
   be required before normal cleanup resumes.

The application intentionally exposes no backup delete capability. Do not
weaken the bucket lock or add a cleanup path to perform recovery.

## Backup Health Checks

Run these from the matching deployed service shell so `PERITIO_ENV`, the live R2
environment, and `DATABASE_URL` all identify the requested target. Output can
include asset IDs; keep it in restricted operational logs.

Staging dry run:

```bash
npm run backup:reconcile-training-content -- --target staging
```

Production dry run:

```bash
npm run backup:reconcile-training-content -- --target production
```

A healthy steady state reports `pending: 0`. A non-zero result requires
investigation; a dry run does not copy anything.

Staging apply, when explicitly approved:

```bash
npm run backup:reconcile-training-content -- --target staging --apply
```

Production apply is a write and must not be used casually. It requires an
incident/change approval and the built-in confirmation phrase:

```bash
npm run backup:reconcile-training-content -- --target production --apply --confirm-production "I understand this writes to production"
```

An applied run reports `pendingBefore`, `scanned`, `backedUp`,
`alreadyPresent`, `failed`, and `stillPending`. Healthy completion has zero
`failed` and zero `stillPending`. Never expose provider messages that contain
keys or customer data.

## Hard Deletion Recovery

Peritio has no simple hard-delete undo. Choose one of these explicit paths:

- restore the complete database to a separate scratch database, inspect the
  missing records, and design/review a bounded surgical recovery; or
- restore the complete production database to a prior consistent point.

The second option affects every tenant and all state after the recovery point.
Do not perform it for a single-tenant deletion without executive, security, and
data-owner approval. The backup R2 lane can recover object bytes but does not by
itself reconstruct deleted PostgreSQL metadata.

## Stop Conditions

Stop recovery and escalate if any of the following occurs:

- the database identity, environment, recovery point, or target is ambiguous;
- a whole-database recovery cannot be performed from one consistent point;
- the API or worker cannot be fully quiesced;
- a restore would cross a one-way schema change not covered by a tested plan;
- `app_state` is absent, duplicated, malformed, or inconsistent with dedicated
  tables;
- startup reports non-zero invalid user-scoped history cleanup;
- required live objects are absent from both live and backup R2;
- the backup lock, privacy, retention, or bucket identity differs from the
  validated provider settings;
- any instruction requires exposing credentials, object keys, filenames, or
  customer content; or
- usage/billing impact cannot be bounded and approved.
