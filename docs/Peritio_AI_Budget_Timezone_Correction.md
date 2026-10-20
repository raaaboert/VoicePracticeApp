# AI budget timezone correction — Batch 9F.2B.2

Local-only correction of `31c9329e50b77aef0ebf095449458c9ea02fd5e6`.
Independent Claude Opus re-audit is mandatory before staging deployment. Successful
local tests are not deployment authorization. No push, shared migration, real provider
request, configuration change or production operation is part of this batch.

## Authority and query shape

The SQL-only user-local calculation introduced in 9F.2B.1 was incorrect. Node accepts
offset identifiers and aliases that PostgreSQL interprets differently or rejects;
ICU and PostgreSQL timezone rules also differ. PostgreSQL must not interpret the
user's timezone for budget admission.

The corrected query materializes the same valid 72-hour event window once inside
PostgreSQL. One UNION branch aggregates platform calls/tokens using constant UTC.
The other returns only matching-user timestamps and nonnegative token totals. It
does not transfer other users' history or event bodies to Node. Node applies its
original date-parts algorithm with one formatter per calculation. The shared
`createDayKeyFormatter` uses the same constructor/options/parts and day-key formatting
as `getDayKey`; it caches no usage, authority or cross-request state.

The window still uses the pre-existing validity filters. Public snapshots exclude
the exact cutoff; reservations include it. Reservations choose their authoritative
timestamp after acquiring the global advisory lock. The query remains in that same
transaction; batching, ownership, HMACs, bucket reservations, dispatch boundaries,
settlement, unknown outcomes and recovery are untouched. Platform UTC totals and
organization bucket accounting do not depend on the user's timezone.

## Correctness evidence

Node v24.18.0, ICU 78.3, Node timezone data 2026b. The corpus contains all 418 zones
from this runtime's `Intl.supportedValuesOf('timeZone')`, plus 22 distinct supported
aliases/offset forms: 440 total. It explicitly includes `+14:00`, `-12:00`, `+05:30`,
`+0530`, `US/Pacific-New`, `Pacific/Kiritimati`, `America/New_York`,
`Africa/Casablanca`, `Africa/El_Aaiun` and `America/Edmonton`.

The actual local PostgreSQL test compares 440 zones x 32 deterministic cutoffs =
14,080 snapshots against an independent copy of the original Node date-parts
algorithm (only formatter allocation is hoisted). Cutoffs cover 2026–2028, spring
and fall DST, repeated midnight, UTC midnight and future ICU/database disagreement
dates. Fixtures include quarter-hour samples, exact cutoff ±1 ms and 72-hour
lookback ±1 ms. PostgreSQL timezone calculations are never the expected answer.

A separate read-only diagnostic against local PostgreSQL 18.6 compared its old
timezone expression with Node at 2,661 sampled timestamps per zone. It observed
73 differing dates for each of Casablanca/El_Aaiun, and 44 for Edmonton. For example,
at `2026-10-24T23:59:59.999Z`, Node's Casablanca day is October 25 while PostgreSQL's
is October 24; at `2026-12-31T06:59:59.999Z`, Node's Edmonton day is December 30 while
PostgreSQL's is December 31. The old expression rejected `+0530` and
`US/Pacific-New` with SQLSTATE 22023. These are diagnostic observations, not the test
oracle. All corrected production-path comparisons above pass without those errors.

Five existing applicable calls reject a three-call user cap for every explicitly
listed zone, in both the actual off-mode store and record-mode provider adapter:
20 rejection cases, no provider dispatch, no additional event/attempt. The off-mode
path also runs before 025 exists. Offset-local concurrent admission accepts exactly
three of ten reservations across independent pools for each of five forms/aliases.
Real lock waits with a deterministic post-lock clock cross UTC, +14 and -12 local
midnight; earlier-day calls do not consume the new local day, while UTC platform
totals remain separate. No sleep-based midnight timing is used.

Blank/unknown validity fields remain excluded; negative tokens count as zero;
unattributed (NULL org) events remain valid; impossible NULL required fields and
malformed timestamps are rejected by the existing database constraints/types.
Existing provider failure, six-process reservation, four-process settlement,
crash/lease reconciliation, UTC attribution, enterprise exemption, active-simulation
grace, safe API errors and mode-off tests are included in the full API run.

## Performance and query plans

The benchmark uses mocked provider results and a private disposable localhost schema.
It never calls OpenAI. Run from `api` with a command-scoped local
`AI_SPEND_INTEGRATION_DATABASE_URL`:

```text
node --import tsx scripts/benchmark-ai-spend.ts --revision=5e26167d7592179fc7b4f047a7fea4c8255f2dba
node --import tsx scripts/benchmark-ai-spend.ts --revision=31c9329e50b77aef0ebf095449458c9ea02fd5e6
node --import tsx scripts/benchmark-ai-spend.ts
```

Historical stores are read from local Git objects into a checked temporary directory,
then removed. No branch checkout or dependency change is needed. All three versions
use the same mock adapter, Node/shared timezone semantics and benchmark harness.
Each cell has one warm-up, three serial calls, then eight calls from four concurrent
workers, with pool maxima four. The benchmark connect timeout is 30 seconds for all
versions: the first foundation attempt with a one-second timeout failed under its
long synchronous scan; this is a harness setting, not a production timeout change.

The two distributions are 1,000 users with 1/1,000 of seeded rows assigned to the
test account, and 100% assigned to that account. Seeded recent rows are spread over
the preceding twelve hours; measured calls accumulate after seeding. Counts are
approximately 0/2,700/9,000/27,000. No limits are raised in the application; the
benchmark supplies unlimited internal test-policy limits to measure all sizes.

Round trips remain **10 off / 24 record**, serial and concurrent, versus the
foundation's **9 / 61**. No extra database round trip is introduced by this correction.

Only user rows cross the process boundary. Serial average returned-user counts are
1/3/10/28 for the spread distribution, and 1/2,701/9,001/27,001 for the concentrated
distribution (the +1 is the average of preceding measured calls). Concurrent averages
include more measured calls. The platform aggregate returns one row regardless of
volume. Historical foundation queries instead transferred the whole recent window.

EXPLAIN ANALYZE with 27,011 recent records chooses a sequential scan when the entire
table is recent. With 100,000 additional retained older rows, the same query uses
`idx_ai_usage_events_created_at` via Bitmap Index/Heap Scan and materializes only
27,011 recent records. User filtering stays in PostgreSQL; only 38 spread-user or
27,011 concentrated-user rows are returned at the end of the workload. The CTE is
reused for both branches. No index/migration is necessary for this correction.

Concentration makes Node work grow with one user's three-day history. This is a
real regression against the unsafe SQL-only implementation, not hidden by averages.
The 27,000-record account is an intentionally uncapped stress case, far beyond the
production source defaults (120 calls/user/day and 1,500 global/day); deployed
settings and enterprise/grace exemptions must be verified, not inferred from those
defaults. Normal spread activity preserves the broad foundation improvement.
Validate concentrated-user volumes and lock latency before activation. No stale
cache, timezone-offset guessing or broad schema redesign is introduced to hide it.

Measurements below are localhost/Windows results, not Render latency or an SLO.
They use three serial samples and eight concurrent completions per cell; caching,
GC, JIT, connection setup and host noise affect small samples. SQL plans are captured
after timings; the 100,000 older rows used for the second plan do not affect timing
datasets. Provider latency is excluded.

F / B1 / fix below means foundation `5e26167`, unsafe SQL-only `31c9329`, and this correction. Values are matched local runs.

### Spread across 1,000 users

| Seeded events | Mode | Median ms (F / B1 / fix) | Sequential calls/s (F / B1 / fix) | Four-worker calls/s (F / B1 / fix) | Fix user rows/call (serial average) |
| ---: | --- | --- | --- | --- | ---: |
| 0 | off | 2.75 / 2.8 / 2.61 | 384.73 / 321.49 / 371.35 | 179.06 / 58 / 228.61 | 1 |
| 0 | record | 13.79 / 9.01 / 6.22 | 75.56 / 110.81 / 142.13 | 74.69 / 105.78 / 112.16 | 1 |
| 2,700 | off | 141.67 / 3.56 / 4.21 | 6.81 / 262.76 / 228.59 | 6.67 / 163.98 / 174.05 | 3 |
| 2,700 | record | 146.11 / 8.01 / 7.52 | 5.96 / 111.63 / 117.31 | 5.75 / 104.87 / 98.26 | 3 |
| 9,000 | off | 592.92 / 7.51 / 8.37 | 1.8 / 135.87 / 118.93 | 1.95 / 110.72 / 110.4 | 10 |
| 9,000 | record | 596.05 / 12.62 / 11.4 | 1.74 / 77.87 / 79.85 | 1.96 / 79.38 / 73.91 | 10 |
| 27,000 | off | 1353.68 / 17.3 / 19.32 | 0.69 / 56.85 / 52.78 | 0.68 / 55.32 / 51.75 | 28 |
| 27,000 | record | 1274.07 / 21.84 / 25.41 | 0.72 / 43.61 / 38.03 | 0.68 / 42.77 / 36.28 | 28 |

### Concentrated in one user

| Seeded events | Mode | Median ms (F / B1 / fix) | Sequential calls/s (F / B1 / fix) | Four-worker calls/s (F / B1 / fix) | Fix user rows/call (serial average) |
| ---: | --- | --- | --- | --- | ---: |
| 0 | off | 2.73 / 2.02 / 2.58 | 364.71 / 506.6 / 385.59 | 199.2 / 214.33 / 219.14 | 1 |
| 0 | record | 15.41 / 5.47 / 6.53 | 66.52 / 160.87 / 140.48 | 23.66 / 112.11 / 118.07 | 1 |
| 2,700 | off | 260.22 / 4.83 / 16.06 | 3.13 / 204.45 / 63.75 | 3.41 / 158.12 / 63.2 | 2701 |
| 2,700 | record | 271.74 / 8.91 / 20.48 | 3.08 / 110.85 / 50.43 | 3.16 / 98.67 / 49.85 | 2701 |
| 9,000 | off | 937.83 / 11.43 / 41.29 | 1.08 / 87.12 / 23.35 | 1 / 87.61 / 24.11 | 9001 |
| 9,000 | record | 1044.7 / 14.96 / 47.37 | 0.95 / 64.71 / 21.05 | 1.04 / 60.09 / 19.98 | 9001 |
| 27,000 | off | 2730.26 / 30.45 / 115.24 | 0.37 / 33.29 / 8.61 | 0.34 / 32.49 / 8.42 | 27001 |
| 27,000 | record | 2810.38 / 34.1 / 121.71 | 0.35 / 28.68 / 8.16 | 0.34 / 27.36 / 8.17 | 27001 |

At 27,000 events, the spread workload's record median rises from 21.84 to 25.41 ms
and four-worker throughput falls from 42.77 to 36.28 calls/s. With every event owned
by one user, it rises from 34.10 to 121.71 ms and falls from 27.36 to 8.17 calls/s.
That concentrated case remains about 23 times faster than the foundation median,
but its extra Node/lock-held work is a real activation consideration. No production
capacity claim follows from these small local samples.

## Validation

- Focused ledger/timezone files: 36 passed, zero failed/skipped.
- All 16 local PostgreSQL integration files: 128 passed, zero failed/skipped.
- Full PostgreSQL-enabled API suite: 1,220 passed, zero failed/skipped.
- Shared/API builds, API TypeScript, benchmark TypeScript and diff checks pass.
- All three matched benchmark revisions complete with mocked providers. The earlier
  foundation attempt's one-second benchmark connection timeout failed; the matched
  runs use 30 seconds consistently and complete. Runtime timeout settings are unchanged.

The test harness establishes NODE_ENV=test itself where the injected clock is used;
none of these results require an inherited terminal setting. Migration 025 is
byte-identical. No schema, source-data, mobile, scoring or lifecycle change was made.

## Release gates

`AI_SPEND_LEDGER_MODE` still defaults to `off`; no 025/ledger secret is needed for
that path. Migration 025, limits, minute entitlements, API/mobile contracts and frozen
production main are unchanged. No shared database operation or deployment occurred.

Provider HTTP errors remain potentially billable/unknown: no speculative refunds.
That behavior remains an activation-policy prerequisite. Existing old binaries retain
the pre-lock cutoff defect; shared advisory locking does not fix them. Preserve the
coordinated cutover excluding unsafe overlapping writers, actual revision/topology
checks, migration/secrets coordination and independent audit. Ledger retention and
deidentification, HTTP-level scoring single-flight/idempotency and strict TTS grants
remain separately deferred; they were not implemented here.
