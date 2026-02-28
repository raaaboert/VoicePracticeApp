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
```

`API_BASE_URL` is the backend API base used by the admin utility in local and Vercel environments.

## Run

From repo root:

```bash
npm run start:api
npm run start:admin
```

`/prompt-preview` expects the API to expose `GET /internal/ai/debug-prompt` and requires a valid admin login token.
