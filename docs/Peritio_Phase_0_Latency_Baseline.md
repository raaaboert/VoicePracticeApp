# Peritio Phase 0 Latency Baseline

Recorded: 2026-09-21

This is a manually captured staging smoke baseline for later comparison during Performance Intelligence work. It records the observed order of magnitude on the deployed Phase 0 build; it is not a service-level agreement, production capacity result, or CI timing gate.

## Observed staging configuration

The observations came from staging commit `44a0b8531876a3962a322d68b8eeedabe3ecd67c` with the following resolved runtime configuration:

| Capability | Resolved value |
| --- | --- |
| Simulation opening and turns | `gpt-5.6-luna`, Responses API, low reasoning |
| Scoring | `gpt-5.6-terra`, Responses API, medium reasoning |
| Modular prompting | Enabled |
| Remote TTS | Enabled (`gpt-4o-mini-tts`) |
| Speech-to-text observed | `whisper-1` |

## Opening observation

One real smoke-session opening was observed:

| Route measurement | Observed latency |
| --- | ---: |
| Context ready | 22 ms |
| Context build | 1 ms |
| Training Pack lookup | 0 ms |
| Luna model latency | 2,581 ms |
| Response sent | 4,030 ms |
| Speech-prefetch TTS | 1,426 ms |

The opening was a runtime-cache miss and reported `workspace bootstrap: false`.

## Four-turn smoke sample

All four normal learner turns were runtime-cache hits. Context build and Training Pack lookup each reported 0 ms for every turn.

| Turn | Transcription | Luna model | Assistant ready |
| --- | ---: | ---: | ---: |
| 1 | 2,328 ms | 2,679 ms | 6,526 ms |
| 2 | 1,539 ms | 2,927 ms | 5,983 ms |
| 3 | 1,267 ms | 2,649 ms | 5,433 ms |
| 4 | 1,304 ms | 1,795 ms | 4,623 ms |

The supplied four-turn sample summaries are:

| Measurement | Approximate p50 | Approximate p95 |
| --- | ---: | ---: |
| Assistant ready | 5,708 ms | 6,445 ms |
| Model latency | 2,664 ms | 2,890 ms |
| Transcription | 1,422 ms | 2,210 ms |

These p50 and p95 figures describe only this four-turn smoke sample. Four observations are too few for a statistically meaningful production p95, so they must not be used as an SLA, regression threshold, capacity estimate, or CI gate.

## Scoring observation

The completed smoke session produced a scorecard with the following observed evaluation request:

| Measurement | Observed value |
| --- | ---: |
| Terra model latency | approximately 7,024 ms |
| Prompt characters | 28,405 |
| Input tokens | 5,729 |
| Output tokens | 418 |
| Total tokens | 6,147 |
| Reasoning | medium |

## Interpretation and Phase 0 boundary

The baseline captures the existing latency order of magnitude before later evidence-engine work. It is intentionally observational: normal turns in this sample were cache hits, while the opening was a cache miss.

The route logs do not measure direct database-lock hold or wait time. Existing route timings are sufficient for Phase 0. Do not add lock-timing instrumentation or a timing CI gate now; consider direct lock instrumentation in Phase 1B only if later evidence warrants it.

## Deployment observation, separate from latency

The initial simultaneous staging API and worker deployment encountered one Postgres `deadlock detected` error during `initializeTrainingContentSchema`. The identical API commit was redeployed without source or configuration changes and succeeded cleanly; staging then passed the real simulation/scoring smoke test.

This pre-existing startup behavior is an operational observation, not a simulation latency measurement, and no evidence of corruption was found. Multiple startup initializers perform DDL, so simultaneous API and worker cold starts can theoretically acquire schema/table locks in conflicting order. The failure is loud and recoverable. A single transient occurrence does not justify a Phase 0 source change.

When coordinated cold starts or deploys are practical to control, prefer staggering API and worker startup. If startup DDL reports `deadlock detected`, redeploy or retry. Monitor for recurrence; if it becomes recurrent, evaluate holding an advisory lock across the broader startup-DDL sequence in Phase 1B or later. Phase 1A adds no schema and is not blocked by this observation.
