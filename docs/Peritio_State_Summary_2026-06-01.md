# Peritio State Summary (2026-06-01)

This document records the major work completed after the prior `2026-05-04` state summary.

It is intentionally detailed and handoff-oriented.

This period was centered on:

- centralizing OpenAI model configuration
- moving the active Render GPT profile to explicit GPT-5.4 Responses API settings
- removing brittle runtime model-prefix routing
- hardening mobile submit-turn recovery for short valid responses and delayed assistant replies
- validating the pushed backend deployment and latest Android preview APK
- confirming that earlier scoring-integrity guarantees remain intact

The most important product truth at the end of this work is:

- Render is healthy on the intended pushed commit
- simulation opening, turn, and scoring use `gpt-5.4` through the Responses API
- admin custom-scenario generation uses `gpt-5.4-mini` through the Responses API
- reasoning effort is explicit and configurable
- simulation output caps are route-specific and unchanged
- short valid responses such as `ok`, `yeah`, `that sucks`, and `I don't know` are accepted
- legacy `/ai/turn` fallback is reserved for mixed-version route compatibility
- provider failures, timeouts, and malformed assistant replies no longer silently start a second legacy generation request
- fake/local/fallback score numbers remain prohibited after verified scoring failure
- the latest Android preview APK was built from the same commit now deployed on Render

## Current Baseline

As of the end of this summary:

- branch: `main`
- current `HEAD`: `d62835c`
- full commit SHA: `d62835c7ef12c739eebc89a1c4d83235947a349f`
- latest pushed commit on `main`: `Harden mobile simulation turn recovery`
- remote: `origin/main`
- `HEAD` matches `origin/main`
- local worktree before this summary document was created: clean
- live Render `/ready`: healthy
- live Render `/version`: serving `d62835c7ef12c739eebc89a1c4d83235947a349f`

Recent pushed commits, newest first:

- `d62835c` - `Harden mobile simulation turn recovery`
- `7660f40` - `Revert "Remove generated Peritio state summary snapshot"`
- `c546967` - `Remove generated Peritio state summary snapshot`
- `463dd8b` - `Centralize OpenAI config and harden simulation turn recovery`
- `1c2121d` - `Centralize OpenAI model configuration`

Important note:

- the remove/revert pair restored the prior `Peritio_State_Summary_2026-05-04.md` snapshot
- there is no net application behavior change from that remove/revert pair
- this new summary document was created after `d62835c`
- unless separately committed later, this document is the only local change after the last pushed application commit

## Executive Summary

This cycle had five major outcomes.

### 1. OpenAI model selection is now centralized and config-driven

The API previously had model selection and API-path behavior that was too easy to couple to model-name patterns.

A dedicated configuration layer now owns:

- chat/admin model
- simulation model
- API family selection
- Responses API reasoning effort
- route-specific simulation output caps
- transcription model
- speech/TTS model default

The new central module is:

- `api/src/openaiModelConfig.ts`

Runtime config loads it once through:

- `api/src/runtimeConfig.ts`

API routes then consume the resolved model config rather than making their own model-selection decisions.

### 2. Render now uses an explicit GPT-5.4 Responses API profile

The intended active Render GPT-related env profile is:

```text
OPENAI_SIMULATION_MODEL=gpt-5.4
OPENAI_SIMULATION_API_FAMILY=responses
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=low
OPENAI_SIMULATION_TURN_REASONING_EFFORT=low
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=low
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_CHAT_API_FAMILY=responses
OPENAI_CHAT_REASONING_EFFORT=low
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

Additional expectations:

- `OPENAI_TTS_MODEL` is not required in Render
- when unset, TTS safely defaults to `tts-1`
- no route-specific token-cap env overrides are required
- simulation caps remain:
  - opening: `160`
  - turn: `220`
  - score: `1200`

Live Render `/version` confirms:

```json
{
  "gitSha": "d62835c7ef12c739eebc89a1c4d83235947a349f",
  "models": {
    "chatModel": "gpt-5.4-mini",
    "simulationModel": "gpt-5.4",
    "transcriptionModel": "whisper-1"
  }
}
```

The public `/version` route does not expose API-family or reasoning-effort values. Those remain operator-verified Render dashboard settings plus code-validated runtime behavior.

### 3. Mobile submit-turn recovery was hardened after a short-response spinner incident

A simulation appeared stuck after the user said:

```text
that sucks
```

The audit ruled out minimum-length validation.

Short valid text remains valid:

- `ok`
- `yeah`
- `that sucks`
- `I don't know`
- `I don't know` with a typographic apostrophe

The original reliability problem was sequential waiting:

- mobile could wait up to `75` seconds for unified submit-turn assistant completion
- a timeout or provider-side failure could silently trigger legacy `/ai/turn`
- legacy generation could then wait another `45` seconds
- the user could see a processing state for roughly two minutes

The first hardening pass limited the legacy path to compatibility fallback.

A later audit found two additional edge cases:

1. provider/model `not found` errors could be mistaken for missing-route compatibility
2. malformed successful await payloads could fall through into legacy generation

Those edge cases were fixed narrowly.

### 4. Backend deployment and APK source now align

Final verification confirmed:

- local `main` matches `origin/main`
- Render is serving the expected pushed commit
- no local-only code changes remain
- no generated test artifacts remain
- the latest EAS Android preview APK was built from `d62835c`

Latest EAS preview build:

- build id: `8b54cada-4338-4b63-aaac-7c765ba8985f`
- status: `FINISHED`
- profile: `preview`
- platform: `ANDROID`
- source SHA: `d62835c7ef12c739eebc89a1c4d83235947a349f`
- artifact: `https://expo.dev/artifacts/eas/icUkx22nFQdvUcxTxDo1UX.apk`

### 5. Scoring integrity remains preserved

This cycle did not modify:

- scoring rubric behavior
- score persistence behavior
- dashboard aggregation
- auth
- tenant scoping
- billing or usage enforcement
- transcript retention
- transcript logging
- mobile layout
- lifecycle/background behavior
- transcription behavior
- TTS behavior

The earlier product rule remains intact:

- verified scores may display and persist
- real persisted score recovery is allowed
- score unavailable must remain honest and scoreless
- insufficient evidence must remain separate from service failure
- failed scoring must not create dashboard performance records

## Product Decisions Captured

### OpenAI Configuration Principle

Model changes must be explicit.

Peritio should select:

- model ID through env configuration
- API family through env configuration
- reasoning effort through env configuration
- simulation output cap by route

Peritio must not infer runtime behavior from:

- model prefix
- model-name substring
- a generic `startsWith("gpt-5")` rule

The current compatibility fallback is intentionally narrow:

- `gpt-5.4` defaults to Responses API
- `gpt-5.2-chat-latest` remains recognized as a Responses API rollback model
- explicit env values override compatibility defaults

### Mobile Compatibility Principle

The mobile legacy `/ai/turn` path exists only for mixed-version rollout compatibility.

It may run when:

- unified route returns `404`
- unified route returns `405`
- unified route returns `501`
- a response explicitly states that a route or endpoint is not found

It must not silently run after:

- await timeout
- provider `503`
- provider failure
- provider/model `not found`
- malformed assistant reply
- empty assistant reply
- invalid successful response shape

### Scoring Integrity Principle

Peritio may show:

- a verified authoritative score
- a recovered real persisted authoritative score
- a score-unavailable state
- a normal no-scorecard-created state for insufficient evidence

Peritio must not show:

- a fake local fallback score
- synthetic score numbers after verified scoring failure
- sparse evaluator output normalized into plausible neutral values
- unavailable scoring as dashboard performance

## Detailed Work Completed

## Part 1 - Central OpenAI Model Configuration

### New configuration module

`api/src/openaiModelConfig.ts` centralizes:

- `OPENAI_CHAT_MODEL`
- `OPENAI_CHAT_API_FAMILY`
- `OPENAI_CHAT_REASONING_EFFORT`
- `OPENAI_SIMULATION_MODEL`
- `OPENAI_SIMULATION_API_FAMILY`
- `OPENAI_SIMULATION_OPENING_REASONING_EFFORT`
- `OPENAI_SIMULATION_TURN_REASONING_EFFORT`
- `OPENAI_SIMULATION_SCORE_REASONING_EFFORT`
- `OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS`
- `OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS`
- `OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS`
- legacy aggregate `OPENAI_SIMULATION_MAX_OUTPUT_TOKENS`
- `OPENAI_TRANSCRIPTION_MODEL`
- `OPENAI_TTS_MODEL`

### Code-level defaults

The resolved code defaults are:

```text
chat model: gpt-4o-mini
chat API family: chat_completions
chat reasoning effort: unset

simulation model: gpt-5.4
simulation API family: responses
simulation reasoning effort: low

simulation opening cap: 160
simulation turn cap: 220
simulation score cap: 1200

transcription model: whisper-1
speech model: tts-1
```

The chat code fallback remains intentionally conservative for backward compatibility.

The recommended deployed chat profile is explicitly env-driven:

```text
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_CHAT_API_FAMILY=responses
OPENAI_CHAT_REASONING_EFFORT=low
```

### Runtime consumers

Simulation opening, turn, and score use:

- `requestSimulationCompletion(...)`
- resolved simulation model
- resolved API family
- route-specific output cap
- route-specific reasoning effort

Admin custom-scenario generation uses:

- resolved chat/admin model
- resolved chat/admin API family
- resolved chat/admin reasoning effort

Transcription uses:

- resolved transcription model

Optional remote TTS uses:

- resolved speech model

### Hidden hardcoded model audit

No runtime request path still relies on hidden hardcoded `gpt-5.2-chat-latest`, `gpt-4o-mini`, or older GPT models.

Remaining older model references are intentional:

- code-level chat compatibility default
- tactical rollback compatibility
- tests
- historical/demo support-case metadata
- documentation explaining compatibility behavior

## Part 2 - OpenAI Request Shapes

### Chat Completions compatibility path

The Chat Completions path sends:

```json
{
  "model": "configured-model",
  "messages": [],
  "temperature": 0.75,
  "max_tokens": 220
}
```

This remains available for explicit rollback profiles.

### Responses API path

The Responses API path sends:

```json
{
  "model": "configured-model",
  "input": [],
  "max_output_tokens": 220,
  "reasoning": {
    "effort": "low"
  }
}
```

When reasoning effort is unset:

- `reasoning` is omitted

For Responses API requests:

- route-level temperature values are intentionally not forwarded
- `max_output_tokens` is used instead of `max_tokens`
- text extraction supports `output_text` and structured output chunks
- empty output fails safely

### Other OpenAI endpoints

The backend continues to use:

- `/v1/audio/transcriptions`
- `/v1/audio/speech`

No realtime API path was introduced.

## Part 3 - Active Model Usage Map

### `OPENAI_CHAT_MODEL`

Practical role:

- admin custom-scenario generation

Active Render value:

```text
gpt-5.4-mini
```

### `OPENAI_SIMULATION_MODEL`

Practical roles:

- simulation opening line
- unified submit-turn assistant reply
- legacy `/ai/turn` compatibility reply
- simulation scoring/evaluation

Active Render value:

```text
gpt-5.4
```

### `OPENAI_TRANSCRIPTION_MODEL`

Practical role:

- recorded speech transcription

Active Render value:

```text
whisper-1
```

### `OPENAI_TTS_MODEL`

Practical role:

- optional remote speech synthesis

Expected Render behavior:

- env may remain unset
- code safely defaults to `tts-1`

## Part 4 - Mobile Submit-Turn Recovery

### Unified path

The latest mobile flow:

1. starts the unified `submit-turn-await` request
2. submits recorded audio through unified `/ai/submit-turn`
3. receives transcript-first response when configured
4. waits for assistant completion using correlation ID
5. commits the assistant reply only when it is usable
6. returns to listening after success or recoverable failure

### Timeout values

Current mobile network waits:

```text
unified submit-turn: 75 seconds
submit-turn-await: 75 seconds
opening: 45 seconds
legacy /ai/turn: 45 seconds
score: 45 seconds
remote TTS: 30 seconds
```

### Short valid input

The short-input audit confirmed:

- no minimum-length gate rejects valid short responses
- trimming rejects whitespace-only input
- assistant-echo detection remains intentional
- echo comparison skips very short normalized text to avoid false positives

Valid examples:

- `ok`
- `yeah`
- `that sucks`
- `I don't know`

### Narrow compatibility fallback

`mobile/src/lib/unifiedSubmit.ts` now classifies compatibility fallback narrowly.

Allowed fallback signals:

- request failed with `404`
- request failed with `405`
- request failed with `501`
- exact `not found`
- explicit `route not found`
- explicit `endpoint not found`

Disallowed fallback signals:

- timeout
- `503`
- generic provider error
- `OpenAI model not found`
- malformed awaited payload
- empty awaited assistant reply

### Malformed assistant payload protection

`isUsableAwaitedAssistantReply(...)` now requires:

- `outcome === "assistant_reply"`
- non-empty assistant text after trimming

A malformed successful await payload now enters the existing recoverable error path instead of starting legacy generation.

## Part 5 - Preparing Scenario / Opening State

The brief manually observed `Preparing scenario` pause remains a watch item, not a proven defect.

Current opening behavior:

- initial opening prefetch uses mobile API timeout of `45` seconds
- backend opening route logs context-ready, response-sent, and error stages
- backend OpenAI empty output becomes an error
- backend errors return `503`
- mobile initialization clears `isInitializing` in `finally`
- mobile exits the preparing state after success or handled failure

No concrete stuck-state defect was found in the network/API opening path.

Pre-existing native TTS/audio promise risks remain documented separately.

## Part 6 - Backend Await Route And Logging

### Await route

Backend route:

```text
GET /mobile/users/:userId/ai/submit-turn-await/:correlationId
```

Behavior:

- authenticates the mobile user
- scopes access through existing tenant rules
- waits up to `75` seconds
- returns `504` on timeout
- returns `503` on assistant-generation error
- returns result payload on success

### Safe searchable markers

Useful log markers:

- `[ai-simulation]`
- `[ai-responses-error]`
- `[ai-transcription]`
- `[simulation-route]`
- `[simulation-no-transcript]`
- `[simulation-turn-summary]`
- `[simulation-score-failed]`
- `[simulation-score-persist-failed]`
- `[TTS-TIMING]`
- `[tts-call]`

### Safe metadata

Logs include useful metadata such as:

- route
- correlation ID
- stage
- elapsed time
- response outcome
- requested model
- response model
- API path
- reasoning effort
- output cap
- token usage
- prompt character count
- transcript character count
- audio byte count
- MIME type
- TTS latency

Logs do not add:

- transcript text
- raw user speech
- audio content
- audio payload
- full prompt content

Existing logs do include internal identifiers such as user IDs and session IDs. They are metadata-only, not anonymous.

## Part 7 - Scoring Integrity Re-Verification

### Minimum evidence

Backend scoring requires:

```text
MIN_USER_TURNS_FOR_SCORE = 3
```

Fewer than three real user turns returns:

```text
status=not_scored
reason=insufficient_evidence
```

This remains separate from service failure.

### Payload validation before persistence

The score route:

1. requests evaluator output
2. extracts JSON
3. validates required score fields
4. normalizes scorecard values
5. builds persisted record
6. appends score record
7. returns verified result

Malformed or sparse evaluator output is rejected before persistence.

### Persistence failure

If score generation succeeds but persistence fails:

- backend logs `[simulation-score-persist-failed]`
- backend returns `503`
- mobile does not treat the score as verified
- false success is not shown

### Persisted recovery

Recovery route:

```text
GET /mobile/users/:userId/ai/score?simulationSessionId=...
```

Recovery requires a real persisted record with valid score fields.

Recovery does not invent fallback score values.

### Dashboard integrity

Dashboard performance aggregation continues to consume real conclusive `score_records`.

Failed or unavailable scoring does not create dashboard performance.

## Part 8 - Usage, Billing, And Entitlement Guardrails

No usage, billing, or entitlement behavior changed in this cycle.

Verified preserved behavior:

- simulation start recognition remains required
- usage finalization remains linked to recognized simulation sessions
- retries remain idempotent
- deterministic usage-session identity remains intact
- duplicate completion safely resolves to the prior authoritative usage record
- monthly org minute enforcement remains unchanged
- per-user daily limits remain unchanged
- retry/recovery does not create a duplicate usage session
- score IDs remain anchored to recognized simulation session IDs when available
- score persistence uses upsert behavior for stable IDs

## Part 9 - Documentation Updates

Updated:

- `api/.env.example`
- `api/README.md`

The recommended documented profile now matches the active Render configuration:

```text
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_CHAT_API_FAMILY=responses
OPENAI_CHAT_REASONING_EFFORT=low
OPENAI_SIMULATION_MODEL=gpt-5.4
OPENAI_SIMULATION_API_FAMILY=responses
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=low
OPENAI_SIMULATION_TURN_REASONING_EFFORT=low
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=low
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

The API README also documents:

- optional reasoning-effort values
- route-specific caps
- legacy aggregate cap fallback
- TTS `tts-1` default
- chat compatibility defaults
- simulation compatibility behavior

This state summary additionally captures:

- tactical rollback steps
- provider-side abort residual risk
- reasoning-token cap monitoring
- hard-scenario manual validation guidance

## Files Changed In This Cycle

### Backend/API

- `api/src/openaiModelConfig.ts`
- `api/src/openaiModelConfig.test.ts`
- `api/src/openaiClient.ts`
- `api/src/openaiClient.test.ts`
- `api/src/runtimeConfig.ts`
- `api/src/index.ts`
- `api/.env.example`
- `api/README.md`

### Mobile

- `mobile/src/lib/openai.ts`
- `mobile/src/lib/unifiedSubmit.ts`
- `mobile/src/lib/unifiedSubmit.test.ts`
- `mobile/src/screens/SimulationScreen.tsx`

### Docs

- `docs/Peritio_State_Summary_2026-05-04.md` was restored after an accidental removal
- `docs/Peritio_State_Summary_2026-06-01.md` is this new handoff summary

## Validation Completed

### Git and deployment

Verified:

```text
main == origin/main == d62835c7ef12c739eebc89a1c4d83235947a349f
```

Verified live endpoints:

```text
GET https://voicepractice-api-dev.onrender.com/ready
GET https://voicepractice-api-dev.onrender.com/version
```

Render `/ready` was healthy.

Render `/version` returned the expected deployed SHA and model IDs.

### EAS Android preview

Verified through:

```powershell
cd mobile
npx.cmd eas-cli build:list --platform android --limit 5 --json --non-interactive
```

Latest preview build:

```text
id: 8b54cada-4338-4b63-aaac-7c765ba8985f
status: FINISHED
git commit: d62835c7ef12c739eebc89a1c4d83235947a349f
profile: preview
artifact: https://expo.dev/artifacts/eas/icUkx22nFQdvUcxTxDo1UX.apk
```

### Focused model and recovery tests

Passed:

```powershell
npm.cmd run build --workspace api
npx.cmd tsc --noEmit -p mobile/tsconfig.json
npx.cmd tsx mobile/src/lib/unifiedSubmit.test.ts
cd api
npx.cmd tsx --test src/openaiClient.test.ts src/openaiModelConfig.test.ts src/runtimeConfig.test.ts src/services/simulationScoring.test.ts
```

Focused API result:

```text
22 tests passed
0 failed
```

### Broader validation

Passed:

```powershell
npm.cmd run verify:fast
npm.cmd run test:critical-flow
git diff --check
```

Full API suite:

```powershell
npm.cmd test --workspace api
```

Result:

```text
136 passed
2 failed
```

The two failures are unrelated stale auth-session fixtures:

- `trusted web auth session stores dashboard scope and device metadata`
- `trusted web auth session touch updates activity metadata only when needed`

Cause:

- fixtures issue sessions on `2026-03-30`
- tests validate tokens against the current runtime clock in June 2026
- those tokens are expired

Auth behavior was not changed during this cycle.

## Current Behavior Matrix

### Normal simulation opening

Expected:

- mobile prefetches opening
- backend uses `gpt-5.4`
- backend uses Responses API
- reasoning effort is `low`
- cap is `160`
- mobile exits preparing state after success

### Normal simulation turn

Expected:

- audio is transcribed with `whisper-1`
- transcript-first unified route returns quickly
- assistant generation continues through correlation ID
- mobile awaits assistant completion
- backend uses `gpt-5.4`
- reasoning effort is `low`
- cap is `220`
- reply plays through existing TTS path

### Short valid response

Expected for `ok`, `yeah`, `that sucks`, or `I don't know`:

- transcript remains valid
- no minimum-length rejection occurs
- no false assistant-echo rejection occurs
- normal assistant reply is generated

### Empty or whitespace transcript

Expected:

- classified as no clear speech
- no assistant generation occurs
- mobile returns to recoverable listening state

### Await timeout or provider failure

Expected:

- no silent legacy generation
- mobile exits processing through recoverable error handling
- correlation ID remains available for diagnosis

### Mixed-version rollout

Expected:

- older backend without unified route may return route-unavailable status
- latest mobile APK may use legacy `/ai/turn` compatibility path
- real provider failures do not trigger compatibility fallback

### Verified scoring

Expected:

- at least three real user turns
- evaluator output validates
- real score persists
- verified scorecard displays
- dashboard may consume conclusive persisted record

### Insufficient evidence

Expected:

- fewer than three real user turns
- no scorecard created
- no service-failure copy
- no fake values
- no score record

### Score unavailable

Expected:

- verified scoring failed or could not persist
- persisted recovery is attempted
- if recovery misses, final state is scoreless
- no fake fallback values display
- no failed score becomes dashboard performance

## Build / APK Command

PowerShell command for a new Android Expo preview APK:

```powershell
cd C:\Users\Robert\Desktop\Visual_Studio_Apps\VoicePracticeApp\mobile
npx.cmd eas-cli build --platform android --profile preview
```

The preview profile currently sets:

```text
EXPO_PUBLIC_REMOTE_AI_ENABLED=true
EXPO_PUBLIC_REMOTE_TTS_ENABLED=true
EXPO_PUBLIC_API_BASE_URL=https://voicepractice-api-dev.onrender.com
```

## Exact Render Env Vars To Keep

```text
OPENAI_SIMULATION_MODEL=gpt-5.4
OPENAI_SIMULATION_API_FAMILY=responses
OPENAI_SIMULATION_OPENING_REASONING_EFFORT=low
OPENAI_SIMULATION_TURN_REASONING_EFFORT=low
OPENAI_SIMULATION_SCORE_REASONING_EFFORT=low
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_CHAT_API_FAMILY=responses
OPENAI_CHAT_REASONING_EFFORT=low
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

Leave these unset unless a later validated change is intentionally made:

```text
OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS
OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS
OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS
OPENAI_SIMULATION_MAX_OUTPUT_TOKENS
OPENAI_TTS_MODEL
```

## Tactical Rollback Plan

If a production issue requires model rollback:

```text
OPENAI_SIMULATION_MODEL=gpt-5.2-chat-latest
OPENAI_SIMULATION_API_FAMILY=responses
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_CHAT_API_FAMILY=chat_completions
```

Remove or blank:

```text
OPENAI_SIMULATION_OPENING_REASONING_EFFORT
OPENAI_SIMULATION_TURN_REASONING_EFFORT
OPENAI_SIMULATION_SCORE_REASONING_EFFORT
OPENAI_CHAT_REASONING_EFFORT
```

Then:

1. redeploy Render
2. confirm `/ready`
3. confirm `/version`
4. run a normal Android simulation
5. run a short-response turn
6. complete verified scoring
7. inspect Render logs

Important:

- `gpt-5.2-chat-latest` is a tactical rollback target only
- OpenAI documents it as deprecated
- it should not become the long-term primary target again

## Known Caveats And Residual Risks

### 1. Provider-side backend abort deadline is still absent

The backend OpenAI client uses raw `fetch(...)` calls without a provider-side abort signal.

Mobile waits are bounded, but backend work may continue after a mobile timeout.

This is a future targeted hardening item, not a blocker for the current validated rollout.

### 2. Responses API output caps include reasoning budget

For Responses API calls, `max_output_tokens` includes:

- visible output tokens
- reasoning tokens

Current caps are intentionally unchanged:

```text
opening: 160
turn: 220
score: 1200
```

Harder scenarios should be monitored for:

- empty output
- incomplete output
- truncated reply
- unusual latency
- score JSON parse failure
- score payload validation failure

Do not raise caps speculatively. Change them only after concrete evidence.

### 3. Partial non-empty Responses output remains a watch item

The backend rejects empty OpenAI Responses output.

A non-empty but incomplete provider response could still be accepted for simulation text.

Score output remains protected by JSON parsing and payload validation.

Future hardening may inspect provider incomplete-status metadata if logs show a concrete need.

### 4. Native audio and TTS promises remain pre-existing watch items

Mobile network requests are bounded.

Native audio-mode reset and some TTS playback promise paths do not have explicit native deadlines.

These were not introduced by the GPT model work.

Investigate only if real-device logs show a repeatable stuck state outside the bounded network/API paths.

### 5. Render public version metadata is intentionally limited

Render `/version` confirms:

- deployed Git SHA
- chat model
- simulation model
- transcription model

It does not expose:

- API families
- reasoning efforts
- TTS model
- token caps

Verify private env values in the Render dashboard after future changes.

### 6. GPT-5.5 is now documented as the latest general-purpose model

The current GPT-5.4 deployment remains a valid explicit target.

Do not change models casually.

A future model upgrade should be a separate evaluation pass with:

- mocked request-shape tests
- local smoke tests
- Render env rollout order
- hard-scenario latency checks
- scoring consistency checks
- Android validation
- rollback preparation

### 7. Full API suite has two unrelated stale auth fixtures

Current full-suite result:

```text
136 passed
2 failed
```

The failures are stale date fixtures in `api/src/services/webAuth.test.ts`.

They should be fixed in a separate auth-test-maintenance task.

Do not mix that work into model or mobile reliability changes.

## Manual Validation Checklist

### Render

- confirm `/ready`
- confirm `/version`
- confirm private Render API-family env values
- confirm private Render reasoning-effort env values
- scan logs for `[ai-simulation]`
- scan logs for `[ai-responses-error]`
- scan logs for `submit-turn-await`
- scan logs for `[simulation-no-transcript]`
- scan logs for `invalid_score_payload`
- scan logs for `score_generation_failed`
- scan logs for `[simulation-score-persist-failed]`
- scan logs for `score_records`

### Android APK

- install latest preview APK built from `d62835c`
- start normal simulation
- confirm preparing-scenario state exits normally
- complete at least three real user turns
- submit `ok`
- submit `yeah`
- submit `that sucks`
- submit `I don't know`
- end early with fewer than three turns
- confirm honest insufficient-evidence state
- run harder scenario
- watch latency and reply completeness
- end and confirm verified scorecard
- run another simulation

### Score persistence

- use a normal mobile user, not superuser
- complete verified score
- confirm scorecard appears
- spot-check persisted score record if practical
- confirm dashboard performance consumes only real conclusive score record

### Admin

- generate custom scenario
- confirm generated JSON fields populate cleanly
- confirm no admin auth or tenant-scope regression

## Official OpenAI References

- GPT-5.4: `https://developers.openai.com/api/docs/models/gpt-5.4`
- GPT-5.4 mini: `https://developers.openai.com/api/docs/models/gpt-5.4-mini`
- latest model guidance: `https://developers.openai.com/api/docs/guides/latest-model`
- Responses API request shape: `https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses`
- tactical rollback model: `https://developers.openai.com/api/docs/models/gpt-5.2-chat-latest`
- GPT-4o mini compatibility model: `https://developers.openai.com/api/docs/models/gpt-4o-mini`

## Important Boundaries Preserved

This cycle did not change:

- scoring rubric behavior
- score persistence semantics
- dashboard aggregation
- auth
- tenant scoping
- monthly-minute enforcement
- per-user usage limits
- billing behavior
- transcript retention policy
- transcript content logging
- audio content logging
- mobile layout
- lifecycle/background behavior
- transcription model behavior
- TTS behavior

## Recommended Next Steps

### Immediate

1. Keep the latest Render env profile unchanged.
2. Install and validate the latest APK artifact from `d62835c`.
3. Run the short-response checklist.
4. Run at least one harder simulation.
5. Complete verified scoring with a normal mobile user.
6. Inspect Render latency and scoring logs after testing.

### Separate future hardening tasks

Keep these isolated from the validated model migration:

1. Document or implement provider-side backend OpenAI abort deadlines.
2. Inspect Responses incomplete-status metadata if logs show truncation.
3. Fix the two stale web-auth date fixtures.
4. Evaluate GPT-5.5 only as a separate model-upgrade project.
5. Continue iOS readiness and device validation after Android sign-off.

## Final Current State

Peritio is in a validated GPT-5.4 rollout state.

The API model layer is centralized.

The deployed GPT model profile is explicit.

The mobile short-turn recovery path no longer hides timeout, provider, or malformed-reply failures behind a second legacy generation request.

The latest Render backend and Android preview APK source both use:

```text
d62835c7ef12c739eebc89a1c4d83235947a349f
```

The earlier scoring-integrity guarantees remain in place:

- verified score when verified score exists
- recovered score only when a real persisted score exists
- score unavailable when verified scoring fails
- no scorecard created when the user ends too early
- no fake local fallback score numbers
- no failed score records consumed by dashboard performance

The next work is validation and monitoring, not another broad remediation pass.
