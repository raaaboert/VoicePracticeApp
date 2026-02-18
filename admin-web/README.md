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
NEXT_PUBLIC_API_BASE_URL=http://localhost:4100
```

## Run

From repo root:

```bash
npm run start:admin
```
