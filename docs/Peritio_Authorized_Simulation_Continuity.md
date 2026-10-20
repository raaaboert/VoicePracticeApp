# Authorized simulation continuity (9G.1)

This change is local pending independent audit. It does not activate the spending
ledger, change customer allowances, or authorize a deployment/mobile build.

## Admission and accounting

Verified enterprise simulation opening, turns, transcription, server-authorized
speech and eligible first scoring continue beyond internal daily call/token
thresholds. The API loads the registered session, verifies the authenticated
active/verified member and organization, ownership, and operation-specific
conversation/completion deadline. Existing entitlement/grace checks still run.
Conversation is unavailable after usage completion or persisted scoring.
Runtime/scoring retain their existing scenario/version, snapshot and industry
authorization. Direct speech uses the registered session's permitted continuity;
assignment/publication changes cannot extend its lifetime.

Only a server-created admission object can select this policy; request flags or
serialized objects cannot. Completion admission permits scoring only, not speech
or more turns. Authoring, administrative tools, non-enterprise activity and
unbound speech retain their existing technical-budget policy. No blanket
enterprise exemption is introduced.

Both prechecks and atomic provider reservations distinguish technical admission
from measurement. Qualifying reservations have null technical limits, but still
reserve/settle ordinary usage events and use the existing advisory locks,
post-lock timestamps and timezone calculations. Above-threshold prechecks emit
a throttled operational warning without session IDs, prompts, speech or secrets.
Provider failures remain failures. Existing rate limits, file/text bounds,
timeouts, customer minutes and session deadlines are unchanged.

## Additive speech contract

- Multipart transcription optionally carries the full `simulationSessionId`.
  The server validates the registered session before granting continuity. This
  is not an unrestricted transcription endpoint: existing authentication,
  upload bounds, route throttles, entitlement and active-session limits remain.
- Opening/turn replies (including unified-turn recovery) optionally include
  `speechAuthorization`. TTS sends it with `simulationSessionId`.
- The authorization is a domain-separated HMAC using the existing stable
  `MOBILE_TOKEN_SECRET`. It binds user, organization, full session identity,
  server start, conversation expiry, and hashes of the actual server response
  and canonical speech chunks. It contains no source speech text.
- Arbitrary text, another session/user/org, missing/forged/expired grants and
  completed sessions do not qualify. Legitimate same-response retries are
  intentionally permitted during the authorized lifetime, subject to existing
  throttles. A voice preset change does not authorize different text.
- Mobile retains grants only in session-owned memory across screen remounts;
  they are not included in dialogue, score, reporting or persisted histories.
  Unexpected missing authorization fails safely without automatic synthesis
  retry. Registration-before-opening and existing audio recovery are preserved.

Old mobile request formats remain accepted under their existing limits. Older
installed binaries cannot obtain continuity protection for unbound direct
speech. Updated mobile against the older API still uses the old speech contract
because additional request fields are ignored and response fields are optional.
The full improvement needs a separately approved future mobile build.

Speech grants can be verified after API restarts or by another instance sharing
the same secret and registered-session database; they do not need a local text
cache. Secret rotation invalidates outstanding grants. Existing process-local
unified-turn/prefetch recovery and per-process rate-limiter limitations remain;
this batch does not claim multi-instance recovery improvements.

## Ledger compatibility and deferred work

`AI_SPEND_LEDGER_MODE` remains `off`; no schema/config change or migration 025 is
required by this feature. Existing ledger integration suites may initialize 025
in disposable local test schemas only. Nothing is applied to staging/production.
The same verified policy feeds the future record-mode `legacyLimits`, so its
conservative estimated accounting does not itself reintroduce technical caps
for qualifying sessions. Existing ledger tests are regression protection, not a
claim that end-to-end authorized continuity in record mode is activation-ready.
That mode needs separate explicit HTTP/crash/settlement validation and approval.

Separate follow-ups remain: duplicate prefetch/foreground TTS work, simultaneous
first-score provider calls, and usage finalization after scenario eligibility
changes. No change to those behaviors is included here.

## Local performance check

With a command-scoped disposable LOCAL `AI_SPEND_INTEGRATION_DATABASE_URL`, run:

```
node --import tsx api/scripts/benchmark-simulation-admission.ts
```

This compares the unchanged baseline reservation/settlement algorithm using
nonblocking finite limits against continuity's null technical limits. Seven
serial and four concurrent operations run at 0, 2,700, 9,000 and 27,000 usage
records, spread over users or concentrated on one. There are no provider calls,
ledger tables or shared database writes. The random schema is removed afterward.

On this local run, both policies used 10 queries per reserve/settle operation
and returned the same number of rows. At 27,000 spread records, median serial
times were 19.99 ms baseline / 19.28 ms continuity; concurrent medians were
69.20 / 70.63 ms. Concentrated-user serial medians were 119.19 / 117.23 ms,
concurrent 355.94 / 362.19 ms. The existing per-user aggregation cost remains;
no full-platform JavaScript scan or new advisory-lock algorithm was introduced.

These are noisy local store-level measurements, not production throughput or
whole-route benchmarks. They exclude HTTP, AI latency, and the additional
indexed registered-session/score lookups used to verify admission. Those lookups
occur in the existing short context read; production latency/topology still
requires operational validation. Baseline usage-store SQL is unchanged.

## Validation for this local change

- Full API suite with disposable PostgreSQL enabled: 1,230 passed, 0 failed,
  0 skipped.
- All 17 PostgreSQL integration files separately: 134 passed, 0 failed,
  0 skipped (included in the API total, not additional unique coverage).
- Focused admission service + continuity HTTP file: 10 passed, 0 failed,
  0 skipped. Both call and token ceiling cases complete real HTTP registration,
  opening/prefetch, transcription, turns, chunks/retry, usage completion, first
  scoring and score recovery, using mocked providers and persisted usage.
- Full mobile suite: 427 passed, 0 failed, 0 skipped. Focused speech/recovery
  subset: 67 passed, including real screen callbacks and substituted native
  playback/network modules.
- Shared/API builds, mobile TypeScript and diff checks passed. Shared has no
  standalone test script/files; shared behavior is exercised by consumer tests.
- Existing PostgreSQL tests cover independent-process atomic admission, crash
  recovery and 14,080 actual timezone/cutoff comparisons. Providers are mocked;
  no actual OpenAI credits are used.

No device test, EAS build, live deployment, or production change was performed.
Physical playback/prefetch/retry/remount validation in a separately approved
mobile build and independent code audit remain required before deployment.
