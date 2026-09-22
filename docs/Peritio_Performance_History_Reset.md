# Peritio Performance History Reset Specification

Recorded: 2026-09-21

Status: Phase 0 specification only. This document does not authorize a reset, schema change, script execution, staging mutation, production mutation, or deployment.

## Purpose

At the final modernization cutover, Peritio will start Performance Intelligence from a known clean learner-performance baseline. Current performance history is pre-official/test data. The operation must remove or exclude that evidence without erasing customer configuration, identity, support history, audit configuration, or financial/accounting truth.

The reset boundary is a recorded cutover timestamp, `T`. Evidence before `T` must not contribute to learner-facing practice history, Training Pack progress, Performance plans, or the new Performance Intelligence model. Accounting sources retain their historical rows and do not apply the performance cutoff.

## Current storage classification

| Store or collection | Current role | Reset treatment |
| --- | --- | --- |
| `score_records` and file `*.score-records.json` | Scored-attempt, coaching, outcome, completion, and performance evidence | Delete pre-cutover rows. |
| `simulation_sessions` and file `*.simulation-sessions.json` | Recognized simulation lifecycle/recovery ledger | Delete pre-cutover rows. It is not the durable billing ledger. |
| `usage_sessions` and file `*.usage-sessions.json` | Hybrid: learner practice/activity history and billing/quota duration truth | Preserve rows for accounting. Learner/performance consumers must ignore rows before `T`. Do not wholesale-delete this store unless equivalent immutable accounting truth has first been created and verified. |
| Legacy app-state `scoreRecords` | Legacy performance evidence | Remove after authoritative-store reconciliation. |
| Legacy app-state `usageSessions` | Legacy copy of the hybrid usage domain | Remove only after proving every financially relevant row is represented in the preserved authoritative usage store. |
| `ai_usage_events` and file `*.ai-usage-events.json` | Provider-call accounting and budget truth: route kind, model, prompt/rubric versions, and token totals | Preserve all valid rows. These are not duplicate score results or learner transcripts. |
| Legacy app-state `aiUsageEvents` | Legacy accounting events | Migrate/reconcile into the authoritative AI-usage store and preserve; do not discard. |
| `performance_plans` | Historical Performance Plan/Goal definitions plus baseline and final-result snapshots | Delete the disposable pre-official plans. |
| `performance_plan_scope_items` | Frozen plan scope and attribution | Delete with the parent plans. |
| `performance_plan_audit_events` | Plan-specific changes and results | Delete with the disposable plans. This is distinct from the preserved platform audit log. |
| `performance_plan_updates` | Goal comments/updates | Delete with the disposable plans. |
| App-state `trainingPackAssignments` | Assignment definitions plus derived `startedAt`/`completedAt` progress | Preserve the assignment and assignee; reset only progress timestamps for affected assignments. |
| `support_cases` and file `*.support-cases.json` | Customer support record | Preserve. |
| Platform `audit_events` and audit configuration | Administrative/security audit truth | Preserve. |
| `org_content_usage` and `org_content_usage_sessions` | Learning Resource engagement/completion state | Preserve. They are not simulation performance evidence. |

The repository contains no separate persisted Performance Insight store. Current insights and progress are derived from score records, usage sessions, and Performance plans. Removing scores and plans and applying `T` to performance reads prevents those derived artifacts from surviving their source evidence.

## Preserve allowlist

The future tool must preserve, byte-for-byte or by a documented canonical hash where timestamps or ordering are normalized:

- organizations/accounts;
- users, authentication tokens/challenges, verification state, and account state;
- organization configuration, entitlements, quotas, contract/billing settings, industries, roles, and segments;
- Standard and Custom scenarios;
- Focus Topics, their Training Pack and Custom Scenario attachments, and division bindings;
- Learning Resources, categories, assets, assignments, scenario relationships, engagement/completion state, and open-session state;
- Training Packs and their definitions;
- Training Pack assignment definitions, including pack, organization, user, active state, assignment time, assigner, required scenarios, and completion rule;
- divisions and manager relationships;
- platform administrative configuration, platform audit events, and reviewer/store-review configuration;
- support cases;
- authoritative `ai_usage_events` and any reconciled legacy AI accounting events;
- `usage_sessions` needed for billing, quota, entitlement, and financial reconciliation;
- all other non-performance administrative data.

The tool must use this allowlist when calculating preservation hashes. It must never call account-deletion methods as a reset shortcut.

## Delete or reset

At cutover timestamp `T`, the future implementation must:

1. Delete all disposable pre-official `score_records`, including their file-backed equivalents and reconciled legacy `scoreRecords` entries.
2. Delete all recognized `simulation_sessions` from the disposable period, including file-backed equivalents.
3. Delete the disposable pre-official `performance_plans`. The current foreign keys cascade deletion to scope items, plan audit events, and plan updates; the manifest must still count and verify every child table explicitly.
4. Clear legacy performance-history arrays only after reconciling them with the authoritative stores.
5. Preserve Training Pack assignment definitions while setting `startedAt` and `completedAt` to `null` for assignments whose progress came from the disposable period. Updating `updatedAt` to the reset execution time is allowed and must be reported.
6. Make every learner-facing practice-history, Training Pack progress, goal-progress, and Performance Intelligence read ignore preserved `usage_sessions` whose evidence ends before `T`.
7. Leave Learning Resource usage/completion data unchanged.
8. Verify that no remaining derived Performance Intelligence artifact references a deleted score, simulation session, plan, or plan child.

For an initial modernization cutover in which all current performance history is declared disposable, the manifest may select all current scores, recognized simulation sessions, Performance plans, and assignment progress. The cutoff still must be recorded so retained hybrid usage rows remain excluded from future learner-performance calculations.

## Usage and billing distinction

`usage_sessions` cannot safely be treated as performance-only data. The same rows supply:

- learner practice counts and duration;
- dashboard attempt/activity views;
- Training Pack assignment progress;
- Performance Plan activity progress;
- organization and user usage totals;
- daily/monthly quota, overage, entitlement, and billing calculations.

The locked reset outcome is therefore a logical performance reset for this hybrid store: retain its financial rows and introduce an authoritative cutover boundary `T` for performance consumers. If Phase 1B instead creates a dedicated immutable accounting archive or verified billing rollup, it may then physically remove pre-`T` usage rows from the performance store. The reset must refuse to apply if neither mechanism exists.

`ai_usage_events` contains provider route, model, prompt/rubric provenance, and token counts. It is used for budget enforcement and accounting totals and does not contain the scored outcome or transcript. Preserve it across the reset. Support cases are also preserved.

The future manifest must report preserved usage totals by organization and billing period, plus AI-event counts and token totals by kind, before and after the operation.

## Observed staging inventory

A read-only staging inventory on 2026-09-21 found:

| Store | Rows |
| --- | ---: |
| `usage_sessions` | 109 |
| `simulation_sessions` | 110 |
| `score_records` | 59 |
| `ai_usage_events` | 1,200 |
| `support_cases` | 36 |
| `performance_plans` | 5 |
| `performance_plan_scope_items` | 8 |
| `performance_plan_audit_events` | 8 |
| `performance_plan_updates` | 0 |

The 1,200 AI accounting events comprised 215 opening, 307 turn, 59 score, 313 transcription, and 306 TTS events. The staging app state contained no legacy usage, score, AI-usage, or support arrays and no Training Pack assignments. These counts are evidence for planning, not an execution manifest; they must be recollected immediately before every rehearsal or cutover.

## Future tool safety contract

The Phase 1B implementation must meet all of these requirements:

1. Use an explicit allowlist of mutable stores and fields. Any newly discovered performance-like table is reported and blocks apply until classified.
2. Default to dry-run. Mutation requires an explicit `--apply`-style flag.
3. Resolve and print the target environment without printing credentials. An explicit target must match the target inferred from the database URL.
4. Refuse unknown Postgres targets. Refuse production unless the operator supplies an explicit production target and the exact production confirmation phrase.
5. Require a fresh production backup immediately before production execution. Record its identifier, creation time, scope, and checksum/verification result in the manifest.
6. Verify backup integrity and documented restore readiness before enabling production apply.
7. Inventory with direct read-only queries and file reads. Inventory must not initialize stores, run migrations, seed data, create tables/indexes, or rewrite normalized files.
8. Print exact pre-mutation counts by table/store, tenant, and relevant time boundary. Include the exact IDs or a reviewable encrypted artifact when listing every ID would expose sensitive data.
9. Produce canonical counts and hashes for the preserve allowlist before mutation.
10. For Postgres, lock the `app_state` row and perform related database mutations in a transaction where feasible. If a store cannot participate in the same transaction, apply in an explicit order with resumable checkpoints and report partial completion.
11. Reset assignment progress without deleting or changing assignment definitions or assignees.
12. Preserve AI accounting, support, platform audit, and Learning Resource usage data.
13. Verify post-mutation counts, preservation hashes, billing totals, AI token totals, assignment definitions, and the absence of unresolved references.
14. Be idempotent where practical. A repeated dry-run after success should report zero disposable rows and unchanged preserved hashes.
15. Emit a durable execution report containing target, mode, code SHA, cutoff `T`, operator-supplied backup evidence, before/after counts, preservation checks, unresolved references, and errors. Never include database credentials, auth tokens, or support content.

## Timing and execution sequence

### Phase 0

Specification only. Do not build or run the reset.

### Start of Phase 1B

Extend `api/scripts/reset-simulation-baseline.ts` if it can meet this contract without retaining its unsafe behaviors. Add the performance cutoff, Performance Plan deletion, accounting-preserving usage handling, backup inputs, direct read-only inventory, preservation hashes, reference validation, and tests. Do not create an unrelated destructive framework unless the existing script cannot be made explicit and safe.

### Staging

1. Run a dry-run against staging.
2. Review the manifest, cutoff, counts, preserved hashes, and accounting totals.
3. Execute only after review.
4. Verify customer configuration, billing/accounting truth, support data, Learning Resource state, and a clean learner-performance baseline.
5. Repeat staging resets during development when useful, always using the same safety process.

### Production

Do not reset production during Phase 0, Phase 1A, or Phase 1B development. Production remains on the current proven application.

Immediately before final modernization cutover:

1. Create a fresh production backup.
2. Verify backup integrity and restore readiness.
3. Run the final reset dry-run.
4. Have a human review and approve the manifest, cutoff, counts, hashes, and accounting totals.
5. Execute the reset once.
6. Verify preservation and the clean performance baseline.
7. Deploy the accepted modernization release.
8. Smoke-test identity, configuration, billing, support, learning content, simulation launch, and empty/new Performance Intelligence behavior.

## Existing reset utility comparison

### `reset-simulation-baseline.ts`

Useful pieces to retain:

- target parsing and database-target inference;
- refusal of Postgres unless explicitly enabled;
- exact production confirmation phrase;
- direct app-state loading;
- dry-run inventory mode;
- before/after count reporting;
- assignment progress reset that preserves assignment definitions;
- no use of account-deletion methods;
- practical idempotency after all selected rows are gone.

Behavior that does not meet this contract:

- dry-run is optional rather than the default;
- the apply path deletes all `usage_sessions`, including billing/quota truth;
- it deletes all `ai_usage_events`, which are accounting/budget truth;
- it deletes all support cases;
- it does not inspect or delete `performance_plans` or their child tables;
- its preserved Training Pack count initializes the Training Pack store, which can create schema during what should be read-only inventory;
- it checks preservation counts but not canonical hashes or financial totals;
- it does not require or verify a fresh backup;
- it does not scan for newly added performance stores or unresolved references;
- it does not coordinate every Postgres/app-state mutation in one transaction or emit resumable checkpoints;
- its printed target object can include the database URL and must be sanitized in any future execution report.

### `reset-pretester-history.ts`

This older utility is intentionally limited to local file data unless forced, but it has no dry-run mode and calls the same broad reset service. It clears usage sessions, recognized simulation sessions, score records, AI usage events, and support cases, resets assignment progress, and does not clear the Performance Plan store. It should not be used as the modernization reset.

Neither current utility satisfies this specification. No current reset utility is authorized for Phase 0 execution.
