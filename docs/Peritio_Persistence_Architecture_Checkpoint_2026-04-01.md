# Peritio Persistence Architecture Checkpoint (2026-04-01)

This note records the post-hardening persistence state after the dashboard/auth and simulation-history extraction work.

## Extracted Domains

The following domains now persist outside the monolithic app-state snapshot:

- dashboard web auth sessions
- audit events
- support cases
- AI usage events
- score records

## Still Monolithic

The main remaining monolith domains are core app-state records such as:

- users / orgs / config
- training-pack assignments and related core product state

## Decision

`usageSessions` are now extracted.

The previous no-go decision was revisited only after proving a write-safety model for billing and access-control truth.

## `usageSessions` Write-Safety Model

The extracted `usageSessions` design relies on these invariants:

- the dedicated usage-session store is the authoritative billing and entitlement source of truth
- mobile simulation attempts now carry a durable `simulationSessionId`
- the server persists a lightweight recognized simulation-session ledger keyed by that `simulationSessionId`
- normal simulation start registers a recognized started session, and `/usage/sessions` finalization must match that recognized session before usage is recorded
- recognized sessions finalize at most once, so duplicate completion retries resolve to the same usage record instead of double-counting
- each stored usage session persists the billed delta computed at first write so idempotent replays can return the same billing result
- deterministic usage ids derived from `simulationSessionId` remain part of the finalization model so usage-record lookup stays stable after replay
- monolith-side training-assignment lifecycle updates remain secondary derived state and can be reconciled on retry / later reads

This keeps billing/access truth with the extracted store while preserving existing output semantics.

## Practical Constraints

- hosted deployments should still treat `postgres` as the serious path
- `STORAGE_PROVIDER=file` is acceptable only for dev/demo/small-scale operation for simulation-history domains
- extracted `usageSessions` and `scoreRecords` still read from in-process snapshots to preserve synchronous app behavior, so hosted deployments should be treated as single-process unless a future pass adds explicit refresh/invalidation
- attempt / training / reporting composition still spans extracted stores plus monolithic product state, so mixed-architecture discipline still matters

## Practical Recommendation

The major persistence hardening phase is complete enough to shift attention back to product work.

Do not reopen `usageSessions` extraction as an architecture question unless the current write model is being deliberately redesigned.
