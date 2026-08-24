import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "App.tsx"),
  "utf8",
);

function organizationPlanSource(): string {
  const start = appSource.indexOf("const renderOrganizationPlan = () =>");
  const end = appSource.indexOf("const renderUsageDashboard = () =>", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return appSource.slice(start, end);
}

test("Organization Plan menu access is gated by the centralized role helper", () => {
  const menuLabelIndex = appSource.indexOf(">Organization Plan</Text>");
  const conditionalIndex = appSource.lastIndexOf("{canViewOrganizationPlan ? (", menuLabelIndex);

  assert.notEqual(menuLabelIndex, -1);
  assert.notEqual(conditionalIndex, -1);
  assert.ok(conditionalIndex < menuLabelIndex);
});

test("direct Organization Plan rendering fails closed through the same access helper", () => {
  const routeStart = appSource.indexOf("if (screen === ORGANIZATION_PLAN_SCREEN)");
  const routeEnd = appSource.indexOf("return renderOrganizationPlan();", routeStart + 1)
    + "return renderOrganizationPlan();".length;
  const source = appSource.slice(routeStart, routeEnd);

  assert.notEqual(routeStart, -1);
  assert.equal(source.includes("resolveOrganizationPlanScreen(screen, user)"), true);
  assert.equal(source.includes("renderOrganizationPlan()"), true);
});

test("Organization Plan renders enterprise operations without consumer plan marketing or price", () => {
  const source = organizationPlanSource();

  assert.match(source, /Organization Plan/);
  assert.match(source, /YOUR PLAN/);
  assert.match(source, /planName/);
  assert.match(source, /Usage this cycle/);
  assert.match(source, /Organization allocation/);
  assert.match(source, /Remaining this cycle/);
  assert.match(source, /Cycle resets/);
  assert.doesNotMatch(
    source,
    /\bFree\b|\bPro\b|\$11\.99|\$0\.00|Other Plans|Price:|Enterprise licensing is available|Support included|Daily simulation|upgrade/i,
  );
});

test("Contact Support opens a modal without creating a support case", () => {
  const source = organizationPlanSource();
  const contactButtonIndex = source.indexOf("<Text style={styles.primaryButtonText}>Contact Support</Text>");
  const contactButtonSource = source.slice(Math.max(0, contactButtonIndex - 300), contactButtonIndex + 100);

  assert.match(source, /Need help with your organization or account\?/);
  assert.notEqual(contactButtonIndex, -1);
  assert.match(contactButtonSource, /onPress=\{openOrganizationPlanSupport\}/);
  assert.doesNotMatch(contactButtonSource, /requestOrganizationPlanSupport|createSupportCase/);
  assert.match(source, /visible=\{isOrganizationPlanSupportOpen\}/);
  assert.match(source, /Tell us how we can help with your organization or account\./);
  assert.match(source, /How can we help\?/);
});

test("Organization Plan support modal cancel path creates no case", () => {
  const callbackStart = appSource.indexOf("const cancelOrganizationPlanSupport = useCallback");
  const callbackEnd = appSource.indexOf("const requestOrganizationPlanSupport = useCallback", callbackStart);
  const callbackSource = appSource.slice(callbackStart, callbackEnd);

  assert.notEqual(callbackStart, -1);
  assert.match(callbackSource, /setIsOrganizationPlanSupportOpen\(false\)/);
  assert.match(callbackSource, /setOrganizationPlanSupportDraft\(""\)/);
  assert.doesNotMatch(callbackSource, /createSupportCase/);
});

test("Organization Plan support submits the written message without transcript data and with explicit origin", () => {
  const callbackStart = appSource.indexOf("const requestOrganizationPlanSupport = useCallback");
  const callbackEnd = appSource.indexOf("useEffect(() =>", callbackStart);
  const callbackSource = appSource.slice(callbackStart, callbackEnd);

  assert.match(callbackSource, /message: organizationPlanSupportDraft\.trim\(\)/);
  assert.match(callbackSource, /includeTranscript: false/);
  assert.match(callbackSource, /source: "organization_plan"/);
  assert.doesNotMatch(callbackSource, /transcript:|scenarioTitle|scorecard/);
});

test("Organization Plan support prevents duplicates and reports a successful Case ID", () => {
  const source = organizationPlanSource();

  assert.match(appSource, /organizationPlanSupportSubmittingRef\.current/);
  assert.match(source, /disabled=\{!canSubmitOrganizationPlanSupportRequest\}/);
  assert.match(source, /Submitting\.\.\./);
  assert.match(appSource, /Support request submitted\. Case ID: \$\{result\.caseId\}\./);
});

test("Organization Plan support failure preserves the draft and allows retry", () => {
  const callbackStart = appSource.indexOf("const requestOrganizationPlanSupport = useCallback");
  const catchStart = appSource.indexOf("} catch (caught) {", callbackStart);
  const finallyEnd = appSource.indexOf("}, [mobileAuthToken", catchStart);
  const failureSource = appSource.slice(catchStart, finallyEnd);

  assert.match(failureSource, /setOrganizationPlanSupportError/);
  assert.match(failureSource, /organizationPlanSupportSubmittingRef\.current = false/);
  assert.match(failureSource, /setIsOrganizationPlanSupportSubmitting\(false\)/);
  assert.doesNotMatch(failureSource, /setOrganizationPlanSupportDraft\(""\)/);
});

test("Organization Plan support actions share geometry and centered Dynamic Type-safe text", () => {
  const source = organizationPlanSource();

  assert.equal(source.match(/styles\.organizationPlanSupportModalAction,/g)?.length, 2);
  assert.equal(source.match(/styles\.organizationPlanSupportModalActionText/g)?.length, 2);
  assert.equal(source.match(/maxFontSizeMultiplier=\{1\.2\}/g)?.length, 2);
  assert.equal(source.match(/numberOfLines=\{2\}/g)?.length, 2);
  assert.match(
    appSource,
    /organizationPlanSupportModalActions: \{ flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 2 \}/,
  );
  assert.match(
    appSource,
    /organizationPlanSupportModalAction: \{ flex: 1, height: 52, minHeight: 52, borderRadius: 14, paddingHorizontal: 12 \}/,
  );
  assert.match(
    appSource,
    /organizationPlanSupportModalActionText: \{ fontSize: 14, lineHeight: 18, fontWeight: "800", textAlign: "center" \}/,
  );
});
