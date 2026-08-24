import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(sourceDirectory, "../../App.tsx"), "utf8");
const storageSource = readFileSync(resolve(sourceDirectory, "storage.ts"), "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return appSource.slice(start, end);
}

test("org-admin approval actions share geometry while retaining semantic styles", () => {
  const requestScreen = sourceBetween(
    "const renderAdminOrgRequests = () =>",
    "const renderAdminUserList = () =>",
  );
  const styleSource = sourceBetween("function createStyles(theme: ThemeTokens)", "orgAccessRequestActionText:");

  assert.match(requestScreen, /styles\.primaryButton,[\s\S]*?styles\.orgAccessRequestAction/);
  assert.match(requestScreen, /styles\.ghostButton,[\s\S]*?styles\.orgAccessRequestAction/);
  assert.match(requestScreen, /styles\.primaryButtonText, styles\.orgAccessRequestActionText/);
  assert.match(requestScreen, /styles\.ghostButtonText, styles\.orgAccessRequestActionText/);
  assert.match(requestScreen, /disabled=\{adminLoading\}/);
  assert.equal(requestScreen.match(/maxFontSizeMultiplier=\{1\.2\}/g)?.length, 2);
  assert.equal(requestScreen.match(/numberOfLines=\{1\}/g)?.length, 2);
  assert.match(requestScreen, />\s*Approve\s*<\/Text>/);
  assert.match(requestScreen, />\s*Reject\s*<\/Text>/);

  assert.match(
    styleSource,
    /orgAccessRequestAction: \{ flex: 1, height: 52, minHeight: 52, borderRadius: 14, paddingHorizontal: 12 \}/,
  );
  assert.match(
    appSource,
    /orgAccessRequestActionText: \{ fontSize: 14, lineHeight: 18, fontWeight: "800", textAlign: "center" \}/,
  );
});

test("reset invalidates org-scoped state before persisted authentication cleanup", () => {
  const invalidation = sourceBetween(
    "const invalidateIdentityScopedState = useCallback",
    "const apiConfigured = useMemo",
  );
  const reset = sourceBetween(
    "const resetSessionToOnboarding = useCallback",
    "const loadAuthenticatedScopedConfig = useCallback",
  );

  for (const marker of [
    "identityScopedRequestGenerationRef.current += 1",
    "setConfig(null)",
    "setEntitlements(null)",
    "setScoreSummary(null)",
    "setOrgAdminDashboard(null)",
    "setOrgAdminAnalytics(null)",
    "setOrgAdminUsers(null)",
    "setOrgAdminAccessRequests(null)",
    "setOrgAdminUserDetail(null)",
    'setSelectedAdminUserId("")',
    "setOrganizationPlanSupportDraft(\"\")",
  ]) {
    assert.equal(invalidation.includes(marker), true, `${marker} must be cleared for an identity transition`);
  }

  const invalidateIndex = reset.indexOf("invalidateIdentityScopedState()");
  const persistentCleanupIndex = reset.indexOf("await clearUserId()");
  assert.ok(invalidateIndex >= 0 && invalidateIndex < persistentCleanupIndex);
  assert.ok(reset.indexOf("setUser(null)") < persistentCleanupIndex);
  assert.ok(reset.indexOf("setMobileAuthToken(null)") < persistentCleanupIndex);
  assert.ok(reset.indexOf('setScreen("onboarding")') > persistentCleanupIndex);

  const storageCleanup = storageSource.slice(
    storageSource.indexOf("export async function clearUserId"),
    storageSource.indexOf("export async function loadSuperUserActiveOrgId"),
  );
  assert.match(storageCleanup, /USER_ID_STORAGE_KEY/);
  assert.match(storageCleanup, /ACTIVE_INDUSTRY_BASELINE_CONTEXT_STORAGE_KEY/);
  assert.match(storageCleanup, /SUPERUSER_ACTIVE_ORG_ID_STORAGE_KEY/);
  assert.match(storageCleanup, /clearMobileAuthToken\(\)/);
});

test("old org requests cannot repopulate state after a new identity generation", () => {
  for (const [start, end, responseSetter] of [
    ["const refreshOrgAdminDashboard", "const refreshOrgAdminUsers", "setOrgAdminDashboard"],
    ["const refreshOrgAdminUsers", "const handleAdminUserListLoadEvent", "setOrgAdminUsers"],
    ["const refreshOrgAdminAccessRequests", "const decideOrgAccessRequest", "setOrgAdminAccessRequests"],
    ["const refreshOrgAdminUserDetail", "const setOrgUserLocked", "setOrgAdminUserDetail"],
  ] as const) {
    const refresh = sourceBetween(start, end);
    const guardIndex = refresh.indexOf(
      "requestGeneration !== identityScopedRequestGenerationRef.current",
    );
    assert.ok(guardIndex >= 0, `${start} must reject a stale identity response`);
    assert.ok(guardIndex < refresh.indexOf(responseSetter), `${responseSetter} must run only after the identity guard`);
  }

  const activation = sourceBetween(
    "const activateApprovedMobileSession = useCallback",
    "const applyOrganizationAccessRoute = useCallback",
  );
  assert.match(activation, /invalidateIdentityScopedState\(\)/);
  assert.match(activation, /requestGeneration !== identityScopedRequestGenerationRef\.current/);
  assert.match(activation, /requestGeneration,/);
  assert.match(activation, /if \(!scopedConfigLoaded\)[\s\S]*?return false/);

  const adminHome = sourceBetween("const renderAdminHome = () =>", "const renderAdminOrgDashboard = () =>");
  assert.match(adminHome, /orgAdminUsers\?\.org\?\.name/);
  assert.match(appSource, /screen === "admin_home" && !orgAdminUsers[\s\S]*?refreshOrgAdminUsers\(\)/);
});
