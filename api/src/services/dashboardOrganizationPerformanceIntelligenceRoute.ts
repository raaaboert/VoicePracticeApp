import type { DashboardViewer } from "@voicepractice/shared";

import {
  queryAuthorizedOrganizationPerformanceIntelligence,
  type AuthorizedOrganizationPerformanceIntelligenceResult,
} from "./authorizedOrganizationPerformanceIntelligence.js";
import {
  precheckAuthorizedOrganizationPerformanceViewerAccess,
  validateAuthorizedOrganizationPerformanceRequest,
} from "./authorizedOrganizationPerformance.js";
import { parseDashboardPerformanceRouteQuery } from "./dashboardOrganizationPerformanceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

type OrganizationPerformanceIntelligenceFacade =
  typeof queryAuthorizedOrganizationPerformanceIntelligence;

export interface DashboardOrganizationPerformanceIntelligenceRouteInput {
  readonly query: Readonly<Record<string, unknown>>;
  readonly viewer: DashboardViewer;
  readonly captureSnapshot: () => Promise<PerformanceEvidenceSourceSnapshot>;
  readonly getAsOf?: () => Date;
  /** Test seam for orchestration and safe HTTP error mapping. */
  readonly queryOrganizationPerformanceIntelligence?: OrganizationPerformanceIntelligenceFacade;
}

/** Validates first, captures one snapshot, and evaluates against one server-owned instant. */
export async function queryDashboardOrganizationPerformanceIntelligenceRoute(
  input: DashboardOrganizationPerformanceIntelligenceRouteInput,
): Promise<AuthorizedOrganizationPerformanceIntelligenceResult> {
  const request = validateAuthorizedOrganizationPerformanceRequest(
    parseDashboardPerformanceRouteQuery(input.query, false),
  );
  precheckAuthorizedOrganizationPerformanceViewerAccess({
    viewer: input.viewer,
    organizationId: request.organizationId,
  });

  const snapshot = await input.captureSnapshot();
  const asOf = (input.getAsOf ?? (() => new Date()))();
  const queryFacade = input.queryOrganizationPerformanceIntelligence
    ?? queryAuthorizedOrganizationPerformanceIntelligence;
  return queryFacade({
    snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
    calendarMonth: request.calendarMonth,
    asOf,
  });
}
