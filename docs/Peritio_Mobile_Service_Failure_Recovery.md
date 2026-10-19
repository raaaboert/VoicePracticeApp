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
- Failed completion recovery keeps the pending request, does not produce a scorecard and pauses automatic deadline-driven retries. End Session can retry the recovery read explicitly. Session expiration/completion and the original absolute server deadline remain authoritative; pause/resume never creates a new ID or extends that deadline.

The transcript on screen is client session state; no new claim is made that it was saved server-side. Sign-in/navigation may discard this local state. Scoring is shown only after the existing scoring API/recovery confirms a result. Device speech of a real server response remains subject to the established remote-TTS policy; it is not mocked AI dialogue, and the voice engine was not changed.

## Usage

Registered-but-never-started conversations exit without a completed-activity callback, usage submission or score request. Completion timing explicitly identifies whether conversation started and whether scoring is blocked. App skips mock/never-started usage and deduplicates completion callbacks. A genuinely started interrupted session still submits its real duration on End Session using the unchanged, session-keyed usage endpoint; a failed legacy turn blocks scoring, not legitimate usage. Pending unconfirmed unified work must recover before completion. Existing explicit Exit/background-expiration routes still close without pretending to be a scored completion; this batch does not redesign abandonment accounting or server provider-usage ledgers. No existing usage, allowance or provider-consumption record is deleted or reset.

## Validation / remaining device checks

Automated tests execute the actual screen startup, pause, resume, recovery and completion callbacks and App completion callback, substituting native audio/network/UI bindings. Existing deadline, scoring-response recovery and voice integrity tests remain in the mobile suite. API/shared/database code and contracts are untouched, so no database suite is required for this change.

Physical iOS/Android validation remains: startup and mid-turn offline/401/429/503, microphone/audio shutdown, one-tap retry and double-tap protection, real submitted-response recovery, background/remount behavior, expiration while paused, sign-in navigation, End Session usage, authoritative score recovery and explicit offline developer mode. Existing installed binaries retain the old fallback until replaced by an independently audited build. No server-side accounting correction is proposed by this batch.
