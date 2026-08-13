import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../App.tsx"),
  "utf8"
);
const verifyEmailStart = appSource.indexOf("const renderVerifyEmail");
const verifyEmailEnd = appSource.indexOf("const renderDomainMatch", verifyEmailStart);
const verifyEmailSource = appSource.slice(verifyEmailStart, verifyEmailEnd);

test("Verify Email resizes and scrolls above Android and iOS keyboards", () => {
  assert.match(
    verifyEmailSource,
    /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/
  );
  assert.match(
    verifyEmailSource,
    /contentContainerStyle=\{\[styles\.scrollContent, styles\.verifyEmailScrollContent\]\}/
  );
  assert.match(verifyEmailSource, /keyboardShouldPersistTaps="handled"/);
  assert.match(
    verifyEmailSource,
    /keyboardDismissMode=\{Platform\.OS === "ios" \? "interactive" : "none"\}/
  );
  assert.match(
    appSource,
    /verifyEmailScrollContent:\s*\{\s*flexGrow:\s*1,\s*paddingBottom:\s*48\s*\}/
  );
});

test("Verify Email keeps all fields and existing actions in the keyboard-aware scroll body", () => {
  const scrollStart = verifyEmailSource.indexOf("<ScrollView");
  const scrollEnd = verifyEmailSource.indexOf("</ScrollView>", scrollStart);

  for (const marker of [
    "value={onboardingFirstName}",
    "value={onboardingLastName}",
    "value={onboardingCompanyCode}",
    "value={verificationCode}",
    "void submitVerificationCode();",
    "void resendVerificationCode();",
    "void resetSessionToOnboarding();",
  ]) {
    const markerIndex = verifyEmailSource.indexOf(marker);
    assert.ok(markerIndex > scrollStart && markerIndex < scrollEnd, `${marker} stays scrollable`);
  }
});
