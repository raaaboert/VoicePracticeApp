# Mobile onboarding privacy correction (9E.2; local pending audit)

## Confirmed finding

The 9E.1a investigation confirmed that `POST /mobile/onboard` returned `buildMobileUserProfile(existing)` before ownership verification. That helper removes only `performanceAccess` and otherwise spreads the stored profile. 9E.2 replaces that pre-verification use with a separate explicit allowlist; the full helper remains unchanged for authorized responses. Avoid testing this on real customer accounts or copying private profiles into logs.

## Consumers inspected

- `mobile/src/lib/api.ts`: `onboardMobileUser` is a typed `requestJson<MobileOnboardResponse>` call, with a 12-second request timeout and no profile-field transformation. The only runtime caller found is `submitOnboarding` in `mobile/App.tsx`.
- `mobile/App.tsx`: persists `user.id` and `authToken`, assigns `user`, initializes settings from `user.email`/`user.timezone`, then checks `verificationRequired || !user.emailVerifiedAt`. If true it routes to email verification using ID/expiry. Privilege and organization navigation branches occur after that early return.
- Verification/resend use the pending user ID/token and the names/company code already entered locally. Successful verification replaces the profile and token with the full authorized response.
- `mobile/src/lib/onboardingState.ts` and App setup/update effects: setup checks inspect names, `emailVerifiedAt`, `accountType`, `isSuperUser` and `mobileProfileReonboardingRequired`. Updates are gated off while on onboarding/verification screens. Cold startup restores ID/token and calls authenticated `fetchMobileUser`; a signed existing-account onboarding token is not a normal mobile credential and is rejected there.
- Read-only `git show aa79a9d1fbac6704eb1d0033af81c6342538073d:mobile/App.tsx` and the corresponding `onboardingState.ts` show the same response handling and verification-first branch. PostgreSQL HTTP tests now execute the actual `runOnboarding` callback and setup helpers from both current and frozen-main source, with native UI/storage dispatch mocked, against real onboarding responses. Both save the pending ID/token, populate verification/settings fields and enter verification without protected navigation or updates. This checks the frozen repository client, not the provenance/version of every installed binary. Physical-device validation remains necessary; no device, binary or release build was run.

## Token and user-ID authority

All onboarding success responses, including first-time accounts, now receive the existing signed, expiring `mobile_onboarding_v1` token containing the account ID/email and caller-supplied names/timezone/company code. Those readable signed fields do not grant organization or role authority. The only handlers that recognize this token are resend-verification and verify-email. They bind it to the current user/email; verification rechecks current user/organization status and requires the delivered, currently bound challenge. Profile/company changes happen after successful verification, then the server rotates to a normal mobile token. Existing signed-token replay returns the usual generic 400; first-time consumed-code replay now follows that same path instead of the old opaque-token 401. Both are failures handled by existing clients.

Other protected mobile routes compare the token HMAC with `mobileAuthTokens`; the signed onboarding token is never saved there. Knowing an account ID or presenting that interim token does not authorize config, performance, scoring, notifications, organization administration, support-case access or account deletion. Public error reporting remains public and grants no extra identity authority. New-account pending state still reserves an opaque token internally before delivery, preserving the existing pending-state transaction, but it is never returned to the caller. Only successful verification returns a normal usable credential. Cold startup with an interim token fails normal profile fetch and returns to onboarding, as already happened for existing accounts; restarting onboarding reuses the pending user subject to cooldowns.

## Exact pre-verification projection

The top-level envelope remains exactly `user`, `authToken`, `verificationRequired=true`, `verificationExpiresAt`, `domainMatch=null`. The user allowlist is:

- Presentation: `id` (required opaque subject), normalized submitted `email`, validated submitted `firstName`/`lastName`, resolved submitted `timezone`.
- Null placeholders: `emailVerifiedAt`, `employeeId`, `managerUserId`, `divisionId`, `orgId`, `pendingTimezone`, `pendingTimezoneEffectiveAt`, `dailySecondsCapOverride`, `dailyOverageExpiresAt`.
- False placeholders: `isPlatformAdmin`, `isSuperUser`, `dashboardAccessEnabled`, `mobileProfileReonboardingRequired`, `allowDailyOverageThisCycle`.
- Neutral compatibility constants: `accountType="individual"`, `tier="free"`, `status="active"`, `orgRole="user"`, `manualBonusSeconds=0`; `planAnchorAt`, `createdAt`, `updatedAt` use `1970-01-01T00:00:00.000Z`.

These are not stored facts or authorization claims. Optional internal performance/overage fields and any future stored properties are omitted. The projection accepts only caller presentation inputs plus the necessary ID, never a stored user object. The same allowlist applies to new, existing verified/unverified, interrupted, retried, privileged and re-onboarding accounts. It does not update stored names/timezone/timestamps merely to construct a response.

Enterprise re-onboarding company-code requirements are enforced by the server before issuing a response and again at verification. The signed interim token retains supplied setup values; neutral hints cannot grant organization access. Delivery remains outside database locks, after pending-state commit, with fresh authority checks before response construction. Challenge bindings, limits, replacement, cancellation, consent and verified-profile responses are unchanged. Real PostgreSQL HTTP tests verify both unchanged stored state before verification and the full authorized profile afterward.

## Remaining risks / deployment gate

The necessary opaque ID and caller email remain in the response/token. Pre-existing status codes/messages for disabled users, company-code mismatches and re-onboarding requirements, 201 versus 200 responses, cooldowns and delivery timing can still disclose account existence or coarse state. This batch does not redesign account enumeration, IP trust or onboarding. No sensitive stored values are added to those errors. Physical iOS/Android tests should cover verify/resend, restart after interrupted onboarding, company-code re-onboarding, reviewer login and account switching.

Local commit only, pending independent Claude privacy/security audit and coordinated staging schema/secrets/auto-deploy verification. Migration 024 is unchanged; no new migration, mobile code, native dependency or production change is required.
