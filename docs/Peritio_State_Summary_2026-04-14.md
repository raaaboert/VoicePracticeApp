# Peritio State Summary (2026-04-14)

This document records the major work completed across the chat sessions after the prior state summary on `2026-04-11`, with emphasis on:

- live simulation latency auditing
- first-audio / text-audio sync improvements
- the new unified manual-submit path
- session-scoped runtime and prompt caching
- later-chunk continuity improvements
- current validation state
- current repo state, backups, and the next most sensible follow-up

This is intentionally detailed. It is meant to be a handoff-quality checkpoint rather than a short changelog.

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `8c3ca53`
- latest pushed commit on `main`: `Refactor scorecards and fix reporting freshness`
- important note: the live-simulation latency work completed after that checkpoint is currently **local worktree state**, not a new pushed commit yet

Current local worktree status includes substantial uncommitted simulation-latency changes in:

- `api/src/index.ts`
- `api/src/services/simulationRuntimeCache.ts`
- `api/src/services/simulationRuntimeCache.test.ts`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/unifiedSubmit.ts`
- `mobile/src/lib/unifiedSubmit.test.ts`
- `mobile/src/lib/simulationTimingSummary.ts`
- `mobile/src/lib/simulationTimingSummary.test.ts`
- `mobile/src/lib/ttsFastStart.ts`
- `mobile/src/lib/ttsPlayback.ts`
- `mobile/src/screens/SimulationScreen.tsx`
- `shared/src/index.ts`
- `shared/src/ttsFastStart.ts`

Important operational note:

- the previous scoring/reporting work is pushed
- the newer simulation latency work described below is implemented and validated locally
- this summary is therefore documenting a **post-`8c3ca53` local engineering checkpoint**

## Executive Summary

Since the last state summary, the work shifted from scoring/reporting trust into the live simulation turn loop itself.

The most important outcomes of this period are:

- the real submit -> reply -> speech path was audited end to end rather than guessed at
- the biggest earlier UX problem was confirmed: the live path was still too serial and too full-response-first
- a first major latency pass landed to improve first audio and text/speech synchronization
- a second major pass then collapsed the old two-hop `transcribe -> turn` API path into a unified manual-submit route
- the server now caches session-stable runtime/prompt artifacts instead of rebuilding all of them every turn
- later TTS chunks now get prepared earlier, which should reduce dead air on longer replies
- timing instrumentation is substantially better than before, especially around unified submit, audio-mode wait, chunk prep, and speaking completion

The most important current truth is:

- Peritio's live simulation path is materially tighter than it was on `2026-04-11`
- but the biggest remaining latency bucket is still the server-side serial AI phase inside the unified submit route:
  - transcription
  - model generation
  - first-chunk TTS prefetch

The best concise product judgment now is:

- simulation responsiveness is materially improved
- the architecture is notably better aligned with the manual-submit product model
- the next step should be evidence-led tuning from real traces, not another giant speculative rewrite

## Chronological Timeline Since The Last Summary

### 1. Full Read-Only Audit of the Live Simulation Response Pipeline

After the scoring/reporting checkpoint, the next major effort was a deep read-only audit of the live simulation response path.

That audit traced the real hot path from:

- user taps `Submit Response`
- through transcription
- through model generation
- through TTS generation/fetch
- through device playback start

It explicitly audited:

- model thinking latency
- text-before-speech mismatch
- client orchestration latency
- API/server orchestration latency
- TTS pipeline latency
- existing timing visibility

The strongest conclusions from that audit were:

- the path was still fundamentally serial
- the main live flow was still effectively:
  - finalize recording
  - transcribe
  - generate full text
  - show text
  - start TTS
  - wait for full audio
  - prepare/load audio
  - play audio
- assistant text appearing before speech was not accidental; it followed directly from the state-machine ordering
- prompt/context size and repeated route-level context setup were still real contributors
- the first-chunk TTS round trip was still a major contributor to time-to-first-audio

That audit directly shaped the next implementation pass.

### 2. Backup Checkpoints

Two full backups were created during this period so the user had explicit restore points before the larger simulation-latency refactors.

Backup locations:

- `C:\Users\Robert\Desktop\Visual_Studio_Apps\BackUps\POSTScoreCardFIX_041326`
- `D:\PERITIO BACKUP\CURRENT_BACK_UP`

Both were verified as full mirrors of the current repo at the time they were taken, including:

- `.git`
- workspace junctions under `node_modules/@voicepractice`
- matching file and directory counts

These backups mattered because the next work was intentionally more architectural than a tiny patch, even though it was still tightly scoped to live simulation responsiveness.

### 3. First Major Live Simulation Latency Pass

The first implementation pass after the audit targeted the most obvious first-audio and text/speech mismatch issues without yet collapsing the transcribe/turn boundary.

The biggest changes from that pass were:

- prefetched first-chunk speech was bundled directly into opening and turn responses
- the main path no longer needed a separate first-chunk `/ai/tts` call before first audio
- assistant text commit was delayed until playback actually started, reducing the visual "AI already answered but is not speaking yet" mismatch
- client history was trimmed to the same 24-message window the server actually uses
- some pointless standard-scenario live-path prompt work was removed
- timing instrumentation was expanded so submit-to-playback behavior was easier to read

Important result of that pass:

- first audio got closer to first text
- the main path still remained two-hop on the front half:
  - transcribe request
  - then turn-generation request

That pass improved feel, but it did not yet remove the remaining double-hop architecture.

### 4. Follow-Up Read-Only Optimization Plan

After the first latency pass, another read-only audit was done specifically to decide the best second implementation pass.

That audit concluded the highest-value next steps were:

1. add a single manual-submit endpoint that combines transcription + turn generation + bundled first-chunk speech
2. add session-scoped runtime/prompt caching keyed to the recognized simulation session
3. improve later-chunk continuity by preparing the next chunk earlier
4. strengthen timing visibility around the new hot path

It also explicitly concluded that these should wait for later:

- full end-to-end streaming
- replacing Expo AV
- major auth/session architecture rewrites
- speculative model swaps without timing evidence

### 5. Second Major Live Simulation Latency Pass

This was the major implementation pass that built on the planning audit above.

It targeted the remaining highest-value bottlenecks in this order:

- unified manual-submit endpoint
- session-scoped runtime/prompt cache
- later-chunk continuity improvements
- stronger timing instrumentation
- small hot-path cleanup

This is the most important recent engineering checkpoint after the `2026-04-11` summary.

## What Changed In The Second Major Latency Pass

### 6. Unified Manual-Submit Route

The most important architectural change is the new API route:

- `POST /mobile/users/:userId/ai/submit-turn`

Implemented in:

- `api/src/index.ts`

This route now combines:

- recorded audio input
- transcription
- session/runtime context resolution
- assistant turn generation
- bundled first-chunk speech prefetch

into one main request/response cycle.

That means the primary manual-submit path no longer has to do:

- `transcribe`
- then `turn`

as two separate client->API requests on the happy path.

What the route does:

1. validates mobile token/access/entitlements once
2. accepts multipart audio + JSON payload
3. resolves recognized simulation-session linkage
4. normalizes history to the same 24-message window
5. transcribes the audio
6. reuses or builds the session runtime bundle
7. suppresses transcript text if it looks like assistant echo
8. generates the assistant reply
9. bundles first-chunk speech prefetch when requested
10. returns transcript + assistant text + usage/model data + speech prefetch + runtime diagnostics

The route also preserves current safety expectations:

- access checks still happen
- entitlement/budget checks still happen
- recognized session linkage is preserved
- AI usage events and session touches still happen post-response

Most importantly:

- the old `transcribe -> turn` path was **not** recklessly deleted
- mobile can fall back to the legacy two-hop route if the unified route is unavailable

### 7. Mobile Unified-Submit Client Path

The mobile client was updated to use the new unified route when available.

Main touched files:

- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/unifiedSubmit.ts`
- `mobile/src/screens/SimulationScreen.tsx`

What changed:

- the client now has a real `submitRecordedSimulationTurn(...)` path
- the main manual-submit flow prefers unified submit when:
  - remote AI is enabled
  - transcription should be attempted
  - unified-submit feature gating is enabled
- the client falls back to the old transcribe->turn flow only if the unified route is unavailable
- route-unavailable fallback behavior is intentionally narrow:
  - `404`
  - `405`
  - `501`
  - obvious route-not-found cases

What the client gets back from unified submit:

- transcript text
- assistant text
- speech-prefetch payload for chunk 0
- runtime diagnostics such as:
  - transcription duration
  - cache hit/miss status
  - context build duration
  - model latency
  - speech-prefetch latency

This is the biggest single front-half latency improvement made in this period.

### 8. Session-Scoped Runtime / Prompt Cache

The second major addition was a session-scoped runtime cache:

- `api/src/services/simulationRuntimeCache.ts`

This cache is keyed to the recognized simulation session plus a stable fingerprint including:

- user id
- acting org id
- scenario id
- training id
- difficulty
- persona style
- requested industry id
- submitted training-pack id
- modular-prompt-architecture flag

By design, it caches session-stable live artifacts, including:

- resolved scenario
- resolved segment
- effective difficulty
- effective persona style
- industry id / label / baseline
- counterpart behavior guidance
- resolved active training pack
- rendered system prompt
- rendered opening prompt

The shared runtime resolver in `api/src/index.ts` now uses that cache for:

- opening
- turn
- unified submit

This means the server no longer has to rebuild all of that prompt/runtime context on every turn when the same recognized simulation session continues with the same effective configuration.

Important constraints preserved:

- the cache is session-scoped, not global across users
- it does not cache mutable security or entitlement decisions
- it can bypass cleanly if there is no recognized simulation session id

### 9. Shared Runtime Bundle Refactor

To make the cache actually useful and keep the code understandable, the live runtime assembly was centralized into a shared helper in:

- `api/src/index.ts`

Key shared helper:

- `resolveSimulationRuntimeBundle(...)`

That helper now centralizes the work for:

- config resolution
- scenario resolution
- industry prompt-context resolution
- counterpart behavior guidance
- training-pack lookup
- system/opening prompt construction
- cache hit/miss tracking

This was a structural cleanup that materially reduced duplicated route logic in:

- `/ai/opening`
- `/ai/turn`
- `/ai/submit-turn`

### 10. Later-Chunk Continuity Improvements

The first chunk was already improved in the prior pass. This second pass targeted the remaining roughness on longer replies.

Main touched files:

- `mobile/src/lib/ttsPlayback.ts`
- `mobile/src/screens/SimulationScreen.tsx`

What changed:

- later chunks are no longer only prefetched as raw bytes
- the client now prepares later chunks into playable source forms earlier
- prepared chunk sources are tracked and reused
- chunk-prepared / chunk-playback-start / chunk-complete timing is now logged
- chunk-boundary gap tracking was added

Important practical result:

- later chunks should have less dead air than before because chunk boundaries no longer need to do all prep just-in-time

Important restraint:

- this was still **not** a full streaming rewrite
- Expo AV was not replaced
- the player model stayed understandable instead of becoming a giant speculative abstraction

### 11. Timing / Observability Improvements

The recent pass also improved observability in ways that will matter for the next tuning cycle.

Main touched files:

- `mobile/src/lib/simulationTimingSummary.ts`
- `mobile/src/lib/simulationTimingSummary.test.ts`
- `mobile/src/lib/ttsPlayback.ts`
- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/lib/api.ts`
- `api/src/index.ts`

Important new timing visibility includes:

- unified-submit request start / response
- unified-submit round-trip duration
- cache hit / miss on the server runtime bundle
- runtime context-build duration
- training-pack lookup duration
- model latency
- speech-prefetch TTS latency
- audio-mode reset wait
- assistant ready-to-playback
- playback start
- speaking complete
- chunk prepared
- chunk playback started
- chunk completed
- chunk-boundary gap

This is meaningfully better than where the product was at the last state summary.

### 12. Small Hot-Path Cleanup

One meaningful small cleanup landed on the mobile path:

- recording-payload measurement is no longer a success-path blocker before assistant generation

This is not a huge win by itself, but it is exactly the kind of waste worth removing once the bigger architectural pieces are in place.

## Current Live Turn Architecture

The current intended happy-path live turn architecture now looks like this:

1. user taps `Submit Response`
2. mobile finalizes recording
3. mobile sends **one** unified submit request with:
   - audio
   - scenario/session metadata
   - trimmed history
   - optional first-chunk speech-prefetch request
4. server:
   - validates token/access/entitlements
   - transcribes audio
   - resolves or reuses runtime bundle from the session cache
   - suppresses echo transcripts if needed
   - generates assistant text
   - prebuilds first-chunk speech
5. unified response returns:
   - transcript text
   - assistant text
   - prefetched first-chunk speech
   - runtime diagnostics
6. mobile appends the user message
7. mobile waits for audio-mode reset if needed
8. mobile begins playback using the bundled first chunk
9. assistant text commits when playback actually starts
10. later chunks are fetched and prepared earlier so long replies are smoother

Fallback behavior remains:

- if the unified route is unavailable, mobile falls back to:
  - `/ai/transcribe`
  - then `/ai/turn`
- if remote AI itself is unavailable, local/mock fallback behavior remains coherent

## Validation Performed

The following validation was run during the recent latency implementation work:

```powershell
npm.cmd run build --workspace shared
npm.cmd run build --workspace api
npx.cmd tsc --noEmit -p mobile/tsconfig.json
npx.cmd tsx --test api/src/services/simulationRuntimeCache.test.ts api/src/services/simulationHotPath.test.ts api/src/services/scenarioTextNormalization.test.ts api/src/services/simulationScoring.test.ts
npx.cmd tsx mobile/src/lib/ttsFastStart.test.ts
npx.cmd tsx mobile/src/lib/simulationTimingSummary.test.ts
npx.cmd tsx mobile/src/lib/unifiedSubmit.test.ts
npm.cmd test --workspace api
```

Validation results:

- `shared` build: passed
- `api` build: passed
- mobile TypeScript validation: passed
- focused API tests around the touched areas: passed
- focused mobile timing / chunking / unified-submit fallback tests: passed

Full API suite result:

- `95` passing
- `2` failing

Those two failures were:

- `trusted web auth session stores dashboard scope and device metadata`
- `trusted web auth session touch updates activity metadata only when needed`

Important honesty note:

- those failures are in the web-auth area
- they were not introduced by the live simulation latency work
- they remain unrelated known failures, not simulation regressions

## Current Overall State

### What is now materially stronger

#### 1. Front-half submit path

The biggest practical gain is that the primary live turn no longer needs a separate client->API transcription request followed by a second client->API turn request.

That removes:

- one network round trip
- one duplicate server auth/access pass
- one duplicate route/context setup pass

#### 2. Prompt/runtime rebuild behavior

The system no longer rebuilds all session-stable prompt context on every turn by default.

That is a meaningful architectural improvement because the runtime bundle now behaves more like a per-session asset rather than throwaway per-turn work.

#### 3. Long-reply continuity

Longer replies should now feel smoother because the next chunk can be prepared earlier rather than only fetched as bytes and then fully prepared at the handoff boundary.

#### 4. Timing truth

The current codebase is now much better positioned to answer "where is the delay actually coming from?" with evidence rather than feel.

### What is still true

#### 1. The biggest remaining latency wall is still server-side AI work

After the latest follow-up audit, the best evidence-based judgment is:

- the biggest remaining latency bucket is now the **server-side serial AI phase inside unified submit**

That means:

- transcription
- then model generation
- then first-chunk TTS prefetch

The largest individual sub-bucket is most likely:

- model generation

with first-chunk TTS still a major contributor behind it.

#### 2. Not everything is cached

The session cache now covers the session-stable runtime bundle, but each turn still recomputes or reruns:

- token validation
- access resolution
- entitlement / budget checks
- history normalization
- transcript echo suppression
- prompt message-array assembly from system prompt + current history
- model completion
- first-chunk speech prefetch
- client playback preparation/load

That is now much more reasonable than before. The remaining uncached work is mostly the genuinely turn-specific work.

#### 3. The system is improved, not "final"

This period did not solve:

- end-to-end streaming
- all possible playback overhead
- every conceivable route-level optimization

It made the highest-value practical improvements that were justified by the audit.

## Most Important Files Changed In This Period

### API / server

- `api/src/index.ts`
- `api/src/services/simulationRuntimeCache.ts`
- `api/src/services/simulationRuntimeCache.test.ts`

### Mobile

- `mobile/src/screens/SimulationScreen.tsx`
- `mobile/src/lib/api.ts`
- `mobile/src/lib/openai.ts`
- `mobile/src/lib/unifiedSubmit.ts`
- `mobile/src/lib/unifiedSubmit.test.ts`
- `mobile/src/lib/ttsPlayback.ts`
- `mobile/src/lib/simulationTimingSummary.ts`
- `mobile/src/lib/simulationTimingSummary.test.ts`
- `mobile/src/lib/ttsFastStart.ts`

### Shared

- `shared/src/ttsFastStart.ts`
- `shared/src/index.ts`

## Open Risks / Remaining Limitations

The most important remaining limitations after this period are:

### 1. Unified submit is still internally serial

The product removed the extra front-half client/API hop, which is excellent.

But inside the unified route, the main path is still:

- transcription
- then model generation
- then first-chunk TTS

That is now the main remaining latency wall.

### 2. Cache is in-process only

The runtime cache is intentionally simple and safe:

- in-memory
- process-local
- session-scoped

That is appropriate for this pass, but it is not a distributed cache.

### 3. Expo AV still matters

The later-chunk path is better than before, but Expo AV still imposes:

- source preparation
- load
- play start

That cost still matters, especially on chunk boundaries.

### 4. Current latency work is local, not yet committed

This is operationally important:

- the current latency improvements are implemented and validated locally
- they are not yet represented by a new pushed git commit

## Recommended Next Steps

The strongest next steps now are disciplined, not broad.

### Immediate next practical step

Use the current local build state to do real device trace collection on the updated simulation loop.

The key measurements worth capturing from actual runs are:

- `unifiedSubmitRoundTripMs`
- `runtime.transcriptionMs`
- `runtime.modelLatencyMs`
- `runtime.speechPrefetchTtsLatencyMs`
- chunk-0 and later-chunk playback-start timing
- chunk-boundary gap timing

### Next engineering question to answer from evidence

Once those traces exist, the next small but meaningful question is:

- is the next best optimization target:
  - server-side model/prefetch latency
  - or client-side playback prep/load?

The current code now exposes enough structure to answer that honestly.

### What should not be done impulsively next

Still not recommended as the immediate next move:

- giant streaming rewrite
- Expo AV replacement
- auth/session architecture redesign
- speculative model swap without current timing evidence
- unrelated broad cleanup work

## Final State Judgment

Since the `2026-04-11` summary, Peritio's live simulation pipeline has taken a meaningful second step forward.

The biggest net changes are:

- the front half is now architecturally leaner
- repeated per-turn runtime/prompt work is lower
- long-reply speech continuity is better
- timing visibility is stronger

The most honest concise judgment now is:

- Peritio's live simulation responsiveness is materially better than it was at the last summary
- the most important remaining latency problem is now much narrower and clearer
- the system is in a good place for a real-device, trace-led next tuning cycle rather than another speculative architecture detour

That is a healthy checkpoint.
