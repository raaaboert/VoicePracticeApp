import type { DashboardViewer } from "@voicepractice/shared";

import {
  assertAuthorizedOrganizationPerformanceAccess,
  AuthorizedOrganizationPerformanceInputError,
  validateAuthorizedOrganizationPerformanceRequest,
  type AuthorizedOrganizationPerformanceCalendarMonth,
} from "./authorizedOrganizationPerformance.js";
import {
  queryAuthorizedOrganizationEvidenceCandidates,
  type OrganizationEvidenceCandidate,
} from "./authorizedOrganizationEvidenceCandidates.js";
import {
  resolveCurrentOrganizationPerformancePopulation,
  selectCurrentOrganizationPerformanceCandidates,
} from "./currentOrganizationPerformancePopulation.js";
import {
  aggregateCurrentPopulationPerformance,
  getPreviousOrganizationPerformanceCalendarMonth,
} from "./organizationPerformanceAggregation.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";
import {
  buildPerformanceIntelligenceCompletionComparisons,
  buildPerformanceIntelligenceMetricComparisons,
  projectPerformanceIntelligenceActivity,
  type TeamPerformanceIntelligenceCalendarMonth,
  type TeamPerformanceIntelligenceCompletionComparison,
  type TeamPerformanceIntelligenceMetricComparison,
  type TeamPerformanceIntelligencePeriodActivity,
} from "./teamPerformanceIntelligenceFacts.js";

export interface OrganizationPerformanceIntelligenceFactsInput {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
}

/** Identity-free deterministic facts. This is internal and is not an HTTP DTO. */
export interface OrganizationPerformanceIntelligenceFacts {
  readonly scope: "organization";
  readonly currentMonth: TeamPerformanceIntelligenceCalendarMonth;
  readonly comparisonMonth: TeamPerformanceIntelligenceCalendarMonth;
  readonly population: {
    readonly currentMemberCount: number;
    readonly hasCurrentMembers: boolean;
  };
  readonly activity: {
    readonly current: TeamPerformanceIntelligencePeriodActivity;
    readonly previous: TeamPerformanceIntelligencePeriodActivity;
    readonly attemptDelta: number;
    readonly conclusiveAttemptDelta: number;
  };
  readonly metricComparisons: readonly TeamPerformanceIntelligenceMetricComparison[];
  readonly completionComparisons: readonly TeamPerformanceIntelligenceCompletionComparison[];
  readonly focusReadiness: {
    readonly available: false;
    readonly reason: "historical_focus_topic_mapping_unavailable";
  };
}

export class OrganizationPerformanceIntelligenceInvariantError extends Error {
  constructor(message = "Organization intelligence evidence violated the current-population invariant.") {
    super(message);
    this.name = "OrganizationPerformanceIntelligenceInvariantError";
  }
}

function assertCurrentPopulationCandidateInvariant(
  candidates: readonly OrganizationEvidenceCandidate[],
  organizationId: string,
  memberIds: ReadonlySet<string>,
): void {
  if (candidates.some((candidate) =>
    candidate.orgId !== organizationId
    || candidate.subjectKind !== "user"
    || !memberIds.has(candidate.subjectKey))) {
    throw new OrganizationPerformanceIntelligenceInvariantError();
  }
}

/**
 * INTERNAL - NOT ROUTE-SAFE. Builds organization intelligence facts from one
 * approved snapshot. It resolves the current enterprise organization
 * population exactly once, then applies the resulting candidate set to the
 * selected and immediately preceding UTC calendar months.
 */
export function buildOrganizationPerformanceIntelligenceFacts(
  input: OrganizationPerformanceIntelligenceFactsInput,
): OrganizationPerformanceIntelligenceFacts {
  if (Object.keys(input).some((key) => ![
    "snapshot", "viewer", "organizationId", "calendarMonth",
  ].includes(key))) {
    throw new AuthorizedOrganizationPerformanceInputError([
      "Unsupported organization intelligence fact input fields are not allowed.",
    ]);
  }
  const request = validateAuthorizedOrganizationPerformanceRequest({
    organizationId: input.organizationId,
    calendarMonth: input.calendarMonth,
  });
  assertAuthorizedOrganizationPerformanceAccess({
    snapshot: input.snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
  });

  const population = resolveCurrentOrganizationPerformancePopulation({
    snapshot: input.snapshot,
    organizationId: request.organizationId,
  });
  const authorizedCandidates = queryAuthorizedOrganizationEvidenceCandidates({
    snapshot: input.snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
  });
  const candidates = selectCurrentOrganizationPerformanceCandidates(
    authorizedCandidates,
    population,
  );
  assertCurrentPopulationCandidateInvariant(
    candidates,
    request.organizationId,
    population.memberIds,
  );

  const comparisonMonth = getPreviousOrganizationPerformanceCalendarMonth(request.calendarMonth);
  const current = aggregateCurrentPopulationPerformance({
    candidates,
    calendarMonth: request.calendarMonth,
  });
  const previous = aggregateCurrentPopulationPerformance({
    candidates,
    calendarMonth: comparisonMonth,
  });
  if (current.activity === null || previous.activity === null) {
    throw new OrganizationPerformanceIntelligenceInvariantError(
      "Organization intelligence expected current-population activity facts for both periods.",
    );
  }

  const currentActivity = projectPerformanceIntelligenceActivity(current.activity);
  const previousActivity = projectPerformanceIntelligenceActivity(previous.activity);
  return {
    scope: "organization",
    currentMonth: { ...current.calendarMonth },
    comparisonMonth: { ...previous.calendarMonth },
    population: {
      currentMemberCount: population.currentMemberCount,
      hasCurrentMembers: population.currentMemberCount > 0,
    },
    activity: {
      current: currentActivity,
      previous: previousActivity,
      attemptDelta: currentActivity.attemptCount - previousActivity.attemptCount,
      conclusiveAttemptDelta:
        currentActivity.conclusiveAttemptCount - previousActivity.conclusiveAttemptCount,
    },
    metricComparisons: buildPerformanceIntelligenceMetricComparisons(
      current.metricGroups,
      previous.metricGroups,
    ),
    completionComparisons: buildPerformanceIntelligenceCompletionComparisons(
      current.completionGroups,
      previous.completionGroups,
    ),
    focusReadiness: {
      available: false,
      reason: "historical_focus_topic_mapping_unavailable",
    },
  };
}
