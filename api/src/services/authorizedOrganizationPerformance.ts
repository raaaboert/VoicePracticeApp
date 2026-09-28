import type { DashboardViewer } from "@voicepractice/shared";

import {
  queryAuthorizedOrganizationEvidenceCandidates,
  type OrganizationEvidenceCandidate,
} from "./authorizedOrganizationEvidenceCandidates.js";
import {
  aggregateOrganizationPerformanceWithHistoricalPrivacy,
  OrganizationPerformanceAggregationInputError,
  validateOrganizationPerformanceSelection,
  type OrganizationPerformanceAggregate,
  type OrganizationPerformanceCalendarMonth,
  type OrganizationPerformanceDimensionFilter,
} from "./organizationPerformanceAggregation.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface AuthorizedOrganizationPerformanceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: OrganizationPerformanceCalendarMonth;
  readonly dimensionFilter?: OrganizationPerformanceDimensionFilter;
}

export class AuthorizedOrganizationPerformanceInvariantError extends Error {
  constructor() {
    super("Authorized organization evidence candidates violated the single-organization invariant.");
    this.name = "AuthorizedOrganizationPerformanceInvariantError";
  }
}

/** Internal assertion exported for direct invariant regression coverage. */
function assertOrganizationPerformanceCandidateOrganization(
  candidates: readonly OrganizationEvidenceCandidate[],
  organizationId: string,
): void {
  if (candidates.some((candidate) => candidate.orgId !== organizationId)) {
    throw new AuthorizedOrganizationPerformanceInvariantError();
  }
}

/**
 * Controlled, route-ready organization intelligence boundary. It authorizes
 * the full historical organization evidence set before applying the one-month,
 * one-dimension aggregate and protected-history policy.
 */
export function queryAuthorizedOrganizationPerformance(
  query: AuthorizedOrganizationPerformanceQuery,
): OrganizationPerformanceAggregate {
  const allowedInputKeys = new Set([
    "snapshot", "viewer", "organizationId", "calendarMonth", "dimensionFilter",
  ]);
  if (Object.keys(query).some((key) => !allowedInputKeys.has(key))) {
    throw new OrganizationPerformanceAggregationInputError([
      "Unsupported organization performance query fields are not allowed.",
    ]);
  }
  const dimensionFilter = validateOrganizationPerformanceSelection(query);
  const candidates = queryAuthorizedOrganizationEvidenceCandidates({
    snapshot: query.snapshot,
    viewer: query.viewer,
    organizationId: query.organizationId,
  });
  const organizationId = query.organizationId.trim();
  assertOrganizationPerformanceCandidateOrganization(candidates, organizationId);

  const currentSubjectKeys = new Set(
    query.snapshot.users
      .filter((user) =>
        user.id !== "deleted_user"
        && user.accountType === "enterprise"
        && user.orgId === organizationId)
      .map((user) => user.id),
  );

  return aggregateOrganizationPerformanceWithHistoricalPrivacy(
    {
      candidates,
      calendarMonth: query.calendarMonth,
      ...(dimensionFilter === undefined ? {} : { dimensionFilter }),
    },
    (candidate) =>
      candidate.subjectKind === "user"
      && candidate.orgId === organizationId
      && currentSubjectKeys.has(candidate.subjectKey),
  );
}
