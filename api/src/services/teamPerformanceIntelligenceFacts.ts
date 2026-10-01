import type { DashboardViewer, SimulationScoringWeightsApplied } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceInputError,
  validateAuthorizedOrganizationPerformanceRequest,
  type AuthorizedOrganizationPerformanceCalendarMonth,
} from "./authorizedOrganizationPerformance.js";
import { resolveAuthorizedTeamPerformanceScope } from "./authorizedTeamPerformanceInternal.js";
import {
  aggregateCurrentPopulationPerformance,
  getPreviousOrganizationPerformanceCalendarMonth,
  type OrganizationPerformanceActivityAggregate,
  type OrganizationPerformanceCompletionAggregate,
  type OrganizationPerformanceCompletionGroup,
  type OrganizationPerformanceEvidenceStrength,
  type OrganizationPerformanceMetric,
  type OrganizationPerformanceMetricAggregate,
  type OrganizationPerformanceObjectiveAggregate,
  type OrganizationPerformanceWeightProfile,
} from "./organizationPerformanceAggregation.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

export interface TeamPerformanceIntelligenceFactsInput {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
}

export interface TeamPerformanceIntelligenceCalendarMonth {
  readonly year: number;
  readonly month: number;
  readonly timeZone: "UTC";
}

export interface TeamPerformanceIntelligenceEvidenceStrength {
  readonly conservativeContributorCount: number;
  readonly limitedEvidence: boolean;
}

export interface TeamPerformanceIntelligencePeriodActivity {
  readonly attemptCount: number;
  readonly conclusiveAttemptCount: number;
  readonly evidenceStrength: TeamPerformanceIntelligenceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export type TeamPerformanceIntelligenceWeightProfile =
  | { readonly kind: "known"; readonly weights: SimulationScoringWeightsApplied }
  | { readonly kind: "unknown" };

export interface TeamPerformanceIntelligenceMetricPeriodFact {
  readonly mean: number;
  readonly observationCount: number;
  readonly evidenceStrength: TeamPerformanceIntelligenceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export type TeamPerformanceIntelligenceNonComparableReason =
  | "no_current_evidence"
  | "no_previous_evidence"
  | "incompatible_scoring_generation"
  | "incompatible_weight_profile"
  | "unknown_weight_profile"
  | "metric_unavailable";

export interface TeamPerformanceIntelligenceMetricComparison {
  readonly metric: OrganizationPerformanceMetric;
  readonly scoringGeneration: string;
  readonly weightProfile?: TeamPerformanceIntelligenceWeightProfile;
  readonly current: TeamPerformanceIntelligenceMetricPeriodFact | null;
  readonly previous: TeamPerformanceIntelligenceMetricPeriodFact | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly nonComparableReason: TeamPerformanceIntelligenceNonComparableReason | null;
}

export interface TeamPerformanceIntelligenceCompletionPeriodFact {
  readonly availableObservationCount: number;
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number;
  readonly evidenceStrength: TeamPerformanceIntelligenceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceIntelligenceObjectivePeriodFact {
  readonly availableObservationCount: number;
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number;
  readonly evidenceStrength: TeamPerformanceIntelligenceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceIntelligenceCompletionRateComparison {
  readonly current: TeamPerformanceIntelligenceCompletionPeriodFact | null;
  readonly previous: TeamPerformanceIntelligenceCompletionPeriodFact | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly nonComparableReason: TeamPerformanceIntelligenceNonComparableReason | null;
}

export interface TeamPerformanceIntelligenceObjectiveRateComparison {
  readonly current: TeamPerformanceIntelligenceObjectivePeriodFact | null;
  readonly previous: TeamPerformanceIntelligenceObjectivePeriodFact | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly nonComparableReason: TeamPerformanceIntelligenceNonComparableReason | null;
}

export interface TeamPerformanceIntelligenceCompletionComparison {
  readonly scoringGeneration: string;
  readonly completion: TeamPerformanceIntelligenceCompletionRateComparison;
  readonly objective: TeamPerformanceIntelligenceObjectiveRateComparison;
}

export interface TeamPerformanceIntelligenceFacts {
  readonly scope: "team";
  readonly currentMonth: TeamPerformanceIntelligenceCalendarMonth;
  readonly comparisonMonth: TeamPerformanceIntelligenceCalendarMonth;
  readonly population: {
    readonly currentReportCount: number;
    readonly hasCurrentReports: boolean;
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

export class TeamPerformanceIntelligenceInvariantError extends Error {
  constructor() {
    super("Team intelligence expected current-population activity facts for both periods.");
    this.name = "TeamPerformanceIntelligenceInvariantError";
  }
}

const METRIC_ORDER: readonly OrganizationPerformanceMetric[] = [
  "persuasion", "clarity", "empathy", "assertiveness",
  "communication", "outcome", "overall",
];

function copyEvidenceStrength(
  strength: OrganizationPerformanceEvidenceStrength,
): TeamPerformanceIntelligenceEvidenceStrength {
  return {
    conservativeContributorCount: strength.conservativeContributorCount,
    limitedEvidence: strength.limitedEvidence,
  };
}

function projectActivity(
  activity: OrganizationPerformanceActivityAggregate,
): TeamPerformanceIntelligencePeriodActivity {
  return {
    attemptCount: activity.attemptCount,
    conclusiveAttemptCount: activity.conclusiveAttemptCount,
    evidenceStrength: copyEvidenceStrength(activity.evidenceStrength),
    concentrationWarning: activity.concentration.concentrationWarning,
  };
}

function projectWeightProfile(
  profile: OrganizationPerformanceWeightProfile,
): TeamPerformanceIntelligenceWeightProfile {
  return profile.kind === "unknown"
    ? { kind: "unknown" }
    : { kind: "known", weights: { ...profile.weights } };
}

function metricProfileIdentity(group: OrganizationPerformanceMetricAggregate): string {
  return group.weightProfile?.profileKey ?? "";
}

function metricComparisonIdentity(group: OrganizationPerformanceMetricAggregate): string {
  return `${group.metric}\u0000${group.scoringGeneration}\u0000${metricProfileIdentity(group)}`;
}

function projectMetricPeriod(
  group: OrganizationPerformanceMetricAggregate,
): TeamPerformanceIntelligenceMetricPeriodFact {
  return {
    mean: group.mean,
    observationCount: group.qualifyingObservationCount,
    evidenceStrength: copyEvidenceStrength(group.evidenceStrength),
    concentrationWarning: group.concentration.concentrationWarning,
  };
}

function missingMetricReason(
  group: OrganizationPerformanceMetricAggregate,
  missingPeriodGroups: readonly OrganizationPerformanceMetricAggregate[],
  missingPeriod: "current" | "previous",
): TeamPerformanceIntelligenceNonComparableReason {
  const sameMetric = missingPeriodGroups.filter((candidate) => candidate.metric === group.metric);
  const sameGeneration = sameMetric.filter(
    (candidate) => candidate.scoringGeneration === group.scoringGeneration,
  );
  if (
    sameGeneration.length > 0
    && (
      group.weightProfile?.kind === "unknown"
      || sameGeneration.some((candidate) => candidate.weightProfile?.kind === "unknown")
    )
  ) {
    return "unknown_weight_profile";
  }
  if (sameGeneration.length > 0) {
    return "incompatible_weight_profile";
  }
  if (sameMetric.length > 0) return "incompatible_scoring_generation";
  return missingPeriod === "current" ? "no_current_evidence" : "no_previous_evidence";
}

function buildMetricComparisons(
  currentGroups: readonly OrganizationPerformanceMetricAggregate[],
  previousGroups: readonly OrganizationPerformanceMetricAggregate[],
): TeamPerformanceIntelligenceMetricComparison[] {
  const currentByIdentity = new Map(currentGroups.map((group) => [metricComparisonIdentity(group), group]));
  const previousByIdentity = new Map(previousGroups.map((group) => [metricComparisonIdentity(group), group]));
  const identities = [...new Set([...currentByIdentity.keys(), ...previousByIdentity.keys()])];

  return identities.map((identity) => {
    const current = currentByIdentity.get(identity) ?? null;
    const previous = previousByIdentity.get(identity) ?? null;
    const group = current ?? previous!;
    const unknownWeightProfile = group.weightProfile?.kind === "unknown";
    const comparable = current !== null && previous !== null && !unknownWeightProfile;
    const nonComparableReason: TeamPerformanceIntelligenceNonComparableReason | null = comparable
      ? null
      : current !== null && previous !== null && unknownWeightProfile
        ? "unknown_weight_profile"
        : current === null
          ? missingMetricReason(group, currentGroups, "current")
          : missingMetricReason(group, previousGroups, "previous");
    return {
      metric: group.metric,
      scoringGeneration: group.scoringGeneration,
      ...(group.weightProfile === undefined
        ? {}
        : { weightProfile: projectWeightProfile(group.weightProfile) }),
      current: current === null ? null : projectMetricPeriod(current),
      previous: previous === null ? null : projectMetricPeriod(previous),
      delta: comparable ? current.mean - previous.mean : null,
      comparable,
      nonComparableReason,
    };
  }).sort((left, right) =>
    METRIC_ORDER.indexOf(left.metric) - METRIC_ORDER.indexOf(right.metric)
    || left.scoringGeneration.localeCompare(right.scoringGeneration)
    || JSON.stringify(left.weightProfile ?? null).localeCompare(JSON.stringify(right.weightProfile ?? null)));
}

function projectCompletion(
  aggregate: OrganizationPerformanceCompletionAggregate | undefined,
): TeamPerformanceIntelligenceCompletionPeriodFact | null {
  if (!aggregate || aggregate.availableObservationCount === 0 || aggregate.completionRate === null) return null;
  return {
    availableObservationCount: aggregate.availableObservationCount,
    completeCount: aggregate.completeCount,
    partialCount: aggregate.partialCount,
    inconclusiveCount: aggregate.inconclusiveCount,
    completionRate: aggregate.completionRate,
    evidenceStrength: copyEvidenceStrength(aggregate.evidenceStrength),
    concentrationWarning: aggregate.concentration.concentrationWarning,
  };
}

function projectObjective(
  aggregate: OrganizationPerformanceObjectiveAggregate | undefined,
): TeamPerformanceIntelligenceObjectivePeriodFact | null {
  if (!aggregate || aggregate.availableObservationCount === 0 || aggregate.objectiveAchievementRate === null) return null;
  return {
    availableObservationCount: aggregate.availableObservationCount,
    achievedCount: aggregate.achievedCount,
    objectiveAchievementRate: aggregate.objectiveAchievementRate,
    evidenceStrength: copyEvidenceStrength(aggregate.evidenceStrength),
    concentrationWarning: aggregate.concentration.concentrationWarning,
  };
}

function missingGenerationReason(params: {
  value: object | null;
  periodGroup: OrganizationPerformanceCompletionGroup | undefined;
  otherPeriodGroups: readonly OrganizationPerformanceCompletionGroup[];
  period: "current" | "previous";
  hasValue: (group: OrganizationPerformanceCompletionGroup) => boolean;
}): TeamPerformanceIntelligenceNonComparableReason | null {
  if (params.value !== null) return null;
  if (params.periodGroup) return "metric_unavailable";
  if (params.otherPeriodGroups.some(params.hasValue)) return "incompatible_scoring_generation";
  return params.period === "current" ? "no_current_evidence" : "no_previous_evidence";
}

function buildCompletionComparisons(
  currentGroups: readonly OrganizationPerformanceCompletionGroup[],
  previousGroups: readonly OrganizationPerformanceCompletionGroup[],
): TeamPerformanceIntelligenceCompletionComparison[] {
  const currentByGeneration = new Map(currentGroups.map((group) => [group.scoringGeneration, group]));
  const previousByGeneration = new Map(previousGroups.map((group) => [group.scoringGeneration, group]));
  const generations = [...new Set([...currentByGeneration.keys(), ...previousByGeneration.keys()])].sort();

  return generations.map((scoringGeneration) => {
    const currentGroup = currentByGeneration.get(scoringGeneration);
    const previousGroup = previousByGeneration.get(scoringGeneration);
    const currentCompletion = projectCompletion(currentGroup?.completion);
    const previousCompletion = projectCompletion(previousGroup?.completion);
    const currentObjective = projectObjective(currentGroup?.objective);
    const previousObjective = projectObjective(previousGroup?.objective);
    const completionComparable = currentCompletion !== null && previousCompletion !== null;
    const objectiveComparable = currentObjective !== null && previousObjective !== null;

    return {
      scoringGeneration,
      completion: {
        current: currentCompletion,
        previous: previousCompletion,
        delta: completionComparable
          ? currentCompletion.completionRate - previousCompletion.completionRate
          : null,
        comparable: completionComparable,
        nonComparableReason: completionComparable
          ? null
          : missingGenerationReason({
              value: currentCompletion,
              periodGroup: currentGroup,
              otherPeriodGroups: currentGroups,
              period: "current",
              hasValue: (group) => (group.completion?.availableObservationCount ?? 0) > 0,
            }) ?? missingGenerationReason({
              value: previousCompletion,
              periodGroup: previousGroup,
              otherPeriodGroups: previousGroups,
              period: "previous",
              hasValue: (group) => (group.completion?.availableObservationCount ?? 0) > 0,
            }),
      },
      objective: {
        current: currentObjective,
        previous: previousObjective,
        delta: objectiveComparable
          ? currentObjective.objectiveAchievementRate - previousObjective.objectiveAchievementRate
          : null,
        comparable: objectiveComparable,
        nonComparableReason: objectiveComparable
          ? null
          : missingGenerationReason({
              value: currentObjective,
              periodGroup: currentGroup,
              otherPeriodGroups: currentGroups,
              period: "current",
              hasValue: (group) => (group.objective?.availableObservationCount ?? 0) > 0,
            }) ?? missingGenerationReason({
              value: previousObjective,
              periodGroup: previousGroup,
              otherPeriodGroups: previousGroups,
              period: "previous",
              hasValue: (group) => (group.objective?.availableObservationCount ?? 0) > 0,
            }),
      },
    };
  });
}

/**
 * Builds identity-free deterministic facts for a selected UTC month and its
 * immediate predecessor. The current Team roster is resolved exactly once and
 * that same candidate population is aggregated for both periods.
 */
export function buildTeamPerformanceIntelligenceFacts(
  input: TeamPerformanceIntelligenceFactsInput,
): TeamPerformanceIntelligenceFacts {
  if (Object.keys(input).some((key) => ![
    "snapshot", "viewer", "organizationId", "calendarMonth",
  ].includes(key))) {
    throw new AuthorizedOrganizationPerformanceInputError([
      "Unsupported team intelligence fact input fields are not allowed.",
    ]);
  }
  const request = validateAuthorizedOrganizationPerformanceRequest({
    organizationId: input.organizationId,
    calendarMonth: input.calendarMonth,
  });
  const comparisonMonth = getPreviousOrganizationPerformanceCalendarMonth(request.calendarMonth);
  const scope = resolveAuthorizedTeamPerformanceScope({
    snapshot: input.snapshot,
    viewer: input.viewer,
    organizationId: request.organizationId,
  });
  const current = aggregateCurrentPopulationPerformance({
    candidates: scope.candidates,
    calendarMonth: request.calendarMonth,
  });
  const previous = aggregateCurrentPopulationPerformance({
    candidates: scope.candidates,
    calendarMonth: comparisonMonth,
  });

  if (current.activity === null || previous.activity === null) {
    throw new TeamPerformanceIntelligenceInvariantError();
  }

  const currentActivity = projectActivity(current.activity);
  const previousActivity = projectActivity(previous.activity);
  return {
    scope: "team",
    currentMonth: { ...current.calendarMonth },
    comparisonMonth: { ...previous.calendarMonth },
    population: {
      currentReportCount: scope.currentReportCount,
      hasCurrentReports: scope.currentReportCount > 0,
    },
    activity: {
      current: currentActivity,
      previous: previousActivity,
      attemptDelta: currentActivity.attemptCount - previousActivity.attemptCount,
      conclusiveAttemptDelta:
        currentActivity.conclusiveAttemptCount - previousActivity.conclusiveAttemptCount,
    },
    metricComparisons: buildMetricComparisons(current.metricGroups, previous.metricGroups),
    completionComparisons: buildCompletionComparisons(current.completionGroups, previous.completionGroups),
    focusReadiness: {
      available: false,
      reason: "historical_focus_topic_mapping_unavailable",
    },
  };
}
