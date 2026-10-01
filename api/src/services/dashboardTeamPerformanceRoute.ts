import type { DashboardViewer } from "@voicepractice/shared";

import {
  validateAuthorizedOrganizationPerformanceRequest,
} from "./authorizedOrganizationPerformance.js";
import {
  queryAuthorizedTeamPerformance,
  AuthorizedTeamPerformanceDeniedError,
  type AuthorizedTeamPerformanceResult,
} from "./authorizedTeamPerformance.js";
import { canDashboardViewerAccessOrg } from "./dashboardAuthorization.js";
import { parseDashboardPerformanceRouteQuery } from "./dashboardOrganizationPerformanceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

type TeamPerformanceFacade = typeof queryAuthorizedTeamPerformance;

export interface DashboardTeamPerformanceRouteInput {
  readonly query: Readonly<Record<string, unknown>>;
  readonly viewer: DashboardViewer;
  readonly captureSnapshot: () => Promise<PerformanceEvidenceSourceSnapshot>;
  /** Test seam for route orchestration and error mapping. */
  readonly queryTeamPerformance?: TeamPerformanceFacade;
}

/** Captures the read-only source once, then aggregates outside the shared lock. */
export async function queryDashboardTeamPerformanceRoute(
  input: DashboardTeamPerformanceRouteInput,
): Promise<AuthorizedTeamPerformanceResult> {
  const request = validateAuthorizedOrganizationPerformanceRequest(
    parseDashboardPerformanceRouteQuery(input.query, false),
  );
  if (!canDashboardViewerAccessOrg(input.viewer, request.organizationId)) {
    throw new AuthorizedTeamPerformanceDeniedError("organization_not_found_or_inaccessible");
  }
  const snapshot = await input.captureSnapshot();
  const queryFacade = input.queryTeamPerformance ?? queryAuthorizedTeamPerformance;
  return queryFacade({
    snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
    calendarMonth: request.calendarMonth,
  });
}
