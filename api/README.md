# API (`/api`)

Express API for Phase 1 development.

## Key Endpoints

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
- `GET /support/cases` (admin)
- `GET /support/cases/:caseId` (admin)
- `GET /orgs` / `POST /orgs` / `PATCH /orgs/:orgId` (admin)

## Environment

Create `.env` from `.env.example`:

```bash
PORT=4100
DB_PATH=./db.local.json
ADMIN_BOOTSTRAP_PASSWORD=admin
ADMIN_TOKEN_SECRET=replace_me_for_production
ADMIN_TOKEN_TTL_MINUTES=720
MOBILE_TOKEN_SECRET=replace_me_for_mobile_tokens
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
SUPPORT_TRANSCRIPT_SECRET=replace_me_for_production
```

## Notes

- Storage is file-based JSON (`db.local.json`) for Phase 1.
- Mobile user routes require a per-user mobile bearer token issued by `POST /mobile/onboard`.
- Usage billing increments are 15 seconds (round-down behavior).
- Timezone changes are scheduled for next monthly renewal.
- Remote AI is optional and API-owned. Mobile calls API AI routes; API calls OpenAI.
- Default support behavior stores no transcript. If a user explicitly consents in a support case, transcript data is retained for up to 10 days.
