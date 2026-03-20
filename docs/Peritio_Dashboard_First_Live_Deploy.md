# Peritio Dashboard First Live Deploy

This document is for the first live deployment of the Peritio dashboard at:

- `app.peritio.ai`

It intentionally does **not** replace or attach the existing root site at:

- `peritio.ai`

## Frontend target

- app: `peritio-web`
- host: `app.peritio.ai`
- hosting: Vercel

Required Vercel env vars:

```bash
PERITIO_API_BASE_URL=https://voicepractice-api-dev.onrender.com
PERITIO_APP_HOST=app.peritio.ai
PERITIO_PUBLIC_HOST=peritio.ai
```

## Backend target

- app: `api`
- hosting: existing Render service
- API base URL: `https://voicepractice-api-dev.onrender.com`

Required Render env vars for this first pass:

```bash
NODE_ENV=production
STORAGE_PROVIDER=postgres
CORS_ALLOWED_ORIGINS=https://app.peritio.ai
WEB_AUTH_TOKEN_SECRET=<strong secret>
AUTH_CODE_DELIVERY_PROVIDER=log_only
```

Also keep the existing required API secrets/env vars already used by the live service, especially:

- `DATABASE_URL`
- `MOBILE_TOKEN_SECRET`
- `SUPPORT_TRANSCRIPT_SECRET`
- `ADMIN_TOKEN_SECRET`
- any existing OpenAI env vars if your current live API already uses them

## Important notes

- `AUTH_CODE_DELIVERY_PROVIDER=log_only` means OTP codes are written to Render logs instead of being emailed.
- If the Render API already serves another browser-based app, append `https://app.peritio.ai` to `CORS_ALLOWED_ORIGINS` instead of replacing the existing list.
- Training-pack lifecycle reporting depends on postgres-backed training-pack storage. Hosted file storage is not sufficient for the full dashboard experience.
- The root `peritio.ai` site should not be added to this Vercel project during the first live pass.
