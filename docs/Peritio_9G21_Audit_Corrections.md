# Batch 9G.2.1 — scoring availability and legacy speech reuse

Baseline: `a71058f50791f1be3c4d28fc27dc0086c1f9cc66`.
Local correction only. This supersedes the scoring-capacity assumptions in the
9G.2 report. Independent re-audit is required before any staging deployment.

## Reproduced before correction

The real PostgreSQL HTTP harness now registers nine distinct authorized learners
across two organizations, with `PG_POOL_MAX=5`. Mocked evaluations remain pending
until all nine have entered provider work, or the four excess requests have failed.
This reproduces pool pressure without a timing-dependent ten-second provider sleep.

On the 9G.2 baseline, **5/9** scored and four returned 503 after optional pool
acquisition failed. There were five provider calls; measured elapsed time was
8,339 ms. A legacy foreground TTS request during its registered session's pending
prefetch also dispatched **two** syntheses and failed to reuse the prefetched audio.

## Scoring correction

Optional coordination now has three explicit outcomes:

- **Acquired:** retain normal per-session advisory ownership and recheck the
  persisted score before evaluation. No transaction spans the provider call.
- **Busy:** a local active attempt or PostgreSQL lock collision identifies the
  same session as already being handled. Return the existing recoverable
  503/`ai_unavailable` response and preserve ordinary score recovery.
- **Unavailable:** optional capacity, connection or query acquisition cannot
  finish within a short window. Proceed through ordinary authorized scoring,
  rather than rejecting a legitimate first evaluation.

The optional acquisition window is at most **250 ms**, bounded further by the
existing configured connection timeout. The remaining window bounds the advisory
query; a timed-out query connection is discarded so it cannot retain ownership.
The optional pool's maximum remains five in the regression; no pool enlargement,
new service, quota or spending ceiling is used. Ordinary database timeouts are
unchanged. A static throttled warning records optional fallback without identity,
transcript, provider content or credentials.

Fallback still performs essential persisted-score and registered-session reads,
ownership/context checks, existing deadline/budget admission and provider usage
reservation. Essential database failure stops dispatch. A missing registered
session also fails closed. A known owner is not treated as a capacity failure.

Optional ownership loss cannot discard an otherwise valid generated score:
ordinary first-writer-wins persistence remains authoritative. A completed score
is returned unchanged, whether coordination was acquired or unavailable.
This does not guarantee a future write against an outage after provider dispatch;
the original persistence/error recovery behavior remains in place.

## Scoring evidence

- **9/9 learners** now receive persisted scorecards, with **nine provider calls**
  and nine distinct persisted user/session identities. Repeated recovery returns
  the same records without another provider call. This runs after exhausting the
  technical daily ceiling, independently preserving 9G.1 continuity.
- The measured mocked nine-learner operation completed in **513–696 ms**, versus
  the baseline 8,339 ms with four failures. These timings include local route and
  database work; they do not represent real model latency.
- A separate saturated one-slot coordinator returns `unavailable` in **254–260 ms**
  while its original owner remains held. Local and cross-pool requests for that
  same identity return `busy`; a different identity can acquire a separate pool's
  lock. Releasing capacity restores acquisition. A closed optional pool returns
  `unavailable`, not an exception or false ownership claim.
- Two normal concurrent requests for one session, including independent API
  processes, dispatch **one evaluation**, persist one score and recover it.
- In an isolated local schema, temporarily making the essential session table
  unavailable immediately after optional fallback returns safe 503 with **zero
  provider calls and zero score records**. Restoring it permits one successful
  evaluation and immutable recovery. No shared table/database is modified.
- The existing process-termination test still releases advisory ownership and
  permits recovery. As before, an uncertain provider result after process death
  can require a second sequential evaluation.

Availability takes priority over optional duplicate suppression. When coordination
is unavailable, overlapping same-session fallbacks in different processes can
still evaluate twice; database persistence retains one immutable result. No
exactly-once provider-charge guarantee is claimed. Session-affine PostgreSQL
connections remain necessary for successful advisory coordination, but optional
resource exhaustion is no longer a scoring admission limit.

## Legacy TTS correction

A request without session identity may reuse an otherwise matching prefetched
response only for the **same authenticated user and acting organization**, exact
correlation, normalized text/chunk and voice preset. Synthesis uses the unchanged
server model/preset configuration within the same API process. An exact secure
match is selected even when unrelated entries share the correlation value.

Authentication, organization and entitlement checks and ordinary technical-budget
checks still precede cache lookup. Missing identity never produces a 9G.1
continuity admission object. Updated bound requests still require their matching
session and server-issued speech grant before any reuse; no grant or session
authorization is inferred from a correlation ID.

The actual pending-prefetch HTTP regression now dispatches **one synthesis**
instead of two. The same legacy request returns **429** once its ordinary budget
is exhausted, even with cached audio available. Other users, including a peer
in the same organization and a user in another organization, perform their own
authorized synthesis rather than receiving that cached audio. Focused tests also
reject wrong text, voice, correlation, organization and bound session identity.

## Validation and scope

Final full API suite with disposable LOCAL PostgreSQL: **1,242 passed, 0 failed,
0 skipped**. Full mobile suite: **427 passed, 0 failed, 0 skipped**. Shared/API
builds, mobile TypeScript and diff checks passed. The independent admission,
speech, coordinator and presentation subset passed **30 tests**, with no failures
or skips (included in the API total). No mobile source or contract
changes were made; existing response shapes, score recovery and bounded mobile
retry behavior are preserved. All provider work is mocked.

Changed files:

- `api/src/index.ts`
- `api/src/services/simulationScoringCoordinator.ts`
- `api/src/services/simulationSpeechPrefetchRegistry.ts`
- `api/src/services/simulationSpeechPrefetchRegistry.test.ts`
- `api/src/simulationAiContinuity.integration.test.ts`
- `docs/Peritio_9G21_Audit_Corrections.md`

No migration, deployment, push, EAS build, production change or live provider
request is authorized/performed. Ledger recording remains disabled; existing
ledger tests run only in disposable local schemas. Audio-cache byte budgets,
rare speech failure refinements, hypothetical half-open connections, abandoned
session accounting and all other deferred findings remain outside this batch.
