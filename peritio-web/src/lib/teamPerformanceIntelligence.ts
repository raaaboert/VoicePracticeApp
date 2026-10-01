import type { SimulationScoringWeightsApplied } from "@voicepractice/shared";

import type {
  OrganizationPerformanceCalendarMonth,
  OrganizationPerformanceMetric,
} from "./organizationPerformance";

export type TeamPerformanceMovementDirection = "up" | "down" | "unchanged";

export type TeamPerformanceMovementUnavailableReason =
  | "current_month_incomplete"
  | "no_current_evidence"
  | "no_previous_evidence"
  | "incompatible_scoring_generation"
  | "incompatible_weight_profile"
  | "unknown_weight_profile"
  | "metric_unavailable";

export type TeamPerformanceMovement =
  | { readonly available: true; readonly direction: TeamPerformanceMovementDirection; readonly reason: null }
  | { readonly available: false; readonly direction: null; readonly reason: TeamPerformanceMovementUnavailableReason };

export interface TeamPerformanceEvidenceStrength {
  readonly conservativeContributorCount: number;
  readonly limitedEvidence: boolean;
}

export interface TeamPerformanceQualifiers {
  readonly limitedEvidence: boolean;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceComparisonQualifiers {
  readonly current: TeamPerformanceQualifiers | null;
  readonly previous: TeamPerformanceQualifiers | null;
}

export type TeamPerformanceWeightProfile =
  | { readonly kind: "known"; readonly weights: SimulationScoringWeightsApplied }
  | { readonly kind: "unknown" };

export interface TeamPerformanceMetricPeriod {
  readonly mean: number;
  readonly observationCount: number;
  readonly evidenceStrength: TeamPerformanceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceMetricComparison {
  readonly metric: OrganizationPerformanceMetric;
  readonly scoringGeneration: string;
  readonly weightProfile?: TeamPerformanceWeightProfile;
  readonly current: TeamPerformanceMetricPeriod | null;
  readonly previous: TeamPerformanceMetricPeriod | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly nonComparableReason: Exclude<TeamPerformanceMovementUnavailableReason, "current_month_incomplete"> | null;
}

export interface TeamPerformanceRatePeriod {
  readonly availableObservationCount: number;
  readonly evidenceStrength: TeamPerformanceEvidenceStrength;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceCompletionPeriod extends TeamPerformanceRatePeriod {
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number;
}

export interface TeamPerformanceObjectivePeriod extends TeamPerformanceRatePeriod {
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number;
}

export interface TeamPerformanceRateComparison<TPeriod> {
  readonly current: TPeriod | null;
  readonly previous: TPeriod | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly nonComparableReason: Exclude<TeamPerformanceMovementUnavailableReason, "current_month_incomplete"> | null;
}

export interface TeamPerformanceCompletionComparison {
  readonly scoringGeneration: string;
  readonly completion: TeamPerformanceRateComparison<TeamPerformanceCompletionPeriod>;
  readonly objective: TeamPerformanceRateComparison<TeamPerformanceObjectivePeriod>;
}

export interface TeamPerformanceMetricMovement {
  readonly metric: OrganizationPerformanceMetric;
  readonly scoringGeneration: string;
  readonly weightProfile?: TeamPerformanceWeightProfile;
  readonly movement: TeamPerformanceMovement;
  readonly qualifiers: TeamPerformanceComparisonQualifiers;
}

export interface TeamPerformanceRelativeDimensionValue {
  readonly dimension: "persuasion" | "clarity" | "empathy" | "assertiveness";
  readonly mean: number;
  readonly qualifiers: TeamPerformanceQualifiers;
}

export type TeamPerformanceRelativeDimension = {
  readonly scoringGeneration: string;
  readonly dimensions: readonly TeamPerformanceRelativeDimensionValue[];
  readonly qualifiers: TeamPerformanceQualifiers;
} & (
  | {
      readonly available: true;
      readonly relativePosition: "differentiated";
      readonly reason: null;
      readonly highestDimensions: readonly TeamPerformanceRelativeDimensionValue["dimension"][];
      readonly lowestDimensions: readonly TeamPerformanceRelativeDimensionValue["dimension"][];
    }
  | {
      readonly available: true;
      readonly relativePosition: "balanced";
      readonly reason: null;
      readonly highestDimensions: readonly [];
      readonly lowestDimensions: readonly [];
    }
  | {
      readonly available: false;
      readonly relativePosition: null;
      readonly reason: "incomplete_dimension_set";
      readonly highestDimensions: readonly [];
      readonly lowestDimensions: readonly [];
    }
);

export interface TeamPerformanceCompletionMovement {
  readonly scoringGeneration: string;
  readonly completion: { readonly movement: TeamPerformanceMovement; readonly qualifiers: TeamPerformanceComparisonQualifiers };
  readonly objective: { readonly movement: TeamPerformanceMovement; readonly qualifiers: TeamPerformanceComparisonQualifiers };
}

export interface TeamPerformanceIntelligenceResponse {
  readonly scope: "team";
  readonly asOf: string;
  readonly currentMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly comparisonMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly population: { readonly currentReportCount: number; readonly hasCurrentReports: boolean };
  readonly facts: {
    readonly activity: {
      readonly current: { readonly attemptCount: number; readonly conclusiveAttemptCount: number; readonly evidenceStrength: TeamPerformanceEvidenceStrength; readonly concentrationWarning: boolean };
      readonly previous: { readonly attemptCount: number; readonly conclusiveAttemptCount: number; readonly evidenceStrength: TeamPerformanceEvidenceStrength; readonly concentrationWarning: boolean };
      readonly attemptDelta: number;
      readonly conclusiveAttemptDelta: number;
    };
    readonly metricComparisons: readonly TeamPerformanceMetricComparison[];
    readonly completionComparisons: readonly TeamPerformanceCompletionComparison[];
    readonly focusReadiness: { readonly available: false; readonly reason: "historical_focus_topic_mapping_unavailable" };
  };
  readonly signals: {
    readonly monthCompleteness: { readonly complete: boolean; readonly completesAt: string };
    readonly activityMovement: {
      readonly attempts: TeamPerformanceMovement;
      readonly conclusiveAttempts: TeamPerformanceMovement;
      readonly qualifiers: TeamPerformanceComparisonQualifiers;
    };
    readonly metricMovement: readonly TeamPerformanceMetricMovement[];
    readonly relativeDimensions: readonly TeamPerformanceRelativeDimension[];
    readonly completionMovement: readonly TeamPerformanceCompletionMovement[];
    readonly focus: { readonly available: false; readonly reason: "historical_focus_topic_mapping_unavailable" };
  };
}

export interface TeamPerformanceIntelligenceRequest extends OrganizationPerformanceCalendarMonth {
  readonly orgId: string;
  readonly signal?: AbortSignal;
}

export type TeamPerformanceIntelligenceClientResult =
  | { readonly kind: "success"; readonly data: TeamPerformanceIntelligenceResponse }
  | { readonly kind: "error" };

export async function getTeamPerformanceIntelligence(
  input: TeamPerformanceIntelligenceRequest,
  fetcher: typeof fetch = fetch,
): Promise<TeamPerformanceIntelligenceClientResult> {
  const params = new URLSearchParams({
    orgId: input.orgId,
    year: String(input.year),
    month: String(input.month),
  });
  try {
    const response = await fetcher(`/api/performance/team/intelligence?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: input.signal,
    });
    return response.ok
      ? { kind: "success", data: await response.json() as TeamPerformanceIntelligenceResponse }
      : { kind: "error" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { kind: "error" };
  }
}

export function isTeamPerformanceIntelligenceRequestCurrent(signal: AbortSignal): boolean {
  return !signal.aborted;
}
