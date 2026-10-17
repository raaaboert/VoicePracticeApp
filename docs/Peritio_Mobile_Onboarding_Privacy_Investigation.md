# Mobile onboarding privacy investigation (9E.1a; no contract change)

## Confirmed finding

`POST /mobile/onboard` still returns `buildMobileUserProfile(existing)` before ownership verification. That helper removes only `performanceAccess` and otherwise spreads the stored profile: organization/role, manager and employee ID, privilege/dashboard flags, historical names, verification status, tier and usage/account metadata can be disclosed. 9E.1a intentionally leaves this response projection unchanged for the separate audited fix. Avoid testing this on real customer accounts or copying private profiles into logs.

## Consumers inspected

- `mobile/src/lib/api.ts`: `onboardMobileUser` is a typed `requestJson<MobileOnboardResponse>` call, with a 12-second request timeout and no profile-field transformation. The only runtime caller found is `submitOnboarding` in `mobile/App.tsx`.
- `mobile/App.tsx`: persists `user.id` and `authToken`, assigns `user`, initializes settings from `user.email`/`user.timezone`, then checks `verificationRequired || !user.emailVerifiedAt`. If true it routes to email verification using ID/expiry. Privilege and organization navigation branches occur after that early return.
- Verification/resend use the pending user ID/token and the names/company code already entered locally. Successful verification replaces the profile and token with the full authorized response.
- `mobile/src/lib/onboardingState.ts` and App setup/update effects: setup checks inspect names, `emailVerifiedAt`, `accountType`, `isSuperUser` and `mobileProfileReonboardingRequired`. Updates are gated off while on onboarding/verification screens. Cold startup restores ID/token and calls authenticated `fetchMobileUser`; a signed existing-account onboarding token is not a normal mobile credential and is rejected there.
- Read-only `git show aa79a9d1fbac6704eb1d0033af81c6342538073d:mobile/App.tsx` and the corresponding `onboardingState.ts` show the same response handling and verification-first branch. This checks the frozen repository client, not the provenance/version of every installed binary. A device regression remains necessary for the separately approved response correction.

## Token and user-ID authority

Existing accounts receive a signed, expiring `mobile_onboarding_v1` token containing the account ID/email and caller-supplied names/timezone/company code. Those readable signed fields do not grant organization or role authority. The only handlers that recognize this token are resend-verification and verify-email. They bind it to the current user/email; verification now rechecks current user/organization status and requires the delivered, currently bound challenge. Profile/company changes happen after successful verification, then the server rotates to a normal mobile token.

Other protected mobile routes compare the token HMAC with `mobileAuthTokens`; the signed onboarding token is never saved there. Knowing an account ID or presenting that interim token does not authorize config, performance, scoring, notifications, organization administration, support-case access or account deletion. Public error reporting remains public and grants no extra identity authority. New accounts have a stored opaque token but remain unverified/incomplete; their existing limited setup endpoints do not expose a historical account.

## Minimum compatible projection proposed for the next batch

Transport/navigation needs only top-level `authToken`, `verificationRequired=true`, expiry and the compatibility `domainMatch=null`, plus `user.id`, normalized submitted email and requested timezone. Keep a non-identifying `UserProfile`-shaped shell for old clients/types rather than abruptly deleting required fields. Set `emailVerifiedAt=null`; populate any needed names from the submitted request, never historical values. Organization/manager/employee IDs should be null, privilege/manual-dashboard flags false, and tier/role/account/usage/date fields neutral compatibility values, not stored facts.

Review setup-helper behavior explicitly: existing enterprise re-onboarding company-code requirements are enforced by the server before issuing a response, and the signed interim token retains supplied setup values. Neutral projection fields must neither bypass those server checks nor send old clients around an onboarding/verification loop. Do not rely only on UI flags for authority. After verification, return the full authorized profile through the unchanged success path.

The separate implementation should cover registered/unregistered emails, flagged enterprise re-onboarding, super/platform accounts, normal and reviewer OTPs, resend, lost responses and restart, plus denied uses of interim tokens on protected routes. Preserve current and frozen-client envelope/types and confirm on physical clients. No response hardening or mobile code was implemented in 9E.1a.
