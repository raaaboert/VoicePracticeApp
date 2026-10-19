# Mobile service failure correction (9F.1)

Local implementation pending independent audit. Do not push, deploy or run EAS builds as part of this batch.

## Finding and boundary

Previously the mobile screen could switch to local AI after an opening-prefetch/opening failure, a unified-submit failure or a transcription failure. Structured `ai_unavailable`/`ai_budget_limit`, status 401/429/503 and broad legacy provider-message patterns could trigger it during startup or an active conversation. Missing build-time remote configuration also selected local mode. Mocked mode was labelled in the UI, but did not require confirmation when selected by a live error. Its placeholder transcript and local dialogue could enter session history. Scoring already refused mocked sessions; App nevertheless submitted their elapsed time to the real usage-record endpoint.

All error-triggered mock switches and the old fallback classifier are removed. The existing local opening/reply engine is retained only with all three conditions: `__DEV__`, explicit build-time `EXPO_PUBLIC_LOCAL_SIMULATION=true`, and remote AI disabled. It still requires the existing user confirmation and is labelled as mocked. It does not register with the API, record usage or request scoring. A release build ignores this opt-in regardless of its value. An unconfigured release fails visibly before permission, registration, opening or capture work.

## Recovery behavior

- 401 pauses and offers an explicit Sign in again action. There is no automatic sign-in loop.
- Established daily/organization allowance messages, daily AI request/token budgets and temporary 429 throttles receive distinct explanations. No reset times or remaining balances are inferred.
- Startup failures may retry the same session through the existing single-flight registration/opening coordinator. Auth/authorization/allowance/budget failures require sign-in, Setup or waiting rather than a blind retry.
- Active service failure stops capture and audio. A pending unified submission retains its original correlation ID: Resume Turn uses the existing await/recovery read, never re-POSTs audio. A transcription-only failure can explicitly start a new recording because no assistant turn was requested.
- An ambiguous legacy assistant request cannot safely be replayed. Further turns and scoring are blocked; the learner may end the real session or leave. No invented response is appended. If a screen remount loses pending submitted-request context, it also fails closed rather than starting a new turn.
- Failed automatic completion recovery keeps the pending request, does not produce a scorecard and pauses automatic deadline-driven retries. Resume Turn retries the recovery read; explicit End Without Score abandons the unresolved client turn and completes without waiting for recovery (9F.1b below). Session expiration/completion and the original absolute server deadline remain authoritative; pause/resume never creates a new ID or extends that deadline.

The transcript on screen is client session state; no new claim is made that it was saved server-side. Sign-in/navigation may discard this local state. Scoring is shown only after the existing scoring API/recovery confirms a result. Device speech of a real server response remains subject to the established remote-TTS policy; it is not mocked AI dialogue, and the voice engine was not changed.

## Usage

Registered-but-never-started conversations exit without a completed-activity callback, usage submission or score request. Completion timing explicitly identifies whether conversation started and whether scoring is blocked. App skips mock/never-started usage and deduplicates completion callbacks. A genuinely started interrupted session still submits its real duration on End Session using the unchanged, session-keyed usage endpoint; a failed legacy turn blocks scoring, not legitimate usage. Pending unconfirmed unified work must recover before scored completion, or may be explicitly abandoned to finish without a score. Existing explicit Exit/background-expiration routes still close without pretending to be a scored completion; this batch does not redesign abandonment accounting or server provider-usage ledgers. No existing usage, allowance or provider-consumption record is deleted or reset.

## Validation / remaining device checks

Automated tests execute the actual screen startup, pause, resume, recovery and completion callbacks and App completion callback, substituting native audio/network/UI bindings. Existing deadline, scoring-response recovery and voice integrity tests remain in the mobile suite. API/shared/database code and contracts are untouched, so no database suite is required for this change.

Physical iOS/Android validation remains: startup and mid-turn offline/401/429/503, microphone/audio shutdown, one-tap retry and double-tap protection, real submitted-response recovery, background/remount behavior, expiration while paused, sign-in navigation, End Session usage, authoritative score recovery and explicit offline developer mode. Existing installed binaries retain the old fallback until replaced by an independently audited build. No server-side accounting correction is proposed by this batch.

## Interrupted-turn correction (9F.1a)

Verified the recovery implementation in the supplied deployed staging revision `29ddddcb3bb9fc5e8c17bb75ec2478c1ae31997c` (unchanged API source at local HEAD). This is source-contract inspection, not a live failed-provider/device exercise:

- Recovery HTTP 410 with the exact message `Simulation assistant reply is no longer pending for this correlationId.` follows a user-bound cleaned-entry marker. Cleanup happens after a settled result, currently after a rejected result; there is no remaining in-flight reply for that entry. Only this specific contract permits discarding the failed turn. Generic 410/expiry text and real 401/403 are not interchangeable with it.
- HTTP 504 with `Timed out waiting for simulation assistant reply.` covers BOTH `unsettled` and `no_entry`. It does not cancel the provider promise or clear an unsettled entry. Even this exact timeout must retain the correlation ID and read-only recovery. Generic gateway/provider timeouts are equally inconclusive. Pending entries and cleanup markers are process-local and expire after five minutes; missing/expired state cannot establish that original work never ran. No safe re-record is offered solely on a 504. An unresolved request may therefore require leaving the session without a score; no backend contract change is made here.

Previously Resume sent a confirmed 410 through general service-error classification, which treated it as access denied and permanently blocked scoring after pending state was cleared. The mobile path now discards only its provisional user transcript, preserves all earlier exchanges and offers **Record Again** without starting capture. The same rule applies if the initial await receives that 410: it no longer generates a fresh legacy reply automatically. A replacement is a new explicit recording, not a replay of the old POST, and must reconcile a real server response before completion. Separate earlier ambiguity still blocks scoring. End Session can score sufficient earlier confirmed evidence after a safe discard, and keeps unchanged genuine-time usage handling. Its label does not promise a score while submitted work is pending or scoring is blocked.

The real-screen callback harness covers confirmed 410, ambiguous 504/network/503 and later reconciliation, explicit replacement, evidence exclusion, authorization denial, deadlines, completion deduplication and actual confirmed-audio replay. Native microphone/playback, navigation and physical interruption behavior still require iOS/Android checks. Delivery remains local commit only, pending independent audit; no push, deployment or EAS build.

If recovery instead reports `session_expired` or `session_completed` before the pending exchange is reconciled, completion records legitimate usage but blocks scoring of that unconfirmed evidence. Closure is not a settled-turn confirmation and cannot authorize re-recording.

Validation: focused recovery/startup/deadline/scoring tests **81 passed**; full mobile suite **387 passed**, **0 failed / 0 skipped**. Mobile TypeScript (`npx tsc --noEmit`) and `git diff --check` passed. No backend/database code changed or database tests required.

## Explicit termination during ambiguous recovery (9F.1b)

The earlier End action used the same settlement wait as scored completion, leaving a learner stuck on repeated 504s unless they used Exit. The existing End control now deliberately chooses **End Without Score** while a submitted response is unresolved. It removes only that provisional exchange from client history, retains earlier confirmed exchanges, blocks scoring, invalidates the lifecycle generation and aborts local requests. It skips recovery and can also release a completion already waiting on recovery. Microphone and voice cleanup run together; one cleanup rejection cannot prevent the other from running. The existing completion coordinator and App session-ID guard still deduplicate completion and usage.

Resume Turn remains a read-only recovery attempt with the same correlation ID. A 504 still says nothing definitive about the server operation. Explicit End does **not** claim to cancel or fail server work: a later reply/error is ignored by lifecycle guards, cannot enter finalized history, restart capture or trigger another completion. Confirmed 410 still offers explicit Record Again; once its replacement is confirmed, ordinary End can produce an authorized scorecard.

Paused time, including an unresolved recovery wait, is excluded using the existing pause-adjusted timing. Reconciled real voice playback counts as practice again. Neither timing adjustment extends the registered deadline. The completion callback attempts genuine usage through the unchanged server endpoint, but does not acknowledge persistence. Only the usage response updates entitlements; offline failures remain visible through the existing error path. There is no new offline queue or retry coordinator. Mock/never-started sessions remain excluded.

Tests execute the screen recovery, Resume, End, audio cleanup and completion callbacks, plus App usage/scoring callbacks, with native/network bindings substituted. Deferred requests intentionally ignore abort to test late success, 504, 401, expiry/completion, unmount, competing Resume/End and repeated End. A simulated 75-second wait needs no real sleep. Physical iOS/Android microphone shutdown, voice interruption, background/resume and offline error presentation still require device validation. No backend/database changes or new guarantees are required; no API/database suites were run. Local commit only; no push, deploy or EAS build.

Validation: **95 focused tests passed**; full mobile suite **401 passed / 0 failed / 0 skipped**. Mobile TypeScript and `git diff --check` passed.
