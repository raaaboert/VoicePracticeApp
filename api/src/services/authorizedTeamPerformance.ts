import type { DashboardViewer } from "@voicepractice/shared";

import { isCurrentDashboardEligibleActor, queryAuthorizedPerformanceEvidence } from "./authorizedPerformanceEvidenceQuery.js";
import {
  projectOrganizationEvidenceCandidate,
  type OrganizationEvidenceCandidate,
} from "./authorizedOrganizationEvidenceCandidates.js";
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

export interface AuthorizedTeamPerformanceScopeInput {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
}

export interface AuthorizedTeamPerformanceScope {
  readonly organizationId: string;
  readonly currentReportCount: number;
  /** Current-report evidence across all dates from one authorized snapshot. */
  readonly candidates: readonly OrganizationEvidenceCandidate[];
}

/**
 * INTERNAL - NOT ROUTE-SAFE. Resolves the current one-level Team population
 * once, then returns only its canonical aggregation candidates. Callers may
 * evaluate multiple periods from this same candidate set; they must never
 * accept a caller-supplied person list.
 */
export function resolveAuthorizedTeamPerformanceScope(
  input: AuthorizedTeamPerformanceScopeInput,
): AuthorizedTeamPerformanceScope {
  const organizationId = input.organizationId;
  const users = input.snapshot.users.filter((user) => user.id !== "deleted_user");
  const actor = users.find((user) => user.id === input.viewer.userId);

  if (
    !actor
    || !isCurrentDashboardEligibleActor({
      actor, viewer: input.viewer, organizations: input.snapshot.organizations,
    })
    || actor.accountType !== "enterprise"
    || actor.orgId !== organizationId
    || !input.snapshot.organizations.some((org) => org.id === organizationId && org.status === "active")
    || !canDashboardViewerAccessOrg(input.viewer, organizationId)
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
    viewer: input.viewer,
    orgIds: new Set([organizationId]),
  });
  const directReportIds = new Set(
    users
      .filter((user) => isCurrentDirectPerformanceReport(actor, user) && permittedUserIds.has(user.id))
      .map((user) => user.id),
  );

  const candidates = queryAuthorizedPerformanceEvidence({
    snapshot: input.snapshot,
    viewer: input.viewer,
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

  return {
    organizationId,
    currentReportCount: directReportIds.size,
    candidates,
  };
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
