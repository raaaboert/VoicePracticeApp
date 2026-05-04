# Peritio State Summary (2026-05-01)

This document records the major work completed across this chat session after the prior `2026-04-23` state summary.

It is intentionally detailed and handoff-oriented.

This period was not another broad trust-remediation cycle across the whole product.

It was a mobile-heavy stabilization and refinement cycle centered on:

- mobile simulation reliability
- active-session interruption handling
- background/privacy-safe lifecycle behavior
- phase/status rendering correctness
- compact-screen layout cleanup driven by real-device APK testing
- one important build-path audit when a claimed visual fix did not actually show up on device

The biggest truth now is:

- the codebase moved from "major audit items recently closed" into "mobile simulation reliability and UX hardening"
- the simulation screen is materially more resilient than it was at the start of this chat
- the compact mobile layout is much more transcript-first and much less dashboard-heavy
- the remaining work is now primarily real-device validation, not another broad rewrite

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `f51faf1`
- latest pushed commit on `main`: `Tighten simulation dock spacing and scroll padding`
- previous summary baseline commit: `24f0c48`

Important baseline note:

- by the time this chat started, the repo was already one commit ahead of the `2026-04-23` summary
- that pre-existing next commit was `9b38e94` and it added mobile scorecard recovery after scoring failures

Recent pushed commits, newest first:

- `f51faf1` - `Tighten simulation dock spacing and scroll padding`
- `c39fbe3` - `Consolidate compact simulation status and dock spacing`
- `36cf3af` - `Tighten compact simulation engine and dock spacing`
- `0086883` - `Prioritize transcript space on compact simulation screens`
- `3effd42` - `Compress mobile simulation layout for compact screens`
- `f293519` - `Fix simulation phase rows and compact mobile layout`
- `781b03d` - `Handle mobile simulation app background pause lifecycle`
- `9b38e94` - `Recover mobile scorecards after scoring failures`
- `24f0c48` - `Close audit remediation and fix mobile orb overflow`

Unlike the prior summary, this chat was not compressed into one final cleanup commit.

The git history now shows a sequence of focused mobile implementation passes, which is useful for tracing exactly which reliability/layout changes landed when.

## Executive Summary

This chat broke down into six major workstreams.

### 1. Baseline catch-up and scorecard recovery clarification

The first step was understanding where the repo really stood relative to the `2026-04-23` handoff.

That check confirmed:

- the summary doc baseline was no longer the real current baseline
- `main` already included one extra commit: `9b38e94`

That commit matters because it improved the mobile scorecard failure path:

- persisted mobile scorecards can now be recovered by `simulationSessionId`
- live scoring failure has a controlled recovery/fallback path instead of simply stranding the user

So the real baseline for this chat was slightly stronger than the last written handoff had captured.

### 2. Serious mobile failure audit and recovery hardening

The next major focus was a practical failure audit after a real-device report that a simulation had suddenly failed mid-session.

The audit conclusion was:

- the most likely failure family was not broad backend instability
- the most likely failure family was active-session recorder/microphone interruption and lifecycle drift

The important outcomes from this phase were:

- mobile turn flow was audited end-to-end
- active-session recorder failures were treated as reliability bugs, not user error
- recoverable interruption paths were strengthened instead of letting the session collapse too easily
- `Resume Turn` behavior was reinforced as the recovery path rather than silently killing the session

This phase also confirmed some important non-findings:

- TTS failure should stay non-fatal
- auth/scoped-config fail-closed behavior should not be weakened
- score/session persistence should not be made inaccurate just to hide runtime failures

### 3. Explicit AppState / background privacy handling

After the interruption audit, the next major step was productizing the background/lock-screen behavior as an explicit privacy-safe lifecycle policy.

This was one of the most important changes in the chat.

The final behavior now is:

- if the app backgrounds during an active simulation, recording is stopped
- no background recording is allowed
- no partial background audio is submitted or transcribed
- TTS playback is stopped safely
- the active simulation is preserved only within a defined grace period
- the user must intentionally tap `Resume Turn` to restart capture
- if the app stays backgrounded longer than the grace period, the simulation is safely closed

The grace-period behavior is now explicit in code instead of accidental.

Important properties of this implementation:

- it is privacy-first
- it is metadata-log-friendly
- it guards stale async completions so old requests cannot incorrectly revive an expired session
- it does not fabricate transcripts or AI responses from interrupted background time

### 4. Phase/status rendering correctness and build-path audit

The next workstream focused on the mobile simulation engine/status presentation itself.

There were two problems:

- the `Process` phase could look missing on device
- some claimed fixes did not appear in the APK

The second issue turned out to be important.

The audit showed that:

- the real screen path was indeed `mobile/src/screens/SimulationScreen.tsx`
- the real engine visual path was indeed `mobile/src/components/VoiceOrb.tsx`
- but one earlier helper-based fix had not actually been committed into the build baseline yet

That meant the first "fixed" APK could not possibly reflect all the claimed rendering work.

This was a useful process correction:

- when an APK does not reflect a supposed fix, verify both the actual render path and the committed build baseline

After that audit:

- the phase/status logic was moved into explicit helper-driven stage data
- the full-size mode preserves stable `Capture / Process / Deliver` rows
- compact mode uses a truthful single current-status presentation plus compact chips instead of letting large rows collapse awkwardly

This also made the earlier "Process disappears" bug much less likely to recur.

### 5. Compact-screen layout overhaul and repeated real-device refinement

The biggest visible body of work in this chat was the compact simulation layout sequence.

Real-device APK testing repeatedly showed that the simulation screen still felt too tall and too dashboard-like on smaller Android phones.

That produced a series of focused visual passes:

- compact scenario summary card
- smaller orb / engine visual on compact layouts
- transcript-first layout prioritization
- compact timer presentation
- removal of the compact `Response Mode` card
- tighter transcript bubble styling
- repeated sticky-dock refinement
- removal of redundant engine-card status copy
- tightening of outer scroll compensation

An important design shift happened during this phase:

- the product direction moved away from showing a big dashboard stack on small phones
- the screen now behaves more like a conversation tool

By the end of the chat, the compact simulation screen had moved much closer to:

- scenario context
- one authoritative status indicator
- orb / engine presence
- transcript visibility
- clear CTA

instead of:

- stacked informational cards fighting for vertical space

### 6. Final dock/scroll compensation cleanup

The last workstream was specifically about the bottom of the screen.

Two related issues remained:

- too much dead space under `Start Simulation` in the one-button sticky dock state
- too much extra blank scroll below the transcript/content

The important final insight was:

- the screen was still compensating as if it needed the full dock height as overlap clearance
- that was too generous, especially in the compact one-button state

The final fix centralized dock/scroll math in `simulationScreenLayout.ts` with distinct responsive paths for:

- compact one-button
- compact two-button
- regular/larger layouts

That is stronger than the earlier ad hoc trims because the responsive behavior is now named, centralized, and testable.

## What Was Fixed

## Mobile Scorecard Failure Recovery

### Problem

The repo had already moved past the `2026-04-23` summary, but that had not yet been captured in a newer handoff.

### What changed

The pre-existing `9b38e94` baseline improved mobile scorecard resilience:

- persisted mobile scorecards can be recovered by `simulationSessionId`
- scoring failure can fall back cleanly instead of leaving the user stranded

### Current status

This is already in the pushed baseline.

It should now be considered part of the real current Peritio mobile behavior, not a hypothetical future fix.

## Mid-Simulation Failure Resilience

### Problem

A real-device session stopped unexpectedly mid-simulation.

### What changed

The mobile turn lifecycle and supporting backend/client paths were audited for:

- recorder interruption
- stale async turn work
- TTS failure handling
- background/foreground races
- retry/error-state behavior

The important practical conclusion was that the risky paths were primarily around mobile interruption/lifecycle, not a general need to rewrite the backend turn architecture.

### Current status

The simulation flow is meaningfully more resilient than it was at the start of the chat, especially around interruption and resume behavior.

## Explicit Background Pause / Expire Policy

### Problem

Before this chat, active simulations did not have a strong explicit AppState/background policy.

That was a trust problem because:

- recording could be interrupted ambiguously
- background time needed to be treated as non-recordable
- stale async work could potentially complete after the session state had changed

### What changed

New lifecycle helper:

- `mobile/src/lib/simulationAppStateLifecycle.ts`

New lifecycle test:

- `mobile/src/lib/simulationAppStateLifecycle.test.ts`

Main integration:

- `mobile/src/screens/SimulationScreen.tsx`

Supporting mobile integration:

- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/simulationInteractionModel.ts`
- `mobile/App.tsx`

Behavior now:

- backgrounding pauses the session
- capture stops immediately
- no background audio is submitted
- resume is intentional, not automatic
- a grace period is enforced
- expired background pauses end safely
- stale async work is guarded against reviving a stale turn/session

### Current status

This is implemented in code and helper-test validated.

Known remaining runtime nuance:

- if the OS kills the app entirely while it is backgrounded, the in-memory paused session cannot be recovered
- that case safely resets rather than trying to fake restoration

## Phase Row / Engine Status Fixes

### Problem

The mobile simulation engine/status UI had a few intertwined issues:

- `Process` could appear missing
- compact screens spent too much space on status UI
- later, status copy became too repetitive on the compact engine card

### What changed

New phase helper:

- `mobile/src/lib/voiceOrbPhases.ts`

New phase tests:

- `mobile/src/lib/voiceOrbPhases.test.ts`

Main component:

- `mobile/src/components/VoiceOrb.tsx`

The current behavior is:

- larger-screen mode still preserves explicit `Capture / Process / Deliver` stage truth
- compact mode uses a single current-status presentation plus compact chips
- the engine card no longer repeats readiness/status in multiple stacked places
- the compact engine header now has one authoritative outer status indicator instead of several redundant readiness labels

### Important process note

One failed APK iteration mattered here.

The first time this issue was re-checked on device, we found that:

- the actual component path was correct
- but helper-based phase/status work had not all been committed into the pushed baseline yet

That build-path mismatch was corrected later in the chat, and the current baseline now includes the helper-based phase/status logic.

## Compact Mobile Layout Refinement

### Problem

On smaller Android devices, the simulation screen was still too vertically long and too card-heavy.

Specific problem areas across the chat included:

- oversized scenario card
- oversized orb/engine block
- redundant status UI
- transcript pushed too low
- response-mode card wasting space
- timer block larger than necessary
- sticky dock too tall
- too much extra scroll below transcript/content

### What changed

New layout helper:

- `mobile/src/lib/simulationScreenLayout.ts`

New layout tests:

- `mobile/src/lib/simulationScreenLayout.test.ts`

Compact/mobile visual helpers also evolved in:

- `mobile/src/lib/voiceOrbLayout.ts`
- `mobile/src/lib/voiceOrbLayout.test.ts`
- `mobile/src/components/VoiceOrb.tsx`
- `mobile/src/screens/SimulationScreen.tsx`

The important UI outcomes now are:

- compact scenario summary instead of a large detail-heavy card
- smaller engine/orb presentation on compact screens
- compact timer summary
- no compact `Response Mode` card
- more transcript space
- slightly tighter transcript bubble styling
- reduced repeated engine status copy
- tighter one-button compact dock
- tighter, state-specific bottom scroll compensation

### Current status

This is now much closer to the intended "conversation tool" feel on compact screens.

The remaining requirement is not more code churn by default.

It is a consolidated device validation pass across several device sizes.

## Responsive Dock and Scroll Compensation

### Problem

The late-stage compact layout still had two related issues:

- one-button dock was visually taller than it needed to be
- screen could scroll into too much blank space below the transcript/content

### Root cause

The final audit in this chat found that:

- the compact one-button state was still using spacing assumptions too close to the multi-action dock
- the outer `ScrollView` bottom padding was still effectively overcompensating by treating the full dock height as needed clearance

### What changed

The final fix moved this logic into named layout helpers inside:

- `mobile/src/lib/simulationScreenLayout.ts`

Specifically:

- compact one-button dock bottom padding is now distinct from compact two-button dock padding
- compact one-button scroll clearance is now distinct from compact two-button scroll clearance
- regular/larger layouts stay on a roomier path
- `SimulationScreen.tsx` now asks the helper for:
  - effective dock bottom padding
  - effective outer scroll bottom padding

That is safer than tweaking style constants in-place because it preserves responsive intent and test coverage.

### Current status

This is implemented and test-covered.

It still needs APK/device confirmation because these were visually motivated changes.

## Main Files Changed In This Chat

The chat was highly mobile-focused.

### Mobile simulation screen / layout

- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/components/VoiceOrb.tsx`
- `mobile/src/lib/simulationScreenLayout.ts`
- `mobile/src/lib/simulationScreenLayout.test.ts`
- `mobile/src/lib/voiceOrbPhases.ts`
- `mobile/src/lib/voiceOrbPhases.test.ts`
- `mobile/src/lib/voiceOrbLayout.ts`
- `mobile/src/lib/voiceOrbLayout.test.ts`

### Mobile lifecycle / reliability

- `mobile/src/lib/simulationAppStateLifecycle.ts`
- `mobile/src/lib/simulationAppStateLifecycle.test.ts`
- `mobile/src/lib/simulationInteractionModel.ts`
- `mobile/src/lib/simulationInteractionModel.test.ts`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/App.tsx`

### Score recovery / mobile scoring support

- `mobile/src/lib/simulationScoreHandling.ts`
- `mobile/src/lib/simulationScoreHandling.test.ts`
- `api/src/services/mobileScoreRecovery.ts`
- `api/src/services/mobileScoreRecovery.test.ts`
- `api/src/index.ts`

## Validation Run During This Chat

The work in this chat was validated repeatedly, not just once at the end.

Major validation included:

- `npm run build --workspace api`
- `npx tsc --noEmit -p mobile/tsconfig.json`
- `npx tsx mobile/src/lib/simulationAppStateLifecycle.test.ts`
- `npx tsx mobile/src/lib/simulationInteractionModel.test.ts`
- `npx tsx mobile/src/lib/simulationDiagnostics.test.ts`
- `npx tsx mobile/src/lib/unifiedSubmit.test.ts`
- `npx tsx mobile/src/lib/voiceOrbLayout.test.ts`
- `npx tsx mobile/src/lib/voiceOrbPhases.test.ts`
- `npx tsx mobile/src/lib/simulationScreenLayout.test.ts`
- `npx tsx api/src/services/simulationSessionLifecycle.test.ts`
- repeated `git diff --check`

Because this environment uses PowerShell with script-policy restrictions, many final validation passes were run via `npx.cmd` rather than bare `npx`.

## Current Risk Posture

Compared with the `2026-04-23` handoff, the codebase is now stronger in a different way.

This is not primarily another enterprise trust-closure snapshot.

It is:

- a mobile reliability hardening snapshot
- a mobile simulation UX cleanup snapshot
- a build-path verification snapshot after several APK-driven refinement cycles

The current state is materially stronger for:

- active-session interruption recovery
- privacy-safe background handling
- compact simulation screen usability
- phase/status rendering truthfulness
- transcript-first compact mobile layout

## Remaining Watch List

The remaining watch list is now heavily runtime/device oriented.

### 1. Consolidated APK/device validation pass

The highest-priority remaining need is one real APK validation sweep that confirms the latest pushed baseline on:

- one compact Android phone
- one larger phone
- one tablet or tablet-like large screen

Specific checks:

- pre-start one-button dock height
- minimal extra scroll below transcript/content
- transcript clearing above the dock
- compact status clarity in ready/capture/process/deliver states
- larger-screen balance not becoming overly compressed

### 2. Background pause/expire validation

The code path is in place, but it should still be validated on device for:

- app background during active recording
- app background during idle between turns
- return within grace period
- return after grace period
- user-facing resume/end behavior after return

### 3. Continued monitoring for sudden mid-simulation stops

The likely failure family was addressed in code, but if real-device failures still occur:

- prioritize runtime log evidence first
- do not jump immediately into another broad rewrite

The code now has a better foundation for diagnosing future reports.

### 4. Score recovery sanity check

Because `9b38e94` is now part of the real baseline, it is worth doing at least one sanity check that recovered mobile scorecards still behave as intended after a failed scoring path.

## Recommended Next Step

The best next step is not another broad implementation pass by default.

It is:

- build a fresh APK from `f51faf1`
- run one structured device validation sweep across compact phone, larger phone, and tablet
- if something still feels off, capture the exact state/screen-size/APK behavior and iterate from that evidence

The current code is close enough that device truth matters more than more speculative layout churn.

## APK Build Command

For a fresh Android APK from the current pushed baseline:

```powershell
Set-Location mobile
npx.cmd eas build --platform android --profile preview --non-interactive
```

The `preview` profile is configured to build an `apk`.
