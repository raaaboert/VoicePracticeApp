# Peritio Phase 0 Baseline

Recorded: 2026-09-21

This document freezes the known-good source and behavioral baseline for the Performance Intelligence and Focus Topic modernization initiative. It is descriptive. It does not authorize a production deployment, data reset, schema change, or simulation change.

## Source baseline

- Known-good production source baseline: `aa79a9d1fbac6704eb1d0033af81c6342538073d` (`Add Related Scenario dashboard filters`).
- At the start of Phase 0 implementation, local `main`, local `staging`, `origin/main`, and `origin/staging` all resolved to that SHA.
- The working tree and index were clean before switching from `main` to `staging`.
- Phase 0 implementation began on local branch `staging` at the baseline SHA.
- The existing `pre-modernization-baseline-2026-08-11` tag resolves to `dcfb6fd854cae212d1d1fa3ce47c49f3ad6f695b` and predates the current release baseline. It remains unchanged.
- Runtime used for baseline validation: Node.js `v24.18.0`; npm `11.16.0`.

The current validation baseline observed before implementation was:

| Surface | Result |
| --- | --- |
| API tests | 550 discovered: 544 passed, 6 skipped, 0 failed |
| peritio-web tests | 111 passed, 0 failed |
| mobile tests | 235 passed, 0 failed |
| admin-web tests | 8 passed, 0 failed |
| TypeScript | `shared`, `api`, `mobile`, `admin-web`, and `peritio-web` passed |
| Builds | `shared` and `api` passed |
| Real-Postgres integration | 6 Training Content tests skipped because no integration database URL was configured |

The repository's `verify:fast` command did not include the API test suite at this baseline. Correcting that omission is a separate Phase 0 commit.

## Initiative branch and deployment rule

For this modernization initiative:

- All development occurs on `staging`, and staging is validated throughout the initiative.
- `main` remains at the known production baseline for the entire initiative.
- The normal phase-by-phase promotion workflow is suspended: do not fast-forward `main` after individual phases.
- Promote `main` only after the complete modernization initiative has been accepted in staging and production promotion is explicitly approved.
- Production must remain untouched until that final promotion.

The approved initiative mapping is that staging tracks `staging`, production tracks `main`, and production API/worker auto-deploy remains off. The current repository runbook still describes the older arrangement in which staging tracks `main` and production may deploy a pinned commit or release branch. Repository files cannot prove live provider settings, and no authenticated Render console or Render CLI was available during this work.

**REQUIRES MANUAL VERIFICATION BEFORE FIRST PUSH TO STAGING**

Manual verification must establish and record:

- the staging API and worker deploy branch and auto-deploy state;
- the production API and worker deploy branch; and
- that production API and worker auto-deploy are off.

Do not push Phase 0 commits or the new baseline tag until this verification is complete or the owner explicitly approves the push.

## Runtime model baseline

The intended and owner-reported deployed configuration is:

| Route | Model | API | Reasoning |
| --- | --- | --- | --- |
| Live simulation (opening and turn) | `gpt-5.6-luna` | Responses API | low |
| Scoring/evaluation | `gpt-5.6-terra` | Responses API | medium |

Remote TTS and modular prompt architecture are enabled in the intended deployed configuration.

Repository tests in `api/src/openaiModelConfig.test.ts` prove that these environment values resolve to the stated models, Responses API routing, and reasoning levels. The repository also proves that remote TTS and modular prompting are gated configuration paths. It does not prove the current provider environment values or production routing. Source defaults differ from the deployed configuration and must not be changed as part of this baseline work.

## Backup baseline

The owner reports that a full pre-modernization backup has been created. No backup artifact was present in this workspace, so this inspection did not prove its integrity or restoreability.

Before any destructive reset tooling is used, verify the backup inventory and integrity. Before final production cutover, complete and document a full restore rehearsal.

## Simulation invariants

- Phase 0 freezes current prompt composition and numeric scoring behavior before later architecture work.
- Phase 0 must not modify the simulation hot path.
- This initiative makes no runtime model, TTS, or STT changes.
- Existing simulation setup, launch, prompt, and scoring behavior remains authoritative until a later approved phase deliberately changes it.

## Current behavior to preserve

### Numeric scoring

- Persuasion, clarity, empathy, and assertiveness are independent primary dimensions on a 1-10 scale.
- Communication is a composite of those four dimensions. Default weights are 0.25 each; valid Training Pack overrides can change and normalize those four weights.
- Overall is a composite: `round(0.65 * Communication + 0.35 * Outcome)`.
- If `completionLevel` is not `complete`, or `objectiveAchieved` is false, Overall is capped at 65.
- A non-complete session forces `objectiveAchieved` false. An unachieved Outcome is capped at 69, and claimed achievement requires an Outcome of at least 70.
- AI scoring requires at least three real user turns. Fewer turns return `not_scored` and do not create a score record.
- Current live AI scoring validates the full evaluator payload before normalization; malformed or sparse payloads do not become neutral scores.

### Training Pack prompt and scoring behavior

- Modular behavior requires both the environment flag and the organization flag.
- A Training Pack applies only when its required behavioral triggers opt in the scenario with `scenario:<id>` or `scenario:*`.
- Roleplay appends the Training Pack brief and behavioral triggers. The brief includes its topic, objectives, success behaviors, failure patterns, audience level, and compliance constraints.
- Evaluation begins with the same base evaluation prompt. It appends a Training Pack scoring-weight block only when valid scoring-weight overrides exist.
- Training Pack scoring overrides affect only persuasion, clarity, empathy, and assertiveness. They affect Overall only through the Communication composite; the Communication/Outcome blend and unresolved cap remain unchanged.
- Success behaviors, failure patterns, and compliance constraints are not independently appended to the evaluation prompt today.

### Focus Topics and Learning Resources

- Focus Topic (`OrgTraining`) authoritative storage remains the current app-state collections: `orgTrainings`, `orgTrainingScenarioAttachments`, and `orgTrainingPackAttachments`.
- Standard scenarios do not require Focus Topic membership. Custom-scenario launch eligibility is resolved from the current scoped Focus Topic attachments and learner division visibility.
- Learning Resource eligibility is resolved independently from publication state, organization membership, module entitlement, and explicit resource assignments.
- Learning Resource-to-Scenario associations support related-content navigation only. They never grant Learning Resource access, scenario access, simulation launch eligibility, or reporting authority.
