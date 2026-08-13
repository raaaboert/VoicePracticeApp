import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../App.tsx"),
  "utf8"
);

const EDITABLE_SCROLL_POLICY =
  /keyboardShouldPersistTaps="handled"[\s\S]*?keyboardDismissMode=\{Platform\.OS === "ios" \? "interactive" : "none"\}/;

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);

  assert.notEqual(start, -1, `found ${startMarker}`);
  assert.notEqual(end, -1, `found ${endMarker}`);
  return appSource.slice(start, end);
}

test("onboarding, verification, and company-code scrolls preserve Android keyboard focus", () => {
  for (const section of [
    sourceBetween("const renderOnboarding", "const renderVerifyEmail"),
    sourceBetween("const renderVerifyEmail", "const renderDomainMatch"),
    sourceBetween("const renderDomainMatch", "const renderPendingApproval"),
  ]) {
    assert.match(section, EDITABLE_SCROLL_POLICY);
  }
});

test("editable selection, profile, and admin scrolls use the shared interaction policy", () => {
  for (const section of [
    sourceBetween("function SearchableSelectionDropdown", "export default function App"),
    sourceBetween("const renderSuperUserOrgSelect", "const renderSetup"),
    sourceBetween("const renderProfile", "const renderSettings"),
    sourceBetween("const renderAdminOrgDashboard", "const renderAdminOrgRequests"),
    sourceBetween("const renderAdminUserDetail", "const renderContent"),
  ]) {
    assert.match(section, EDITABLE_SCROLL_POLICY);
  }
});
