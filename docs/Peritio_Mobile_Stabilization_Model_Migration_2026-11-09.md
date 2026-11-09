# Mobile stabilization and model migration — November 9, 2026

Current release-preparation status: **independent review PASS WITH MINOR FINDINGS; four approved reliability refinements completed, with 37/37 final focused tests passing on Windows/Node 24.22.2. Approved for commit and staging promotion for one consolidated Linux CI run.** Linux execution and staging/real-microphone acceptance remain outstanding. No manual deployment or production push is authorized by this preparation. Earlier uncommitted checkpoints below describe historical state. The original missing-VAD finding and negative-control probe below are historical, superseded by the final implementation/evidence section; they are retained to distinguish the original defect from what was actually fixed.

## Baseline and diagnosis

Inspected production merge `392948ed1360e857771ef0405a0266bafe0d947b`, with parents `438fa2e9bc0d848697c1c5f5b8774130435d8aae` and `cc8ffe72c0073f16be84cdcafce02c31842ff7a7`. Work is on local branch `fix/mobile-stability-model-migration`, still at that merge. No commit or push was made.

The production merge did not change `openaiClient.ts`, model configuration, recording profile, audio guard or `SimulationScreen.tsx` relative to its first parent. Its runtime tree matches staging; the staging/production tree difference is mobile version 1.0.0 versus the preserved production version 1.1. There is no evidence that this security release introduced the fabricated sentence.

The owner's reproduction is explicit Submit after saying nothing, following the AI's spoken response. The exact recording and device acoustic levels were not accessed, so the particular provider output cannot be replayed or independently attributed to an acoustic threshold.

Relevant history:

- `d559029` introduced recording/turn reliability protections, including capture validity checks.
- `2f9df95e42a4b6c6ddbbb6727f4978a7987de5d3` (August 14, “Honor explicit simulation submit and surface capture failures”) deliberately let explicit Submit reach transcription despite inconclusive voice detection. This protected quiet speech and unreliable microphone meters, but left the silent-submit path open.
- Subsequent protections check file existence, size, duration, empty/unusable transcripts and assistant echo. A multi-second silent AAC file can satisfy the file checks; a fabricated grammatical sentence passes the text checks. No verified earlier phrase-specific fix was found that would justify restoring a phrase blocklist.

The flow is Expo Audio mono AAC/M4A recording with metering → capture validation → unified `/ai/submit-turn` or legacy `/ai/transcribe` → OpenAI file transcription → usable-text/echo checks → user bubble and assistant generation → confirmed history used for scoring. The API's shared `transcribeSimulationAudioFile` calls `requestTranscription` for both upload routes. Nonempty ASR text alone previously provided no acoustic evidence of speech.

## Silence defenses and original server gap (historical finding)

`simulationAudioGuard.ts` now tracks aggregate microphone levels, not audio samples or recorded text. A recording is rejected before upload only when it has at least four valid meter observations spanning at least half a recording of 600 ms or longer, a peak at or below -70 dB and a level range no greater than 3 dB. This targets sustained low, flat capture rather than restoring the old “no voice threshold hit means reject” rule.

Missing, invalid, sparse or stale meter readings remain inconclusive. Expo Android maps `getMaxAmplitude` exceptions and actual zero amplitude to the same -160 dB result. This sentinel is now treated as unavailable, not as confirmed silence. Any unavailable interval makes the whole recording's meter evidence inconclusive because genuine speech could have occurred during that interval. The status callback also records missing readings. Quiet modulated speech is allowed even below the older voice threshold. Signal evidence resets for every recording. Local rejection uses the existing clear-speech retry path; retention/cleanup are unchanged. This client hint cannot be the authority for installed apps or solve ordinary quiet-room noise.

At the API boundary, legacy verbose Whisper responses can suppress text when every segment reports both high no-speech probability (at least 0.9) and low average log probability (below -0.5). This is not protection for the migrated default: `gpt-transcribe` does not return that Whisper field, and configured Whisper aliases migrate to it. Missing confidence metadata and empty detected-language arrays are not proof of silence. The genuinely spoken words “Thank you for watching” remain valid. New file transcription requests use JSON and `languages[]=en`; optional chunking settings are omitted.

**Original release blocker, before the final implementation:** currently installed apps had no authoritative server acoustic admission check. Neither the client level threshold nor a model change met that requirement. The API had no packaged AAC/M4A decoder or VAD dependency. `@breezystack/lamejs` is an MP3 encoder, not an incoming-audio decoder or speech classifier. FFmpeg installed by `api/Dockerfile.video-worker` belongs to a separate Docker worker; `render.yaml` did not provision it into the API service. A local Windows FFmpeg installation did not establish availability on the Render API. Sending microphone recordings through the existing R2/video-worker pipeline would introduce different retention and processing behavior and was not done.

The final implementation below supplies the missing API-local packaged decoder and CPU VAD in the common helper used by both routes. It uses seekable, request-scoped encoded input and bounded in-memory PCM, rather than the worker/R2 workflow. These are explicitly added runtime dependencies and model assets in this authorized final implementation pass. An RMS-only substitute would falsely reject soft speech while passing some noise and was not used.

## Model migration and compatibility

Official model retirement and replacement guidance was checked November 9. [Deprecations](https://developers.openai.com/api/docs/deprecations) confirms that `gpt-4o-mini-tts` also retires January 6, 2027. Replacing `tts-1` with it would not resolve that deadline.

| Active role | New default | Compatibility treatment |
| --- | --- | --- |
| General chat / inherited scenario generation | `gpt-6-luna` | Existing Chat endpoint retained, reasoning `none`, `max_completion_tokens`; explicit Responses configuration remains supported. |
| Recorded-file transcription | `gpt-transcribe` | Existing upload endpoint; JSON output and plural string language hint, `languages[]=en`. Optional chunking omitted. |
| Speech generation | `gpt-realtime-2.1-mini` | Server-only Realtime WebSocket, then MP3 encoding. Not a substitution in `/audio/speech`. |
| Simulation opening, live turns and scoring | Existing `gpt-5.4` defaults | Prompts, caps, low reasoning and scoring contract preserved. |

Known retiring GPT-4o-mini and Whisper/transcribe aliases/snapshots map to their replacements. **Explicit TTS pins are preserved**, allowing temporary emergency rollback to the previous `gpt-4o-mini-tts` path or supported snapshots before January 6, 2027; omission still defaults to Realtime. No automatic provider fallback chain was added. The mini-TTS rollback retains preset instructions, voices, speeds, authorization and MP3 transport. Generic `tts-1` pins are not a promise that newer cedar/marin presets work with that older model. `ENABLE_REMOTE_TTS=false` remains a disable switch, but returns the existing 501 from the API and does not guarantee device-speech fallback: installed builds can require remote speech. Other explicit models, historical labels and hosted configuration remain untouched.

Luna Chat uses nonreasoning behavior by default and its supported token-limit field. Explicit reasoning requests omit incompatible sampling fields; Responses supports the same reasoning choice. See [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and the [multipart reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

The speech adapter uses a fresh authenticated server connection per existing TTS chunk. It waits for session configuration, requests an out-of-band audio response, and accepts only completed audio with a matching spoken transcript. A bounded English normalizer now accepts natural cardinal numbers, decimals, USD dollars/cents and percentages, including optional number-word conjunctions and singular/plural currency units. For example, `$1,250.50` can match “one thousand two hundred and fifty dollars and fifty cents”; `25%` can match “twenty-five percent.” Changed amounts, dollars versus percent, and lost negative signs still reject the response. There is no fuzzy edit-distance acceptance or removal of all numbers. Other currencies, dates, identifiers, contractions and abbreviations can still require live evaluation; unsupported rewrites remain errors rather than being assumed equivalent.

The adapter preserves preset voices cedar/marin/shimmer, six persona instructions and preset speeds; it requests 24 kHz PCM and encodes actual mono 128 kbps MP3. The mobile MP3 filenames, `audio/mpeg` response, no-store headers, prefetch, authorization, chunk sequencing and existing request deadlines remain in place. No microphone audio is sent to Realtime. The TTS adapter adds no microphone storage or HTTP credential endpoint; the separate final speech-detection pipeline's temporary encoded-input lifecycle is documented below.

Sockets terminate idempotently on completion, timeout, error or premature close. The original elapsed deadline is checked after synchronous MP3 encoding too, so a delayed timer callback cannot allow late success. Input text, event count/size and total PCM remain bounded (4,000 characters, 10,000 events, 1 MiB/event, 300 seconds of PCM), without a monetary cap. No transcript/audio/provider error body is logged. Existing 12-second deadlines were not extended. Encoding is still synchronous and bounded; measured tail latency under concurrency remains a staging check. See [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) and [client events](https://developers.openai.com/api/reference/resources/realtime/client-events).

The API now directly declares `ws@8.22.0` (already present transitively) and adds `@breezystack/lamejs@1.2.7`, pinned in the lockfile. Encoding uses JavaScript on the server; it requires no mobile native dependency or hosted FFmpeg installation. The encoder package is LGPL-3.0; its included license and distribution obligations belong in normal dependency review. It is not included in mobile bundles.

Existing TTS character/request accounting and authorization are preserved. Actual Realtime text-token usage is recorded through the existing usage callbacks. Audio tokens are kept separate from the ledger's `text_tokens` metric, with aggregate provider totals and audio/text token details in non-sensitive usage logs for billing comparison. These logs are not a newly implemented persistent audio-cost ledger. Existing HTTP-only security/accounting fixtures explicitly select a mock legacy transport; new tests exercise the migrated Realtime route. No auth or monetary policy was changed.

## Android layout

The affected body is inline in `SimulationScreen.tsx`, shared by the user and AI bubbles on that screen. It is not a global chat component. The old code imposed fixed Android line heights and a second independently calculated body width. These are plausible native measurement constraints, not an independently reproduced explanation of the owner's unspecified original clipping example.

Android body text now stretches to the bubble's inner width, retains font padding and uses native scaled line metrics, simple line breaking and no added hyphenation. Bubble widths, gutters, colors, alignment and transcript data remain unchanged. iOS retains its existing fractional line-height safeguard and explicit inner width. No line-count limit, font-scaling cap, fixed text height or overflow clipping was added.

Native QA used a separately identified `com.peritio.practice.layoutqa` app on a read-only Android emulator overlay. It executed the current message JSX/styles with synthetic long/unbroken text, both roles, light/dark themes, widths 280/320/375/390 and system font scales 1 and 2. No Peritio login or API was used. Existing staging-app installation/data was preserved; a signature/provider conflict was handled by using a separate QA identity, not by uninstalling the existing app.

All measured final lines fit vertically. Initial horizontal metric assertions flagged lines with trailing spaces; installed React Native `FontMetricsUtil.kt` uses Android `getLineWidth`, which includes trailing whitespace. All flagged final cases ended in whitespace; this is not evidence that visible glyphs were cut. Inspected normal/200% screenshots show readable wrapping without visible clipping. [Android's documented metric distinction](https://developer.android.com/reference/android/text/Layout#getLineWidth(int)) explains why this assertion alone cannot certify glyph bounds. Physical-device/full-simulation and tablet verification remain required; the original reported Android case was not independently reproduced.

## Initial implementation validation and artifacts

Node 24.22.2; isolated file storage, fake provider credentials and blocked hosted connections for automated tests. No hosted database, actual OpenAI request, real user audio or provider secret was used.

- Consolidated focused API selection: **83/83 passed**, covering routing/configuration, silence routes, legacy confidence metadata, Realtime protocol/MP3/error/timeout bounds, upload guards, accounting, prompts, prefetch and recovery. Final 128 kbps codec/route follow-up: **6/6 passed**. A final configuration review preserved explicit chat-reasoning inheritance for scenario generation; its focused selection, including the added regression, passed **13/13**.
- Consolidated focused mobile selection: **156/156 passed**, covering capture, recording format, turn integrity, retry/lifecycle recovery, TTS playback/chunks, transcript processing and message layouts. One initial recovery fixture lacked the newly imported helper; its dependency context was corrected and the consolidated selection rerun successfully. This was not an application authentication or persistence defect.
- API and mobile TypeScript: passed. `git diff --check`: passed. API dependency declarations agree with the lockfile.
- Current full-app iOS and Android Hermes bundle exports: passed in a scratch copy, with dotenv excluded and remote AI disabled. These are local validation bundles, not store artifacts.
- Local x86_64 Android debug/native QA compilation: passed. Initial offline cache gaps were resolved with public build-dependency retrieval; this was not a source failure. Native QA packaging was incremental, outside the repository. No EAS build or store submission was started.
- A synthetic 30-second PCM control encoded and independently decoded as MP3, 24 kHz, mono, 128 kbps, duration 30.048 seconds; approximately 266 ms local encoding time. This measures codec overhead only, not provider voice latency or quality under concurrency.

Logs, local bundles, QA APK and screenshots are outside the repository at `%LOCALAPPDATA%\Peritio-Mobile-QA-WFZyRg`. Focused test logs are at `%LOCALAPPDATA%\Peritio-Batch0-AFhokJ`. The scratch copy contains only tracked non-secret source/assets and generated QA material, no repository `.env` files. The owned emulator is stopped after QA; its read-only overlay changes are discarded.

## Cost expectations

Published standard short-context prices: GPT-4o-mini input/output $0.15/$0.60 per million tokens versus Luna $0.10/$0.50; nominal reductions of about 33% and 17% at identical counts. Actual prompt/output lengths and explicitly retained hosted models may differ. Whisper $0.006/minute versus file `gpt-transcribe` $0.0045/minute is a nominal 25% reduction.

Realtime mini text input/output costs $0.60/$2.40 per million tokens and audio output $20 per million audio tokens. The previous mini-TTS audio-output rate was $12 per million tokens; original `tts-1` billing used characters. Do not treat these units or tokenization as interchangeable, or promise a per-session savings. Realtime instructions, transcript output, connection setup and CPU encoding add overhead. Compare billed audio/text tokens and measured p50/p95 latency for the same responses in staging. [Official pricing](https://developers.openai.com/api/docs/pricing) is the source for these rates. No spending ceiling was introduced.

## Mobile/store status and minimum release sequence

Local mobile version remains **1.1**; the existing iOS background-audio settings were preserved. EAS uses remote build numbers and auto-increment for store profiles. Production package/bundle ID is `com.peritio.practice`; staging is a separate `com.peritio.practice.staging` app. `preview` and `staging-ios` target staging; `production` and `production-ios` target production.

No configured Expo Updates runtime/update URL or direct `expo-updates` dependency was found. OTA availability is not established. Backend model changes require API deployment only; mobile capture/layout changes require updated installed binaries under the current configuration. Plan one coordinated update for each affected platform. No native mobile dependency was added by this patch; a new native dependency is not required to justify these binary updates.

The [public Play listing](https://play.google.com/store/apps/details?id=com.peritio.practice) is accessible, but did not establish installed versionCode or current console review/track status. Apple's configured production app ID is `6780612337`; the public page could not be verified with available browsing. Neither public-page availability nor its absence establishes review status. App Store Connect/Play/EAS current build numbers, review state and next allowable marketing version remain unverified. Do not choose a duplicate build number or assume a pending release can be overwritten.

1. Conduct one narrow review of the now-implemented acoustic admission, native decoder/process cleanup and privacy lifecycle, packaging/licenses, multipart model compatibility, Realtime speech matching, codec bounds, accounting and Android measurement. Run the focused Linux commands below. No broad security re-audit is needed.
2. After approval, integrate the reviewed work into staging while preserving version 1.1; commit/push/deploy only with authorization. Confirm the staging API revision, `/health`, `/ready`, model routing and outbound WSS/model access. No worker functionality or backup change is required. The video-worker Dockerfile only copies the shared CPU-install configuration for consistent dependency installation.
3. Use the distinct staging mobile app for one coordinated functional pass: repeated silent Submit, near-silence, genuine quiet/short/normal speech, genuinely spoken “Thank you for watching,” retry after rejection, no empty user bubble or scored exchange, full simulation and scoring, all six voices, long speech/chunks, numbers/names, background/resume and voice failure/retry. Compare billed usage and p50/p95 latency. Real model behavior has not been verified locally.
4. Verify full-screen Android on representative hardware/tablet at 100%/200% font size and both themes, and physical iOS recording/playback/background/layout compatibility. The local emulator message test and iOS bundle export do not replace these checks.
5. Verify console release states once, allocate appropriate unused remote build numbers (and a new App Store marketing version if the existing 1.1 is already released), then prepare one Android store build and one iOS store build/submission after validation and explicit release authorization. Existing `preview` APK is for staging, not Play production. No submission is authorized by this work.
6. After staging passes, deploy the compatible API before distributing new binaries; smoke-test the existing installed client too. If new-model speech fails, the unchanged MP3 HTTP contract permits an API rollback without changing mobile API contracts. Rollback to a retiring provider is only temporary and must respect its shutdown date. Do not switch customers to staging or change their codes/accounts.

Immediate production release remains **NO-GO pending targeted review, actual Linux execution and staging/physical validation**. The missing implementation is now supplied and tested locally. The initial passing test selection did not prove acoustic speech detection; it tested meter traces and mocked ASR outcomes. The final acoustic tests below add that evidence for their controls, without claiming elimination of all real-world false speech detections or ASR hallucinations.

## Independent-review correction evidence (before final VAD implementation)

The incorrect multipart request confused the response's detected-language objects with the request's list of ISO language-code strings. The current [API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) distinguishes them. Requests now use `model=gpt-transcribe`, `file`, `response_format=json`, and `languages[]=en`, never the singular hint alongside the plural or `languages[0][code]`. The [migration guide](https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe) supports JSON and the string-list hint. Optional `chunking_strategy` was removed: its availability in the general transcription schema and diarization examples is not proof of no-speech rejection for this model. No unsupported confidence field was added.

An offline negative-control diagnostic generated seven valid mono 32 kHz AAC/M4A fixtures at a 64 kbps encoding target. No credentials or user recordings were used. Four noise fixtures were deterministic synthetic signals; three speech fixtures used an installed offline Windows desktop voice, with one amplitude-scaled to -52 dB RMS. This is synthetic speech, not a real-device or human whisper recording.

| Fixture | Legacy `/ai/transcribe` before VAD | Unified `/ai/submit-turn` before VAD |
| --- | --- | --- |
| Digital silence | Forced ASR hallucination accepted, HTTP 200 | Forced ASR hallucination accepted; assistant generated, HTTP 200 |
| Broadband hiss | Same failure | Same failure |
| Simulated quiet-room noise (noise + 60/120 Hz hum) | Same failure | Same failure |
| Low-level mechanical-noise surrogate | Same failure | Same failure |
| Quiet synthetic speech, -52 dB RMS | Stub transcript accepted | Stub transcript accepted; assistant generated |
| Short synthetic “Yes” | Stub transcript accepted | Stub transcript accepted; assistant generated |
| Ordinary synthetic speech | Stub transcript accepted | Stub transcript accepted; assistant generated |

The historical probe deliberately supplied a fabricated nonempty transcript for the four no-speech fixtures and control transcripts for the three speech fixtures. **No live ASR, decoder or VAD ran in that probe's API.** All 14 requests returned 200. This established that the pre-VAD routes could not independently reject a provider hallucination; it did not estimate real OpenAI error rates or certify speech recognition. No scored session was submitted, and no production or hosted system was contacted. Probe source, generated synthetic audio and `gap-evidence.json` are at `%LOCALAPPDATA%\Peritio-Audio-Blocker-4c00268c`; the isolated test database was cleaned up by the harness.

Correction validation before VAD on Node **24.22.2**: directly affected API selection **39/39 passed**; mobile audio-guard file passed **14 named checks**, including repeated/mixed -160 readings, missing readings, quiet speech and normal controls; API and mobile TypeScript passed; `git diff --check` passed. The earlier 239-test selection and mobile builds were not repeated. Test logs use the `migration-blockers-final-*` / `migration-corrections-meter` names under `%LOCALAPPDATA%\Peritio-Batch0-AFhokJ`. The acoustic negative-control probe completed 14 requests and exposed 8 forced noise-hallucination acceptances. Its successful execution was **not** a passing VAD test; the server gap was correctly marked **FAIL/BLOCKED** at that checkpoint.

The final implementation below addresses that checkpoint's required next action. After narrow review, Linux execution and authorization, integrate/deploy to staging, then do one staging pass with both the existing client protocol and the updated staging binary. Only after that should the batch progress toward production API and iOS/Android store releases. No store binary can substitute for protection of currently installed clients. No commit, push, deployment or store build was performed in either local correction pass.

Exactly 13 already-existing files were updated during the earlier request/meter/TTS correction pass: `api/README.md`; `api/src/openaiClient.ts` and its test; `api/src/openaiModelConfig.ts` and its test; `api/src/ttsPresetConfig.ts` and its test; `api/src/services/realtimeSpeech.ts` and its test; `mobile/src/lib/simulationAudioGuard.ts` and its test; `mobile/src/screens/SimulationScreen.tsx`; and this report. All belong to the original 29-file change set below. No new repository file or dependency was added in that earlier pass. The explicitly authorized final VAD additions are listed separately below. All six historical reports remain unchanged.

## Original combined change set (29 files, preserved)

Runtime, dependency and configuration/documentation files:

1. `api/.env.example`
2. `api/README.md`
3. `api/package.json`
4. `api/src/index.ts`
5. `api/src/openaiClient.ts`
6. `api/src/openaiModelConfig.ts`
7. `api/src/ttsPresetConfig.ts`
8. `api/src/services/realtimeSpeech.ts` (new)
9. `api/src/services/transcriptionEvidence.ts` (new)
10. `mobile/src/lib/simulationAudioGuard.ts`
11. `mobile/src/screens/SimulationScreen.tsx`
12. `package-lock.json`
13. This report.

Tests and existing test fixtures:

14. `api/src/openaiClient.test.ts`
15. `api/src/openaiModelConfig.test.ts`
16. `api/src/ttsPresetConfig.test.ts`
17. `api/src/services/realtimeSpeech.test.ts` (new)
18. `api/src/services/transcriptionEvidence.test.ts` (new)
19. `api/src/realtimeSpeechRoute.test.ts` (new)
20. `api/src/simulationSilenceRoute.test.ts` (new)
21. `api/src/aiSpendLedgerRoute.integration.test.ts`
22. `api/src/dashboardAdminRoute.test.ts`
23. `api/src/mobileAiBudgetRoute.test.ts`
24. `api/src/safeErrorRoutes.test.ts`
25. `api/src/simulationAiContinuity.integration.test.ts`
26. `api/src/simulationPromptRoutes.testSupport.ts`
27. `mobile/src/lib/simulationAudioGuard.test.ts`
28. `mobile/src/lib/simulationServiceRecovery.test.ts`
29. `mobile/src/screens/SimulationScreen.messageLayout.test.ts`

All six historical audit reports remain untracked and match their recorded pre-work SHA-256 hashes. No changes were staged, committed, pushed, deployed or submitted. No provider configuration, production data, backup system or mobile native dependency was changed.

## Final server-side speech detection implementation

### Selection, provenance and packaging

The API now directly pins `ffmpeg-static@5.3.0` and `onnxruntime-node@1.31.1`. FFmpeg supplies the API's own decoder; it does not depend on the video worker or an administrator installing FFmpeg. The actual Windows packaged executable reports FFmpeg 6.1.1. The official Microsoft ONNX Runtime CPU binding executes the official Silero VAD v6.2 model directly; there is no additional VAD wrapper to maintain. FFmpeg, the official runtime and a small vendored model were chosen over an unverified wrapper or a remote service.

The vendored model is 2,327,524 bytes from official Silero commit `be95df9152c0d7618fa1edfeb296fc3dae32376f`, SHA-256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. Its provenance and MIT notice are beside the asset. Every inference child checks that hash. Model/CPU inference is offline and no runtime model download occurs. The implementation follows the upstream 16 kHz wrapper: 512-sample frames, 64 samples of previous context, recurrent state reset per recording.

Primary references: [pinned Silero source](https://github.com/snakers4/silero-vad/tree/be95df9152c0d7618fa1edfeb296fc3dae32376f), [official ONNX Runtime Node support](https://onnxruntime.ai/docs/get-started/with-javascript/node.html), [ffmpeg-static packaging](https://github.com/eugeneware/ffmpeg-static). Installed packages, native artifacts and upstream source/license files were inspected; actual Windows execution below is stronger evidence than package metadata alone. Silero and ONNX Runtime are MIT. The `ffmpeg-static` npm package declares GPL-3.0-or-later, and downloaded binaries have their own included notices/build configuration. Server/container redistribution must comply with the applicable FFmpeg licenses; do not infer that subprocess use removes those obligations or that it automatically changes ownership of all proprietary code. None of these packages/assets is shipped in the mobile binary.

ONNX's npm distribution includes CPU native binaries but can otherwise download optional CUDA components on Linux. Root `.npmrc` sets `onnxruntime-node-install=skip`, which the installed package explicitly supports through npm's environment propagation. The video-worker Dockerfile copies this file along with manifests. The current npm propagates `npm_config_onnxruntime_node_install=skip` (verified), while warning that unknown project config support will change in its next major version. Pin/verify the deployment toolchain; future npm upgrades must recheck this CPU-only installation behavior. No GPU configuration or new provider setting was introduced. The ONNX package contains about 307 MB of cross-platform runtime artifacts; installation/image size is substantially larger than the 2.3 MB model.

`npm run build:api` now runs an actual packaged-decoder/native-CPU/model preflight after compilation and SQL copying. Standalone command: `npm run verify:speech-runtime --workspace api`. It exercises both silent and positive synthetic AAC/M4A through the compiled production analyzer, including seekable-file decoding, native CPU/model inference and cleanup, with bounded time/output. This fails the build if required assets cannot execute. Runtime asset resolution remains lazy: missing assets do not crash unrelated API startup or health routes; an affected audio request instead returns a safe, retryable 503. Source and compiled `dist/services` paths both resolve the checked-in worker/model correctly. Package install must run normal FFmpeg install scripts on the target platform; copying Windows `node_modules` to Linux or installing with all scripts disabled is not a deployment procedure.

### Actual decision and compatibility

Both existing mobile upload entrypoints call the same `transcribeSimulationAudioFile` helper, which now decodes and classifies the real upload before reserving ASR usage or dispatching to OpenAI. This includes clients that send no meter information. No new mobile field, API endpoint, speech phrase blocklist, undocumented ASR-confidence field or OTP/auth change was added.

Decoded mono PCM is 16 kHz signed 16-bit. Before classification, peak normalization is bounded to at most 100x gain; this is not an amplitude-based acceptance rule. Silero's neural speech probability must reach 0.7 somewhere and remain at least 0.5 for three consecutive frames (96 ms). Maximum probability below 0.2 means `no_speech`; other recordings that do not meet admission are `uncertain`. Both are rejected safely. These are conservative initial policy thresholds calibrated against controls, not validated population accuracy statistics.

For rejected/ambiguous/invalid recordings, legacy `/ai/transcribe` returns existing HTTP 200 `{text:""}`; unified `/ai/submit-turn` returns existing `outcome:"no_clear_speech"` and an empty transcript. It creates no assistant turn or score and dispatches no ASR. Technical failures, unavailable assets, full queues and deadlines use existing HTTP 503 `ai_unavailable` with a retry message. Existing installed v1.1 client handlers already understand empty transcripts, `no_clear_speech` and the safe error envelope; wire compatibility is source-verified, while actual installed-device UX remains a staging acceptance item. No utterance is automatically submitted to scoring by this check. Speech-bearing recordings continue through existing transcript usability/echo checks and actual OTP/auth/accounting/turn logic.

The analyzer only establishes probable speech, not that the recognized words are true, belong to the user, are English or are appropriate. A genuine spoken phrase such as “Thank you for watching” remains eligible. TV/music/other voices and adversarial noise may produce speech detections; whispered, very short, distant, clipped, accented or noisy speech can be rejected. Uncertainty uses the existing retry path instead of fabricating dialogue. Strict invalid/truncated-audio handling can also reject unknown-length streaming WAV headers; finalized WAV and mobile AAC/M4A are covered. Synthetic speech controls do not establish human-whisper or real microphone accuracy.

### Resource, cancellation and privacy boundaries

| Resource | Enforced bound |
| --- | --- |
| Uploaded recording | 12 MiB, maximum decoded duration 180 seconds |
| Decoded PCM | 5,760,000 bytes; overlong inputs rejected rather than admitting a truncated prefix |
| Analysis admission | One active analysis per API process; at most eight waiting, 24 MiB aggregate queued input, eight-second queue wait |
| Time | Decoder four seconds, VAD child five seconds, combined deadline twelve seconds including queueing |
| Child work | At most one decoder or VAD child active at a time per analyzer process; no shell; direct child is reaped before slot release |
| Decoder | Restricted formats/protocols, 1 MiB probing, bounded analysis, single decoding thread, 16 MiB maximum individual allocation |
| Inference | CPU only, single inter/intra-op thread, fixed model/frame dimensions; Node child heap target 96 MiB; bounded PCM/stdout |

The heap target and maximum decoder allocation are **not OS-enforced total RSS caps**. Native codec/runtime memory exists outside V8; fixed model/input dimensions, process concurrency and deadlines bound ordinary work, but a native-code defect can still exceed expected memory before the host/container enforces its memory limit. No new host resource setting was changed. The single-analysis queue trades throughput for predictable CPU; large recordings and busy/low-CPU hosts can require retries and must be load-checked in staging. The preexisting authenticated AI concurrency/authorization controls remain in force; no monetary AI cap was added.

M4A can place its index after media data, requiring a seekable input. Each request therefore uses an owned `peritio-speech-<owner-pid>-<random>` temporary directory with an exclusive mode-0600 encoded input file, inherited local Windows ACLs, and no customer-derived filename. The input is deleted immediately after decoding, before inference. PCM/model input stays in memory and buffers are cleared on completion. No recording is sent to R2, the video worker, backup tooling or a new service. Child environments exclude API/database credentials. Decoder stderr is discarded; logs contain only correlation/route, aggregate decision and timing, not filenames, audio, level samples or transcripts. The earlier ASR empty-response filename log was removed.

Success, decoder/VAD error, deadline, cancellation and client disconnect all run owned-child-close and private-directory cleanup, then idempotently release analysis capacity. Listeners attach before checking already-aborted/destroyed requests. Cancellation also propagates into the existing ASR fetch; it cannot undo provider work already completed. Test overrides require both `NODE_ENV=test` and `PERITIO_ENV=development` and are not exposed over HTTP.

**Residual privacy/cleanup risk:** abrupt API/OS termination while decoding can leave the private encoded input directory until a later bounded startup cleanup. Startup examines at most 256 temporary-root entries for at most two seconds between operations and removes at most 32 qualifying directories. It only handles the exact PID-qualified application pattern, owners confirmed exited (ESRCH), folders at least five minutes old, and empty folders or the single regular `input.audio` file. Live/permission-denied owners, fresh folders, symlinks, unknown contents and older unqualified naming are preserved. Deletion is nonrecursive and logs aggregate counts only; cleanup failure does not prevent unrelated API startup. No background service, secure-erasure guarantee or host retention policy is added. A backlog, legacy folder or very recent crash can remain, so actual host temporary-filesystem/ACL policy still needs staging observation. A host kill during native work can also prevent application cleanup. Do not describe this implementation as exclusively memory-only or as proving zero retention under machine failure. Cleanup errors fail the audio request closed instead of being accepted as speech.

### Deterministic evidence and measured overhead

Seven original synthetic controls are now under `api/test-fixtures/speech`, with provenance. Four are deterministic generated signals and three use offline Windows TTS, not customer audio. Real packaged decoding and neural inference ran, with the ASR stub deliberately ready to return “Thank you for watching” for any upload.

| AAC/M4A control | Actual VAD maximum probability | Decision on both routes | Approx. local total analysis |
| --- | ---: | --- | ---: |
| Digital silence | 0.00891 | Reject before ASR | 239 ms |
| Hiss | 0.01633 | Reject before ASR | 247 ms |
| Quiet-room noise surrogate | 0.01321 | Reject before ASR | 259 ms |
| Mechanical-noise surrogate | 0.01712 | Reject before ASR | 237 ms |
| Quiet synthetic speech (-52 dB RMS) | 0.999995 | Accept, then existing ASR path | 242 ms |
| Short synthetic “Yes” | 0.999880 | Accept, then existing ASR path | 223 ms |
| Normal synthetic speech | 0.999997 | Accept, then existing ASR path | 238 ms |

Noise controls generated zero ASR/assistant calls and no score records through both actual authenticated HTTP routes, without mobile meter flags. Speech controls made one ASR request each, and unified speech made one assistant request. The stub's words are not proof of transcription accuracy or of a particular genuinely spoken phrase; retaining that stub on speech controls proves no phrase blocklist was used. Transcript-first silent retries generated no duplicate assistant/scoring work. Invalid/truncated inputs and missing decoder/VAD failure/timeouts also exercised both routes. Actual HTTP disconnects during VAD on both routes recovered capacity and allowed a subsequent valid request.

Final focused selection on Node **24.22.2**, Windows: **65/65 passed**, zero failures/skips:

```
api/src/services/speechActivity.test.ts
api/src/speechActivityRoute.test.ts
api/src/simulationSilenceRoute.test.ts
api/src/mobileMultipartSecurityRoute.test.ts
api/src/safeErrorRoutes.test.ts
api/src/openaiClient.test.ts
```

It additionally covers finalized WAV/MP3/FLAC/Ogg/WebM, compressed expansion beyond 180 seconds, empty/over-byte-limit inputs, actual missing model asset, process-exit cleanup after cancellation during each child stage, queue count/byte caps, queued cancellation and recovery. Older provider-mock route tests now supply valid synthetic speech rather than invalid placeholder bytes; the detector is not disabled to preserve their results. The PostgreSQL-gated continuity fixture was updated consistently but its hosted/local PostgreSQL integration test was not run for this audio-only change.

API and mobile TypeScript checks passed after the final implementation. `npm run build:api` passed with its runtime preflight; the final standalone decoder/inference preflight passed too. `git diff --check` passed. The earlier 239 checks, full application suites, mobile bundles and store builds were not repeated. Native runtime install and public package/model retrieval used no hosted secrets or customer systems.

Measured inference/load time was about 119–147 ms and VAD child peak RSS about 90–92 MiB for these 1.28–3.62-second controls; total local wall time was 223–259 ms. A compiled-production-path four-request burst finished in 887 ms, with individual responses at 245/472/683/886 ms and roughly 86 MiB VAD child peak RSS. All four passed, then counters returned to zero active, zero queued and zero queued bytes. These are one local Windows machine's observations, **not** Render p95, maximum-duration cost or an OS memory guarantee. Decoder/API heap and upload-buffer memory are additional. No recurring vendor cost is introduced, but CPU, memory, image storage and queue latency increase.

Evidence logs are under `%LOCALAPPDATA%\Peritio-Batch0-AFhokJ`: `speech-final-regressions.log`, `speech-final-api-types.log`, `speech-final-mobile-types.log`, `speech-api-build.log`, `speech-packaging-final.log`, `speech-actual-measure.log`, `speech-compiled-burst.log`. The bounded tests assert owned scratch input directories empty, child PIDs exited and capacity recovered. No real microphone recording or OpenAI dispatch was needed.

### Linux/Render verification boundary and remaining gates

**No Linux process execution occurred locally:** WSL is not installed and Docker is unavailable. The official ONNX Runtime package contains Linux x64 CPU/N-API binaries; static inspection found GLIBC_2.28 as the largest required version for its core library, and GLIBC_2.14 for its Node binding. This supports a conventional modern glibc Linux deployment but is not evidence of a successful GitHub Actions or Render run. Musl-only images are not established as compatible. The API's packaged FFmpeg is fetched for the actual target platform, independent of the worker's apt-installed FFmpeg. Windows x64 execution, native/model validation and the compiled path were actually verified. No provider settings were inspected/changed and no remote CI run was triggered.

Minimum Linux gate, with Node 24.22.2, safe isolated test credentials/storage and the repository's ordinary CI environment:

```sh
npm ci
npm run build:api
npm run test:speech-activity --workspace api
```

The build must demonstrate the Linux decoder + native CPU + pinned model actually execute. Do not run these route tests against production configuration or connect their harness to hosted databases. Check platform-specific codec behavior, install logs/CPU-only installation, deploy artifact contents and actual Render headroom/latency before production. A failed preflight is a deployment blocker, not permission to bypass the detector.

Minimum one coordinated staging/real-device acceptance pass after review and release authorization:

1. On physical iOS and Android, test both installed-v1.1 protocol behavior and the updated staging app against the staging API. Use the correct environment/app, without changing real users' company codes.
2. Submit silence repeatedly (at least ten trials/device), quiet-room noise, fan/hum/hiss and no-response-after-AI cases. Require existing clear-speech retry UX, no invented bubble, assistant response or score entry. Monitor only aggregate diagnostics.
3. Test quiet human speech, whisper/soft voice, “yes/no,” short names, varied accents and normal speech; retry must remain usable. Genuinely speak “Thank you for watching” to confirm content is not blocklisted. Include TV/music/other voices to characterize unavoidable false accepts.
4. Complete simulation/scoring, all six TTS presets, long responses, numbers/currency/percentages, interruption/resume and retry. Confirm the prior Android 100%/200% layout and TTS fixes remain intact.
5. Cancel/disconnect during upload/analysis and retry; check no stuck slots, extra turns, temp residue or sensitive logs. Exercise a small legitimate concurrent-user burst and near-180-second recordings on Render, observe CPU/RSS/queue/error rates and p50/p95 end-to-end latency.

The server-side fix can deploy to staging and later production **before new store binaries**, because it changes no public contract and acts on both existing entrypoints. The existing v1.1 source handlers support the responses, but actual binary acceptance still needs the pass above. There is no mobile native dependency or requirement to rebuild the app merely to enable this gate. Shipping the combined Android layout/meter changes separately still requires the previously planned new mobile releases and explicit authorization.

Independent review has passed with minor findings; the approved small finalization changes are recorded below. Remaining validation gates are actual Linux packaging/runtime execution and staging/real-microphone accuracy/latency/compatibility. The prior absence of server-side acoustic logic is resolved; general real-world hallucination elimination is not claimed. Current judgment: **approved to promote to staging for one consolidated Linux CI run; not ready for production promotion on local evidence alone.**

### Exact files changed in final speech-detection pass

Eleven existing files changed in this pass (including files already uncommitted):

```
api/Dockerfile.video-worker
api/README.md
api/package.json
api/src/index.ts
api/src/openaiClient.ts
api/src/mobileMultipartSecurityRoute.test.ts
api/src/safeErrorRoutes.test.ts
api/src/simulationAiContinuity.integration.test.ts
api/src/simulationSilenceRoute.test.ts
package-lock.json
docs/Peritio_Mobile_Stabilization_Model_Migration_2026-11-09.md
```

Eighteen new files:

```
.npmrc
api/assets/speech/README.md
api/assets/speech/LICENSE.Silero.txt
api/assets/speech/silero_vad.onnx
api/scripts/speech-vad-worker.mjs
api/scripts/verify-speech-runtime.mjs
api/src/services/speechActivity.ts
api/src/services/speechActivity.test.ts
api/src/services/speechActivity.testSupport.ts
api/src/speechActivityRoute.test.ts
api/test-fixtures/speech/README.md
api/test-fixtures/speech/digital-silence.m4a
api/test-fixtures/speech/hiss.m4a
api/test-fixtures/speech/room-noise-surrogate.m4a
api/test-fixtures/speech/mechanical-noise-surrogate.m4a
api/test-fixtures/speech/quiet-speech.m4a
api/test-fixtures/speech/short-word.m4a
api/test-fixtures/speech/normal-speech.m4a
```

The combined working change set is 49 files (the original 29, plus 18 new files and two newly touched tracked files). This pass does not add another mobile modification. The entire prior model, Android layout/meter and TTS implementation is preserved. The six historical audit reports remain separate and untracked with unchanged recorded hashes. Nothing is staged, committed, pushed, deployed or submitted; no backup job, hosted credential, customer data or provider configuration was accessed.

## Approved final staging preparation

Independent review verdict supplied by the owner: **PASS WITH MINOR FINDINGS**. The existing model migration, Android corrections and VAD thresholds are preserved; no further broad audit was performed.

- Queue admission now waits up to eight seconds, within the unchanged twelve-second overall deadline created before queueing. The timer is always cleared, including rejected admission. Deterministic mocked-clock tests verify 7.999-second waiting, rejection at eight seconds, and cancellation at twelve seconds after seven seconds in the queue plus five seconds of active work; owned children and slots recover.
- API startup invokes the bounded dead-owner cleanup described above before serving requests. Only PID-qualified application folders with proven dead owners and constrained contents are eligible. Legacy unknown-owner names are deliberately not deleted automatically. Tests cover active/fresh/legacy/unrelated folders, directory links, unexpected contents, the 32-removal cap and nonfatal missing-root failure.
- Build self-check now runs real packaged FFmpeg, native ONNX Runtime and the pinned Silero model on both silent and positive AAC/M4A, through the compiled production analyzer and seekable input path. It makes no OpenAI request. The source fixtures must remain in the deployed checkout; the existing Docker context includes them.
- Removed the decoder output `-t` cutoff. Decoding now must reach EOF within the byte/time ceiling; excess PCM triggers bounded process termination or an invalid-audio result. A prefix-only analysis cannot admit the original longer recording. Exactly 180 seconds of finalized silent WAV passes; 185-second M4A containing a genuine speech prefix is rejected through the service and both actual HTTP routes, with zero ASR/assistant calls. Overlong audio uses existing empty/no-clear-speech retry behavior. No VAD threshold changed.

Final focused validation: **37/37 tests passed**, no skips/failures, in `speech-release-final-tests.log`; standalone real runtime self-check passed in `speech-release-runtime.log`; API TypeScript (including emitted compiled analyzer for the self-check) and mobile no-emit TypeScript passed in `speech-release-api-types.log` / `speech-release-mobile-types.log`. All used Node **24.22.2**, isolated test storage/fake credentials and no hosted customer access. No full API/mobile suites, frontend builds or store builds were repeated.

The finalization edits only `api/src/services/speechActivity.ts`, its test, `api/src/speechActivityRoute.test.ts`, `api/src/index.ts`, `api/scripts/verify-speech-runtime.mjs`, `api/README.md`, and this document; the combined implementation remains the same 49 intended files. The six historical reports are excluded and retain their recorded SHA-256 values. No SQL migration, TTS/model decision, Android design or provider configuration changed.

The Render root-level build command **`npm install --include=dev && npm run build:api` needs no adjustment**: checked-in dependencies, root `.npmrc`, model/scripts and both M4A controls are included, and the API build already invokes the native self-check. Node 24.22.2 and a compatible glibc Linux runtime still must pass the actual CI/Render run. A staging API deployment of the promoted commit is necessary to exercise the behavior; no manual deployment is performed here.

Repository CI currently triggers on pushes to main, pull requests targeting main and `workflow_dispatch`, not staging pushes. After promotion, use the existing GitHub Actions **CI** workflow, **Run workflow**, branch **staging**, for ONE consolidated Linux run. No workflow/configuration change or manual dispatch was made in this preparation. The promotion must use a normal merge preserving both histories, mobile version **1.1**, and existing `expo-audio` settings `enableBackgroundPlayback=false` / `enableBackgroundRecording=false`. Never reset staging to the feature branch or push production main.
