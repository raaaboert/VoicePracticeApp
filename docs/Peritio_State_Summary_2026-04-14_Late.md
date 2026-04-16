# Peritio State Summary (2026-04-14 Late Update)

This document is the follow-up checkpoint after the earlier `Peritio_State_Summary_2026-04-14.md`.

It covers everything completed after that prior summary, with special emphasis on:

- the finalization and push of the live simulation latency work
- the immediate post-simulation score-save failure that surfaced afterward
- the exact backend root cause of that score persistence failure
- the narrowly scoped fix that was implemented and pushed
- current repo/runtime state
- the most sensible next steps from here

This is intended to be a handoff-quality state document, not a short changelog.

## Current Baseline

As of the end of this update:

- branch: `main`
- current `HEAD`: `1269c2b`
- latest pushed commit on `main`: `Fix score record persistence SQL`

Recent pushed commits, newest first:

- `1269c2b` — `Fix score record persistence SQL`
- `0d57fa2` — `Speed up live simulation turn pipeline`
- `8c3ca53` — `Refactor scorecards and fix reporting freshness`

Current local worktree note:

- the repo is functionally clean except for two older docs still untracked locally:
  - `docs/Peritio_State_Summary_2026-04-02.md`
  - `docs/Peritio_State_Summary_2026-04-11.md`
- those older docs were intentionally left out of recent commits

Most important operational truth right now:

- the major live simulation latency work is now pushed
- the urgent score persistence bug discovered afterward is also fixed and pushed
- the next APK should be built from the current `main` branch state, not the older pre-fix mobile build

## Executive Summary

Since the earlier `2026-04-14` state summary, two major things happened:

1. the live simulation latency work that had been locally implemented was finalized and pushed as `0d57fa2`
2. an urgent production-blocking post-simulation failure was then discovered, audited, fixed, validated, and pushed as `1269c2b`

The live simulation architecture is now meaningfully tighter than it was before:

- the main manual-submit path uses a unified route
- session-scoped runtime/prompt caching is in place
- first-audio timing is improved
- later chunks are prepared earlier
- timing visibility is better

But immediately after that improvement, a new high-priority failure surfaced:

- a completed simulation would finish
- score generation would succeed
- but the scorecard screen would show the error:
  - `"Score was generated but could not be saved. Please retry once the service is healthy. No local fallback score was shown."`

That turned out not to be a latency regression.

It was a backend Postgres SQL bug in the extracted `score_records` persistence path:

- the score route generated the scorecard successfully
- then failed when trying to write the `score_records` row
- because the Postgres insert/upsert SQL had malformed placeholder numbering and tail casting

That bug is now fixed and guarded by a regression test.

The best concise state judgment now is:

- live simulation responsiveness is materially improved
- the major urgent score-save blocker is fixed
- current pushed state is suitable for a fresh APK build and real-device verification
- the next strongest work should be evidence-led latency tuning from real unified-submit traces, not another broad architecture pass

## What The Previous 2026-04-14 Summary Captured

The earlier `Peritio_State_Summary_2026-04-14.md` captured the live simulation latency program while it was still primarily a **local engineering checkpoint**.

At that time, the important truths were:

- the live-turn pipeline had been deeply audited
- the first latency pass had already improved first audio and text/speech synchronization
- the second major pass had implemented:
  - unified manual submit
  - session-scoped runtime/prompt caching
  - later-chunk preparation improvements
  - stronger timing instrumentation
- but the summary still reflected that work as newer local state after the previously pushed `8c3ca53`

So this late update starts where that document left off:

- from “major latency work implemented and validated locally”
- to “major latency work pushed”
- then into the urgent score persistence incident and fix

## Chronological Timeline Since The Previous Summary

### 1. Live Simulation Latency Work Was Finalized And Pushed

After the earlier `2026-04-14` summary was written, the live simulation latency work was committed and pushed:

- commit: `0d57fa2`
- message: `Speed up live simulation turn pipeline`

That commit represented the main live-turn responsiveness pass.

At a high level, it introduced:

- unified manual submit on the main mobile path
- session-scoped runtime/prompt caching on the server
- better chunk preparation for longer spoken replies
- stronger timing visibility across submit -> reply -> first audio

This was the commit that materially improved simulation feel.

### 2. Follow-Up Audit Focused On Remaining Latency

After the push, a focused read-only audit was done to identify what remained most worth attacking next.

The strongest conclusions from that follow-up audit were:

- the single biggest remaining latency bucket was now the server-internal serial AI phase inside unified submit:
  - transcription
  - model generation
  - first-chunk speech prefetch
- the session cache was already covering most of the session-stable prompt/runtime artifacts
- the main expensive work still rebuilt per turn was now mostly the truly turn-specific work:
  - auth/access/entitlement checks
  - history normalization
  - transcript echo suppression
  - model generation
  - first-chunk speech prefetch
- later-chunk continuity was improved, but still secondary to the front-half/server-side serial chain

That mattered because it confirmed the latency architecture was healthier now and that the next round should be small and evidence-led rather than another big speculative rewrite.

### 3. Fresh APK Guidance Was Reconfirmed

After the pushed latency work, the user asked for the current Android APK build command.

The guidance remained:

```powershell
cd mobile
npx.cmd eas build --platform android --profile preview --non-interactive
```

This mattered operationally because the mobile app had meaningful client-side simulation changes and needed a new build to reflect the current codebase.

### 4. Urgent Post-Simulation Failure Surfaced

Immediately after the latency improvements, a new high-priority issue was reported:

- after finishing a live simulation
- instead of showing the scorecard
- the mobile app showed the banner:
  - `"Score was generated but could not be saved. Please retry once the service is healthy. No local fallback score was shown."`

Observed context from the report:

- scenario: `Solar Door-to-door - Don't have time right now`
- role / difficulty / persona: `Sales Representative | Medium | Skeptical`

This became the next urgent engineering task.

### 5. Full Read-Only Audit Of The Score Generation / Save Path

Before changing any code, the scorecard failure was traced end to end.

The audit focused on:

- simulation completion on mobile
- mobile score-generation request path
- mobile post-scorecard navigation behavior
- backend `/mobile/users/:userId/ai/score` route
- score persistence layer
- AI usage event persistence
- training-pack assignment side effects
- audit-event side effects
- why no local fallback score was shown

Important mobile-side files inspected:

- `mobile/App.tsx`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/api.ts`

Important backend files inspected:

- `api/src/index.ts`
- `api/src/services/scoreRecordAccess.ts`
- `api/src/storage/scoreRecordStore.ts`
- `api/src/storage/aiUsageEventStore.ts`
- `api/src/storage/auditEventStore.ts`
- `api/src/services/simulationHistory.ts`

Key mobile-side findings:

- the app does **not** require a previously persisted score record in order to render a scorecard
- if the backend returns a proper scored payload, mobile can render from the returned scorecard directly
- the “No local fallback score was shown” text is currently expected behavior in this failure mode, not a separate bug
- mobile only lands on that error-banner scorecard state because the backend returns a non-2xx response after generation

Key backend findings:

- score generation itself was succeeding
- the failure was definitely happening **inside the persistence block after generation**
- the route was catching that persistence failure and returning:
  - `"Score was generated but could not be saved. Please retry once the service is healthy."`

In other words:

- generation succeeded
- persistence failed
- mobile showed the generic save-failure banner because that is exactly what the backend returned

### 6. Initial Suspects That Were Investigated And Ruled Out

Several plausible suspects were checked first because they fit the general shape of “generation succeeded, save failed.”

These included:

- AI usage event duplicate-id collision
- training-pack assignment lifecycle sync throwing
- audit-event persistence throwing on queued metadata
- missing simulation session linkage
- mobile contract mismatch between generated score and saved score record

Important conclusion from that audit:

- AI usage events already upsert correctly
- audit events were not the cleanest match
- training-pack sync did not immediately look like the primary culprit
- the problem was more likely in the score-record persistence path itself

### 7. Exact Root Cause Identified

The exact root cause was found in:

- `api/src/storage/scoreRecordStore.ts`

Specifically:

- the Postgres `INSERT INTO score_records ... VALUES (...)` statement had malformed placeholder numbering after the scorecard/reporting refactor work

The broken SQL had:

- 31 placeholders referenced
- only 30 values bound
- an incorrect `::jsonb` cast on the wrong placeholder in the tail of the insert
- `created_at` expecting a nonexistent `$31::timestamptz`

The relevant broken tail previously looked like:

```sql
$22, $23::jsonb, $24::jsonb, $25, $26, $27, $28, $29, $30, $31::timestamptz
```

But the actual bound value list only had 30 values, ending with:

- `$30` -> `record.createdAt`

So the backend could:

- generate the scorecard successfully
- construct the `SimulationScoreRecord`
- reach `scoreRecordAccess.append(db, record)`
- then fail on the malformed Postgres insert before returning the scored payload

This was exactly consistent with the user-facing symptom.

### 8. Why The Failure Surfaced Now

`git blame` showed the malformed SQL came from the earlier scorecard/reporting refactor commit:

- `8c3ca53` — `Refactor scorecards and fix reporting freshness`

So the failure was **not** introduced by the later latency work.

What changed “now” was simply:

- the user ran through the improved simulation flow
- hit the score route against the newer Postgres persistence path
- and that path encountered the malformed insert

So the correct reading is:

- the latency work made the simulation experience better
- the score-save bug was an existing backend regression in the extracted score-record persistence layer

### 9. Narrow Fix Implemented

The actual fix was intentionally tiny and limited to SQL correctness.

Changed file:

- `api/src/storage/scoreRecordStore.ts`

The tail of the SQL `VALUES` clause was corrected from:

```sql
$22, $23::jsonb, $24::jsonb, $25, $26, $27, $28, $29, $30, $31::timestamptz
```

to:

```sql
$22::jsonb, $23::jsonb, $24, $25, $26, $27, $28, $29, $30::timestamptz
```

This correction means:

- `coaching_artifact` now correctly uses `$22::jsonb`
- `normalized_coaching_themes` now correctly uses `$23::jsonb`
- `rubric_version` now correctly uses plain `$24`
- the tail no longer shifts forward incorrectly
- `created_at` now correctly uses `$30::timestamptz`

The fix does **not** change:

- score generation semantics
- mobile request shape
- mobile response shape
- scorecard contract
- tenant/access behavior
- fallback behavior
- any live simulation latency code

This was a pure persistence SQL correctness fix.

### 10. Regression Test Added

A new targeted regression test was added in:

- `api/src/storage/scoreRecordStore.test.ts`

What it does:

- stubs the Postgres pool/client surface
- captures the generated `INSERT INTO score_records` SQL text and bound values
- asserts that:
  - the highest placeholder number matches the bound values count
  - the tail has the expected JSONB casts
  - the bogus `$31::timestamptz` reference is absent

This test does **not** prove a full live HTTP save against a real Postgres server, but it is strong protection against exactly this class of placeholder/cast regression.

### 11. Validation Performed

Validation after the fix included:

```powershell
npx.cmd tsx --test api/src/storage/scoreRecordStore.test.ts
npx.cmd tsx --test api/src/storage/scoreRecordStore.test.ts api/src/services/scoreRecordAccess.test.ts api/src/services/simulationScoring.test.ts
npm.cmd run build --workspace api
npm.cmd test --workspace api
```

Results:

- targeted score-record store test: passed
- targeted score persistence/scoring tests: passed
- API build: passed
- full API suite: still shows the same two unrelated known web-auth test failures

Unrelated known failures still present in the full API suite:

- `trusted web auth session stores dashboard scope and device metadata`
- `trusted web auth session touch updates activity metadata only when needed`

These failures were not introduced by the score-save fix and sit outside the mobile simulation score path.

### 12. Score-Save Fix Was Committed And Pushed

After the final verification pass, the score persistence fix was committed and pushed.

Commit:

- `1269c2b` — `Fix score record persistence SQL`

That means both the simulation latency work and the urgent score persistence fix are now on `origin/main`.

## Current Architecture State

### Live Simulation Path

Current high-level live simulation architecture:

- manual submit remains the interaction model
- mobile prefers the unified `submit-turn` route
- the server reuses session-scoped runtime/prompt cache entries where possible
- first-chunk speech prefetch is bundled into the response
- assistant text still commits at playback start rather than getting ahead of the voice
- longer replies get better chunk preparation than before

The biggest remaining latency bucket is still:

- the server-side serial AI phase inside unified submit:
  - transcription
  - model generation
  - first-chunk speech prefetch

### Score Generation / Save Path

Current high-level score path:

1. mobile completes the simulation
2. mobile calls `/mobile/users/:userId/ai/score`
3. backend evaluates the transcript/dialogue and generates the normalized scorecard
4. backend constructs `SimulationScoreRecord`
5. backend persists:
   - score record
   - AI usage event
   - training-pack assignment side effects
   - audit metadata
6. backend returns the scored payload
7. mobile resolves the score outcome and renders the scorecard

Current important truth:

- the urgent persistence break in step 5 is now fixed

## Current Validation / Repo State

Current pushed state:

- `1269c2b` is live on `origin/main`

Important recent pushed commits:

- `1269c2b` — score persistence SQL fix
- `0d57fa2` — live simulation latency pipeline improvements

Current local repo note:

- only the older untracked docs remain outside Git tracking locally
- no new uncommitted code changes were left behind from the urgent fix

## Build / APK Guidance

Because both mobile-side simulation logic and backend logic changed recently, the cleanest test path is:

1. use current backend code from `main`
2. build a fresh Android preview APK from current repo state

Current recommended build command:

```powershell
cd mobile
npx.cmd eas build --platform android --profile preview --non-interactive
```

This should be used rather than relying on an older installed build.

## Current Risks / Remaining Limitations

### 1. Live Simulation Latency Is Improved, Not Solved

The live simulation path is notably better than before, but the system is still not truly streamed end to end.

The main remaining latency wall is still server-side serial work inside unified submit.

### 2. Score Route Error Reporting Is Still Broad

The score route still returns a generic:

- `"Score was generated but could not be saved..."`

for any failure inside its persistence block.

That is acceptable for now, but it means future persistence issues would still collapse into the same broad mobile error banner.

### 3. Regression Coverage For Score Save Is Stronger But Still Narrow

The new regression test guards the exact SQL placeholder/cast bug that caused this incident.

What still does **not** exist:

- a full HTTP integration test for `/mobile/users/:userId/ai/score`
- a real end-to-end device test baked into automation for completed simulation -> successful scorecard render

### 4. Known Unrelated API Test Failures Still Exist

The two known web-auth test failures remain in the broader API suite and should not be forgotten, even though they are not part of this simulation/scoring issue.

## Recommended Manual Test Sequence Now

The most valuable manual validation from here is:

1. build a fresh preview APK from current `main`
2. run a real simulation on device
3. complete a normal multi-turn session
4. confirm:
   - the simulation still feels tighter than before
   - the scorecard appears normally after completion
   - the previous save-failure banner does not appear
5. repeat with:
   - a short response / low-evidence session
   - a normal scored session
   - a longer multi-turn session

Specifically for the originally reported case:

- scenario: `Solar Door-to-door - Don't have time right now`
- role / difficulty / persona: `Sales Representative | Medium | Skeptical`

That is a useful regression test because it was the concrete observed failure path.

## Recommended Next Steps

The next best work from here is **not** another broad refactor.

The best next steps are:

1. **Real-device verification of the score-save fix**
   - confirm the scorecard now appears normally after completed simulations
   - confirm no score-save banner appears

2. **Collect real timing traces from the unified submit path**
   - compare transcription vs model vs first-chunk speech-prefetch durations
   - use actual numbers rather than intuition to choose the next latency target

3. **If another small latency pass is needed, target the remaining serial AI wall**
   - only after reviewing real logs
   - not as a speculative architecture rewrite

4. **Later, add a fuller integration test around `/mobile/users/:userId/ai/score`**
   - this is the clearest test gap exposed by the urgent score-save incident

## Final State Judgment

Peritio is in a meaningfully better state than it was at the prior summary checkpoint.

The important truths now are:

- the live simulation loop is faster and better synchronized
- the major latency improvements are pushed
- the urgent post-simulation score persistence failure has been root-caused precisely
- the fix is narrow, validated, and pushed

The system is now in a better position for the next fresh APK build and on-device verification than it was before this late update.
