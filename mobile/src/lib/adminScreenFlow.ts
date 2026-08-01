export type AdminUserListLoadState = "outside" | "active";
export type AdminUserListLoadEvent = "enter" | "leave" | "manual_refresh";

export interface AdminUserListLoadTransition {
  state: AdminUserListLoadState;
  shouldLoad: boolean;
}

export function transitionAdminUserListLoad(
  state: AdminUserListLoadState,
  event: AdminUserListLoadEvent,
): AdminUserListLoadTransition {
  if (event === "leave") {
    return { state: "outside", shouldLoad: false };
  }

  if (event === "manual_refresh") {
    return { state: "active", shouldLoad: true };
  }

  return state === "active"
    ? { state, shouldLoad: false }
    : { state: "active", shouldLoad: true };
}

export function resolveHomeAdminDestination(isOrgAdmin: boolean): "admin_home" | "admin_user_list" {
  return isOrgAdmin ? "admin_home" : "admin_user_list";
}
