import type { DashboardViewer } from "@voicepractice/shared";

import { isCurrentDashboardEligibleActor, queryAuthorizedPerformanceEvidence } from "./authorizedPerformanceEvidenceQuery.js";
import { projectOrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";
import {
  AuthorizedOrganizationPerformanceInputError,
  projectRouteSafeResult,
  validateAuthorizedOrganizationPerformanceRequest,
  type AuthorizedOrganizationPerformanceCalendarMonth,
  type AuthorizedOrganizationPerformanceResult,
} from "./authorizedOrganizationPerformance.js";
import { canDashboardViewerAccessOrg } from "./dashboardAuthorization.js";
import { aggregateCurrentPopulationPerformance } from "./organizationPerformanceAggregation.js";
import {
  getDashboardPermittedUserIds,
  isCurrentDirectPerformanceReport,
  resolvePerformanceAccessLevel,
} from "./performanceAuthorization.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface AuthorizedTeamPerformanceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
}

export type AuthorizedTeamPerformanceResult = AuthorizedOrganizationPerformanceResult;

export class AuthorizedTeamPerformanceDeniedError extends Error {
  readonly reason: "organization_not_found_or_inaccessible" | "performance_scope_denied";

  constructor(reason: AuthorizedTeamPerformanceDeniedError["reason"]) {
    super(reason === "performance_scope_denied"
      ? "Team performance access required."
      : "Performance workspace not found.");
    this.name = "AuthorizedTeamPerformanceDeniedError";
    this.reason = reason;
  }
}

export class AuthorizedTeamPerformanceInvariantError extends Error {
  constructor() {
    super("Team performance evidence violated the current direct-report scope invariant.");
    this.name = "AuthorizedTeamPerformanceInvariantError";
  }
}

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
  const organizationId = request.organizationId;
  const users = query.snapshot.users.filter((user) => user.id !== "deleted_user");
  const actor = users.find((user) => user.id === query.viewer.userId);

  if (
    !actor
    || !isCurrentDashboardEligibleActor({
      actor, viewer: query.viewer, organizations: query.snapshot.organizations,
    })
    || actor.accountType !== "enterprise"
    || actor.orgId !== organizationId
    || !query.snapshot.organizations.some((org) => org.id === organizationId && org.status === "active")
    || !canDashboardViewerAccessOrg(query.viewer, organizationId)
  ) {
    throw new AuthorizedTeamPerformanceDeniedError("organization_not_found_or_inaccessible");
  }

  const access = resolvePerformanceAccessLevel(actor, new Set([organizationId]));
  if (access !== "team" && access !== "organization") {
    throw new AuthorizedTeamPerformanceDeniedError("performance_scope_denied");
  }

  const permittedUserIds = getDashboardPermittedUserIds({
    db: { users },
    actor,
    viewer: query.viewer,
    orgIds: new Set([organizationId]),
  });
  const directReportIds = new Set(
    users
      .filter((user) => isCurrentDirectPerformanceReport(actor, user) && permittedUserIds.has(user.id))
      .map((user) => user.id),
  );

  const candidates = queryAuthorizedPerformanceEvidence({
    snapshot: query.snapshot,
    viewer: query.viewer,
    organizationId,
  })
    .filter((evidence) => evidence.subjectKind === "user" && directReportIds.has(evidence.userId))
    .map(projectOrganizationEvidenceCandidate);

  if (candidates.some((candidate) =>
    candidate.orgId !== organizationId
    || candidate.subjectKind !== "user"
    || !directReportIds.has(candidate.subjectKey)
  )) {
    throw new AuthorizedTeamPerformanceInvariantError();
  }

  return projectRouteSafeResult(aggregateCurrentPopulationPerformance({
    candidates,
    calendarMonth: request.calendarMonth,
  }));
}
