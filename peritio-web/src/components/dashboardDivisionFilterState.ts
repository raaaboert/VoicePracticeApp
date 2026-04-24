import type {
  DashboardDivisionScope,
  DashboardDivisionScopeOption,
  DashboardViewer,
} from "@voicepractice/shared";

export function formatDashboardDivisionOptionLabel(option: DashboardDivisionScopeOption): string {
  return option.active ? option.name : `${option.name} (Deleted)`;
}

export function buildDashboardDivisionSearch(
  currentSearch: string,
  divisionId: string | null
): string {
  const params = new URLSearchParams(currentSearch);
  if (divisionId && divisionId.trim()) {
    params.set("divisionId", divisionId.trim());
  } else {
    params.delete("divisionId");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildDashboardScopedHref(pathname: string, divisionId: string | null): string {
  return `${pathname}${buildDashboardDivisionSearch("", divisionId)}`;
}

export function buildDashboardScopedUserDetailHref(userId: string, divisionId: string | null): string {
  const encodedUserId = encodeURIComponent(userId);
  return buildDashboardScopedHref(`/app/users/${encodedUserId}`, divisionId);
}

export function buildDashboardScopedCustomerDetailHref(customerId: string, divisionId: string | null): string {
  const encodedCustomerId = encodeURIComponent(customerId);
  return buildDashboardScopedHref(`/app/customers/${encodedCustomerId}`, divisionId);
}

export function buildDashboardScopedTrainingPackHref(trainingPackId: string, divisionId: string | null): string {
  const encodedTrainingPackId = encodeURIComponent(trainingPackId);
  return buildDashboardScopedHref(`/app/training/${encodedTrainingPackId}`, divisionId);
}

export function buildDashboardScopedTrainingPackAssignmentHref(
  trainingPackId: string,
  assignmentId: string,
  divisionId: string | null
): string {
  const encodedTrainingPackId = encodeURIComponent(trainingPackId);
  const encodedAssignmentId = encodeURIComponent(assignmentId);
  return buildDashboardScopedHref(`/app/training/${encodedTrainingPackId}/assignments/${encodedAssignmentId}`, divisionId);
}

export function buildDashboardScopedAttemptDetailHref(attemptId: string, divisionId: string | null): string {
  const encodedAttemptId = encodeURIComponent(attemptId);
  return buildDashboardScopedHref(`/app/attempts/${encodedAttemptId}`, divisionId);
}

export function canRenderSingleScopeDivisionFilter(
  divisionScope: DashboardDivisionScope | null | undefined
): boolean {
  return (divisionScope?.divisions.length ?? 0) > 0;
}

export function canRenderDashboardWorkspaceDivisionFilter(params: {
  viewer: DashboardViewer | null;
  divisionScope: DashboardDivisionScope | null | undefined;
}): boolean {
  return params.viewer?.accessType === "customer_dashboard_user" && canRenderSingleScopeDivisionFilter(params.divisionScope);
}
