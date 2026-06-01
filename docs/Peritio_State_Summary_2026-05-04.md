# Peritio State Summary (2026-05-04)

This document records the major work completed after the prior `2026-05-01` state summary.

It is intentionally detailed and handoff-oriented.

This period was centered on one high-stakes product integrity issue:

- Peritio must never show, persist, track, or report fake/local/fallback scorecards as if they are verified performance.

That scorecard/scoring work then led into:

- backend score validation hardening
- `score_records` persistence and schema drift remediation
- Render/Postgres production-readiness verification
- final mobile scorecard state refinement
- mobile bottom CTA / dock visual consistency
- final code backups before the next phase

The most important product truth at the end of this work is:

- verified scores are still displayed normally
- real persisted score recovery still works
- failed scoring no longer produces user-facing fallback score numbers
- sparse/malformed scorer JSON no longer becomes a neutral 50/100 score
- scoring persistence failure no longer pretends success for normal mobile users
- unavailable/failed scores do not create score records for dashboard performance
- early insufficient-evidence endings now show a normal no-scorecard-created state instead of a service-failure error
- the mobile simulation CTA treatment has been visually flattened and aligned with setup and scorecard screens

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `c974f7a`
- latest pushed commit on `main`: `Refine mobile CTA and scorecard states`
- remote: `origin/main`
- local worktree before this summary document was created: clean

Recent pushed commits, newest first:

- `c974f7a` - `Refine mobile CTA and scorecard states`
- `cae7a99` - `Fix score unavailable flow and score record persistence`
- `f51faf1` - `Tighten simulation dock spacing and scroll padding`
- `c39fbe3` - `Consolidate compact simulation status and dock spacing`
- `36cf3af` - `Tighten compact simulation engine and dock spacing`
- `0086883` - `Prioritize transcript space on compact simulation screens`
- `3effd42` - `Compress mobile simulation layout for compact screens`
- `f293519` - `Fix simulation phase rows and compact mobile layout`

Important note:

- this summary document itself was created after `c974f7a`
- unless separately committed later, this document is the only new local change after the last pushed code commit

## Executive Summary

This cycle had five major outcomes.

### 1. Fake fallback scoring was removed from the mobile product path

The old mobile flow could show a local fallback score when authoritative scoring failed.

That behavior was unacceptable because it made a generated/local compatibility score look meaningful to the user.

The product decision implemented in this cycle is:

- if authoritative scoring fails and no real persisted score can be recovered, the final review page still renders
- it shows a clear score-unavailable state
- it does not show any score numbers
- it does not show legacy rubric/category score cards
- it does not pretend a failed score is valid
- it does not persist or report fallback values

The user can still:

- see the session/scenario header
- download/share transcript through the existing consent path
- submit a support/report issue from the final page
- run another simulation

### 2. Backend scoring validation now rejects sparse or malformed scorer output

The backend scoring normalization path previously had a dangerous edge case:

- sparse evaluator JSON like `{}` could normalize into a neutral score around 50/100

That was fixed.

Required scoring fields are now validated before normalization and persistence.

If evaluator output is missing required fields, malformed, or out of range:

- scoring fails safely
- no neutral fake score is persisted
- the route does not mark the session as scored
- mobile enters score unavailable or not scored depending on the state

### 3. `score_records` Postgres schema drift was identified as the likely original root cause

The original real-device event likely happened because:

- authoritative scoring may have succeeded
- but persistence into Postgres `score_records` may have failed
- mobile recovery then had no persisted score to retrieve
- the old mobile fallback path filled the gap with a local fake score

The persistence audit found a concrete risk:

- the Postgres `CREATE TABLE IF NOT EXISTS score_records` definition had the current full column list
- but the startup `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration block only covered a subset of newer columns
- an older production/staging table could therefore be missing columns that current append/select/recovery code expected

The migration coverage was expanded so existing tables are upgraded at startup instead of only fresh databases being correct.

### 4. Render/Postgres production-readiness checks were completed

After local code-level verification, production/staging database and Render logs were manually checked.

Verified by the user:

- `score_records` schema audit: all OK
- `id` primary key exists
- `simulation_session_id` index exists
- no matching scoring/persistence error logs in Render from the last 2 days
- final Render/Postgres scoring smoke verification completed and was good to go

This means the suspected schema drift class is now addressed in code and did not remain visible in the checked Render environment.

### 5. Mobile scorecard state and bottom CTA visuals were refined after APK screenshots

Two final mobile refinements landed:

1. Insufficient evidence now shows normal no-scorecard-created copy instead of a service-failure message.
2. The simulation screen bottom CTA dock was visually flattened to match setup and scorecard bottom CTA treatment.

The current mobile review flow now distinguishes:

- `scored`
- `scoring_in_progress`
- `score_unavailable`
- `not_scored`

This matters because:

- `score_unavailable` means a verified score could not be created due to a service/scoring/persistence/recovery failure
- `not_scored` with insufficient evidence means the user ended too early for a scorecard

Those are different product states and now have different copy.

## Product Decision Captured

The scorecard product decision is now encoded as an implementation principle:

Peritio may show:

- a verified authoritative score
- a recovered real persisted authoritative score
- a score unavailable state
- a normal no-scorecard-created state for insufficient evidence

Peritio must not show:

- a fake local fallback score
- a deterministic generated score when authoritative scoring failed
- fallback communication/outcome scores
- fallback completion/objective values
- fallback legacy rubric category values
- compatibility score categories as a substitute for verified scoring
- "practice-only fallback score" copy

Peritio must not persist/report:

- fallback score values
- synthetic scores created by the client
- sparse evaluator output normalized into neutral values
- scoring failures as dashboard performance

## Detailed Work Completed

## Part 1 - Mobile Fallback Score Audit

### Audit Scope

The mobile scorecard/scoring path was audited across:

- mobile session completion path
- mobile score handling helpers
- `ScorecardView`
- final Session Review render state
- API scoring route
- backend scoring normalization
- OpenAI evaluator response parsing
- score record append/persistence
- score recovery by `simulationSessionId`
- dashboard/summary aggregation
- logging and diagnostics

The audit focused on these questions:

- where fallback scores came from
- whether they were deterministic/local
- whether they were displayed only or persisted
- whether they could leak to dashboards
- what caused fallback selection
- whether scoring failure still rendered the final page
- whether support/report issue remained available
- whether logs were safe and actionable

### Key Audit Finding

The old fallback behavior lived on the mobile side.

The fallback scorecard was local/deterministic behavior used to keep the review page populated when authoritative scoring failed.

Even if it was framed as practice-only and not intended for tracking, it was still user-facing as a numeric score.

That violated the product rule:

- failed verified scoring must not be hidden behind fake score values

### Important Risk Found

The backend also had a separate but related integrity risk:

- sparse or malformed evaluator JSON could normalize into plausible-looking scores

This meant the product needed both:

- mobile fallback display removal
- backend scorer payload validation

Without both, fake or invalid scores could still appear through different paths.

## Part 2 - Mobile Score-Unavailable Implementation

### Mobile State Model

The mobile scoring state model now includes:

- `scoring_in_progress`
- `scored`
- `score_unavailable`
- `not_scored`

Relevant files:

- `mobile/src/types.ts`
- `mobile/App.tsx`
- `mobile/src/lib/simulationScoreHandling.ts`
- `mobile/src/lib/scorecardViewModel.ts`
- `mobile/src/screens/ScorecardView.tsx`

### Verified Score Path

When authoritative scoring succeeds:

- `status: "scored"` is returned
- scorecard values display normally
- overall score displays
- communication/outcome display
- completion/objective display
- legacy compatibility rubric cards display
- coaching details display
- score metadata updates the transcript support metadata

This behavior was preserved.

### Score Unavailable Path

When authoritative scoring fails and no real persisted score can be recovered:

- mobile sets `score_unavailable`
- `scorecard` remains `null`
- the Session Review page still renders
- no numeric score cards render
- no legacy rubric/category cards render
- support/report issue remains available
- Run Another Simulation remains available

User-facing copy:

- title: `We couldn't generate a score for this session.`
- body: `Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported.`

### Real Persisted Recovery Path

Recovery remains allowed only for a real persisted score record.

Good path:

- primary score POST creates and persists a score record
- response is lost or client times out
- mobile GET recovery by `simulationSessionId` finds the persisted score
- mobile displays that verified score

Rejected path:

- primary scoring failed
- no persisted authoritative score exists
- mobile or backend creates a synthetic score

The rejected path is no longer allowed.

## Part 3 - Backend Scoring Validation

### Problem

Before this cycle, `normalizeSimulationScorecard` could make incomplete evaluator output look usable.

Example risk:

- evaluator returns `{}`
- normalizer applies defaults/fallbacks
- score appears as neutral or plausible

That is not acceptable for authoritative scoring.

### Fix

Backend scoring now validates required evaluator fields before normalization.

Relevant files:

- `api/src/services/simulationScoring.ts`
- `api/src/services/simulationScoring.test.ts`
- `api/src/index.ts`

New/updated behavior:

- `assertValidSimulationScorePayload` checks required fields
- `SimulationScorePayloadValidationError` represents invalid evaluator payloads
- `POST /mobile/users/:userId/ai/score` calls validation before normalization
- invalid payloads fail safely
- invalid payloads are not persisted

### Required Field Principle

If a scoring response is missing required authoritative fields, it is not a score.

The backend now treats these as failed/unavailable:

- `{}`
- missing overall score
- missing communication score
- missing outcome score
- invalid score ranges
- malformed JSON
- incomplete completion/objective fields
- incomplete rubric category scores

### Behavior Preserved

Valid scorer JSON still normalizes and persists correctly.

The valid scoring rubric behavior was not broadly rewritten.

## Part 4 - Score Record Persistence Audit And Fix

### Initial Hypothesis

After fallback display was removed, the likely original incident cause became clearer:

- authoritative scoring probably succeeded
- then score record persistence may have failed
- recovery could not find a persisted score
- the old mobile code showed a fake fallback score

The most likely backend cause was schema drift in Postgres `score_records`.

### Persistence Path Audited

The audit covered:

- `POST /mobile/users/:userId/ai/score`
- score payload validation
- `normalizeSimulationScorecard`
- `scoreRecordAccess.append`
- `scoreRecordStore`
- Postgres `score_records` insert/select
- file/in-memory score record store behavior
- schema/migration definitions
- recovery compatibility
- dashboard aggregation
- error handling around persistence failure

### Concrete Bug Class Found

The Postgres `score_records` store had:

- a full current `CREATE TABLE IF NOT EXISTS` definition
- but incomplete `ALTER TABLE ADD COLUMN IF NOT EXISTS` coverage

This is safe for fresh databases.

It is not safe for older databases.

If production/staging had an older table, startup would not add every column current code needed.

That could break:

- `INSERT INTO score_records`
- `SELECT ... FROM score_records`
- recovery by `simulationSessionId`
- dashboard aggregation requiring newer fields

### Migration Fix

The startup migration now adds every current non-`id` column used by append/select/recovery.

Covered columns include:

- `simulation_session_id`
- `user_id`
- `org_id`
- `division_id`
- `segment_id`
- `scenario_id`
- `training_id`
- `training_pack_id`
- `industry_id`
- `started_at`
- `ended_at`
- `communication_score`
- `outcome_score`
- `overall_score`
- `completion_level`
- `objective_achieved`
- `persuasion`
- `clarity`
- `empathy`
- `assertiveness`
- `summary`
- `coaching_artifact`
- `normalized_coaching_themes`
- `rubric_version`
- `model`
- `prompt_version`
- `input_tokens`
- `output_tokens`
- `total_tokens`
- `created_at`

Relevant file:

- `api/src/storage/scoreRecordStore.ts`

### Insert Placeholder Verification

The Postgres insert path was checked for:

- placeholder count
- placeholder numbering
- column/value order
- JSONB casts
- timestamp casts
- optional nullable fields
- token fields
- `ON CONFLICT (id)` compatibility

The local schema contract check showed:

```json
{
  "expectedColumnCount": 31,
  "alterCount": 30,
  "insertColumnCount": 31,
  "selectColumnCount": 31,
  "missingAlter": [],
  "missingInsert": [],
  "missingSelect": [],
  "highestPlaceholder": 31,
  "uniquePlaceholderCount": 31,
  "placeholderSequenceOk": true
}
```

`id` is intentionally not part of `ALTER TABLE ADD COLUMN` because it is created as the table primary key.

### Persistence Failure Policy

The route now fails closed for normal mobile users if score persistence fails.

If scoring succeeds but `scoreRecordAccess.append` fails:

- the route returns `503`
- no verified success response is returned
- mobile enters score unavailable/recovery flow
- dashboard does not get a score record
- logs include safe persistence metadata

Relevant file:

- `api/src/index.ts`

Safe log:

- `[simulation-score-persist-failed]`

Metadata includes safe fields such as:

- route
- correlation id
- session id
- simulationSessionId
- user id
- org id
- segment id
- scenario id
- scoring stage
- error category
- reason

It does not include transcript text or audio.

### Superuser Caveat

Superuser mobile contexts intentionally skip score persistence.

That means:

- superuser scoring is not a valid smoke test for score record persistence
- production/staging score persistence smoke tests must use a normal mobile user

This caveat was explicitly documented in the Render/Postgres runbook.

## Part 5 - Recovery Compatibility

### Recovery Endpoint

Recovery path:

- `GET /mobile/users/:userId/ai/score?simulationSessionId=...`

Relevant files:

- `api/src/index.ts`
- `api/src/services/mobileScoreRecovery.ts`
- `api/src/services/mobileScoreRecovery.test.ts`

### Recovery Requirements

Recovered records must have real authoritative fields:

- numeric communication score
- numeric outcome score
- numeric overall score
- valid completion level
- boolean objective achieved
- numeric persuasion/clarity/empathy/assertiveness scores

Sparse/incomplete records are rejected.

They are not repaired.

They are not filled with fallback values.

### Recovery Result Shape

Recovered authoritative score returns:

- `status: "scored"`
- `scorecard`
- record metadata
- model/prompt/rubric metadata where available
- usage token fields where available

This matches what mobile expects.

## Part 6 - Dashboard And Performance Integrity

### Dashboard Risk

The key risk was that failed scoring attempts or fallback scores could pollute:

- user score summaries
- org analytics
- dashboard attempt details
- training progress
- assignment scoring summaries

### Confirmed Behavior

Dashboard/reporting continues to consume score records.

Failed/unavailable scoring attempts that do not create `score_records` rows are not counted as scored performance.

Not-scored/insufficient-evidence attempts do not create score records.

Usage/session accounting can still happen according to existing usage-session behavior, but performance scoring requires a real score record.

Relevant files:

- `api/src/services/scoreRecordAccess.ts`
- `api/src/services/scoreRecordAccess.test.ts`
- `api/src/services/simulationHistory.ts`
- `api/src/services/simulationHistory.test.ts`
- `api/src/services/dashboardAttemptDetails.test.ts`

## Part 7 - Production/Staging Render/Postgres Verification

### Code-Level Verification

Local checks showed:

- schema contract matches current append/select/recovery code
- migration coverage is complete for current columns
- insert placeholder sequence is correct
- file store and Postgres mocked store tests pass
- recovery rejects incomplete records
- dashboard summaries ignore failed no-record sessions

### Manual Render/Postgres Verification

The local shell did not have production/staging DB credentials or log access.

A manual Render/Postgres verification runbook was provided.

It included:

- SQL to inspect `information_schema.columns`
- SQL to verify primary key constraints
- SQL to verify indexes
- drift detection criteria
- Render log searches
- normal mobile-user scoring smoke test
- score row lookup by `simulation_session_id`
- recovery GET verification
- not-scored no-row verification

The user then verified:

- `score_records` schema audit: all OK
- `id` primary key exists
- `simulation_session_id` index exists
- no matching scoring/persistence error logs in Render from the last 2 days
- final Render/Postgres smoke test completed successfully

### Go/No-Go Outcome

After those checks:

- backend score persistence/schema state is good to go
- preview APK/device validation can proceed
- ongoing monitoring should continue after each deploy

## Part 8 - Mobile Scorecard State Refinement

### Problem

After fallback removal, early end / insufficient evidence was still showing the wrong copy:

```text
We couldn't generate a score for this session.
Your simulation completed, but the scoring service failed before a verified score could be created. No score was saved or reported.
```

That was wrong when the user ended too early.

It made a normal no-scorecard-created state look like a system failure.

### Fix

The mobile client now distinguishes:

- true scoring/service failure: `score_unavailable`
- insufficient evidence: `not_scored`

For insufficient evidence, the scorecard view now shows:

```text
No scorecard created

This session ended before there were enough user responses to generate a verified scorecard.
Complete at least 3 user responses before ending the session.
```

### Client-Side Early Classification

The client now counts user responses before calling scoring.

If there are fewer than 3 user responses:

- mobile sets `not_scored`
- it does not show the artificial scoring delay
- it does not call scoring just to receive the known insufficient-evidence result
- backend still remains authoritative for actual scoring enforcement

Relevant file:

- `mobile/src/lib/simulationScoreHandling.ts`

New helper:

- `countUserResponsesForVerifiedScorecard`

Constant:

- `MIN_USER_RESPONSES_FOR_VERIFIED_SCORECARD = 3`

### Scorecard View Model

Relevant file:

- `mobile/src/lib/scorecardViewModel.ts`

The view model now outputs distinct copy and support wording for:

- scored
- score unavailable
- not scored
- scoring in progress

For `not_scored`:

- no score numbers render
- no legacy rubric cards render
- transcript actions render
- support actions render
- Run Another Simulation renders
- support copy does not imply something went wrong

For `score_unavailable`:

- no score numbers render
- no legacy rubric cards render
- service-failure copy remains honest
- support issue affordance remains available

## Part 9 - Mobile Bottom CTA / Dock Visual Consistency

### Problem

Real-device APK screenshots showed inconsistent CTA treatment across:

1. Setup screen
2. Simulation screen
3. Scorecard/review screen

Observed:

- setup CTA looked relatively clean
- scorecard CTA looked relatively clean
- simulation CTA sat inside an extra little panel/card/dock
- simulation felt heavier and visually inconsistent
- some screens still had uneven space above the CTA

### Root Cause

The simulation screen had:

- outer dock padding
- inner action dock
- inner dock background
- top border
- rounded top corners
- shadow/elevation
- separate horizontal inset
- ScrollView compensation based on measured dock height

Setup and scorecard did not use that heavy panel treatment.

They place the CTA directly in the app safe-area width.

### Fix

The simulation CTA region was visually flattened.

Removed from the simulation CTA treatment:

- extra panel background
- rounded top container/card feel
- top border
- shadow/elevation
- extra inner horizontal inset

Preserved:

- sticky CTA behavior
- one-button state
- two-button state
- disabled/busy state
- small-phone behavior
- tablet behavior
- no content overlap

Relevant files:

- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/lib/simulationScreenLayout.ts`
- `mobile/src/lib/simulationScreenLayout.test.ts`

### Setup CTA Alignment

The setup screen now uses a small bottom action region:

- `bottomActionRegion`
- `bottomPrimaryButton`
- tighter setup scroll bottom padding
- setup error text lives inside the bottom action region

Relevant file:

- `mobile/App.tsx`

### Scorecard CTA Alignment

The scorecard screen kept its clean direction but was tuned to match the unified CTA rhythm:

- reduced scroll bottom padding
- tightened footer top spacing
- preserved Run Another Simulation behavior

Relevant file:

- `mobile/src/screens/ScorecardView.tsx`

### Safe Area And Scroll Compensation

The parent app-level `SafeAreaView` owns bottom safe-area handling.

Simulation now passes:

- `parentAppliesBottomSafeArea: true`

This prevents bottom inset double counting.

Scroll bottom padding is now a small fixed content gap because the CTA is in normal layout flow, not overlaying the ScrollView.

This means:

- no big blank compensation slab
- no overlap
- no duplicated safe-area padding
- setup/simulation/scorecard bottom spacing feels more related

## Files Changed In This Cycle

### Backend/API

- `api/src/index.ts`
- `api/src/services/simulationScoring.ts`
- `api/src/services/simulationScoring.test.ts`
- `api/src/services/mobileScoreRecovery.ts`
- `api/src/services/mobileScoreRecovery.test.ts`
- `api/src/services/scoreRecordAccess.test.ts`
- `api/src/storage/scoreRecordStore.ts`
- `api/src/storage/scoreRecordStore.test.ts`

### Mobile

- `mobile/App.tsx`
- `mobile/src/types.ts`
- `mobile/src/screens/ScorecardView.tsx`
- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/lib/simulationScoreHandling.ts`
- `mobile/src/lib/simulationScoreHandling.test.ts`
- `mobile/src/lib/scorecardViewModel.ts`
- `mobile/src/lib/scorecardViewModel.test.ts`
- `mobile/src/lib/simulationScreenLayout.ts`
- `mobile/src/lib/simulationScreenLayout.test.ts`

### Docs / Backups

- `docs/Peritio_State_Summary_2026-04-22.md`
- `docs/Peritio_State_Summary_2026-04-23.md`
- `docs/Peritio_State_Summary_2026-05-01.md`
- `docs/Peritio_State_Summary_2026-05-04.md`

## Validation Completed

### Backend/API Validation

The following checks passed during the backend persistence/schema work:

```text
npm.cmd run build --workspace api
npx.cmd tsx api/src/storage/scoreRecordStore.test.ts
npx.cmd tsx api/src/services/scoreRecordAccess.test.ts
npx.cmd tsx api/src/services/mobileScoreRecovery.test.ts
npx.cmd tsx api/src/services/simulationScoring.test.ts
npx.cmd tsx api/src/services/simulationHistory.test.ts
npx.cmd tsx api/src/services/dashboardAttemptDetails.test.ts
node scripts/test-critical-flow.mjs
git diff --check
```

`git diff --check` produced CRLF warnings only, no whitespace errors.

### Mobile Validation

The following mobile checks passed during the scorecard/CTA refinement work:

```text
npx.cmd tsc --noEmit -p mobile/tsconfig.json
npx.cmd tsx mobile/src/lib/simulationScreenLayout.test.ts
npx.cmd tsx mobile/src/lib/scorecardViewModel.test.ts
npx.cmd tsx mobile/src/lib/simulationScoreHandling.test.ts
npx.cmd tsx mobile/src/lib/simulationInteractionModel.test.ts
npx.cmd tsx mobile/src/lib/simulationDiagnostics.test.ts
npx.cmd tsx mobile/src/lib/voiceOrbLayout.test.ts
git diff --check
```

`git diff --check` produced CRLF warnings only, no whitespace errors.

### Render/Postgres Validation

Manually verified by the user:

- score records schema audit all OK
- `id` primary key exists
- `simulation_session_id` index exists
- no matching score persistence/scoring error logs in Render from the last 2 days
- real staging/dev scoring smoke test completed successfully

## Current Behavior Matrix

### Normal Verified Score

Trigger:

- scoring succeeds
- score record persists successfully

User sees:

- overall score
- communication score
- outcome score
- completion/objective state
- legacy rubric category cards
- strengths/improvements/coaching summary
- transcript card
- support card
- Run Another Simulation

Data behavior:

- score record exists
- dashboard can consume it
- usage/session behavior remains unchanged

### Persisted Recovery

Trigger:

- score was created and persisted
- live response was interrupted or client missed it
- recovery GET finds the real record by `simulationSessionId`

User sees:

- verified score
- recovery warning copy
- normal scorecard details

Data behavior:

- no fake score
- recovered score is real persisted data

### Score Unavailable

Trigger examples:

- OpenAI upstream failure
- model timeout
- malformed scorer response
- scorer payload validation failure
- score persistence failure
- recovery miss after failed scoring
- network or route failure where no persisted score exists

User sees:

- `We couldn't generate a score for this session.`
- service-failure body copy
- no score numbers
- no rubric cards
- transcript card
- support/report issue affordance
- Run Another Simulation

Data behavior:

- no fallback score persisted
- no score record created for failed scoring
- dashboard performance is not polluted

### Not Scored / Insufficient Evidence

Trigger:

- fewer than 3 real user responses before ending session

User sees:

- `No scorecard created`
- insufficient-evidence body copy
- no score numbers
- no rubric cards
- transcript card
- support feedback affordance
- Run Another Simulation

Data behavior:

- no score record created
- dashboard performance is not polluted
- usage/session behavior remains according to existing usage-session policy

### Local Mock Mode

Trigger:

- local/test simulation mode

User sees:

- score unavailable copy appropriate to local mode
- no fake score

Data behavior:

- no verified score record from local mock scoring

## Logging And Diagnostics

### Safe Logs Added/Confirmed

Important safe log markers:

- `[simulation-score-persist-failed]`
- `[simulation-score-failed]`
- `[ai-responses-error]`
- `[ai-simulation]`
- `[simulation-no-transcript]`

The persistence failure log includes metadata only.

It should be sufficient to diagnose:

- route/stage
- correlation id
- simulation session id
- scenario/segment id
- user/org id where safe
- scoring failure category
- persistence failure reason

### Content Boundary

No new logs were added that include:

- transcript text
- audio
- personal user content

Support transcript sharing remains behind the existing explicit consent path.

## Build / APK Command

The preview APK command remains:

```powershell
cd mobile
npx.cmd eas-cli build --platform android --profile preview
```

The `preview` profile in `mobile/eas.json` is configured with:

- `distribution: internal`
- Android `buildType: apk`
- `EXPO_PUBLIC_REMOTE_AI_ENABLED=true`
- `EXPO_PUBLIC_REMOTE_TTS_ENABLED=true`
- `EXPO_PUBLIC_API_BASE_URL=https://voicepractice-api-dev.onrender.com`

## Backups Created

Two backups were created during this cycle.

### PreScoreCardFix_NoFallBack Backup

Path:

```text
C:\Users\Robert\Desktop\Visual_Studio_Apps\BackUps\PreScoreCardFix_NoFallBack_050426
```

Commit captured:

```text
cae7a99d43e05527bf0150d16ac2b69e0554d180
```

Approximate size:

```text
1.35 GB
```

Backup mode:

- code backup with `.git`
- excluded bulky/generated folders and logs

Manifest:

- `BACKUP_MANIFEST.txt`

### Final Pre-iOS Conversion Backup

Path:

```text
C:\Users\Robert\Desktop\Visual_Studio_Apps\BackUps\FINAL_PreIOSconversion_050426
```

Commit captured:

```text
c974f7ac1efff7d915a833d550747dc096a46388
```

Approximate size:

```text
2.37 GB
```

Backup mode:

- full repository folder copy
- includes `.git`
- includes ignored/generated content
- includes build folders
- includes logs
- includes dependencies
- uses `/XJ` to avoid following junction/reparse links

Manifest:

- `BACKUP_MANIFEST.txt`

## Important Boundaries Preserved

This cycle did not intentionally change:

- auth rules
- tenant isolation
- scoped config behavior
- dashboard access controls
- scoring rubric intent
- valid score normalization behavior beyond rejecting malformed/sparse payloads
- usage/billing policy
- customer dashboard aggregation semantics except preserving score integrity
- OpenAI model selection
- transcript/audio logging policy

The work intentionally avoided:

- broad scoring architecture rewrites
- hiding failures with fake values
- weakening fail-closed behavior
- logging sensitive content
- treating failed score attempts as scored performance

## Known Caveats And Residual Risks

### 1. APK visual validation still matters

The CTA and scorecard state changes passed TypeScript and helper tests.

They still need real-device screenshot validation because:

- safe-area behavior differs by Android device
- nav bar/inset behavior can vary
- perceived spacing depends on actual viewport height
- iOS safe area will differ later

Manual validation should focus on:

- setup bottom CTA spacing
- simulation pre-start one-button CTA
- simulation active two-button CTA
- scorecard Run Another Simulation CTA
- small phone
- larger phone
- tablet/large viewport if available

### 2. iOS conversion may re-open safe-area details

The current mobile app uses Expo/React Native and app-level `SafeAreaView`.

iOS conversion/testing should specifically check:

- bottom safe-area with home indicator
- keyboard avoidance
- microphone permission copy
- audio recording lifecycle
- background/lock behavior
- TTS playback behavior
- sticky bottom CTA spacing
- scorecard review footer spacing

### 3. Render logs should continue to be monitored after deploys

Even after schema verification, keep watching:

- `[simulation-score-persist-failed]`
- `[simulation-score-failed]`
- `invalid_score_payload`
- `score_generation_failed`
- `score_records`
- `column does not exist`
- `ON CONFLICT`
- `bind message supplies`
- `Recoverable score not found`

### 4. Superuser smoke tests do not validate persistence

Superuser scoring intentionally skips score persistence.

All future score persistence smoke tests must use a normal mobile user.

### 5. Dashboard integrity depends on score record discipline

The current system is safe because failed/unavailable scoring does not create score records.

Future work should preserve that rule.

## Recommended Next Steps

### Immediate

1. Build a new preview APK from `main` at `c974f7a`.

   ```powershell
   cd mobile
   npx.cmd eas-cli build --platform android --profile preview
   ```

2. Install on the same Android device used for screenshots.

3. Validate CTA consistency:

   - setup screen
   - simulation pre-start
   - simulation active two-button
   - scorecard success
   - scorecard not-scored
   - scorecard score-unavailable if force-failure is practical

4. Validate score states:

   - normal scoring success
   - early end with fewer than 3 user responses
   - score recovery after persisted score if possible
   - support/report issue button remains visible

5. Check Render logs after test sessions.

### Before iOS Conversion

1. Keep the `FINAL_PreIOSconversion_050426` backup untouched.
2. Confirm latest Android APK visual pass is acceptable.
3. Confirm no new Render scoring/persistence errors after APK tests.
4. Confirm `main` is clean and pushed.
5. Decide iOS bundle/package identity and Apple developer provisioning approach.

### iOS Conversion / Validation Plan

The next major phase should be iOS readiness and device validation.

Suggested work order:

1. Audit Expo/iOS config:

   - `mobile/app.json`
   - iOS bundle identifier
   - microphone permission strings
   - EAS project config
   - build profiles

2. Create or confirm iOS EAS profile:

   - internal preview build
   - correct API base URL
   - remote AI enabled
   - remote TTS enabled if desired

3. Build iOS preview.

4. Validate iOS device flows:

   - onboarding/login token behavior
   - scoped config load
   - setup screen
   - simulation start
   - microphone permission
   - transcription path
   - active turn submit
   - app background/foreground privacy behavior
   - end session and score
   - score unavailable
   - insufficient evidence
   - support report with transcript consent

5. Re-check bottom CTA safe-area behavior specifically on:

   - iPhone with home indicator
   - smaller iPhone if available
   - large iPhone if available

6. Run the same backend smoke checks after iOS scoring.

### Longer-Term Follow-Ups

These are not blockers for the current go-forward state, but they are useful future hardening:

- add a small route-level integration test for score persistence failure returning 503
- add a mobile render-level test harness if the project adopts one later
- create an operator script for Render score smoke tests
- add a documented staging test user and scenario id process
- continue consolidating bottom CTA patterns if more screens are added
- consider shared mobile CTA tokens/helpers after the design settles on both Android and iOS

## Final Current State

Peritio is now in a much stronger state than at the beginning of this cycle.

The scoring path is no longer allowed to hide failures behind fake local scores.

The backend no longer accepts sparse scorer output as if it were a real score.

The likely `score_records` schema drift cause has been remediated and manually checked against Render/Postgres.

Mobile now shows:

- verified score when verified score exists
- recovered score only when a real persisted score exists
- score unavailable when verified scoring fails
- no scorecard created when the user ends too early

The final mobile CTA treatment is also cleaner and more consistent across:

- setup
- simulation
- scorecard/review

The next work is no longer a score integrity remediation cycle.

The next work should be:

- build and validate the updated Android preview APK
- then begin the iOS conversion/validation phase from the final backup and pushed `main`
