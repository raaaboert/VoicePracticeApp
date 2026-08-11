import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "App.tsx"),
  "utf8",
);

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test("Start Over remounts onboarding inputs instead of reusing the native OTP input as Company Code", () => {
  const onboardingSource = sourceBetween("const renderOnboarding = () =>", "const renderVerifyEmail = () =>");
  const verificationSource = sourceBetween("const renderVerifyEmail = () =>", "const renderDomainMatch = () =>");

  assert.equal(onboardingSource.includes('key="onboarding-profile-screen"'), true);
  assert.equal(verificationSource.includes('key="verify-email-screen"'), true);
  assert.equal(onboardingSource.includes("value={onboardingCompanyCode}"), true);
  assert.equal(onboardingSource.includes("onChangeText={setOnboardingCompanyCode}"), true);
  assert.equal(verificationSource.includes("value={verificationCode}"), true);
  assert.equal(verificationSource.includes('keyboardType="number-pad"'), true);
  assert.equal(verificationSource.includes("maxLength={6}"), true);
});

test("Start Over clears the mistyped attempt, limited credential, verification state, and saving flags", () => {
  const resetSource = sourceBetween(
    "const resetSessionToOnboarding = useCallback(",
    "const loadAuthenticatedScopedConfig = useCallback(",
  );

  for (const marker of [
    "await clearUserId();",
    "setUser(null);",
    "setMobileAuthToken(null);",
    "setPendingVerificationUserId(null);",
    'setVerificationCode("");',
    "setVerificationExpiresAt(null);",
    'setOnboardingEmail("");',
    'setOnboardingFirstName("");',
    'setOnboardingLastName("");',
    'setOnboardingCompanyCode("");',
    "setIsOnboardingSaving(false);",
    "setIsVerificationSaving(false);",
    'setScreen("onboarding");',
  ]) {
    assert.equal(resetSource.includes(marker), true, `${marker} must remain in the full Start Over reset`);
  }
});
