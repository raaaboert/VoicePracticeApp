# Peritio State Summary (2026-04-02)

This document records the major work completed across this chat session, with emphasis on:

- simulation integrity and usage-session hardening
- simulation performance and responsiveness
- deliberate-practice interaction-model improvements
- timing observability
- low-hanging latency reduction
- simulation/runtime diagnostics hardening
- current state after all commits pushed during this chat

This is intentionally exhaustive. It is meant to serve as a handoff-quality checkpoint, not a short changelog.

## Current Baseline

As of the end of this chat:

- branch: `main`
- pushed baseline: `dbdb566`
- latest commit message: `Harden simulation diagnostics and reduce support noise`
- worktree state at the end of the engineering work: clean
- unrelated `simlog.txt` repo-root noise was removed before the last commit

This chat produced a sequence of meaningful checkpoints, not just one isolated patch. The product moved from:

- stronger usage/session integrity
- into deep simulation UX and latency auditing
- into explicit-submit interaction-model cleanup
- into multiple raw-latency reduction passes
- into timing observability hardening
- and finally into support/runtime diagnostics hardening

## Executive Summary

The most important outcome of this chat is that Peritio's simulation experience is now much more intentional, more measurable, and materially faster-feeling than it was at the start of the session.

The biggest product improvements made during this chat were:

- simulation usage/session legitimacy became materially safer
- explicit manual turn submission replaced the old silence-driven turn-ending behavior
- the real start-registration retry bug was fixed
- assistant response visibility became clearer and less confusing
- timing/correlation instrumentation became good enough for real device trace collection
- several raw-latency reductions landed across mobile recording, API hot paths, prompts, and TTS startup
- low-value long-poll support noise was reduced
- runtime diagnostics for TTS cancellation, missing usage-record context, and no-transcript failures became much more actionable

The biggest architectural/product judgment reached during the chat was:

- persistence and usage-session integrity are now in much better shape
- the primary remaining product risk is not billing or entitlement semantics
- the primary remaining product risk is still simulation responsiveness under real device/network conditions
- after the latest performance and diagnostics work, the right next step is live APK testing with real traces, not another speculative architecture pass

## Chronological Timeline

### 1. Usage-Session Integrity Cleanup and Local Pre-Tester Reset

This chat included a focused integrity pass that hardened the extracted `usageSessions` baseline rather than reopening persistence architecture.

That pass accomplished three main things:

- orphaned user-scoped simulation history now gets repaired during integrity maintenance
- stale recognized simulation sessions now get pruned
- a local-only pre-tester reset script was added so disposable simulation history can be cleared while preserving real users/orgs/setup

The resulting checkpoint was committed and pushed as:

- `4c65970` - `Harden usage session cleanup and local tester reset`

#### What changed

Key changes from that pass:

- startup/on-demand integrity maintenance for orphaned:
  - usage sessions
  - recognized simulation sessions
  - score records
  - AI usage events
  - support cases
- stale `started` recognized sessions now get pruned on startup
- additional recognized-session lifecycle validation around timing plausibility
- local reset script for disposable history

#### Exact files in that checkpoint

- `api/package.json`
- `api/scripts/reset-pretester-history.ts`
- `api/src/index.ts`
- `api/src/services/integrityMaintenance.ts`
- `api/src/services/integrityMaintenance.test.ts`
- `api/src/services/simulationSessionLifecycle.ts`
- `api/src/services/simulationSessionLifecycle.test.ts`
- `api/src/storage/simulationSessionStore.ts`
- `api/src/storage/simulationSessionStore.test.ts`

#### Why it mattered

This established a safer foundation for the later simulation-performance work. It reduced the chance that:

- deleted users leave simulation/reporting residue behind
- stale recognized sessions pile up forever
- local pre-tester baselines are hard to reset safely

#### Local pre-tester reset result

The reset script was run successfully against the local file-backed snapshot.

It reported clearing:

- `0` usage sessions
- `0` recognized simulation sessions
- `0` score records
- `0` AI usage events
- `0` support cases
- `0` assignment progress rows

That result was interpreted correctly:

- the local snapshot was already clean on disposable simulation history
- the reset therefore served as confirmation rather than destructive cleanup

The script preserved local users/setup, including:

- `rbdautel@gmail.com`
- `useradmin@robscompany.example`
- `user@robscompany.example`
- `orgadmin@summitrevenue.example`

Also preserved:

- `orgCount = 2`
- `mobileAuthTokens = 1`
- `webAuthChallenges = 3`

Important honesty note captured during the chat:

- `rob@peritio.ai` was not present in the current local file snapshot, so there was nothing by that exact email to preserve there

### 2. First Major Adversarial Simulation Audit

After the integrity checkpoint, the chat shifted into a hard, product-focused simulation audit.

That audit intentionally did not stop at:

- tests passing
- builds passing
- architecture "looking cleaner"

Instead it focused on:

- real simulation experience quality
- latency and perceived responsiveness
- turn loop integrity
- TTS startup pain
- backend hot-path behavior
- trust boundaries and correctness

#### Key conclusions from that audit

The audit concluded:

- the architecture was cleaner than before
- the simulation experience was still too slow and clunky to call release-grade
- the biggest UX killer was the serial path from submit/turn-end through:
  - transcription
  - model generation
  - TTS generation/fetch
  - audio startup

The audit explicitly called out:

- a real mobile start-registration retry bug
- a built-in multi-second silence wait before processing
- assistant text being hidden until playback started
- avoidable backend writes/touches still sitting on hot paths

At that point the recommendation was effectively:

- do not move forward yet on simulation UX quality
- fix the start-flow bug
- make turn submission explicit
- improve responsiveness

That audit directly shaped the next several implementation passes.

### 3. Full Repo Backup Checkpoint

During the chat, a full backup was created at:

- `C:\Users\Robert\Desktop\Visual_Studio_Apps\BackUps\POST_ALL_CLEANUP_TESTEDGOOD_04022026`

Verification confirmed:

- source files: `34,234`
- backup files: `34,234`
- source directories: `6,630`
- backup directories: `6,630`

The backup explicitly included:

- `.git`
- `api/db.local.json`
- recreated workspace junctions under `node_modules/@voicepractice`

This matters operationally because it created a clean, restorable checkpoint after the earlier cleanup/integrity work and before the deeper simulation changes accelerated.

## Major Simulation Product Work Done In This Chat

### 4. Simulation Interaction Model + Speed + Start-Flow Correctness Pass

This was the first major implementation pass aimed directly at the simulation experience.

It addressed five core things:

- the start-registration retry bug
- explicit user turn submission
- dead-air reduction
- earlier response visibility
- initial timing instrumentation

The resulting checkpoint was later included in:

- `e495989` - `Improve simulation responsiveness and reduce raw latency`

### 4.1 Start-flow correctness fix

The original bug:

- opening delivery state and recognized-session registration state were being conflated
- if start registration failed after opening delivery began, retry could get into a bad local state and incorrectly bypass proper re-registration

The fix:

- separated opening delivery tracking from recognized-start registration tracking
- retried recognized-start registration independently
- made start retry safe even if the opening line had already been delivered

This was one of the most important correctness fixes in the chat because it protected the newer recognized-session integrity model from a very real client-state bug.

### 4.2 Turn model change: explicit submit becomes primary

Before:

- silence detection effectively ended the turn
- the app was still partly deciding when the user was "done"

After:

- `Submit Response` became the primary turn-ending action
- the simulation became more deliberate-practice oriented
- the user, not silence heuristics, became the main turn boundary authority

This was a major UX improvement because it aligned the simulation with the intended product model:

- user speaks
- user decides when done
- user taps submit
- processing begins

### 4.3 Dead-air reduction

The original state included a built-in client-side wait window before processing began.

That was removed from the primary path.

The user no longer had to wait for the app to "decide" they had stopped speaking before anything happened.

This substantially improved perceived responsiveness even before deeper raw-latency work landed.

### 4.4 Assistant response visibility improvement

The assistant response was changed so that:

- assistant text is appended as soon as the model reply comes back
- the app no longer waits for TTS playback start to reveal assistant content
- the UI explicitly communicates response-state progress while voice startup is happening

This was a high-value perceived-speed improvement because it removed confusing "dead time with no visible result."

### 4.5 Initial timing instrumentation

This pass also introduced early timing/correlation plumbing for the simulation loop, including:

- correlation ids for simulation phases
- mobile phase logs for start/submit/transcribe/reply/TTS/playback
- backend timing logs for simulation routes

That observability work was important because it let later performance passes be based on actual phase breakdowns rather than pure guesswork.

### 4.6 Branding fix

During this pass, a visible branding regression was also fixed:

- splash/landing branding was restored from `counterMatch` back to:
  - `Peritio`
  - `Professional Training Simplified`

This was intentionally kept narrow and only corrected the obvious leftover placeholder branding encountered in the same path.

### 5. Simulation Raw-Latency Reduction Pass (v1)

After the interaction-model correction, the next focus was raw submit-to-response latency.

This pass pursued low-risk, real wins across:

- backend simulation route hot paths
- TTS startup
- prompt/output trimming
- payload and context efficiency

This work was also included in:

- `e495989` - `Improve simulation responsiveness and reduce raw latency`

### 5.1 Backend opening/turn hot-path reduction

Before:

- `/ai/opening` and `/ai/turn` still went through write-locked context paths more than necessary

After:

- opening/turn moved to a read-first context path
- write-path fallback was retained only for narrow legacy training-workspace bootstrap cases
- non-critical post-response work was deferred where safe

This meant the common case became lighter without weakening correctness.

### 5.2 Prompt and context cleanup

Several low-risk prompt/context wins landed:

- server-authoritative industry baseline use
- removal of pointless/filler baseline text
- whitespace normalization in dialogue history
- lighter prompt construction

Important product constraint preserved:

- this was not solved by starving the AI into unnaturally clipped replies
- response quality and naturalness were intentionally preserved

### 5.3 TTS startup improvement (first round)

The first TTS startup pass included:

- earlier fast-start behavior
- smaller first chunk more often
- removal of one extra playback-rate setup step before play

This was not a streaming rewrite. It was a pragmatic startup optimization pass.

### 5.4 Instrumentation strengthening

Additional route timing logs were added so the system could expose:

- route-level context timing
- prompt size
- token caps
- training-pack lookup time

This created a better basis for later optimization decisions.

### 6. Simulation Timing Observability Pass

The next dedicated pass was not broad product work. It was an observability usability pass.

The core problem:

- timing instrumentation existed, but it was too fragmented to be pleasant or fast to interpret during live diagnosis

The solution:

- added clearer mobile turn-summary output
- improved backend route-summary consistency
- made it easier to trace a single turn end-to-end using correlation ids

This work was later rolled into the checkpoint committed as:

- `a8beeaf` - `Enforce manual turn submission and improve timing traces`

### 6.1 What observability became good at

After this pass, one turn could be tracked much more cleanly across:

- mobile submit
- finalize
- transcribe request/response
- assistant request/response
- TTS request/startup
- playback start

This was important because later live APK testing was expected to rely on exactly these traces.

### 7. Manual Turn Submission Only Correction

Real testing then revealed that even after the interaction-model improvements, the app could still auto-submit due to remaining silence fallback / safety logic.

That was not acceptable for the intended product model.

This pass enforced:

- manual submit as the only turn-submission path

The resulting checkpoint was committed and pushed as:

- `a8beeaf` - `Enforce manual turn submission and improve timing traces`

### 7.1 What was removed

Removed from active turn flow:

- short-silence auto-submit
- long-silence auto-submit
- hidden timeout that submitted on the user's behalf

### 7.2 What remained

Remaining safety behavior became advisory only:

- long-pause notices
- soft turn-length notices
- absolute turn-length notices

These could:

- warn
- guide
- leave the user in control

But they could no longer submit the turn automatically.

### 7.3 Product significance

This was not just a technical cleanup.

It fully aligned the simulation interaction model with the deliberate-practice intent:

- user controls turn boundary explicitly
- the app no longer "steals" the turn boundary during hesitation or longer pauses

### 8. Simulation Raw-Latency Reduction v2

After the submit-only correction, the next pass focused again on raw latency, but under a strong product constraint:

- do not damage realism just to benchmark better

This work was part of the later checkpoint:

- `a9f4351` - `Checkpoint simulation performance improvements before next APK build`

### 8.1 Recording/upload path improvements

The recording profile was changed from a heavier general preset to a speech-optimized one:

- mono instead of stereo
- `32 kHz / 64 kbps` AAC instead of the previous heavier preset

Why this mattered:

- smaller upload payloads
- lower transcription request weight
- minimal expected impact on speech transcription usefulness

Importantly, this was not a reckless downgrade to junk-quality audio. It remained a speech-oriented AAC recording path.

### 8.2 Prompt path cleanup without realism loss

This pass further reduced model-side waste without forcing shallow replies:

- removed redundant filler baseline text
- normalized dialogue history whitespace
- tightened prompt wording while preserving realism

Key product principle preserved:

- no aggressive token starvation
- no forced ultra-short AI responses
- still natural, realistic practice dialogue

### 8.3 TTS fast-start improvement (second round)

TTS chunking became smarter:

- more medium-length replies qualified for fast-start splitting
- long single-sentence replies could split on natural clause boundaries
- longer replies could prefetch later chunks more effectively

This was especially important for responses that were realistic spoken turns rather than extreme edge cases.

### 9. Low-Hanging Simulation Latency Wins Pass

Before the next planned APK cycle, one more narrow speed pass was done to capture the most realistic remaining low-hanging wins without broadening scope.

This produced the commit:

- `a9f4351` - `Checkpoint simulation performance improvements before next APK build`

### 9.1 Biggest win: inline TTS playback attempt with safe fallback

This was a significant TTS startup improvement.

The app now:

- attempts inline data-URI playback first for remote TTS audio
- falls back safely to the existing file-based playback path if inline playback fails
- disables inline mode for the rest of that app run after a failure to avoid repeated instability

Why this mattered:

- it can eliminate the file-write step entirely in the best case
- it keeps the previous stable path as fallback

This was a classic good low-hanging win:

- real potential speed value
- bounded complexity
- safe fallback

### 9.2 Additional micro-wins

Other small wins from this pass:

- more aggressive but still natural first-chunk TTS chunking
- audio-mode reset moved out of the front of the submit path
- file-size inspection moved out of the front of the submit path
- small non-modular backend lookup skip for opening/turn

These were not giant wins individually, but they were exactly the kind of low-risk shaving that made sense before another APK build.

### 9.3 Commit-readiness audit outcome

An audit of this low-hanging-wins pass concluded:

- this was a good checkpoint to commit/push before the next APK
- the remaining biggest uncertainty was real-device magnitude, not code unsoundness

### 10. Simulation Diagnostics Hardening Pass

The final implementation pass in this chat focused on diagnostics quality rather than broad behavior changes.

This produced the current latest pushed checkpoint:

- `dbdb566` - `Harden simulation diagnostics and reduce support noise`

This pass specifically targeted recurring noisy or under-diagnosed support/runtime issues:

- vague `TTS playback cancelled`
- `mobile_updates.long_poll` network noise
- `simulationSessionId, userId, segmentId, and scenarioId are required`
- occasional `No transcribed user text received...` failures

### 10.1 TTS cancellation diagnostics hardening

Before:

- `TTS playback cancelled` was too vague to distinguish:
  - expected lifecycle cancellation
  - superseded playback
  - session-ending cancellation
  - navigation/screen-change side effect
  - real user-facing failure

After:

- TTS cancellation is now classified with structured context
- logs include:
  - correlation id
  - simulation session id
  - source kind (`inline` vs `file`)
  - whether playback started
  - whether inline-to-file fallback was attempted/succeeded
  - chunk index / total chunks
  - whether the request was superseded
  - whether the session was ending
  - whether the screen was changing
  - whether the abort signal fired
  - expected/unexpected classification
  - likely-user-facing classification

Expected cancellations are no longer treated like ambiguous runtime failures.

Unexpected cancellations still surface as support-relevant simulation errors.

### 10.2 Missing-field usage-record hardening

Before:

- support logs showed usage finalization attempts that lacked required fields

After:

- the current scorecard usage-record path now performs a client-side required-field preflight
- if required fields are missing, the bad call is skipped rather than sent
- support diagnostics capture:
  - flow stage
  - trigger type
  - exact missing fields
  - presence booleans for core optional/required context
  - correlation id

Server-side, `/usage/sessions` also now:

- logs structured missing-field diagnostics
- returns a code and explicit `missingFields`

This means:

- the current client baseline should stop producing that bad call
- older clients or other callers still produce immediately diagnosable output if they hit it

### 10.3 Long-poll noise reduction

Before:

- `mobile_updates.long_poll` transient failures could create support noise without representing a real user-facing problem

After:

- long-poll failures are tracked across consecutive attempts
- transient failures are suppressed to local warning logs
- support auto-reporting begins only after repeated failures
- later persistent failure windows can still escalate again
- recovery is explicitly logged when polling succeeds after failure streaks

This was carefully constrained so that:

- persistent real problems still surface
- auth/session-reset-worthy issues still break through
- only likely-benign transient noise gets reduced

### 10.4 No-transcript diagnostics hardening

Before:

- no-transcript errors were helpful but still shallow

After:

- diagnostics now capture:
  - audio byte size
  - turn duration
  - content type
  - file extension
  - whether remote transcription was attempted
  - whether the request failed
  - transcription error message if present
  - whether local fallback was used
  - local fallback reason
  - whether the recording looks suspiciously tiny
  - a derived classification such as:
    - `request_failed`
    - `empty_transcript_result`
    - `tiny_or_empty_recording`
    - `local_fallback`

API-side warnings were also added for empty transcribe responses and placeholder/no-transcript 422s on turn/score.

This makes future triage much faster because "no transcript" is no longer one opaque bucket.

## Commit Timeline

These were the meaningful pushed checkpoints created during this chat:

| Commit | Message | Summary |
| --- | --- | --- |
| `4c65970` | `Harden usage session cleanup and local tester reset` | orphan cleanup, stale recognized-session pruning, local reset tool |
| `e495989` | `Improve simulation responsiveness and reduce raw latency` | start-flow fix, explicit submit model, response visibility, first major latency reduction set |
| `a8beeaf` | `Enforce manual turn submission and improve timing traces` | manual-submit-only enforcement, cleaner timing traceability |
| `a9f4351` | `Checkpoint simulation performance improvements before next APK build` | raw latency v2, recording-profile lightening, smarter TTS chunking, low-hanging wins |
| `dbdb566` | `Harden simulation diagnostics and reduce support noise` | TTS cancellation classification, usage-record guard, long-poll noise reduction, no-transcript diagnostics |

## Current Simulation Product State

### 11. Interaction Model

Current intended simulation loop is now:

1. user starts simulation
2. opening line is delivered
3. recognized start registration is performed correctly
4. app records continuously during the user's turn
5. user explicitly taps `Submit Response`
6. only then does the app finalize and process the turn
7. assistant text is shown as soon as available
8. TTS begins as early as practical

Important current behavior:

- manual submit is the only turn-submission path
- silence and turn-length logic are advisory only
- the app keeps the deliberate-practice feel rather than behaving like an always-listening assistant

### 12. Start / Session Integrity

Current state:

- recognized simulation sessions exist as the legitimacy gate for usage finalization
- start-registration retry bug is fixed
- duplicate completion/idempotency semantics remain intact
- usage recording is protected by both server-side recognized-session validation and current client-side field guards

### 13. Response Visibility

Current state:

- assistant text appears before voice playback starts
- UI now communicates response phase more clearly
- perceived responsiveness is materially better than the old hidden-response behavior

Tradeoff intentionally accepted:

- text may appear slightly before voice on some turns
- this was judged better than showing nothing while TTS startup waits

### 14. Timing Observability

Current state:

- mobile logs include phased simulation timing
- mobile emits per-turn timing summaries
- backend simulation routes emit timing summaries
- TTS timing includes source preparation and source kind
- correlation ids connect mobile and API logs for real trace analysis

This is now good enough for real session trace collection.

### 15. Recording / Transcription Path

Current state:

- speech-oriented recording profile is lighter than before
- submit path no longer blocks transcription on non-critical local work like file-size measurement or immediate audio-mode reset
- no-transcript cases now carry much better diagnostics

### 16. TTS Path

Current state:

- fast-start chunking is materially better than it was at the start of this chat
- long single-sentence replies can split on natural clause boundaries
- inline remote playback can be attempted before file materialization
- safe fallback to file playback remains
- TTS cancellations are meaningfully classified

Remaining truth:

- TTS is still a major contributor to end-to-end latency
- startup is improved, not eliminated as a concern

### 17. Backend Hot Path

Current state:

- `/ai/opening` and `/ai/turn` are lighter than earlier in the chat
- non-critical follow-up writes are deferred where safe
- prompt/context assembly is cleaner
- some common-path training-pack work is skipped when not needed

Remaining truth:

- model call latency still dominates a large part of the turn path
- the simulation pipeline is still fundamentally serial

## Major Audits Performed During This Chat

This chat included multiple serious audit phases, not just implementation.

### Audit themes covered

- simulation UX
- turn loop correctness
- dead-air analysis
- TTS startup and playback flow
- backend hot-path behavior
- observability usability
- integrity/billing/entitlement regression checks
- realism/practice-quality preservation
- diagnostics actionability and support-noise quality

### High-level audit outcomes over time

Early major audit:

- architecture cleaner, simulation still too slow and clunky
- move forward on integrity, but not yet on simulation experience

Post interaction-model / speed pass audit:

- worth keeping
- start-flow bug fixed
- explicit submit model correct
- perceived responsiveness materially better

Post raw-latency passes:

- worth keeping
- real raw-latency contributors reduced
- still need live traces to rank remaining bottlenecks honestly

Post diagnostics pass:

- worth keeping
- error reporting more actionable
- less long-poll noise
- better support truth without hiding real failures

## Validation and Testing Performed Across This Chat

These command families were run repeatedly across the work:

- `npm.cmd run build --workspace shared`
- `npm.cmd run build --workspace api`
- `npm.cmd run test --workspace api`
- `npm.cmd run verify:fast`
- `npx.cmd tsc --noEmit -p mobile/tsconfig.json`
- focused `tsx` runs for new mobile helper tests
- `git diff --check`
- targeted simulation integrity / lifecycle / history / readiness test suites

### Repeated strong proof areas

The strongest consistently green proof areas were:

- API usage-session readiness
- recognized simulation-session lifecycle
- simulation-history readiness
- billing/access/entitlement parity
- mobile type safety
- repo-wide fast verification

### New focused tests added during this chat

Notable new/focused tests from this chat included:

- `mobile/src/lib/simulationInteractionModel.test.ts`
- `mobile/src/lib/ttsFastStart.test.ts`
- `mobile/src/lib/simulationTimingSummary.test.ts`
- `mobile/src/lib/simulationRecordingProfile.test.ts`
- `mobile/src/lib/simulationDiagnostics.test.ts`
- `api/src/services/simulationHotPath.test.ts`
- `api/src/services/simulationSessionLifecycle.test.ts`
- `api/src/services/integrityMaintenance.test.ts`
- `api/src/services/usageSessionReadiness.test.ts`
- `api/src/services/simulationHistoryReadiness.test.ts`

### Final diagnostics-pass validation result

For the last diagnostics checkpoint specifically, validation passed:

- mobile typecheck
- API build
- full API tests (`82/82`)
- `verify:fast`
- focused diagnostics unit tests

## Important Operational Artifacts and Commands

### 18. Backup Artifact

Backup created during this chat:

- `C:\Users\Robert\Desktop\Visual_Studio_Apps\BackUps\POST_ALL_CLEANUP_TESTEDGOOD_04022026`

Verified contents:

- `34,234` files
- `6,630` directories
- `.git` included
- `api/db.local.json` included
- workspace junctions preserved

### 19. APK Build Guidance

Throughout this chat, every meaningful mobile-behavior checkpoint was treated as requiring a new APK for realistic installed-app testing.

Reason:

- mobile simulation logic changed multiple times
- installed packaged app behavior needed to stay aligned with the pushed API behavior

PowerShell-specific issue encountered:

- `npx.ps1` was blocked by execution policy

Correct build command used:

```powershell
cd mobile
npx.cmd eas build --platform android --profile preview
```

One-line form:

```powershell
cd mobile; npx.cmd eas build --platform android --profile preview
```

This remained the recommended APK command at the end of the chat as well.

## Remaining Known Limits and Risks

Even after all the work in this chat, the following truths remain:

### 20. Simulation is still serial

The core response path is still fundamentally serial:

1. finalize recording
2. upload/transcribe
3. model generation
4. TTS generation/fetch
5. local playback preparation/load
6. playback start

This means raw latency is reduced, but not solved.

### 21. TTS still matters a lot

TTS improved significantly during this chat, but it remains one of the biggest likely contributors to real submit-to-playback time.

Especially still relevant:

- provider generation/fetch time
- local preparation/load cost
- real-device behavior of inline playback path

### 22. Real-device proof still matters

A large amount of the right engineering work is now in place, but the next highest-value truth source is still:

- real device traces
- real network conditions
- real APK testing

This was a recurring conclusion in the later audits.

## Future Items Discussed

The future items discussed during this chat were not broad architecture fantasies. They were mostly disciplined next-step recommendations.

### 23. Immediate Next Step Discussed Repeatedly

The repeatedly recommended next step after the later performance work was:

- build a new APK
- run live simulation sessions
- collect real correlated timing traces

Recommended capture volume discussed:

- `2-3` full sessions
- roughly `8-12` turns total
- ideally across at least mixed response lengths and, if possible, different network conditions

### 24. What To Measure Next

The explicit next measurement goal discussed was to determine which phase actually dominates live latency:

- transcription/upload
- model generation
- TTS provider time
- client-side TTS source prep / file-write / load

This is important because after the latest work, another optimization pass should be trace-led, not guess-led.

### 25. Likely Next Optimization Areas If Live Traces Demand Them

The likely next candidates discussed were:

1. deeper TTS startup improvement if TTS remains dominant
2. transcription/upload further reduction if audio upload is still dominant
3. additional model/prompt shaping only if real traces prove model-side prompt cost is still materially hurting latency
4. deeper client audio-path work if inline playback succeeds poorly or local load still dominates

### 26. What We Explicitly Did Not Want Next

Several future directions were repeatedly not recommended as the next move:

- do not reopen persistence architecture
- do not redesign billing/quota formulas
- do not redesign entitlement rules
- do not broaden into multi-process work
- do not do speculative giant streaming rewrites unless a tiny safe win becomes obvious
- do not do broad UI redesign outside the simulation loop

This is important context for future sessions, because the chat deliberately moved away from architecture vanity and toward product experience plus measurement.

## Files and Areas Most Affected Across This Chat

These areas carried most of the simulation/performance/diagnostics work:

### Mobile

- `mobile/App.tsx`
- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/ttsPlayback.ts`
- `mobile/src/lib/ttsFastStart.ts`
- `mobile/src/lib/simulationInteractionModel.ts`
- `mobile/src/lib/simulationTimingSummary.ts`
- `mobile/src/lib/simulationRecordingProfile.ts`
- `mobile/src/lib/simulationDiagnostics.ts`

### API

- `api/src/index.ts`
- `api/src/aiPrompts.ts`
- `api/src/services/simulationHotPath.ts`
- `api/src/services/simulationSessionLifecycle.ts`
- `api/src/services/integrityMaintenance.ts`
- `api/scripts/reset-pretester-history.ts`
- `api/src/storage/simulationSessionStore.ts`

### Tests

- `mobile/src/lib/simulationInteractionModel.test.ts`
- `mobile/src/lib/ttsFastStart.test.ts`
- `mobile/src/lib/simulationTimingSummary.test.ts`
- `mobile/src/lib/simulationRecordingProfile.test.ts`
- `mobile/src/lib/simulationDiagnostics.test.ts`
- `api/src/services/simulationHotPath.test.ts`
- `api/src/services/simulationSessionLifecycle.test.ts`
- `api/src/services/integrityMaintenance.test.ts`
- `api/src/services/usageSessionReadiness.test.ts`
- `api/src/services/simulationHistoryReadiness.test.ts`

## Final State Judgment

At the end of this chat, the honest state is:

- Peritio is in a meaningfully better state than it was at the start of the chat
- the simulation experience is much more intentional and diagnosable
- correctness and integrity are stronger
- support/runtime diagnostics are more trustworthy
- the current baseline is a legitimate checkpoint for live APK testing

What is still true:

- the simulation is not "finished"
- the serial remote chain still exists
- real APK/device traces should now drive the next performance move

But relative to where this chat began, the project now has:

- better integrity
- better turn control
- better responsiveness
- better visibility
- better diagnostics
- and a much clearer next step

That is the real outcome of this session.
