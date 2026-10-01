import type { DashboardViewer } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceInputError,
  projectRouteSafeResult,
  validateAuthorizedOrganizationPerformanceRequest,
  type AuthorizedOrganizationPerformanceCalendarMonth,
  type AuthorizedOrganizationPerformanceResult,
} from "./authorizedOrganizationPerformance.js";
import {
  AuthorizedTeamPerformanceDeniedError,
  AuthorizedTeamPerformanceInvariantError,
  resolveAuthorizedTeamPerformanceScope,
} from "./authorizedTeamPerformanceInternal.js";
import { aggregateCurrentPopulationPerformance } from "./organizationPerformanceAggregation.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export {
  AuthorizedTeamPerformanceDeniedError,
  AuthorizedTeamPerformanceInvariantError,
};

export interface AuthorizedTeamPerformanceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
}

export type AuthorizedTeamPerformanceResult = AuthorizedOrganizationPerformanceResult;

/**
 * Route-safe Team summary for the authenticated viewer's current, one-level
 * direct reports. Disabled same-org reports remain person-viewable under the
 * existing Performance target rule and therefore remain in this population.
 */
export function queryAuthorizedTeamPerformance(
  query: AuthorizedTeamPerformanceQuery,
): AuthorizedTeamPerformanceResult {
  if (Object.keys(query).some((key) => ![
    "snapshot", "viewer", "organizationId", "calendarMonth",
  ].includes(key))) {
    throw new AuthorizedOrganizationPerformanceInputError([
      "Unsupported team performance query fields are not allowed.",
    ]);
  }
  const request = validateAuthorizedOrganizationPerformanceRequest({
    organizationId: query.organizationId,
    calendarMonth: query.calendarMonth,
  });
  const scope = resolveAuthorizedTeamPerformanceScope({
    snapshot: query.snapshot,
    viewer: query.viewer,
    organizationId: request.organizationId,
  });

  return projectRouteSafeResult(aggregateCurrentPopulationPerformance({
    candidates: scope.candidates,
    calendarMonth: request.calendarMonth,
  }));
}
