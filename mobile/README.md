# Mobile App (`/mobile`)

Expo React Native app for VoicePractice.

## What This Phase Includes

- First-use onboarding (email + timezone)
- Settings screen with timezone updates (deferred to next monthly renewal)
- My Plan section with current plan, daily remaining usage, and Pro/Pro+ pricing cards
- Enterprise section with contact email/link CTA placeholders
- Setup flow driven by API config (segments/scenarios)
- Pre-session entitlement check before simulation starts
- Post-session usage recording to API
- Optional remote AI mode where mobile calls API AI routes (and API calls OpenAI)
- Session transcript download on score screen (device/local)
- Optional feedback flow with transcript sharing consent for support review

## Environment

Create `.env` from `.env.example`:

```bash
EXPO_PUBLIC_REMOTE_AI_ENABLED=false
EXPO_PUBLIC_API_BASE_URL=
```

`EXPO_PUBLIC_API_BASE_URL` is optional. Leave it blank to auto-detect from Expo host.
For Android emulator-only override, use `http://10.0.2.2:4100`.
For EAS APK/production builds, set `EXPO_PUBLIC_API_BASE_URL` explicitly (do not rely on auto-detect/localhost).
This repo configures it in `mobile/eas.json` as `https://voicepractice-api-dev.onrender.com`.

When `EXPO_PUBLIC_REMOTE_AI_ENABLED=true`, mobile uses API routes for:

- transcription
- role-play turn generation
- server-side scoring

OpenAI keys are configured in `api/.env`, not mobile env.

## Run

From repo root:

```bash
npm run start:mobile
```

Or from `/mobile`:

```bash
npm install
npm run start
```
