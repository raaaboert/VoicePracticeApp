import type { DashboardViewer, SimulationScoringWeightsApplied } from "@voicepractice/shared";

import {
  AuthorizedOrganizationEvidenceCandidatesInputError,
  queryAuthorizedOrganizationEvidenceCandidates,
  type OrganizationEvidenceCandidate,
} from "./authorizedOrganizationEvidenceCandidates.js";
import {
  aggregateOrganizationPerformanceWithHistoricalPrivacy,
  OrganizationPerformanceAggregationInputError,
  validateOrganizationPerformanceSelection,
  type OrganizationPerformanceAggregate,
} from "./organizationPerformanceAggregation.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface AuthorizedOrganizationPerformanceCalendarMonth {
  readonly year: number;
  readonly month: number;
}

export interface AuthorizedOrganizationPerformanceDimensionFilter {
  readonly dimension: "division" | "scenario" | "training";
  readonly id: string;
}

export interface AuthorizedOrganizationPerformanceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
  readonly dimensionFilter?: AuthorizedOrganizationPerformanceDimensionFilter;
}

interface RouteSafeEvidenceStrength {
  readonly conservativeContributorCount: number;
  readonly limitedEvidence: boolean;
}

interface RouteSafeConcentration {
  readonly concentrationWarning: boolean;
}

type RouteSafeWeightProfile =
  | {
      readonly kind: "known";
      readonly profileKey: string;
      readonly weights: SimulationScoringWeightsApplied;
    }
  | { readonly kind: "unknown"; readonly profileKey: "unknown" };

interface RouteSafeActivityAggregate {
  readonly attemptCount: number;
  readonly conclusiveAttemptCount: number;
  readonly evidenceStrength: RouteSafeEvidenceStrength;
  readonly concentration: RouteSafeConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

interface RouteSafeCompletionAggregate {
  readonly availableObservationCount: number;
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number | null;
  readonly evidenceStrength: RouteSafeEvidenceStrength;
  readonly concentration: RouteSafeConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

interface RouteSafeObjectiveAggregate {
  readonly availableObservationCount: number;
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number | null;
  readonly evidenceStrength: RouteSafeEvidenceStrength;
  readonly concentration: RouteSafeConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

interface RouteSafeCompletionGroup {
  readonly scoringGeneration: string;
  readonly completion?: RouteSafeCompletionAggregate;
  readonly objective?: RouteSafeObjectiveAggregate;
}

interface RouteSafeMetricAggregate {
  readonly metric: "overall" | "communication" | "outcome" | "persuasion" | "clarity" | "empathy" | "assertiveness";
  readonly scoringGeneration: string;
  readonly weightProfile?: RouteSafeWeightProfile;
  readonly mean: number;
  readonly qualifyingObservationCount: number;
  readonly evidenceStrength: RouteSafeEvidenceStrength;
  readonly concentration: RouteSafeConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

/** Route-safe grouped performance result. Exact contributor shares and identities are intentionally omitted. */
export interface AuthorizedOrganizationPerformanceResult {
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly dimensionFilter: AuthorizedOrganizationPerformanceDimensionFilter | null;
  readonly historicalScope: "organization_history" | "current_population";
  readonly activity: RouteSafeActivityAggregate | null;
  readonly completionGroups: readonly RouteSafeCompletionGroup[];
  readonly metricGroups: readonly RouteSafeMetricAggregate[];
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export class AuthorizedOrganizationPerformanceInputError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(" "));
    this.name = "AuthorizedOrganizationPerformanceInputError";
    this.errors = errors;
  }
}

export class AuthorizedOrganizationPerformanceInvariantError extends Error {
  constructor() {
    super("Authorized organization evidence candidates violated the single-organization invariant.");
    this.name = "AuthorizedOrganizationPerformanceInvariantError";
  }
}

function assertOrganizationPerformanceCandidateOrganization(
  candidates: readonly OrganizationEvidenceCandidate[],
  organizationId: string,
): void {
  if (candidates.some((candidate) => candidate.orgId !== organizationId)) {
    throw new AuthorizedOrganizationPerformanceInvariantError();
  }
}

function projectRouteSafeResult(
  aggregate: OrganizationPerformanceAggregate,
): AuthorizedOrganizationPerformanceResult {
  const concentration = (value: { readonly concentrationWarning: boolean }): RouteSafeConcentration => ({
    concentrationWarning: value.concentrationWarning,
  });

  return {
    calendarMonth: { ...aggregate.calendarMonth },
    dimensionFilter: aggregate.dimensionFilter === null ? null : { ...aggregate.dimensionFilter },
    historicalScope: aggregate.historicalScope,
    activity: aggregate.activity === null ? null : {
      attemptCount: aggregate.activity.attemptCount,
      conclusiveAttemptCount: aggregate.activity.conclusiveAttemptCount,
      evidenceStrength: { ...aggregate.activity.evidenceStrength },
      concentration: concentration(aggregate.activity.concentration),
      historicalPrivacyAdjustmentApplied: aggregate.activity.historicalPrivacyAdjustmentApplied,
    },
    completionGroups: aggregate.completionGroups.map((group) => ({
      scoringGeneration: group.scoringGeneration,
      ...(group.completion === undefined ? {} : {
        completion: {
          availableObservationCount: group.completion.availableObservationCount,
          completeCount: group.completion.completeCount,
          partialCount: group.completion.partialCount,
          inconclusiveCount: group.completion.inconclusiveCount,
          completionRate: group.completion.completionRate,
          evidenceStrength: { ...group.completion.evidenceStrength },
          concentration: concentration(group.completion.concentration),
          historicalPrivacyAdjustmentApplied: group.completion.historicalPrivacyAdjustmentApplied,
        },
      }),
      ...(group.objective === undefined ? {} : {
        objective: {
          availableObservationCount: group.objective.availableObservationCount,
          achievedCount: group.objective.achievedCount,
          objectiveAchievementRate: group.objective.objectiveAchievementRate,
          evidenceStrength: { ...group.objective.evidenceStrength },
          concentration: concentration(group.objective.concentration),
          historicalPrivacyAdjustmentApplied: group.objective.historicalPrivacyAdjustmentApplied,
        },
      }),
    })),
    metricGroups: aggregate.metricGroups.map((group) => ({
      metric: group.metric,
      scoringGeneration: group.scoringGeneration,
      ...(group.weightProfile === undefined ? {} : {
        weightProfile: group.weightProfile.kind === "unknown"
          ? { ...group.weightProfile }
          : { ...group.weightProfile, weights: { ...group.weightProfile.weights } },
      }),
      mean: group.mean,
      qualifyingObservationCount: group.qualifyingObservationCount,
      evidenceStrength: { ...group.evidenceStrength },
      concentration: concentration(group.concentration),
      historicalPrivacyAdjustmentApplied: group.historicalPrivacyAdjustmentApplied,
    })),
    historicalPrivacyAdjustmentApplied: aggregate.historicalPrivacyAdjustmentApplied,
  };
}

/**
 * Controlled, route-ready organization intelligence boundary. It authorizes
 * the full historical organization evidence set before applying the one-month,
 * one-dimension aggregate and protected-history policy.
 *
 * Residual privacy limit: current-subject classification follows this snapshot.
 * Saved organization-wide results across membership changes may therefore
 * differ; membership hysteresis/versioning is intentionally deferred.
 *
 * Authorized person-level queries may show current employee evidence directly.
 * This grouped boundary prevents aggregates from becoming indirect reports on
 * protected historical people who are no longer individually viewable.
 *
 * Accepted hard-delete residual: a platform-admin hard delete truly removes
 * score history, so a saved before/after aggregate comparison may reveal the
 * deleted contribution. Deletion and self-delete semantics remain unchanged.
 */
export function queryAuthorizedOrganizationPerformance(
  query: AuthorizedOrganizationPerformanceQuery,
): AuthorizedOrganizationPerformanceResult {
  const allowedInputKeys = new Set([
    "snapshot", "viewer", "organizationId", "calendarMonth", "dimensionFilter",
  ]);
  if (Object.keys(query).some((key) => !allowedInputKeys.has(key))) {
    throw new AuthorizedOrganizationPerformanceInputError([
      "Unsupported organization performance query fields are not allowed.",
    ]);
  }
  let dimensionFilter: AuthorizedOrganizationPerformanceDimensionFilter | undefined;
  let candidates: OrganizationEvidenceCandidate[];
  try {
    dimensionFilter = validateOrganizationPerformanceSelection(query);
    candidates = queryAuthorizedOrganizationEvidenceCandidates({
      snapshot: query.snapshot,
      viewer: query.viewer,
      organizationId: query.organizationId,
    });
  } catch (error) {
    if (
      error instanceof OrganizationPerformanceAggregationInputError
      || error instanceof AuthorizedOrganizationEvidenceCandidatesInputError
    ) {
      throw new AuthorizedOrganizationPerformanceInputError(error.errors);
    }
    throw error;
  }
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

  const aggregate = aggregateOrganizationPerformanceWithHistoricalPrivacy(
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
  return projectRouteSafeResult(aggregate);
}
