# API (`/api`)

Express API for Phase 1 development.

## Key Endpoints

- `GET /health`
- `GET /ready`
- `POST /auth/login`
- `POST /auth/change-password`
- `GET /config`
- `PATCH /config` (admin)
- `GET /users` (admin)
- `POST /users` (admin)
- `PATCH /users/:userId` (admin)
- `GET /users/:userId/entitlements` (admin)
- `POST /mobile/onboard`
- `GET /mobile/users/:userId`
- `PATCH /mobile/users/:userId/settings`
- `GET /mobile/users/:userId/entitlements`
- `POST /mobile/users/:userId/ai/transcribe` (mobile auth)
- `POST /mobile/users/:userId/ai/opening` (mobile auth)
- `POST /mobile/users/:userId/ai/turn` (mobile auth)
- `POST /mobile/users/:userId/ai/score` (mobile auth)
- `POST /mobile/users/:userId/support/cases` (mobile auth)
- `POST /usage/sessions`
- `GET /usage` (admin)
- `GET /audit/events` (admin)
- `GET /support/cases` (admin)
- `GET /support/cases/:caseId` (admin)
- `GET /orgs` / `POST /orgs` / `PATCH /orgs/:orgId` (admin)

## Environment

Create `.env` from `.env.example`:

```bash
PORT=4100
NODE_ENV=development
STORAGE_PROVIDER=file
DB_PATH=./db.local.json
DATABASE_URL=
CORS_ALLOWED_ORIGINS=http://localhost:3000
ADMIN_BOOTSTRAP_PASSWORD=admin
ADMIN_TOKEN_SECRET=replace_me_for_production
ADMIN_TOKEN_TTL_MINUTES=720
MOBILE_TOKEN_SECRET=replace_me_for_mobile_tokens
MOBILE_REVERIFY_ON_ONBOARD=false
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_MAX_DAILY_CALLS_PER_USER=
OPENAI_MAX_DAILY_CALLS_GLOBAL=
OPENAI_MAX_DAILY_TOKENS_PER_USER=
OPENAI_MAX_DAILY_TOKENS_GLOBAL=
SUPPORT_TRANSCRIPT_SECRET=replace_me_for_production
```

## Notes

- Storage supports two providers:
  - `file` via `DB_PATH`
  - `postgres` via `DATABASE_URL` (durable, recommended for hosted deployments)
- In production, set `STORAGE_PROVIDER` explicitly and provide `CORS_ALLOWED_ORIGINS`.
- Mobile user routes require a per-user mobile bearer token issued by `POST /mobile/onboard`.
- `MOBILE_REVERIFY_ON_ONBOARD` defaults to `true` in production and `false` otherwise.
- AI budget caps default in production when `OPENAI_API_KEY` is set (`120` per-user calls/day, `1500` global calls/day, `250000` per-user tokens/day, `2000000` global tokens/day).
- Usage billing increments are 15 seconds (round-down behavior).
- Timezone changes are scheduled for next monthly renewal.
- Remote AI is optional and API-owned. Mobile calls API AI routes; API calls OpenAI.
- Default support behavior stores no transcript. If a user explicitly consents in a support case, transcript data is retained for up to 10 days.
- `/ready` returns `503` while database connectivity is unavailable. All non-health routes are gated behind readiness.
- Audit events are stored in `auditEvents` and exposed via `GET /audit/events` with org/actor/date filters.
