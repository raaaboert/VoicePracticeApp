# Peritio Phase 0 Scoring-Weight Override Audit

Recorded: 2026-09-21

This is a read-only inventory for the future removal of customer-controlled Training Pack `scoringWeightOverrides`. It does not authorize changing packs, scoring behavior, historical scores, or production data.

## Inspection scope and method

The source inspection used local `staging` at `6ac62cf124b37feefcb7215528abed52c24d26fe`.

Two datasets were inspected without initializing application stores:

- The workspace file dataset at `api/db.local.json` and its sidecars was read directly. File storage has no Training Pack persistence implementation, and the local score-record sidecar contains zero records.
- The configured Postgres URL was classified as `staging` by `inferDatabaseTargetEnvironment`. Its tables were queried directly inside an explicit read-only transaction that was rolled back. No application store initialization, schema creation, update, reset, or deployment occurred.

The staging dataset is the relevant Training Pack audit dataset because Training Pack persistence is Postgres-only today.

## Training Pack inventory

Staging contains 2 Training Packs. Neither has a non-empty scoring override.

| Pack ID | Name | Organization | Current status | Submitted status | Exact `scoringWeightOverrides` |
| --- | --- | --- | --- | --- | --- |
| `0379b0fa-0898-4d3b-96f1-ce7198144a42` | Pack B | Rob's Company (`org_b2eeef27-3f4d-42b2-a592-d93709e17e77`) | Inactive (`active = false`) | Not represented by the current Training Pack model | `{}` |
| `e5082904-50dd-439c-ad02-0a2e6d715b16` | Pack A | Rob's Company (`org_b2eeef27-3f4d-42b2-a592-d93709e17e77`) | Inactive (`active = false`) | Not represented by the current Training Pack model | `{}` |

The current Training Pack contract and table expose an `active` boolean. They do not expose a separate draft/submitted/published lifecycle, so no submitted status can be reported.

Summary:

- Packs inspected: 2
- Packs with non-empty overrides: 0
- Active packs: 0
- Inactive packs: 2
- Training Pack assignment definitions in staging app state: 0

Both inactive packs are currently attached to the active Focus Topic `Test Training` (`training_0bfaa855-4f66-4b08-9410-94ae33f45629`) for Rob's Company. Attachment is configuration context; it does not establish that either pack participated in a historical score.

## Historical score exposure

The staging `score_records` table contains 59 records:

- Records with a non-empty `training_pack_id`: 0
- Records referencing a currently existing pack with non-empty overrides: 0
- Distinct referenced Training Pack IDs: none

### Definite evidence

There is no current staging record that is attributable through `training_pack_id` to either inspected pack, and neither current pack contains an override. The observed staging dataset therefore has zero directly identifiable historical scores affected by the currently stored overrides.

Current live AI scoring resolves the applicable persisted Training Pack before evaluation, passes that pack to the prompt orchestrator, obtains the resolved scoring weights from the orchestrator, and persists the resolved pack ID on the score record. This makes a non-null `trainingPackId` strong evidence of which pack participated in the current path.

### Current-state inference

Both packs are currently attached to one active Focus Topic, but both packs themselves are inactive, contain no overrides, and have no score or assignment references. This is current configuration evidence only. Focus Topic attachment alone does not prove that a pack was selected, scenario-scoped, or applied when a historical score was produced.

### Historically unknowable state

Score records do not persist `scoringWeightsApplied` or an immutable snapshot of the Training Pack overrides. Training Packs and their overrides are mutable, and older records can predate reliable pack attribution. Consequently:

- A record that references a pack does not by itself prove which override values existed when it was scored.
- Current pack values cannot reconstruct historical applied weights.
- A null `trainingPackId` cannot prove that no pack influenced a legacy score if the record predates the current attribution behavior.
- Deletion or later editing of a pack can remove the current object needed for attachment-based inference.

For the inspected staging data, these limitations do not create a known affected population; they limit the stronger claim that overrides were never used historically. Repeat this read-only inventory immediately before the later scoring-consolidation migration.

## Migration implication

The observed staging data does not require a score rewrite when customer-controlled overrides are removed: no current pack has overrides and no score references a Training Pack. This conclusion is dataset-specific and does not replace a final pre-migration audit of staging and production.
