import type { DashboardViewer } from "@voicepractice/shared";

import {
  queryAuthorizedTeamPerformanceIntelligence,
  type AuthorizedTeamPerformanceIntelligenceResult,
} from "./authorizedTeamPerformanceIntelligence.js";
import {
  validateAuthorizedOrganizationPerformanceRequest,
} from "./authorizedOrganizationPerformance.js";
import { AuthorizedTeamPerformanceDeniedError } from "./authorizedTeamPerformance.js";
import { canDashboardViewerAccessOrg } from "./dashboardAuthorization.js";
import { parseDashboardPerformanceRouteQuery } from "./dashboardOrganizationPerformanceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

type TeamPerformanceIntelligenceFacade = typeof queryAuthorizedTeamPerformanceIntelligence;

export interface DashboardTeamPerformanceIntelligenceRouteInput {
  readonly query: Readonly<Record<string, unknown>>;
  readonly viewer: DashboardViewer;
  readonly captureSnapshot: () => Promise<PerformanceEvidenceSourceSnapshot>;
  readonly getAsOf?: () => Date;
  /** Test seam for route orchestration and safe error mapping. */
  readonly queryTeamPerformanceIntelligence?: TeamPerformanceIntelligenceFacade;
}

/** Validates first, captures one snapshot, and evaluates against one server instant. */
export async function queryDashboardTeamPerformanceIntelligenceRoute(
  input: DashboardTeamPerformanceIntelligenceRouteInput,
): Promise<AuthorizedTeamPerformanceIntelligenceResult> {
  const request = validateAuthorizedOrganizationPerformanceRequest(
    parseDashboardPerformanceRouteQuery(input.query, false),
  );
  if (!canDashboardViewerAccessOrg(input.viewer, request.organizationId)) {
    throw new AuthorizedTeamPerformanceDeniedError("organization_not_found_or_inaccessible");
  }

  const snapshot = await input.captureSnapshot();
  const asOf = (input.getAsOf ?? (() => new Date()))();
  const queryFacade = input.queryTeamPerformanceIntelligence
    ?? queryAuthorizedTeamPerformanceIntelligence;
  return queryFacade({
    snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
    calendarMonth: request.calendarMonth,
    asOf,
  });
}
