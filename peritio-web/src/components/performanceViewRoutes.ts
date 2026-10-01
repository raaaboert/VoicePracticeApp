import { buildDashboardScopedUserDetailHref } from "@/src/components/dashboardDivisionFilterState";

export type PerformanceView = "group" | "individuals" | "goals";

export function buildPerformanceIndividualDetailHref(userId: string, divisionId: string | null): string {
  const base = buildDashboardScopedUserDetailHref(userId, divisionId);
  return `${base}${base.includes("?") ? "&" : "?"}performanceOrigin=individuals`;
}

export function buildPerformanceViewHref(
  view: PerformanceView,
  context: { orgId?: string | null; divisionId?: string | null },
): string {
  const pathname = view === "group"
    ? "/app/performance"
    : `/app/performance/${view}`;
  const params = new URLSearchParams();
  if (context.orgId?.trim()) params.set("orgId", context.orgId.trim());
  if (context.divisionId?.trim()) params.set("divisionId", context.divisionId.trim());
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
