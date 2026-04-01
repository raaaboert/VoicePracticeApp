# Peritio Web (`/peritio-web`)

Customer-facing Peritio web experience for:

- `peritio.ai` public landing page
- `app.peritio.ai` authenticated dashboard

## Current scope

- Shared web session login using email + one-time code
- Dashboard access resolved from the existing API user/account/org model
- Real protected reporting for:
  - `/app`
  - `/app/dashboard`
  - `/app/customers`
  - `/app/customers/[customerId]`
  - `/app/users`
  - `/app/users/[userId]`
  - `/app/training`
  - `/app/training/[trainingPackId]`
  - `/app/training/[trainingPackId]/assignments/[assignmentId]`
  - `/app/attempts/[attemptId]`
- Theme settings screen with dark/light mode toggle

The durable parts of the dashboard foundation are:

- shared user identity by email
- verified-email gating via `emailVerifiedAt`
- explicit dashboard authorization via server-side viewer resolution
- tenant-scoped customer dashboard users and `super_user` cross-account access
- Customers as the super-user-only org drilldown path

The shared `/web/auth/*` OTP flow is the only auth path used by `peritio-web`.

The dashboard now uses a hardened OTP request/verify flow plus trusted 14-day browser sessions for returning users.

## OTP delivery

The API owns OTP delivery behind `api/src/services/authCodeDelivery.ts`.

- Local/dev: keep `AUTH_CODE_DELIVERY_PROVIDER=log_only`
- Hosted dashboard: prefer `WEB_AUTH_CODE_DELIVERY_PROVIDER=resend` when you are ready to deliver real OTP emails
- Mobile onboarding verification can stay on `log_only` until you are ready by leaving `MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER` blank or setting it to `log_only`
- Later, if you also want the practice app to email verification codes, set `MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER=resend`

When using Resend, configure these API env vars:

- `RESEND_API_KEY`
- `AUTH_CODE_FROM_EMAIL`
- `AUTH_CODE_FROM_NAME`
- `AUTH_CODE_REPLY_TO` (optional)

If delivery stays on `log_only`, sign-in and verification codes are written to the API logs instead of being emailed.

## Environment

Create `.env.local` from `.env.example`:

```bash
PERITIO_API_BASE_URL=http://localhost:4100
PERITIO_APP_HOST=app.peritio.ai
PERITIO_PUBLIC_HOST=peritio.ai
```

Hosted dashboard values:

```bash
PERITIO_API_BASE_URL=https://voicepractice-api-dev.onrender.com
PERITIO_APP_HOST=app.peritio.ai
PERITIO_PUBLIC_HOST=peritio.ai
```

Required env vars:

- `PERITIO_API_BASE_URL`
- `PERITIO_APP_HOST`
- `PERITIO_PUBLIC_HOST`

`/login`, `/app/*`, and the auth route handlers fail loudly if the required env vars are missing.

## Local setup

1. Configure local API secrets and local dashboard test identities in `api/.env.local`.
2. Keep `AUTH_CODE_DELIVERY_PROVIDER=log_only` for local development unless you are intentionally testing a real email provider.
3. Seed the local file database with dashboard identities:

```bash
npm.cmd run seed:dashboard-local --workspace api
```

4. Start the API:

```bash
npm.cmd run start:api
```

5. In a second terminal, start the Peritio web app:

```bash
npm.cmd run start:peritio
```

Then open:

- `http://localhost:3000/` for the local landing page
- `http://localhost:3000/login` for dashboard sign-in during local development

During local development the API logs the one-time sign-in or verification code to its console.

## Hosted deployment notes

- `peritio-web` is intended to deploy as its own Vercel project from this monorepo
- Vercel project root directory should be `peritio-web`
- because the app imports `@voicepractice/shared` from outside the project folder, enable Vercel's "Include files outside the root directory" setting for this project
- keep `app.peritio.ai` as the authenticated dashboard host
- keep the root `peritio.ai` site isolated from this project unless you intentionally move the public site here later

## Data/storage notes

- dashboard auth and customer reporting work with the existing API data
- training-pack lifecycle reporting depends on the API training-pack store
- the training-pack store requires `STORAGE_PROVIDER=postgres` on the API for full hosted functionality
- if the API is running on file storage, training-pack surfaces will show a real limited/empty state rather than fake data

## Host behavior

- `peritio.ai` serves only the public landing page
- `app.peritio.ai` serves login and dashboard routes
- `localhost` and preview hosts intentionally allow both surfaces for development and preview testing
- unknown production hosts fail closed
