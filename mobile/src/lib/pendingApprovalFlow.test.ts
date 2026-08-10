import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "App.tsx"),
  "utf8",
);

test("Pending Approval is a dedicated screen without company-code resubmission", () => {
  const start = appSource.indexOf("const renderPendingApproval = () =>");
  const end = appSource.indexOf("const renderSuperUserOrgSelect = () =>", start);
  const source = appSource.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.equal(source.includes("Your access request has been submitted."), true);
  assert.equal(source.includes("refreshPendingApprovalStatus"), true);
  assert.equal(source.includes("Sign Out"), true);
  assert.equal(source.includes("TextInput"), false);
  assert.equal(source.includes("submitOrgAccessRequestByCode"), false);
});

test("approved access loads entitlements and scoped config before navigating Home", () => {
  const start = appSource.indexOf("const activateApprovedMobileSession = useCallback(");
  const end = appSource.indexOf("const applyOrganizationAccessRoute = useCallback(", start);
  const source = appSource.slice(start, end);
  const entitlementsIndex = source.indexOf("fetchEntitlements(");
  const scopedConfigIndex = source.indexOf("loadAuthenticatedScopedConfig(");
  const homeIndex = source.indexOf('setScreen("home")');

  assert.notEqual(start, -1);
  assert.ok(entitlementsIndex < scopedConfigIndex);
  assert.ok(scopedConfigIndex < homeIndex);
  assert.equal(source.includes("if (!scopedConfigLoaded)"), true);
});

test("restored sessions resolve access requests instead of routing from profile alone", () => {
  const start = appSource.indexOf("const initializeApp = useCallback(");
  const end = appSource.indexOf("useEffect(() => {", start);
  const source = appSource.slice(start, end);

  assert.equal(source.includes("resolveOrganizationAccessForSession(userPayload, storedMobileToken)"), true);
  assert.equal(source.includes("shouldShowCompanyAccessScreen"), false);
});
