# Admin Web (`/admin-web`)

Next.js admin console for VoicePractice.

## Pages

- `/login`
- `/users`
- `/config`
- `/usage`
- `/stats`
- `/support`
- `/logs`
- `/prompt-preview`

## Features

- Password login against API admin auth
- User create/edit (tier, account type, status, org, manual bonus seconds)
- Config edits (active segment, default difficulty, pricing, limits, enterprise contact)
- Enterprise org create/edit (daily quota, per-user cap, bonus seconds)
- Admin password change
- Basic usage report
- Audit log viewer with enterprise/account/date filters

## Environment

Create `.env` from `.env.example`:

```bash
API_BASE_URL=http://localhost:4100
NEXT_PUBLIC_PERITIO_ENV=development
```

`API_BASE_URL` is the backend API base used by the admin utility in local and Vercel environments.
`NEXT_PUBLIC_PERITIO_ENV` controls the visible admin environment label. Accepted values are
`development`, `staging`, and `production`.

The admin shell also reads `GET /meta/environment` from the configured API. If the admin deployment
is labeled as one environment but the API reports another, the UI shows a warning.

## Hosted Admin Deployments

Use two separate Vercel projects for the admin utility:

- Existing/current admin utility: staging admin
- New production admin utility: production admin

Recommended domains:

- `admin-staging.peritio.ai` -> staging API
- `admin.peritio.ai` -> production API

### Staging Admin Vercel Env

```bash
API_BASE_URL=https://voicepractice-api-dev.onrender.com
NEXT_PUBLIC_PERITIO_ENV=staging
```

### Production Admin Vercel Env

```bash
API_BASE_URL=https://peritio-api-prod.onrender.com
NEXT_PUBLIC_PERITIO_ENV=production
```

Do not point either admin project at a database URL. The admin utility talks only to the API.

After each hosted admin URL exists, update the matching Render API `CORS_ALLOWED_ORIGINS`:

- Staging API: append the staging admin origin, for example `https://admin-staging.peritio.ai`.
- Production API: append the production admin origin, for example `https://admin.peritio.ai`.

Append new origins to the existing comma-separated value instead of replacing dashboard/mobile web
origins that are already working. Production API auto-deploy remains off; production Render changes
and deploys should stay manual.

## Run

From repo root:

```bash
npm run start:api
npm run start:admin
```

`/prompt-preview` expects the API to expose `GET /internal/ai/debug-prompt` and requires a valid admin login token.
