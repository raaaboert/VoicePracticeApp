# Peritio Phase 0 Decisions

Recorded: 2026-09-21

These decisions constrain later Performance Intelligence and Focus Topic work. Phase 0 records them; it does not implement the future architecture described here.

## Performance vocabulary

The primary performance dimensions are:

- persuasion;
- clarity;
- empathy; and
- assertiveness.

Communication and Overall are composites. Outcome represents objective achievement and completion quality; it is not an independent competency.

## Evidence inclusion

Future Performance Intelligence uses valid scored records rather than complete-only records. The evidence model must distinguish valid, partial, inconclusive, complete, and legacy records deliberately instead of inheriting current dashboard `conclusiveOnly` filtering by accident.

This decision does not change current score persistence or reporting filters in Phase 0.

## Focus Topic attribution

An explicit persisted `trainingId` is authoritative when present. Future reporting must not rewrite that historical attribution from current mutable Focus Topic attachments.

Records without an explicit `trainingId` need a defined historical attribution policy. Current attachment-based fallback is not immutable evidence and must not silently become historical truth in the future registry.

## Focus Topic storage

Current app-state storage remains authoritative for simulation behavior. A downstream reporting registry may be added in Phase 1B, but it must remain a projection.

The registry must never become simulation authorization, learner-eligibility, prompt-selection, or launch authority. Registry drift or unavailability must not change which scenarios a learner can run.

## Evaluation architecture

Focus Topic expectations will become the single authoritative customer-specific evaluation layer. Training Packs ultimately become delivery and assignment mechanisms rather than a second customer-specific scoring philosophy.

This future consolidation must be explicit and separately validated. Phase 0 preserves current Training Pack prompt and scoring influence exactly as it exists.

## Performance authorization

The future field is:

```text
performanceAccess = none | team | organization
```

Administrative role and performance visibility are separate concerns. A manager must eventually be possible without granting administrative user-management rights.

The current `isEligibleManagerUser` predicate requires an active `user_admin` in the same organization. Phase 1A must intentionally review every current dependency, including:

- manager assignment validation, normalization, repair, and role/status cleanup in `api/src/services/userProfiles.ts` and the organization-user routes in `api/src/index.ts`;
- direct-report visibility, dashboard permitted-user sets, dashboard reports, attempt access, and Performance goal management;
- manager option lists and organization administration screens;
- Learning Resource `manager` and `manager_team` assignment eligibility in `api/src/services/trainingContentEligibility.ts`;
- Learning Resource assignment-target construction and management routes;
- any Training Pack assignment or progress views that rely on dashboard permitted-user scope; and
- division filtering, which narrows an authorized scope but must not independently grant performance access.

Phase 0 does not add `performanceAccess` or change manager eligibility.

## Deterministic intelligence

Performance Intelligence Phases 1-3 are deterministic-first. No LLM decides strengths, weaknesses, evidence confidence, or recommendations. Derived claims must be reproducible from persisted evidence, explicit thresholds, and versioned deterministic rules.

## Product taxonomy

- Focus Topic is the practice, performance, and customer-learning context.
- Learning Resource is learning material.
- Content Category is a library and presentation grouping, not a competing top-level customer taxonomy.
- Training Pack remains a separate delivery and configuration concept.

Scenario-to-Learning Resource links remain related-navigation metadata and never become authorization.

## Reset decision

Phase 0 produces a reset specification only.

- No reset occurs at Phase 0 exit.
- No reset tool is built during Phase 0.
- The reset tool is built at the start of Phase 1B, when needed.
- It is rehearsed against staging before any production use.
- Production performance history is reset once, immediately before or during final production cutover, after explicit approval and verified backup/restore readiness.

The finalized contract is recorded in [`Peritio_Performance_History_Reset.md`](./Peritio_Performance_History_Reset.md). It resolves the Phase 0 retention questions as follows:

| Data | Locked treatment |
| --- | --- |
| Performance plans and goals | Delete the disposable pre-official plans and their scope, plan-audit, update, baseline, and final-result artifacts. |
| Usage and billing truth | Preserve authoritative usage rows for financial/quota truth and apply a recorded cutover timestamp so pre-cutover rows no longer contribute to learner/performance history. |
| AI accounting events | Preserve all valid AI usage events and reconcile any legacy copies into the authoritative store. |
| Support cases | Preserve. |
| Assignment progress | Preserve assignment definitions and assignees; reset derived `startedAt` and `completedAt` values tied to disposable history. |

Existing reset scripts do not settle these questions: they clear support cases and all AI usage events, reset assignment progress, and do not clear the separate Performance plan store. They must not be run as the modernization reset.
