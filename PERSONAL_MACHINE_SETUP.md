# Personal Machine Setup Checklist

Use this when moving/continuing VoicePracticeApp on a personal machine.

## 1) Confirm local toolchain

Install and verify:

- Git for Windows
- Node.js LTS (includes npm)
- VS Code

Quick check:

```powershell
git --version
node -v
npm -v
```

Or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
```

## 2) Reinstall dependencies cleanly

From repo root:

```powershell
npm install
```

## 3) Recreate local env files with personal values

```powershell
copy api\.env.example api\.env
copy admin-web\.env.example admin-web\.env
copy mobile\.env.example mobile\.env
```

Notes:

- Keep `.env` files uncommitted.
- Remote AI is disabled in the current baseline build; no OpenAI token is required.

## 4) Point git remote to personal repository

```powershell
git remote -v
git remote set-url origin <your-personal-repo-url>
git remote -v
```

## 5) Use personal VS Code accounts/extensions

- Sign into VS Code using personal account(s).
- Ensure sync/extensions are from personal profile.

## 6) Use personal API credentials/billing only

- If remote AI is enabled later, use personal OpenAI API keys and billing only (configured on the API server via `api/.env`).

## 7) Verify local stack startup

```powershell
npm run smoke:stack
```

## 8) Launch all dev surfaces

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-local-stack.ps1
```
