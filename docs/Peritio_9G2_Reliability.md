# Batch 9G.2 local reliability corrections

Baseline: `d90a2c2dda2431a5bf43d2054f95f514f2de4506`.
Local implementation only, pending independent audit. No push, deployment,
shared migration, mobile build, provider spending or production modification.

## Fix 1 — COMPLETE for the confirmed in-process overlap

Previously, the registry deleted its entry on the first consume attempt. After
the 2-second foreground wait, the original prefetch could still be running while
a second synthesis started. A second concurrent consumer could miss immediately.

Now foreground callers join the same in-flight promise and may reuse completed
audio. Cold foreground work also coalesces. Identity includes correlation/response,
authenticated user, acting organization, registered session, normalized text/chunk
hash and voice preset. The model/voice mapping remains process configuration.
Every HTTP request still passes current authentication, entitlements and 9G.1
session/text-grant authorization before any audio reuse. A mismatch never deletes
another operation's pending entry.

Reuse is bounded by the existing 12-second prefetch provider timeout, replacing
the old 2-second decision to fork work. Normal replies use whichever already
started result arrives; no artificial delay is added. A stuck waiter returns
504/`ai_timeout`, not a second provider request. Failure returns the existing
503/`ai_unavailable`; failed entries are released for explicit recovery. A
cancelled HTTP waiter does not cancel synthesis still needed by another waiter.

The cache holds at most 64 entries for 60 seconds. Completed entries can be
evicted under pressure, but pending entries are not evicted to start prefetch.
New prefetch is skipped when every cache slot is pending. Foreground speech is
still allowed if the cache is full; no customer spending/concurrency ceiling is
introduced. Provider usage is reserved/settled once inside the shared factory.

Actual HTTP regression: two overlapping foreground waiters, opening prefetch
and subsequent replay dispatch **one** synthesis. Cold overlap with a cancelled
waiter dispatches **one**. A short injected reuse timeout followed by retry also
dispatches **one**. A failed synthesis followed by successful explicit retry
dispatches **two sequential calls**, as intended. Four successful syntheses in
the combined test produce four ordinary usage events; OFF-mode failure
reservation behavior is unchanged.

This is not distributed exactly-once TTS. Different API processes, a different
operation identity/voice, expiry/eviction after completion, cache saturation,
or uncertain provider outcomes can still cause another synthesis. Coalescing
across API processes would need separate coordination and a way to deliver the
shared audio result; no new shared-audio subsystem is introduced here.

## Fix 2 — COMPLETE for normal concurrent registered scoring

A namespaced PostgreSQL **session advisory lock** coordinates the existing
user/org/session identity across processes. It uses a dedicated bounded pool
with the existing PostgreSQL connection settings. Acquisition is nonblocking
once connected. There is no transaction or process-wide app-state lock across
the AI request. File storage uses a process-local guard only; it is not a
multi-process deployment mechanism.

After acquiring ownership, the API rechecks persisted scoring. A completed score
returns the original 200 response. A competing request returns recoverable
503/`ai_unavailable`, with a retry hint. Existing mobile score recovery by session
ID remains unchanged; no automatic duplicate scoring POST or new response schema
is introduced. Persistence is still immutable and database-enforced.

Ownership releases in `finally` on success, invalid model output, provider error
or timeout. PostgreSQL releases the lock when its owning process/connection dies.
Connection loss before persistence fails safely; it does not authorize trusting
an in-memory score. The existing scoring deadline is checked before provider work.

Actual two-API-process HTTP tests verify:

- Concurrent first scoring: **one** provider dispatch, one persisted score;
  the other process gets 503, then recovers the original score with 200.
- The lock-holding PostgreSQL connection is idle with no open transaction
  while the mocked provider is blocked.
- Provider error and injected provider timeout release ownership; a later
  legitimate retry succeeds (two sequential dispatches per failure/retry case).
- Killing the owner during provider work releases ownership. Recovery makes
  another evaluation: **two calls** for that uncertain operation, then no further
  calls on persisted-score retrieval. This is deliberately not an exactly-once
  charging guarantee after provider uncertainty.

Deployment prerequisites: use a session-affine PostgreSQL connection. Do not use
session advisory locks through transaction-mode pooling without separate review.
The dedicated pool may hold one additional connection per active first scorer,
up to the existing pool maximum. Review connection headroom before deployment;
pool acquisition retains its existing bounded connection timeout.

## Fix 3 — COMPLETE

HTTP reproduction before correction: register a legitimate Topic session,
replace its organization industry with a different enabled industry, then submit
usage. The old route returned **400**, `Invalid scenario for usage session.`

The route now uses registered identity, Topic, division and Training Pack
attribution when completing that activity. It does not resolve a new launch
against today's scenario projection. Existing current account/organization,
ownership, malformed-snapshot, context, duration and completion checks still
apply. New launches continue to enforce current eligibility. Unregistered legacy
handling retains its current resolver; a forged ID cannot create usage.

The customer-scenario archival regression also exposed that PostgreSQL's append
INSERT/RETURNING omitted the existing `scenario_version_id` column. Those clauses
now preserve the already-pinned value. No schema change, historical backfill or
billing formula change was made.

After correction, industry deactivation and customer-scenario archival completion
return **201**. Repeated requests retain exactly **one usage row** with the
original user/org/scenario/version/Topic. Archived scenarios reject new launches;
the completed session can still score its pinned version. Wrong identity,
forged context, missing registration and expired unfinalized sessions are denied.
Persisted finalization replay keeps the existing recovery semantics.

## Validation and release checks

Full API suite with disposable LOCAL PostgreSQL: **1,236 passed, 0 failed,
0 skipped**. Full mobile suite: **427 passed, 0 failed, 0 skipped**. Shared/API
builds, mobile TypeScript and diff checks passed. No mobile source changed.
The independent admission/speech/prefetch subset passed **24 tests**, with no
failures or skips, including 9G.1 service and HTTP protections.

Local mocked HTTP measurements: two TTS waiters plus replay completed in 22–24 ms
around provider-gate release, with one dispatch. Cross-process duplicate scoring
was rejected in 207–237 ms, including cold API/database work. The existing slow-speech
fixture now reuses a 2.1-second prefetch rather than dispatching another provider
request. These are local test observations, not production latency promises.
The new coordination adds acquire/unlock queries and a session connection, not a
global database lock or historical scan. TTS lookup/capacity work is bounded by
the cache size and does not hold a database lock over provider calls.

Production main remains frozen. Ledger mode remains OFF; no migration is added
or applied to a shared database. Existing ledger tests may apply migration 025
only in their disposable local schemas; this is not activation.

Before any separately approved staging deployment, complete independent audit,
verify PostgreSQL pooling/headroom and API instance routing, and physically test
slow opening speech, later chunks, voice retry, cancellation/background/resume,
duplicate scoring/recovery and finalization after availability changes.

**Abandoned and unreported training sessions remain an open production
prerequisite.** This batch does not solve their minute accounting or introduce
new spending policies, dashboards, generation features or ledger activation.

Changed production files: `api/src/index.ts`,
`api/src/services/simulationSpeechPrefetchRegistry.ts`,
`api/src/services/simulationScoringCoordinator.ts`,
`api/src/storage/usageSessionStore.ts`.

Other changed files:

- `api/src/focusTopicAssignmentRuntime.integration.test.ts`
- `api/src/mobileAiBudgetRoute.test.ts`
- `api/src/services/simulationSpeechPrefetchRegistry.test.ts`
- `api/src/simulationAiContinuity.integration.test.ts`
- `api/src/simulationSpeechPrefetchReuse.test.ts`
- `api/src/simulationScoringProcess.testSupport.ts` (local-only API test process)
- `docs/Peritio_9G2_Reliability.md` (this report)
