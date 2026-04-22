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

export function buildDashboardScopedUserDetailHref(userId: string, divisionId: string | null): string {
  const encodedUserId = encodeURIComponent(userId);
  return `/app/users/${encodedUserId}${buildDashboardDivisionSearch("", divisionId)}`;
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
