const AUTHENTICATED_SCOPED_CONFIG_SCREENS = new Set([
  "home",
  "setup",
  "simulation",
  "scorecard",
  "usage_dashboard",
  "admin_home",
  "admin_org_dashboard",
  "admin_org_requests",
  "admin_user_list",
  "admin_user_detail",
  "settings",
  "profile",
  "subscription",
]);

export function requiresAuthenticatedScopedConfig(screen: string): boolean {
  return AUTHENTICATED_SCOPED_CONFIG_SCREENS.has(screen);
}

export function shouldBlockForMissingAuthenticatedScopedConfig(params: {
  screen: string;
  hasUser: boolean;
  hasMobileAuthToken: boolean;
  isSuperUser: boolean;
  hasActiveSuperUserOrg: boolean;
  hasScopedConfig: boolean;
}): boolean {
  if (!params.hasUser || !params.hasMobileAuthToken) {
    return false;
  }

  if (params.isSuperUser && !params.hasActiveSuperUserOrg) {
    return false;
  }

  if (!requiresAuthenticatedScopedConfig(params.screen)) {
    return false;
  }

  return !params.hasScopedConfig;
}
