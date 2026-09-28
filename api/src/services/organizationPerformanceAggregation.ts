import type { SimulationScoringWeightsApplied } from "@voicepractice/shared";

import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";

export const ORGANIZATION_PERFORMANCE_AGGREGATION_TIME_ZONE = "UTC";
export const ORGANIZATION_PERFORMANCE_LIMITED_CONTRIBUTOR_COUNT = 5;
export const ORGANIZATION_PERFORMANCE_LIMITED_OBSERVATION_COUNT = 10;
export const ORGANIZATION_PERFORMANCE_CONCENTRATION_WARNING_SHARE = 0.4;

export interface OrganizationPerformanceCalendarMonth {
  readonly year: number;
  readonly month: number;
}

export type OrganizationPerformanceDimension = "division" | "scenario" | "training";

export interface OrganizationPerformanceDimensionFilter {
  readonly dimension: OrganizationPerformanceDimension;
  readonly id: string;
}

export interface AggregateOrganizationPerformanceInput {
  /** Must come from queryAuthorizedOrganizationEvidenceCandidates. */
  readonly candidates: readonly OrganizationEvidenceCandidate[];
  readonly calendarMonth: OrganizationPerformanceCalendarMonth;
  /** Exactly one historical dimension may be selected per aggregate. */
  readonly dimensionFilter?: OrganizationPerformanceDimensionFilter;
}

export type OrganizationPerformanceMetric =
  | "overall"
  | "communication"
  | "outcome"
  | "persuasion"
  | "clarity"
  | "empathy"
  | "assertiveness";

export type OrganizationPerformanceWeightProfile =
  | { readonly kind: "known"; readonly weights: SimulationScoringWeightsApplied }
  | { readonly kind: "unknown" };

export interface OrganizationPerformanceEvidenceStrength {
  readonly conservativeContributorCount: number;
  readonly limitedEvidence: boolean;
}

export interface OrganizationPerformanceConcentration {
  readonly largestContributionShare: number;
  readonly concentrationWarning: boolean;
}

export interface OrganizationPerformanceMetricAggregate {
  readonly metric: OrganizationPerformanceMetric;
  readonly scoringGeneration: string;
  readonly weightProfile?: OrganizationPerformanceWeightProfile;
  readonly mean: number;
  readonly qualifyingObservationCount: number;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
}

export interface OrganizationPerformanceCompletionAggregate {
  readonly availableObservationCount: number;
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
}

export interface OrganizationPerformanceObjectiveAggregate {
  readonly availableObservationCount: number;
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
}

export interface OrganizationPerformanceCompletionGroup {
  readonly scoringGeneration: string;
  readonly completion: OrganizationPerformanceCompletionAggregate;
  readonly objective: OrganizationPerformanceObjectiveAggregate;
}

export interface OrganizationPerformanceAggregate {
  readonly calendarMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly dimensionFilter: OrganizationPerformanceDimensionFilter | null;
  readonly activity: {
    readonly attemptCount: number;
    readonly conclusiveAttemptCount: number;
    readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  };
  readonly completionGroups: readonly OrganizationPerformanceCompletionGroup[];
  readonly metricGroups: readonly OrganizationPerformanceMetricAggregate[];
}

export class OrganizationPerformanceAggregationInputError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(" "));
    this.name = "OrganizationPerformanceAggregationInputError";
    this.errors = errors;
  }
}

interface MetricDefinition {
  readonly metric: OrganizationPerformanceMetric;
  readonly availability: keyof OrganizationEvidenceCandidate["metricAvailability"];
  readonly value: (candidate: OrganizationEvidenceCandidate) => number | undefined;
  readonly composite: boolean;
}

const METRICS: readonly MetricDefinition[] = [
  { metric: "overall", availability: "overall", value: (row) => row.overallScore, composite: true },
  { metric: "communication", availability: "communication", value: (row) => row.communicationScore, composite: true },
  { metric: "outcome", availability: "outcome", value: (row) => row.outcomeScore, composite: false },
  { metric: "persuasion", availability: "persuasion", value: (row) => row.persuasion, composite: false },
  { metric: "clarity", availability: "clarity", value: (row) => row.clarity, composite: false },
  { metric: "empathy", availability: "empathy", value: (row) => row.empathy, composite: false },
  { metric: "assertiveness", availability: "assertiveness", value: (row) => row.assertiveness, composite: false },
];

const METRIC_ORDER = new Map(METRICS.map((definition, index) => [definition.metric, index]));
const DEIDENTIFIED_CONTRIBUTOR = Symbol("deidentified-contributor");
type ContributorKey = string | typeof DEIDENTIFIED_CONTRIBUTOR;

function validateInput(input: AggregateOrganizationPerformanceInput): OrganizationPerformanceDimensionFilter | undefined {
  const errors: string[] = [];
  if (!Number.isInteger(input.calendarMonth?.year) || input.calendarMonth.year < 1970 || input.calendarMonth.year > 9999) {
    errors.push("calendarMonth.year must be an integer from 1970 through 9999.");
  }
  if (!Number.isInteger(input.calendarMonth?.month) || input.calendarMonth.month < 1 || input.calendarMonth.month > 12) {
    errors.push("calendarMonth.month must be an integer from 1 through 12.");
  }
  const runtimeInput = input as AggregateOrganizationPerformanceInput & Record<string, unknown>;
  if (
    Object.hasOwn(runtimeInput, "evidenceAtFrom")
    || Object.hasOwn(runtimeInput, "evidenceAtBefore")
    || Object.hasOwn(runtimeInput, "from")
    || Object.hasOwn(runtimeInput, "before")
  ) {
    errors.push("Arbitrary date windows are not supported; provide one calendarMonth.");
  }
  let dimensionFilter: OrganizationPerformanceDimensionFilter | undefined;
  if (input.dimensionFilter !== undefined) {
    const { dimension, id } = input.dimensionFilter;
    if (!(["division", "scenario", "training"] as const).includes(dimension)) {
      errors.push("dimensionFilter.dimension must be division, scenario, or training.");
    }
    if (typeof id !== "string" || !id.trim()) {
      errors.push("dimensionFilter.id must be a non-empty string.");
    } else {
      dimensionFilter = { dimension, id: id.trim() };
    }
  }
  if (errors.length > 0) throw new OrganizationPerformanceAggregationInputError(errors);
  return dimensionFilter;
}

function contributorKey(candidate: OrganizationEvidenceCandidate): ContributorKey {
  return candidate.subjectKind === "deidentified" ? DEIDENTIFIED_CONTRIBUTOR : candidate.subjectKey;
}

function contributorCounts(candidates: readonly OrganizationEvidenceCandidate[]): Map<ContributorKey, number> {
  const counts = new Map<ContributorKey, number>();
  for (const candidate of candidates) {
    const key = contributorKey(candidate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function evidenceStrength(
  candidates: readonly OrganizationEvidenceCandidate[],
  observationCount: number,
): OrganizationPerformanceEvidenceStrength {
  const conservativeContributorCount = contributorCounts(candidates).size;
  return {
    conservativeContributorCount,
    limitedEvidence:
      conservativeContributorCount < ORGANIZATION_PERFORMANCE_LIMITED_CONTRIBUTOR_COUNT
      || observationCount < ORGANIZATION_PERFORMANCE_LIMITED_OBSERVATION_COUNT,
  };
}

function concentration(candidates: readonly OrganizationEvidenceCandidate[]): OrganizationPerformanceConcentration {
  if (candidates.length === 0) {
    return { largestContributionShare: 0, concentrationWarning: false };
  }
  const largestCount = Math.max(...contributorCounts(candidates).values());
  const largestContributionShare = largestCount / candidates.length;
  return {
    largestContributionShare,
    concentrationWarning: largestContributionShare > ORGANIZATION_PERFORMANCE_CONCENTRATION_WARNING_SHARE,
  };
}

function isConclusive(candidate: OrganizationEvidenceCandidate): boolean {
  return candidate.completionLevel === undefined || candidate.completionLevel === "complete";
}

function profileIdentity(weights: SimulationScoringWeightsApplied | undefined): string {
  return weights === undefined
    ? "unknown"
    : `known:${weights.persuasion}:${weights.clarity}:${weights.empathy}:${weights.assertiveness}`;
}

function weightProfile(weights: SimulationScoringWeightsApplied | undefined): OrganizationPerformanceWeightProfile {
  return weights === undefined
    ? { kind: "unknown" }
    : { kind: "known", weights: { ...weights } };
}

function matchesDimension(
  candidate: OrganizationEvidenceCandidate,
  filter: OrganizationPerformanceDimensionFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.dimension === "division") return candidate.divisionId === filter.id;
  if (filter.dimension === "scenario") return candidate.scenarioId === filter.id;
  return candidate.trainingId === filter.id;
}

function buildCompletionGroups(
  candidates: readonly OrganizationEvidenceCandidate[],
): OrganizationPerformanceCompletionGroup[] {
  const generations = [...new Set(candidates.map((candidate) => candidate.scoringGeneration))].sort();
  return generations.map((scoringGeneration) => {
    const generationRows = candidates.filter((candidate) => candidate.scoringGeneration === scoringGeneration);
    const completionRows = generationRows.filter((candidate) => candidate.metricAvailability.completion);
    const objectiveRows = generationRows.filter((candidate) => candidate.metricAvailability.objective);
    const completeCount = completionRows.filter((candidate) => candidate.completionLevel === "complete").length;
    return {
      scoringGeneration,
      completion: {
        availableObservationCount: completionRows.length,
        completeCount,
        partialCount: completionRows.filter((candidate) => candidate.completionLevel === "partial").length,
        inconclusiveCount: completionRows.filter((candidate) => candidate.completionLevel === "inconclusive").length,
        completionRate: completionRows.length === 0 ? null : completeCount / completionRows.length,
        evidenceStrength: evidenceStrength(completionRows, completionRows.length),
      },
      objective: {
        availableObservationCount: objectiveRows.length,
        achievedCount: objectiveRows.filter((candidate) => candidate.objectiveAchieved === true).length,
        objectiveAchievementRate:
          objectiveRows.length === 0
            ? null
            : objectiveRows.filter((candidate) => candidate.objectiveAchieved === true).length / objectiveRows.length,
        evidenceStrength: evidenceStrength(objectiveRows, objectiveRows.length),
      },
    };
  });
}

function buildMetricGroups(
  candidates: readonly OrganizationEvidenceCandidate[],
): OrganizationPerformanceMetricAggregate[] {
  const groups: Array<{
    definition: MetricDefinition;
    scoringGeneration: string;
    profileId?: string;
    rows: OrganizationEvidenceCandidate[];
  }> = [];

  for (const definition of METRICS) {
    const qualifying = candidates.filter((candidate) => {
      const value = definition.value(candidate);
      return isConclusive(candidate) && candidate.metricAvailability[definition.availability] && value !== undefined;
    });
    const grouped = new Map<string, OrganizationEvidenceCandidate[]>();
    for (const candidate of qualifying) {
      const profileId = definition.composite ? profileIdentity(candidate.scoringWeightsApplied) : undefined;
      const key = `${candidate.scoringGeneration}\u0000${profileId ?? ""}`;
      const rows = grouped.get(key) ?? [];
      rows.push(candidate);
      grouped.set(key, rows);
    }
    for (const [key, rows] of grouped) {
      const [scoringGeneration, profileId] = key.split("\u0000");
      groups.push({ definition, scoringGeneration: scoringGeneration!, profileId: profileId || undefined, rows });
    }
  }

  return groups
    .sort((left, right) =>
      (METRIC_ORDER.get(left.definition.metric)! - METRIC_ORDER.get(right.definition.metric)!)
      || left.scoringGeneration.localeCompare(right.scoringGeneration)
      || (left.profileId ?? "").localeCompare(right.profileId ?? ""))
    .map(({ definition, scoringGeneration, rows }) => {
      const values = rows.map((candidate) => definition.value(candidate)!).sort((left, right) => left - right);
      return {
        metric: definition.metric,
        scoringGeneration,
        ...(definition.composite ? { weightProfile: weightProfile(rows[0]!.scoringWeightsApplied) } : {}),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        qualifyingObservationCount: values.length,
        evidenceStrength: evidenceStrength(rows, values.length),
        concentration: concentration(rows),
      };
    });
}

/**
 * Aggregates one UTC calendar month of already-authorized Slice 4A candidates.
 * The returned DTO is the privacy boundary: candidate rows and subject keys do
 * not escape. An organization reporting timezone is not available in the 4A
 * snapshot, so month boundaries remain UTC until an authority is established.
 */
export function aggregateOrganizationPerformance(
  input: AggregateOrganizationPerformanceInput,
): OrganizationPerformanceAggregate {
  const dimensionFilter = validateInput(input);
  const start = Date.UTC(input.calendarMonth.year, input.calendarMonth.month - 1, 1);
  const before = Date.UTC(input.calendarMonth.year, input.calendarMonth.month, 1);
  const candidates = input.candidates.filter((candidate) => {
    const evidenceAt = Date.parse(candidate.evidenceAt);
    return evidenceAt >= start && evidenceAt < before && matchesDimension(candidate, dimensionFilter);
  });
  const conclusiveAttemptCount = candidates.filter(isConclusive).length;

  return {
    calendarMonth: {
      year: input.calendarMonth.year,
      month: input.calendarMonth.month,
      timeZone: ORGANIZATION_PERFORMANCE_AGGREGATION_TIME_ZONE,
    },
    dimensionFilter: dimensionFilter ?? null,
    activity: {
      attemptCount: candidates.length,
      conclusiveAttemptCount,
      evidenceStrength: evidenceStrength(candidates, candidates.length),
    },
    completionGroups: buildCompletionGroups(candidates),
    metricGroups: buildMetricGroups(candidates),
  };
}
