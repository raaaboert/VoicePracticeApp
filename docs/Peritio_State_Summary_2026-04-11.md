# Peritio State Summary (2026-04-11)

This document records the major work completed across this chat session, with emphasis on:

- scenario/admin data-model grounding for scoring
- `desiredOutcome` plumbing across standard and custom scenarios
- outcome-aware scorecard and evaluation refactor
- insufficient-evidence handling and unresolved-outcome score caps
- mobile score handling and `not_scored` behavior
- reporting semantics cleanup
- safe simulation/reporting history reset
- reporting freshness fixes for `usage_sessions` and `score_records`
- final readiness state and APK build output

This is intentionally exhaustive. It is meant to serve as a handoff-quality checkpoint, not a short changelog.

## Current Baseline

As of the end of the engineering work in this chat:

- branch: `main`
- pushed baseline: `8c3ca53`
- latest commit message: `Refactor scorecards and fix reporting freshness`
- the recent scoring/reporting/reset/freshness work was consolidated into that checkpoint
- after the code work, a fresh Android `preview` APK was built successfully on EAS

APK build output:

- EAS build URL: `https://expo.dev/accounts/raaaboert/projects/VoicePracticeApp/builds/2f0d9bb7-1e9f-4325-adca-f7188f2ab289`
- build command used:
  - `npx.cmd eas build --platform android --profile preview --non-interactive`

Important operational note:

- the final code push landed before the EAS build
- the build therefore reflects the current pushed baseline rather than an uncommitted local state

## Executive Summary

The most important outcome of this chat is that Peritio's simulation scoring and reporting stack is now much more coherent, much more explicit about outcome versus communication quality, and materially safer to test than it was at the start of the session.

The biggest product/system improvements made during this chat were:

- scenario-level `desiredOutcome` was added cleanly for both standard and custom scenarios
- evaluation now uses a layered scoring model instead of the previous weaker and more ambiguous prompt stack
- custom scenario scoring guidance is now additive rather than replacing the industry guidance layer
- score output now distinguishes:
  - `communicationScore`
  - `outcomeScore`
  - `overallScore`
  - `completionLevel`
  - `objectiveAchieved`
- sessions with insufficient evidence no longer generate normal scores
- unresolved or unsuccessful attempts can no longer surface artificially strong overall scores without the server cap applying
- score persistence is cleaner and more honest
- dashboard/reporting semantics are less inflated than before
- a safe simulation/reporting-data reset path now exists for clean test baselines
- trust-critical reporting routes no longer require an API restart after out-of-band storage resets

The biggest product/architecture judgment reached during the chat was:

- the old scoring problem was not one single bug
- it was a layered trust problem across prompt design, persistence shape, outcome semantics, reporting semantics, and stale reporting reads
- after the recent changes, the core system is now strong enough for serious controlled internal testing
- the biggest remaining risks are no longer basic schema/wiring failures; they are mostly:
  - model judgment quality
  - legacy compatibility drag
  - reporting surface coverage outside the main freshness-fixed routes

## Chronological Timeline

### 1. Deep Scorecard / Reporting Audit Phase

The session began with a long analysis phase rather than immediate code edits.

That phase intentionally traced the full chain across:

- simulation scoring
- scorecard generation
- scoring inputs
- rubric logic
- transcript handling
- persistence
- dashboard consumption
- admin-side industry baseline and scoring-guidance wiring

The point of this audit phase was to answer two trust questions:

1. why a short, unresolved simulation could score unusually high
2. whether the industry/scenario scoring context shown in admin tools was actually wired into runtime and evaluation

Major conclusions from that audit phase:

- the old scorecard path was too willing to reward a single strong-seeming response
- outcome fulfillment and session completion were not first-class enough in the scoring model
- dashboard/reporting semantics were stronger than the underlying scoring primitives really justified
- the admin/content model implied richer industry/scenario scoring control than the implementation fully honored

This audit phase directly shaped every later implementation pass.

### 2. Phase 2 Groundwork: `desiredOutcome` Data-Model and Admin Plumbing

The first implementation goal was deliberately limited:

- add `desiredOutcome`
- wire it cleanly through shared contracts
- preserve backward compatibility
- do not yet redesign scoring

That groundwork landed across:

- shared contracts/types
- API normalization and persistence paths
- standard scenario admin flows
- custom scenario admin flows
- tests for normalization and preservation

What was achieved in this phase:

- standard scenarios support optional `desiredOutcome`
- custom scenarios support optional `desiredOutcome`
- standard/custom create/update flows preserve it
- normalization trims and safely preserves it
- old records without it still load safely
- admin content screens can create/edit/view it

This phase mattered because it turned `desiredOutcome` from a design intention into real product state that later scoring logic could consume.

### 3. Phase 3 Scoring Refactor: Outcome-Aware Evaluation and Persistence

After `desiredOutcome` existed end to end, the next pass changed the actual scoring model.

The new intended evaluation layering became:

Standard scenario:

- Industry Baseline
- Industry Standard Scenario Scoring Guidance
- Scenario Desired Outcome

Custom scenario:

- Industry Baseline
- Industry Standard Scenario Scoring Guidance
- Scenario Desired Outcome
- Custom Scenario Scoring Guidance

That layering is now reflected in the current code path.

The most important scoring-model changes made in this phase:

- custom scenario guidance became additive instead of replacement
- evaluation output now includes:
  - `communicationScore`
  - `outcomeScore`
  - `overallScore`
  - `completionLevel`
  - `objectiveAchieved`
- the legacy subscores were preserved for compatibility:
  - `persuasion`
  - `clarity`
  - `empathy`
  - `assertiveness`
- sessions with `<= 2` user turns now return a typed `not_scored` response
- those insufficient-evidence attempts do not call the evaluator
- those insufficient-evidence attempts do not create score records
- unresolved / unsuccessful attempts are capped at `65`
- score persistence was expanded to carry the new outcome-aware fields
- mobile handling was updated so the `not_scored` path would not silently devolve into fake score generation

This was the major conceptual inflection point of the chat.

Before this pass:

- scoring could still feel like “good answer quality” grading detached from whether the user actually got anywhere

After this pass:

- the system now tries to separate:
  - communication quality
  - outcome progress / success
  - final blended score
  - completion state
  - objective attainment

### 4. Prompt / Reporting / Trust Cleanup Pass

Once the new scoring shape was in place, the next pass focused on contradictions and trust hazards rather than feature expansion.

That pass targeted four main issues:

- prompt/rubric conflict
- incomplete reporting harmonization
- fallback / legacy escape hatches
- messaging/semantics overstating certainty

The most important fixes from that pass:

- old prompt instructions that conflicted with the new outcome-aware score schema were cleaned up
- the evaluator prompt became more internally coherent
- mobile self-summary and org-admin analytics were moved toward conclusive-only score logic
- fake or misleading fallback score behavior was tightened
- the old manual score route was no longer allowed to quietly undermine the new model
- `not_scored` messaging became more honest about what had and had not been persisted yet

This pass reduced the risk that the new scoring model would be weakened by older prompt assumptions or UI/reporting carryover.

### 5. Final Trust / Semantics Cleanup Pass

After the first cleanup pass, a second cleanup pass addressed the remaining low-risk but trust-sensitive issues that were still visible in code review.

That work focused on:

- cross-field sanity between `outcomeScore`, `objectiveAchieved`, `completionLevel`, and `overallScore`
- clarifying “conclusive” versus “successful”
- softening dashboard/reporting language that still over-read old rubric framing
- treating mixed historical data more honestly

Important changes made here:

- contradictory outcome states now normalize conservatively
- success cannot survive obviously inconsistent completion/outcome combinations
- unsuccessful attempts cannot retain success-range outcome signals after normalization
- reporting now exposes a cleaner distinction between:
  - conclusive attempts
  - outcome-aware attempts
  - successful attempts
- several dashboard/user-facing labels were softened away from overconfident language
- attempt detail now shows newer outcome-aware fields explicitly and treats legacy rubric details as compatibility fields rather than the primary truth

This pass did not redesign the system. It made the current architecture cleaner and more trustworthy before testing.

### 6. Safe Simulation / Reporting Baseline Reset

At that point the system needed a genuinely clean test baseline.

The requirement was:

- purge simulation-derived history
- preserve core product structure/configuration
- do not break login or scenario/training setup

The safest reset boundary chosen was:

Purged:

- usage sessions
- score records
- recognized simulation sessions
- AI usage events
- support cases
- assignment progress timestamps if derived from prior attempts

Preserved:

- users
- orgs
- industries
- industry baseline/scoring guidance content
- standard scenarios
- custom scenarios
- training packs
- admin configuration
- auth-related setup needed to keep testing viable

The reset script added for this purpose:

- `api/scripts/reset-simulation-baseline.ts`

That script was then used to clear the live simulation/reporting baseline.

The purge result recorded during the chat was:

- `66` usage sessions removed
- `10` recognized simulation sessions removed
- `65` score records removed
- `378` AI usage events removed
- `39` support cases removed

Verified preserved counts stayed intact across the reset for:

- users
- orgs
- industries
- standard scenarios
- custom scenarios
- training packs
- auth/setup-related records

This reset mattered because it removed mixed-generation historical noise before fresh testing.

### 7. Reporting Freshness Audit and Trust-Critical Fix

After the purge, a major trust issue appeared:

- underlying stores had been cleared
- but admin usage and customer/dashboard reporting still showed old non-zero metrics

This triggered another deep audit.

The key conclusion from that audit:

- frontend requests were fresh
- but the serving API process was reading `usage_sessions` and `score_records` from long-lived in-memory snapshots
- the purge/reset script changed storage out of band
- the running API process kept old snapshot state until restart

That was a serious trust problem.

The resulting fix was intentionally narrow and explicit:

- do not redesign all storage
- do fix the reporting-critical paths

What was changed:

- `usageSessionStore` gained explicit snapshot refresh capability
- `scoreRecordStore` gained explicit snapshot refresh capability
- reporting-critical routes now force a refresh of:
  - usage-session snapshots
  - score-record snapshots
  - monolithic app state
  before composing reporting payloads

This fixed the core problem that mattered most:

- the main admin/dashboard reporting routes no longer require a process restart after an out-of-band reset

Important nuance captured during the audit:

- this was a reporting-critical freshness fix, not a universal “every route in the product is now live-refreshed” rewrite

### 8. Final Audits and Readiness Review

After the freshness fix, a final read-only audit was performed.

The resulting system judgment was:

- fundamentally coherent
- materially safer than before
- ready with caution for serious controlled internal testing

Strongest confirmed areas:

- outcome-aware evaluation layering is now real
- `desiredOutcome` plumbing is real
- insufficient-evidence scoring guard is real
- unresolved-score cap is real
- main web/admin reporting freshness issue is fixed

Main remaining concerns identified:

- some secondary mobile/admin reporting routes still use ordinary snapshot-backed reads
- `outcomeScore` is still model-dependent
- custom scenario `scoringGuidance` still carries a semantically messy dual role because runtime continues using it for custom counterpart-pressure guidance
- legacy rubric fields still exert real influence
- dashboard/reporting semantics are much better, but not perfectly uniform

### 9. New Android APK Built Successfully

After the code work and final audits, a new Android APK was built using the same Expo/EAS path that had historically worked for Peritio.

Important context:

- there was a brief detour into local Gradle assembly
- that path hit environment friction:
  - missing `JAVA_HOME`
  - Android SDK configuration needs
  - Windows path-length issues
  - workspace resolution friction under a substituted drive path
- that detour was abandoned in favor of the actual established happy path:
  - EAS remote build

The successful command was:

- `npx.cmd eas build --platform android --profile preview --non-interactive`

Result:

- build finished successfully
- installable Android artifact is available from the EAS build page

Warnings noted but not blocking:

- `cli.appVersionSource` is not set
- duplicate environment keys exist between the `preview` profile `env` block and the EAS `preview` environment
- local `eas-cli` version is slightly behind the newest available version

None of those warnings blocked the build.

## Current Architecture After This Chat

### 1. Scenario and Scoring Context Model

Current scenario-scoring context now works like this:

#### Standard scenarios

- scenario belongs to an industry
- industry provides:
  - AI Industry Baseline
  - Industry Standard Scenario Scoring Guidance
- scenario provides:
  - `desiredOutcome`

Evaluation stack for standard scenarios:

- Industry Baseline
- Industry Standard Scenario Scoring Guidance
- Scenario Desired Outcome

#### Custom scenarios

- custom scenario belongs to an org and an industry
- industry provides:
  - AI Industry Baseline
  - Industry Standard Scenario Scoring Guidance
- custom scenario provides:
  - `desiredOutcome`
  - custom `scoringGuidance`

Evaluation stack for custom scenarios:

- Industry Baseline
- Industry Standard Scenario Scoring Guidance
- Scenario Desired Outcome
- Custom Scenario Scoring Guidance

Important truth:

- custom scoring guidance is now additive during evaluation
- it no longer replaces the industry-level standard scoring guidance

### 2. Runtime Simulation Prompting

Runtime counterpart behavior continues to rely primarily on:

- scenario context
- AI role
- industry baseline
- conversation state

Important design note:

- no new “counterpart behavior guidance” field was added
- that was an intentional design decision during this chat

Remaining semantic messiness:

- for custom scenarios, the existing custom `scoringGuidance` still has some runtime role in custom counterpart-pressure guidance
- that is workable, but not conceptually as clean as having scoring-only and runtime-only custom guidance layers separated

### 3. Score Generation Model

Current score-generation flow:

1. mobile posts simulation transcript/history for scoring
2. server counts meaningful user turns
3. if `<= 2` user turns:
   - return typed `not_scored`
   - do not call evaluator
   - do not persist score record
4. otherwise:
   - build evaluation prompt with the layered context model
   - send transcript + context to the model
   - parse structured response
   - normalize/repair score state conservatively
   - cap unresolved/unsuccessful outcomes
   - persist score record

Current high-level score fields:

- `communicationScore`
- `outcomeScore`
- `overallScore`
- `completionLevel`
- `objectiveAchieved`

Legacy compatibility fields still preserved:

- `persuasion`
- `clarity`
- `empathy`
- `assertiveness`

### 4. Score Semantics

The system now treats these distinctions more explicitly:

- insufficient evidence / not scored
- partial but scored
- complete and successful
- complete but unsuccessful

Important current truth:

- “conclusive” does not mean “successful”
- conclusive remains primarily completion-based
- success is represented separately through `objectiveAchieved`

This is much better than before, but it is still important when interpreting reporting output.

### 5. Score Persistence Model

Persisted score records now carry:

- scenario/training/org/user linkage
- `simulationSessionId`
- new outcome-aware score fields
- legacy compatibility subscores
- narrative feedback / coaching text
- prompt/model/rubric metadata

Important persistence truth:

- insufficient-evidence attempts do not create score records
- normal scored attempts do
- recognized simulation-session linkage materially reduces duplicate scoring risk when present

### 6. Reporting Model

Current reporting draws from multiple domains:

- usage/activity from `usage_sessions`
- score-based performance from `score_records`
- supporting product/config state from the monolithic app-state store

Main web/admin reporting routes now explicitly refresh the critical snapshot-backed stores before reading, so they can reflect out-of-band resets without a process restart.

This now covers the trust-critical routes powering:

- admin usage
- dashboard overview
- customer directory cards
- customer detail
- dashboard user reporting
- training/reporting drilldowns
- attempt detail

Important limitation:

- this freshness fix was targeted
- it does not mean every route in the entire product has been moved to the same refresh model

### 7. Mobile Behavior

Current mobile score behavior is much more coherent:

- real server-backed scoring uses the new outcome-aware response shape
- `not_scored` is a typed non-error success path
- server-backed failures no longer quietly drop into fake score behavior
- local fake scoring remains scoped to explicit mock/dev-style paths rather than normal production behavior
- the scorecard screen now presents:
  - overall
  - communication
  - outcome
  - completion
  - objective achieved
  more directly and honestly

## Most Important Code Areas Affected

The recent checkpoint touched a broad set of files. The most important areas are grouped below.

### Shared contracts and core types

- `shared/src/contracts.ts`

Why it matters:

- `desiredOutcome` support
- score-record shape
- score response contracts
- default scoring-guidance generation

### API scoring / prompt logic

- `api/src/aiPrompts.ts`
- `api/src/index.ts`
- `api/src/services/simulationScoring.ts`
- `api/src/services/trainingPackRuntime.ts`
- `api/src/services/scenarioTextNormalization.ts`

Why they matter:

- evaluation prompt composition
- additive guidance layering
- outcome-aware normalization
- server-derived score blending
- desiredOutcome normalization

### API reporting / persistence / freshness

- `api/src/services/scoreRecordAccess.ts`
- `api/src/services/usageSessionAccess.ts`
- `api/src/services/dashboardAttemptDetails.ts`
- `api/src/storage/scoreRecordStore.ts`
- `api/src/storage/usageSessionStore.ts`
- `api/src/services/integrityMaintenance.ts`
- `api/scripts/reset-simulation-baseline.ts`

Why they matter:

- conclusive-only summaries
- success/conclusive semantics
- snapshot refresh support
- safe simulation/reporting-data reset boundary

### Mobile

- `mobile/App.tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/simulationScoreHandling.ts`
- `mobile/src/screens/ScorecardView.tsx`
- `mobile/src/types.ts`

Why they matter:

- handling scored vs `not_scored`
- suppressing bad fallback behavior
- presenting new score fields clearly

### Web / dashboard / admin

- `peritio-web/src/components/DashboardReportingWorkspace.tsx`
- `peritio-web/src/components/CustomerDetailTabs.tsx`
- `peritio-web/app/app/customers/[customerId]/page.tsx`
- `peritio-web/app/app/attempts/[attemptId]/page.tsx`
- `peritio-web/app/app/users/[userId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/page.tsx`
- `peritio-web/app/app/training/[trainingPackId]/assignments/[assignmentId]/page.tsx`
- `admin-web/app/content/page.tsx`
- `admin-web/src/components/EnterpriseCustomScenariosCard.tsx`

Why they matter:

- desiredOutcome editing
- reporting wording cleanup
- attempt/detail display of outcome-aware scores
- more honest conclusive-vs-success framing

### Tests

Important recent coverage lives in:

- `api/src/services/scenarioTextNormalization.test.ts`
- `api/src/services/simulationScoring.test.ts`
- `api/src/services/scoreRecordAccess.test.ts`
- `api/src/services/integrityMaintenance.test.ts`
- `api/src/services/simulationHistory.test.ts`
- `api/src/services/simulationHistoryReadiness.test.ts`
- `api/src/storage/usageSessionStore.test.ts`
- `api/src/storage/scoreRecordStore.test.ts`
- `api/src/services/dashboardAttemptDetails.test.ts`
- `mobile/src/lib/simulationScoreHandling.test.ts`

## Validation Performed During This Chat

The following validation/build commands were run during the recent work:

```powershell
npm.cmd test --workspace api
npm.cmd run build --workspace api
npx.cmd tsc --noEmit -p mobile/tsconfig.json
npm.cmd run build --workspace peritio-web
npm.cmd run build --workspace admin-web
npm.cmd run build --workspace shared
npm.cmd run reset:simulation-baseline --workspace api -- --dry-run --allow-postgres
npm.cmd run reset:simulation-baseline --workspace api -- --allow-postgres
npm.cmd run reset:simulation-baseline --workspace api -- --dry-run --allow-postgres
cd mobile
npx.cmd eas whoami
npx.cmd eas build --platform android --profile preview --non-interactive
```

Important validation outcomes:

- API tests passed
- API build passed
- mobile TypeScript validation passed
- shared/web/admin builds passed
- reset script dry-run and live run both behaved as expected
- fresh EAS Android preview build completed successfully

## What Is Solid Now

The most solid parts of the current system are:

### 1. `desiredOutcome` is now real product state

It exists in:

- standard scenarios
- custom scenarios
- admin flows
- API normalization
- scoring/evaluation context

This is no longer an aspirational field sitting only in product discussions.

### 2. Insufficient evidence is handled honestly

This is one of the cleanest parts of the current system now.

If the user barely engaged:

- no normal score is produced
- no score record is created
- mobile does not quietly synthesize a fake production scorecard

### 3. Outcome-aware scoring is materially better than the old model

The system now has a real distinction between:

- communication quality
- outcome achievement
- completion state
- final overall score

That does not make the model perfect, but it is a major step up in conceptual honesty.

### 4. The main web/admin reporting trust failure was actually fixed

The stale post-purge reporting problem was real.

It is now fixed for the reporting-critical routes that mattered most, which means:

- clean resets actually produce clean main reporting surfaces
- those routes no longer depend on a full API restart to reflect storage truth

### 5. The reset boundary is practical and safe

The project now has a much more operationally useful way to prepare a clean testing baseline without nuking the actual product setup.

## Remaining Risks / Imperfections

The system is much stronger than it was, but it is not “done” in some magical sense.

The most important remaining risks are:

### 1. Outcome truth is still partly model-dependent

Even with server-side normalization:

- `outcomeScore` is still derived from model judgment
- `objectiveAchieved` is still rooted partly in model output

The server now constrains that judgment more intelligently, but it does not eliminate model subjectivity.

### 2. Freshness coverage is not universal

The trust-critical web/admin routes were fixed.

However, some secondary paths still deserve caution, especially:

- some mobile reporting routes
- some org/admin export or analytics routes

Those areas were explicitly identified as outside the fully universal freshness rewrite.

### 3. Legacy rubric fields still matter more than ideal

They remain useful for compatibility, but they still influence:

- communication fallback logic
- some reporting summaries
- strongest/weakest area language
- some coaching-focus derivation

That is acceptable for now, but it is still legacy drag.

### 4. Custom scenario guidance is not perfectly clean semantically

Current reality:

- custom `scoringGuidance` is now correctly additive during evaluation
- but runtime still uses that field in ways that blur “scoring guidance” versus “counterpart behavior pressure”

That is not a blocker, but it is a conceptual seam worth remembering.

### 5. Reporting semantics are improved, not fully normalized

The system is more honest now, but not perfectly uniform.

Examples:

- some score views are billing-period scoped
- some are last-30-day scoped
- some aggregates are customer summaries feeding a higher-level summary

That means interpretation discipline still matters.

## What To Pressure-Test Next

The immediate next step is not another speculative architecture pass.

The immediate next step is disciplined manual testing against the new clean baseline and fresh APK.

Highest-value tests:

1. one- and two-turn sessions that should return `not_scored`
2. short but articulate sessions that should still fail the evidence threshold
3. longer unresolved sessions that should score but cap at `65`
4. clearly successful full sessions that should exceed the unresolved cap
5. standard scenarios with explicit `desiredOutcome`
6. custom scenarios where industry guidance and custom guidance both matter
7. mobile scorecard display of:
   - communication
   - outcome
   - overall
   - completion
   - objective achieved
8. post-reset reporting surfaces in the main web/admin views
9. customer/dashboard semantics when a session is complete-but-unsuccessful
10. any secondary reporting surfaces still suspected of reading stale snapshots

## Final State Judgment

At the end of this chat, the best concise judgment is:

- Peritio's scoring/reporting stack is now fundamentally coherent enough for serious controlled internal testing
- the most dangerous earlier trust failures were real and were addressed directly
- the remaining issues are no longer mostly “basic wiring is broken”
- the remaining issues are now mostly:
  - model-behavior realism
  - reporting-coverage completeness
  - legacy compatibility drag
  - product-interpretation discipline

That is a much healthier place to be.

The right move now is:

- test the current system hard
- gather real transcript/score examples
- see where the outcome-aware model still over- or under-calls success
- then iterate from actual evidence rather than broad speculation
