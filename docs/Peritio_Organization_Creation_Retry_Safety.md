# Organization creation retry safety — Phase A1

Implementation is local on `staging`, uncommitted and pending independent review.
This document authorizes no deployment, migration or next remediation batch.

## Contract and persistence

`POST /orgs` still requires the existing platform-admin authentication. It now
also requires a UUID-v4 `Idempotency-Key`. Authentication runs before receipt
lookup. Missing/malformed keys return 400 before creating anything; a key reused
with different creation inputs returns 409.

One logical submission retains its key and original payload across automatic
transport retries, manual retries and a tab reload. A confirmed success clears
the pending operation. An explicitly separate submission gets a fresh key,
including when every company/contact field is identical.

The organization ID retains the `org_<UUID>` format and is derived from that
operation ID. A private `organizationCreationReceipts` map in the existing
`app_state` JSON contains the input fingerprint and organization ID. The receipt
and new organization commit together under the existing serialized mutation and
PostgreSQL transaction. This introduces no SQL DDL, migration, table, dependency
or infrastructure configuration. Existing databases with no map are accepted.

Receipts do not expire and are not copied into organization API responses. Replay
returns the current organization without overwriting edits, permissions, users,
memberships or join codes, and emits no second creation audit event. If a receipt
references a removed organization, replay fails closed rather than recreating it.
Corrupt receipt metadata fails closed rather than being silently discarded.

The operation ID is not an authorization credential. Customer tokens and invalid
or expired admin sessions cannot use it to create or recover an organization.

## Admin behavior and compatibility

The form saves its pending operation in per-tab sessionStorage, scoped to the API
base URL, BEFORE dispatch. Storage failure prevents sending an unremembered
creation. Failed/ambiguous requests retain the key and freeze the original fields
for retry. An administrator can explicitly start a separate creation after
checking the directory; this does not undo an earlier successful request.

No mobile, billing, authentication architecture or other organization-management
endpoint changes are included. Existing organization IDs and relationships are
unchanged. The tracked creation scripts and test request helpers now provide keys.

A stale admin page or external caller without a key can no longer create an
organization: it must refresh/update. This fail-closed compatibility change is
intentional; allowing unkeyed creation would retain the duplicate-creation hole.
The new admin can communicate with the old API, which ignores the additional
header; retry safety is not enforced until the updated API is deployed. The old
admin cannot create organizations against the new API because it omits the
mandatory `Idempotency-Key` and receives 400. No release was performed in this batch.

## Deployment and rollback order

Production deployment order:

1. Deploy the updated admin-web application first.
2. Ensure operational scripts have been updated to provide the required key.
3. Deploy the updated backend API.
4. Refresh previously opened admin browser tabs.
5. Verify organization creation and idempotent retry behavior.

Rollback order:

1. Roll back the API first.
2. Roll back admin-web second.

This order preserves client/API compatibility; the old API does not enforce the
new retry guarantee. Preserve receipt metadata and review the rollback boundaries
below before any rollback.

### Staging deployment safety and verification

Render automatically deploys the staging API when `staging` is pushed. The Vercel
admin-web branch mapping is not yet confirmed. **Verify that mapping before any
push**, including the Vercel project, deployment branch, target API URL and how the
updated admin will be available before the API changes. Agree on a controlled
release plan if that order cannot be guaranteed. Do not assume a staging Git push
produces a coordinated deployment.

If the staging API updates first, organization creation from the old admin may
temporarily return 400 until the updated admin is available and old tabs are
refreshed. Record the verified branch/project mapping, deployed admin/API commit
identifiers, operational-script version and deployment order. Do not record secrets.

After the staging deployments, smoke-test creation from a refreshed admin, retry
the same operation and confirm it returns the same organization without another
creation, verify conflicting details under the same key return 409, and confirm a
new operation can create a distinct organization with identical details. Record
the smoke-test results before approving production deployment. These are future
verification requirements; no push, deployment or smoke test is authorized here.

## Deferred low-severity audit findings

- **F2 — corrupt retry receipt map can prevent API startup.** Deferred; no
  application-code correction is included in this documentation batch.
- **F3 — admin form can get stuck if browser storage or UUID generation fails.**
  Deferred; no application-code correction is included in this documentation batch.

## Boundaries

The concurrency guarantee uses the existing supported single-API-writer model.
This work does not make cached app-state writes safe across multiple API
processes, implement distributed fencing or change deployment topology. Receipt
metadata must be preserved by subsequent releases. Rolling back to old code can
discard metadata and removes enforcement; do not call that a safe rollback.

SessionStorage survives reloads, not closing/clearing a tab or all browser data.
Keep an ambiguous operation's ID if retrying outside that tab; inspect the account
directory before intentionally starting a replacement. Explicitly abandoning an
operation and creating a new key starts a different operation, not a replay.

Local validation uses synthetic file-backed API subprocesses, disposable scratch
directories, disabled dotenv reads, no database/provider credentials and outbound
network guards. It covers a dropped response after persistence, a fresh process
reading the same file, concurrent requests, commit failure, key conflicts and
authorization. No PostgreSQL instance, hosted database, production service, build
or migration is exercised; PostgreSQL correctness relies on the existing
app-state transaction boundary and is not represented as a newly executed
database integration test.

## Local validation performed

- 20 new tests passed: real-route subprocess/failure/restart/concurrency tests,
  receipt tests, form-operation tests and the real admin-fetch retry helper.
- 28 selected existing organization/authorization/persistence tests passed under
  a clean environment, disposable working directory, disabled dotenv and an
  outbound socket guard. Do not rerun existing API suites against local env files.
- API and admin-web TypeScript checks passed with `--noEmit --incremental false`.
- Modified operator/critical-flow scripts passed `node --check`; their operational
  flows were not executed. `git diff --check` passed.

The new self-contained tests can be run without a database or a build:

```powershell
node --import ./node_modules/tsx/dist/loader.mjs --test api/src/services/organizationCreationRetry.test.ts api/src/organizationCreationRoute.test.ts admin-web/src/lib/organizationCreation.test.ts
```

The API subprocess fixture explicitly prevents dotenv loading, supplies only
synthetic file-storage configuration and rejects external network connections.
