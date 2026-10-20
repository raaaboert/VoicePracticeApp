# Durable abandoned-simulation accounting (9I.1)

This revision is local pending independent review. It authorizes no deployment,
mobile build or financial-ledger activation. `AI_SPEND_LEDGER_MODE` and migration
025 are unchanged.

## Confirmed activity, not an open-session clock

Successful registered opening and conversational turn routes, including unified
audio submit, attempt a durable checkpoint before returning the assistant result.
An opening establishes a checkpoint with zero seconds. Each later unique exchange
adds `min(max(0, confirmedAt - previousConfirmedAt), 60 seconds)`, bounded by the
existing conversation maximum. No time accumulates before the first checkpoint or
after the last. Scoring, recovery reads, transcription alone and TTS/replay do not
add checkpoints. A first confirmed turn without a recorded opening also starts at
zero; missing evidence is never reconstructed.

These gaps are imperfect proxies for active practice, not proof of uninterrupted
speaking or listening. They do not measure provider cost, audio duration or tokens.
They are only a fallback for sessions which never finalize normally.

The opening has a constant identity; turns use a hash of semantic history, without
persisting utterances. Correlation IDs do not establish new billable exchanges.
The session row stores first/last timestamps, fractional accumulated seconds,
hashed exchange identities (whose count is the confirmed exchange count), maximum
seconds and the earliest settlement timestamp. PostgreSQL row locks serialize
checkpoint updates against each other and finalization. Out-of-order writes never
move the latest checkpoint backwards and may conservatively undercount. Successful
AI responses survive checkpoint database failures; safe diagnostics record the
failure, but a crash/failed write can lose that checkpoint. Unconfirmed provider
work is not charged. No historical activity is inferred from `lastSeenAt`.

## Completion and abandoned settlement

Normal `/usage/sessions` completion still uses validated client-reported duration,
even if below the estimate. The separate modified-client underreporting issue is
not fixed here. Request/response shapes and deterministic session usage IDs remain.

Abandoned settlement waits through the existing absolute completion deadline
(conversation maximum plus 20-minute completion grace; existing null-limit fallback
is eight hours), plus two minutes of clock tolerance. It never settles merely
because a learner pauses. A later increase in the configured maximum defers the
candidate in the due index. A decrease does not move an already-recorded candidate
earlier. Expired sessions cannot resume or re-register under the same identity.

The existing usage row is inserted and the registered session marked settled in
one PostgreSQL transaction, under the same session lock used by client completion.
Concurrent clients/workers return the durable winner; no second usage record or
charge is created. Existing append-first records are healed without overwriting
their duration. File storage retains its single-process append-first, deterministic
retry recovery; it does not offer multi-file atomic transactions.

Both usage and session records distinguish `client_completed` from
`server_abandoned`. Existing rows retain NULL provenance; they are not rewritten.
Opening-only settlement has zero raw seconds. Settlement creates neither a score
nor training-objective completion, and does not invoke assignment-completion sync.
It does not depend on current scenario publication, industry or Topic assignment.
Pinned user/org/division/Topic/scenario/version attribution comes from registration.

## Admission and continuity

New session registration first reconciles up to 50 expired sessions for that user.
Its entitlement projection includes finalized usage and confirmed unsettled usage
for that user and relevant organization, deduplicated by deterministic usage ID.
It reuses daily caps, monthly allotments, overrides, bonuses and temporary-overage
calculations. No reservations or new caps are introduced.

Estimates are used only for new-session admission. For an already registered,
owned, unexpired conversation, newly settled abandoned estimates created after
registration are excluded from its allowance projection. Existing client-completed
usage, authorization, session deadlines, scoring recovery and active-session grace
remain in force. New estimated usage must not interrupt an admitted simulation.

The periodic worker runs a bounded 50-session sweep at startup and once a minute,
without overlapping itself. Its timer is unref'd and cleared when the server closes.
It takes a current configuration snapshot without writing full app state; provider
work never runs inside settlement transactions. Due/organization partial indexes
avoid scanning all registered sessions per request. Durable rows recover after
restart; no external scheduler is required.

## Attribution and rounding

Abandoned usage starts at registration and ends at its final confirmed exchange,
not reconciliation time. User daily aggregation uses that end timestamp in the
effective configured timezone. Organization billing periods use session start.
Daily raw seconds aggregate before rounding down to 15 seconds; organization usage
still rounds down each session individually. No remainder carry was introduced.
Existing historical records and accounting periods remain untouched.

Settled abandoned records can appear as usage activity in existing reporting;
they must not be interpreted as a successful score or objective completion. Pending
estimates affect new admission but are not published as completed usage records.

## Deployment and remaining limits

The existing store-initialization schema mechanism adds:

- `simulation_sessions.confirmed_activity JSONB NULL`
- `simulation_sessions.activity_settle_after TIMESTAMPTZ NULL`
- `simulation_sessions.usage_source TEXT NULL`
- `usage_sessions.usage_source TEXT NULL`
- Partial indexes for due candidates and organization/user unsettled activity.

These additions are idempotent and automatically applied during existing store
initialization. A future API-only staging deployment suffices if its database role
has the DDL privileges already required by these stores; otherwise an operator must
apply these additive changes before deployment. No migration 025, external job or
new secret is needed. Retain columns/data on rollback; reverting code stops future
accounting and restores the original abandonment gap. Do not delete settled usage.

Known, accepted limits:

- Simultaneous starts can pass against the same remaining allowance. There are no
  cross-instance minute reservations; checkpoint and settlement correctness are
  database-enforced, but admission is not a globally serialized allocation system.
- The existing snapshot-backed reporting model remains single-instance oriented.
  New admission refreshes usage; this is not a reporting-cache redesign.
- Opening-only sessions, sub-15-second organization sessions, client underreporting,
  failed checkpoints and ambiguous provider outcomes can still undercount under
  the approved policy. This is not a provider-spend cap or exactly-once AI dispatch.
- Unbound speech cannot be assigned to a registered session by guessing.
- Current organization session maximum and timezone conventions remain authoritative;
  this batch does not snapshot new customer policy settings or backfill old sessions.

No additional owner policy approval is requested by this implementation. Independent
audit and coordinated deployment approval remain separate steps.

## Local validation and file inventory

Final API suite with command-scoped disposable LOCAL Focus Topic and customer
scenario PostgreSQL URLs: **1,247 passed, 0 failed, 11 skipped** (1,258 tests).
The skipped tests require separately configured app-state, product-settings,
Training Content/Pack and notification integration fixtures. No shared database
or real AI provider was used. The shared package contains no standalone tests;
its build and the API usage/contract tests passed. Shared/API TypeScript production
builds and `git diff --check` passed.

Focused coverage: six activity/file/timer tests; fifteen local PostgreSQL accounting
tests including the parent; eighteen HTTP continuity tests including the parent,
with four new accounting HTTP regressions. Existing pinned-version, snapshot,
customer-scenario, scoring, recovery, allowance and authorization tests also ran.

Exact changed files:

- `api/src/index.ts`
- `api/src/services/abandonedSimulationUsage.ts`
- `api/src/services/simulationActivity.ts`
- `api/src/services/simulationActivity.test.ts`
- `api/src/services/simulationSessionLifecycle.ts`
- `api/src/services/usageSessionAccess.ts`
- `api/src/storage/simulationSessionStore.ts`
- `api/src/storage/usageSessionStore.ts`
- `api/src/storage/abandonedSimulationUsage.postgres.integration.test.ts`
- `api/src/simulationAiContinuity.integration.test.ts`
- `shared/src/contracts.ts`
- `docs/Peritio_Abandoned_Simulation_Usage.md`
