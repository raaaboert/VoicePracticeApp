import {
  requiresAuthenticatedScopedConfig,
  shouldBlockForMissingAuthenticatedScopedConfig,
} from "./scopedConfigGuard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[scoped-config-guard.test] PASS ${name}`);
}

runTest("marks protected authenticated screens as requiring scoped config", () => {
  assert(requiresAuthenticatedScopedConfig("home"), "home should require scoped config");
  assert(requiresAuthenticatedScopedConfig("setup"), "setup should require scoped config");
  assert(requiresAuthenticatedScopedConfig("admin_home"), "admin home should require scoped config");
  assert(!requiresAuthenticatedScopedConfig("verify_email"), "verify email should stay outside the scoped-config guard");
});

runTest("blocks signed-in enterprise users from protected screens when scoped config is missing", () => {
  assert(
    shouldBlockForMissingAuthenticatedScopedConfig({
      screen: "home",
      hasUser: true,
      hasMobileAuthToken: true,
      isSuperUser: false,
      hasActiveSuperUserOrg: false,
      hasScopedConfig: false,
    }),
    "enterprise home should fail closed without scoped config",
  );
});

runTest("allows verification and onboarding-adjacent screens to continue without scoped config", () => {
  assert(
    !shouldBlockForMissingAuthenticatedScopedConfig({
      screen: "verify_email",
      hasUser: true,
      hasMobileAuthToken: true,
      isSuperUser: false,
      hasActiveSuperUserOrg: false,
      hasScopedConfig: false,
    }),
    "verification should remain accessible while scoped config is still loading",
  );
});

runTest("keeps superusers on org selection without forcing an org-scoped config they do not have yet", () => {
  assert(
    !shouldBlockForMissingAuthenticatedScopedConfig({
      screen: "superuser_org_select",
      hasUser: true,
      hasMobileAuthToken: true,
      isSuperUser: true,
      hasActiveSuperUserOrg: false,
      hasScopedConfig: false,
    }),
    "superuser org selection should stay reachable before an org context is activated",
  );
});

runTest("still blocks superusers on protected screens after an org is selected if scoped config is missing", () => {
  assert(
    shouldBlockForMissingAuthenticatedScopedConfig({
      screen: "home",
      hasUser: true,
      hasMobileAuthToken: true,
      isSuperUser: true,
      hasActiveSuperUserOrg: true,
      hasScopedConfig: false,
    }),
    "superuser home should fail closed when the active org config is unavailable",
  );
});
