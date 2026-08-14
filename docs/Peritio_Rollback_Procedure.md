# Peritio Rollback Procedure

This procedure rolls application code back while preserving durable state. A
code rollback and a database restore are different operations.

> **Do not restore PostgreSQL merely to roll back code.** Most Peritio schema
> changes are additive and idempotent; an older application can usually run
> against the newer schema. Restore data only for a confirmed data incident and
> follow [Peritio Recovery Runbook](./Peritio_Recovery_Runbook.md).

## Before Any Rollback

1. Identify the failing surface, deployed Git SHA, last known-good SHA, onset
   time, and whether the failure is code, configuration, provider, or data.
2. Preserve logs and current deployment metadata. Do not record secrets,
   customer data, filenames, object keys, or signed URLs.
3. Confirm the proposed revision was previously built and validated for the
   target environment.
4. Review the commits between current and target revisions for schema changes,
   config changes, queue/job payload changes, and client/API contract changes.
5. Confirm the database and R2 services are healthy. A provider/data incident
   must use the recovery runbook instead.
6. Assign an operator and reviewer. Record the rollback decision and UTC time.

## API Rollback

Production API deployment is a manual provider action in the currently
validated operating model. Verify that setting in Render before acting because
provider-console settings are not fully represented in the repository.

1. Select the prior known-good Render deployment for the production API.
2. Confirm its Git SHA, build/runtime settings, and required environment variable
   names are compatible with the current production configuration. Do not copy
   secret values into the incident record.
3. Prefer Render's redeploy/promote-previous-deployment operation. Preserve Git
   history; do not force-push or rewrite branches to make a provider rollback.
4. Do not restore the database. Leave additive/idempotent schema introduced by
   the newer revision in place unless a separately tested database plan says
   otherwise.
5. Watch startup logs, then verify health, readiness, environment identity, and
   reported Git SHA.
6. Exercise authentication and one bounded critical flow. Confirm usage,
   support, AI, and Training Content paths do not emit new errors.
7. If the target predates a one-way migration or requires old data semantics,
   stop. Do not improvise a deep rollback.

The production API must remain one instance because some `app_state`
read/modify/write and snapshot behavior is process-local.

## Video Worker Rollback

The Training Content video worker is a separate Render service and can be rolled
back independently from the API.

1. Stop or suspend job intake if the active worker is damaging outputs or
   repeatedly failing jobs.
2. Select the worker's prior known-good deployment and verify its Git SHA,
   Docker image/build, FFmpeg expectations, database identity, R2 environment,
   and job config variable names.
3. Redeploy that worker revision without changing API code or database data.
4. Observe worker startup and lease/job logs. Training Content work uses durable
   PostgreSQL job/lease state, so a restart does not require clearing jobs.
5. Nearby API/worker versions are generally expected to tolerate a short mixed
   version window when changes are additive. If the compared commits change job
   payload semantics or schema destructively, stop and use a coordinated tested
   plan.
6. Verify one bounded non-customer processing flow before restoring normal
   throughput.

Do not delete live or backup R2 objects as part of a worker rollback.

## Dashboard And Admin Rollback

The dashboard (`peritio-web`) and admin (`admin-web`) are stateless relative to
the API's durable PostgreSQL state.

1. In the matching Vercel production project, identify the prior known-good
   deployment by Git SHA.
2. Verify its API base URL/host variables target production and that the older
   client remains compatible with the current API.
3. Promote/redeploy the prior deployment using Vercel's normal rollback
   mechanism. Do not change database or R2 state.
4. Verify the public host, login, role-gated navigation, and one read-only API
   call. Then verify a bounded write flow if required.

Provider project/branch mappings must be manually verified at incident time;
they are not all authoritative in this repository.

## Public Website Rollback

For the public Peritio website, redeploy the prior known-good Git revision using
its normal hosting workflow. It has no Peritio durable application state to
restore. Verify links and host routing after deployment. Do not couple this
rollback to API, database, dashboard, admin, or mobile changes unless the
incident actually spans them.

## Mobile Rollback

Installed iOS and Android binaries cannot be recalled or truly rolled back.

- For a staged Android release, halt or reduce the rollout in the store console
  if that option remains available.
- For iOS, stop a pending/phased release where possible; otherwise prepare,
  review, and release a corrective binary.
- Do not trigger an EAS build merely because a server or web rollback is needed.
- Keep the API backward-compatible with currently installed and previously
  supported clients during server rollback.
- Do not invent a forced-update or minimum-version mechanism during an incident;
  none is documented as an existing recovery control.
- Use server-side feature disablement only when an existing, tested control
  already supports it.

## Database And Schema Decision

Use this decision rule:

| Situation | Action |
| --- | --- |
| Application regression; data remains valid | Roll back the affected service code only. |
| New revision added nullable tables/columns/indexes idempotently | Normally leave the newer schema in place and roll back code. |
| New revision wrote incompatible but bounded data | Stop and create a reviewed data-repair plan; do not restore reflexively. |
| Target revision predates a destructive/one-way migration | Stop. A pre-tested forward-fix or coordinated whole-database recovery is required. |
| Confirmed database corruption or destructive data event | Use the full recovery runbook, not this code procedure. |

Future migrations should remain additive-first. Any destructive migration must
ship with a tested compatibility window, backfill/verification plan, explicit
rollback or forward-fix plan, and recovery-point requirements before production.

## Validation After Rollback

For every affected service:

1. Confirm deployed Git SHA and production environment identity.
2. Confirm health and readiness.
3. Inspect startup logs for schema, auth, connectivity, and integrity warnings.
4. Verify CORS/API routing and authenticated access from the current clients.
5. Check error rates and latency against the pre-incident baseline.
6. For API/worker changes, confirm database writes and R2 access use production
   resources and that Training Content backup failures do not affect customer
   finalization.
7. Keep monitoring through at least one normal processing cycle.

## Stop Conditions

Stop and escalate if:

- the target deployment or Git SHA is ambiguous;
- the target lacks a currently required environment variable or API contract;
- rollback crosses a destructive/one-way database migration;
- the database or R2 state is already inconsistent;
- the rollback would require a force push, history rewrite, secret exposure, or
  manual data deletion;
- startup emits non-zero
  `[integrity][startup] cleaned invalid user-scoped history`; or
- current mobile clients cannot safely use the target API.

## Repository Documentation Drift To Verify

[Peritio Staging And Production Runbook](./Peritio_Staging_Production_Runbook.md)
still describes staging and production as potentially deploying from `main` and
contains historical web-surface deployment status. The current validated
release flow uses `staging` for staging promotion and `main` for production
promotion. Treat provider branch/deployment mappings as a manual verification
item until the older runbook is deliberately refreshed; this documentation task
does not alter it.
