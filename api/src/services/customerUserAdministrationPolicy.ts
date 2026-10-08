import type {
  DashboardAdminCapabilities,
  DashboardViewer,
  UserProfile,
  UserStatus,
} from "@voicepractice/shared";

export type CustomerUserAdministrationField =
  | "firstName"
  | "lastName"
  | "employeeId"
  | "status"
  | "managerUserId"
  | "orgRole"
  | "performanceAccess"
  | "dashboardAccessEnabled"
  | "usageControls";

export interface CustomerUserAdministrationContext {
  actor: UserProfile;
  viewer?: DashboardViewer | null;
}

function isPlatformAdministrator(context: CustomerUserAdministrationContext): boolean {
  return context.actor.isSuperUser === true && context.viewer?.accessType === "super_user";
}

function sharesOrganization(actor: UserProfile, target: UserProfile): boolean {
  return actor.accountType === "enterprise"
    && target.accountType === "enterprise"
    && Boolean(actor.orgId)
    && actor.orgId === target.orgId;
}

export function canAdministerOrganizationUsers(actor: UserProfile): boolean {
  return actor.accountType === "enterprise"
    && Boolean(actor.orgId)
    && actor.status === "active"
    && (actor.orgRole === "org_admin" || actor.orgRole === "user_admin");
}

export function canViewCustomerOrganizationUser(
  context: CustomerUserAdministrationContext,
  target: UserProfile,
): boolean {
  if (isPlatformAdministrator(context)) {
    return true;
  }
  return sharesOrganization(context.actor, target) && canAdministerOrganizationUsers(context.actor);
}

export function canManageCustomerRegularUser(
  context: CustomerUserAdministrationContext,
  target: UserProfile,
): boolean {
  if (isPlatformAdministrator(context)) {
    return target.accountType === "enterprise" && target.orgRole !== "org_admin";
  }
  if (!sharesOrganization(context.actor, target) || !canAdministerOrganizationUsers(context.actor)) {
    return false;
  }
  if (context.actor.orgRole === "user_admin") {
    return target.orgRole === "user";
  }
  return target.orgRole === "user" || target.orgRole === "user_admin";
}

export function canEditCustomerUserField(params: {
  context: CustomerUserAdministrationContext;
  target: UserProfile;
  field: CustomerUserAdministrationField;
}): boolean {
  const { context, target, field } = params;
  if (!canViewCustomerOrganizationUser(context, target)) {
    return false;
  }
  const platformAdmin = isPlatformAdministrator(context);
  const orgAdmin = context.actor.orgRole === "org_admin";
  const regularTarget = target.orgRole === "user";
  if (field === "status") {
    if (target.id === context.actor.id && field === "status") {
      return false;
    }
    return regularTarget || platformAdmin || orgAdmin;
  }
  if (field === "managerUserId") {
    return regularTarget;
  }
  if (field === "firstName" || field === "lastName" || field === "employeeId") {
    return regularTarget || platformAdmin || orgAdmin;
  }
  if (field === "orgRole" || field === "performanceAccess") {
    return platformAdmin || orgAdmin;
  }
  if (field === "usageControls") {
    return platformAdmin || orgAdmin;
  }
  return false;
}

export function canChangeCustomerUserStatus(params: {
  context: CustomerUserAdministrationContext;
  target: UserProfile;
  nextStatus: UserStatus;
  orgUsers: readonly UserProfile[];
}): boolean {
  if (!canEditCustomerUserField({ ...params, field: "status" })) {
    return false;
  }
  if (params.target.orgRole !== "org_admin") {
    return true;
  }
  const activeOrgAdmins = params.orgUsers.filter(
    (user) => user.orgId === params.target.orgId && user.orgRole === "org_admin" && user.status === "active",
  ).length;
  return params.nextStatus !== "disabled" || activeOrgAdmins > 1;
}

export function canDecideCustomerAccessRequests(actor: UserProfile): boolean {
  return canAdministerOrganizationUsers(actor);
}

export function buildCustomerUserAdministrationCapabilities(
  role: UserProfile["orgRole"] | null,
  options?: { superUserOrgContext?: boolean },
): DashboardAdminCapabilities {
  if (options?.superUserOrgContext || role === "org_admin") {
    return {
      viewOrganizationUsers: true,
      manageRegularOrganizationUsers: true,
      approveRejectAccessRequests: true,
      editEmployeeIds: true,
      editUserNames: true,
      manageUserRoles: true,
      assignUserManagers: true,
      managePerformanceAccess: true,
      manageOrganizationContent: true,
      manageFocusTopics: true,
    };
  }
  if (role === "user_admin") {
    return {
      viewOrganizationUsers: true,
      manageRegularOrganizationUsers: true,
      approveRejectAccessRequests: true,
      editEmployeeIds: true,
      editUserNames: true,
      manageUserRoles: false,
      assignUserManagers: true,
      managePerformanceAccess: false,
      manageOrganizationContent: false,
      manageFocusTopics: false,
    };
  }
  return {
    viewOrganizationUsers: false,
    manageRegularOrganizationUsers: false,
    approveRejectAccessRequests: false,
    editEmployeeIds: false,
    editUserNames: false,
    manageUserRoles: false,
    assignUserManagers: false,
    managePerformanceAccess: false,
    manageOrganizationContent: false,
    manageFocusTopics: false,
  };
}
