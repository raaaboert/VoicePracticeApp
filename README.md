# VoicePracticeApp Monorepo

This repo is organized into four apps/packages:

- `mobile` - Expo React Native user app
- `admin-web` - Next.js admin console (`Login`, `Users`, `Config`, `Usage`)
- `api` - Express API with JSON storage for Phase 1
- `shared` - shared contracts/types/helpers used by all three

For personal-machine cutover and preflight checks, see `PERSONAL_MACHINE_SETUP.md`.

## Quick Start

1. Optional preflight (toolchain/env checks):

```bash
powershell -ExecutionPolicy Bypass -File .\\scripts\\preflight.ps1
```

2. Install dependencies from repo root:

```bash
npm install
```

3. Configure API env:

```bash
copy api\\.env.example api\\.env
```

4. Configure mobile env:

```bash
copy mobile\\.env.example mobile\\.env
```

5. Configure admin env:

```bash
copy admin-web\\.env.example admin-web\\.env
```

6. Start each app (separate terminals):

```bash
npm run start:api
npm run start:admin
npm run start:mobile
```

### Android Emulator (Expo Go)

If you're running the mobile app in the Android emulator, after `npm run start:mobile` you can open the app using the emulator-stable Expo URL:

```bash
npm run open:android
```

Or launch all three from one command (opens separate PowerShell windows):

```bash
powershell -ExecutionPolicy Bypass -File .\\scripts\\launch-local-stack.ps1
```

For partner review mode (builds API/admin, starts API + admin in production mode, and starts Expo mobile):

```bash
npm.cmd run start:review
```

Equivalent direct launcher:

```bash
powershell -ExecutionPolicy Bypass -File .\\scripts\\launch-review-stack.ps1
```

Stop all local stack listeners (API/admin/mobile ports):

```bash
powershell -ExecutionPolicy Bypass -File .\\scripts\\stop-local-stack.ps1
```

## Phase 1 Notes

- Business rules are API-driven (tiers, limits, active segment/scenarios, entitlements).
- Mobile does not hardcode plan limits; it reads config and entitlements from API.
- Remote AI calls are intentionally disabled in this baseline build; simulation/scoring run in local mode.
- Mobile user routes use a per-user bearer token issued during onboarding.
- Admin password is API-managed:
  - bootstrap password comes from `api/.env`
  - password can be changed in admin `Config` page
- Usage metering uses 15-second billing increments with round-down behavior.
- Timezone changes are deferred until next monthly plan renewal.

## Smoke Test

Run startup/health checks for API + admin + mobile:

```bash
npm run smoke:stack
```

## Critical-Flow Test

Run an end-to-end API flow against an isolated local DB (admin login, org create, mobile onboard + verify, join request approval, user delete, audit checks):

```bash
npm run test:critical-flow
```

## Release Verification

Before every production deploy, run:

```bash
npm run verify:all
```

This runs:

- package builds (`shared`, `api`, `admin-web`)
- mobile TypeScript check
- stack smoke test (`api`, `admin-web`, Metro startup)
- end-to-end critical flow test

## CI Automation

GitHub Actions now runs the same verification gates on every push/PR to `main`:

- `.github/workflows/ci.yml`

Dependency update PRs are scheduled weekly:

- `.github/dependabot.yml`

## Ops Helper

Assign an existing user email to an enterprise org (creates org if needed):

```bash
node scripts/ops/assign-enterprise-user.mjs --apiBaseUrl http://localhost:4100 --adminPassword "<admin-password>"
```
