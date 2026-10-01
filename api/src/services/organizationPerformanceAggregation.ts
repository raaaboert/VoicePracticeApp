import type { SimulationScoringWeightsApplied } from "@voicepractice/shared";

import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";

export const ORGANIZATION_PERFORMANCE_AGGREGATION_TIME_ZONE = "UTC";
export const ORGANIZATION_PERFORMANCE_LIMITED_CONTRIBUTOR_COUNT = 5;
export const ORGANIZATION_PERFORMANCE_LIMITED_OBSERVATION_COUNT = 10;
export const ORGANIZATION_PERFORMANCE_CONCENTRATION_WARNING_SHARE = 0.4;
export const ORGANIZATION_PERFORMANCE_PROTECTED_CONTRIBUTOR_THRESHOLD = 5;

export interface OrganizationPerformanceCalendarMonth {
  readonly year: number;
  readonly month: number;
}

/** Returns the immediately preceding fixed UTC calendar month. */
export function getPreviousOrganizationPerformanceCalendarMonth(
  calendarMonth: OrganizationPerformanceCalendarMonth,
): OrganizationPerformanceCalendarMonth {
  return calendarMonth.month === 1
    ? { year: calendarMonth.year - 1, month: 12 }
    : { year: calendarMonth.year, month: calendarMonth.month - 1 };
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

export interface OrganizationPerformanceSelectionInput {
  readonly calendarMonth: OrganizationPerformanceCalendarMonth;
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
  | {
      readonly kind: "known";
      /** Stable 1e-9-canonical aggregation identity; not source provenance. */
      readonly profileKey: string;
      readonly weights: SimulationScoringWeightsApplied;
    }
  | { readonly kind: "unknown"; readonly profileKey: "unknown" };

export interface OrganizationPerformanceEvidenceStrength {
  /** Conservative lower bound: deidentified rows deliberately count as one bucket. */
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
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceCompletionAggregate {
  readonly availableObservationCount: number;
  readonly completeCount: number;
  readonly partialCount: number;
  readonly inconclusiveCount: number;
  readonly completionRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceObjectiveAggregate {
  readonly availableObservationCount: number;
  readonly achievedCount: number;
  readonly objectiveAchievementRate: number | null;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceCompletionGroup {
  readonly scoringGeneration: string;
  readonly completion?: OrganizationPerformanceCompletionAggregate;
  readonly objective?: OrganizationPerformanceObjectiveAggregate;
}

export interface OrganizationPerformanceActivityAggregate {
  readonly attemptCount: number;
  /** Includes legacy rows with unavailable completion state under existing conclusive-score semantics. */
  readonly conclusiveAttemptCount: number;
  readonly evidenceStrength: OrganizationPerformanceEvidenceStrength;
  readonly concentration: OrganizationPerformanceConcentration;
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface OrganizationPerformanceAggregate {
  readonly calendarMonth: OrganizationPerformanceCalendarMonth & { readonly timeZone: "UTC" };
  readonly dimensionFilter: OrganizationPerformanceDimensionFilter | null;
  readonly historicalScope: "organization_history" | "current_population";
  readonly activity: OrganizationPerformanceActivityAggregate | null;
  readonly completionGroups: readonly OrganizationPerformanceCompletionGroup[];
  readonly metricGroups: readonly OrganizationPerformanceMetricAggregate[];
  readonly historicalPrivacyAdjustmentApplied: boolean;
}

export interface UnprotectedOrganizationPerformanceCompletionGroup {
  readonly scoringGeneration: string;
  readonly completion: OrganizationPerformanceCompletionAggregate;
  readonly objective: OrganizationPerformanceObjectiveAggregate;
}

export interface UnprotectedOrganizationPerformanceAggregate extends Omit<
  OrganizationPerformanceAggregate,
  "activity" | "completionGroups"
> {
  readonly activity: OrganizationPerformanceActivityAggregate;
  readonly completionGroups: readonly UnprotectedOrganizationPerformanceCompletionGroup[];
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

type CurrentSubjectClassifier = (candidate: OrganizationEvidenceCandidate) => boolean;
type HistoricalPrivacyMode = "all_eligible_history" | "current_only";

interface CompletionPopulation {
  readonly scoringGeneration: string;
  readonly completionRows: readonly OrganizationEvidenceCandidate[];
  readonly objectiveRows: readonly OrganizationEvidenceCandidate[];
}

interface MetricPopulation {
  readonly definition: MetricDefinition;
  readonly scoringGeneration: string;
  readonly profileId?: string;
  readonly rows: readonly OrganizationEvidenceCandidate[];
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

/** Validates and canonicalizes the route-facing month/dimension selection before evidence acquisition. */
export function validateOrganizationPerformanceSelection(
  input: OrganizationPerformanceSelectionInput,
): OrganizationPerformanceDimensionFilter | undefined {
  const errors: string[] = [];
  if (!Number.isInteger(input.calendarMonth?.year) || input.calendarMonth.year < 1970 || input.calendarMonth.year > 9999) {
    errors.push("calendarMonth.year must be an integer from 1970 through 9999.");
  }
  if (!Number.isInteger(input.calendarMonth?.month) || input.calendarMonth.month < 1 || input.calendarMonth.month > 12) {
    errors.push("calendarMonth.month must be an integer from 1 through 12.");
  }
  const runtimeInput = input as OrganizationPerformanceSelectionInput & Record<string, unknown>;
  if ([
    "evidenceAtFrom", "evidenceAtBefore", "from", "before", "startAt", "endAt",
    "scenarioId", "trainingId", "divisionId",
  ].some((key) => Object.hasOwn(runtimeInput, key))) {
    errors.push("Prefiltered evidence, arbitrary date windows, and legacy dimension fields are not supported.");
  }
  let dimensionFilter: OrganizationPerformanceDimensionFilter | undefined;
  if (input.dimensionFilter !== undefined) {
    const filter = input.dimensionFilter as unknown;
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      errors.push("dimensionFilter must be an object when provided.");
    } else {
      const runtimeFilter = filter as Record<string, unknown>;
      const { dimension, id } = runtimeFilter;
      if (Object.keys(runtimeFilter).some((key) => key !== "dimension" && key !== "id")) {
        errors.push("dimensionFilter supports exactly one dimension and id.");
      }
      if (!(["division", "scenario", "training"] as const).includes(dimension as OrganizationPerformanceDimension)) {
        errors.push("dimensionFilter.dimension must be division, scenario, or training.");
      }
      if (typeof id !== "string" || !id.trim()) {
        errors.push("dimensionFilter.id must be a non-empty string.");
      } else if (["division", "scenario", "training"].includes(dimension as string)) {
        dimensionFilter = { dimension: dimension as OrganizationPerformanceDimension, id: id.trim() };
      }
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
  if (candidates.length === 0) return { largestContributionShare: 0, concentrationWarning: false };
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

function canonicalWeightUnits(weight: number): number {
  return Math.round(weight * 1_000_000_000);
}

function profileIdentity(weights: SimulationScoringWeightsApplied | undefined): string {
  return weights === undefined
    ? "unknown"
    : `known:${canonicalWeightUnits(weights.persuasion)}:${canonicalWeightUnits(weights.clarity)}:${canonicalWeightUnits(weights.empathy)}:${canonicalWeightUnits(weights.assertiveness)}`;
}

function weightProfile(weights: SimulationScoringWeightsApplied | undefined): OrganizationPerformanceWeightProfile {
  return weights === undefined
    ? { kind: "unknown", profileKey: "unknown" }
    : {
        kind: "known",
        profileKey: profileIdentity(weights),
        weights: {
          persuasion: canonicalWeightUnits(weights.persuasion) / 1_000_000_000,
          clarity: canonicalWeightUnits(weights.clarity) / 1_000_000_000,
          empathy: canonicalWeightUnits(weights.empathy) / 1_000_000_000,
          assertiveness: canonicalWeightUnits(weights.assertiveness) / 1_000_000_000,
        },
      };
}

function matchesDimension(candidate: OrganizationEvidenceCandidate, filter: OrganizationPerformanceDimensionFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.dimension === "division") return candidate.divisionId === filter.id;
  if (filter.dimension === "scenario") return candidate.scenarioId === filter.id;
  return candidate.trainingId === filter.id;
}

function completionPopulations(
  candidates: readonly OrganizationEvidenceCandidate[],
): CompletionPopulation[] {
  const generations = [...new Set(candidates.map((candidate) => candidate.scoringGeneration))].sort();
  return generations.map((scoringGeneration) => {
    const generationRows = candidates.filter((candidate) => candidate.scoringGeneration === scoringGeneration);
    return {
      scoringGeneration,
      completionRows: generationRows.filter((candidate) => candidate.metricAvailability.completion),
      objectiveRows: generationRows.filter((candidate) => candidate.metricAvailability.objective),
    };
  });
}

function metricPopulations(
  candidates: readonly OrganizationEvidenceCandidate[],
): MetricPopulation[] {
  const populations: MetricPopulation[] = [];
  for (const definition of METRICS) {
    const grouped = new Map<string, OrganizationEvidenceCandidate[]>();
    for (const candidate of candidates) {
      const value = definition.value(candidate);
      if (!isConclusive(candidate) || !candidate.metricAvailability[definition.availability] || value === undefined) continue;
      const profileId = definition.composite ? profileIdentity(candidate.scoringWeightsApplied) : undefined;
      const key = `${candidate.scoringGeneration}\u0000${profileId ?? ""}`;
      const rows = grouped.get(key) ?? [];
      rows.push(candidate);
      grouped.set(key, rows);
    }
    for (const [key, rows] of grouped) {
      const [scoringGeneration, profileId] = key.split("\u0000");
      populations.push({ definition, scoringGeneration: scoringGeneration!, profileId: profileId || undefined, rows });
    }
  }
  return populations.sort((left, right) =>
    (METRIC_ORDER.get(left.definition.metric)! - METRIC_ORDER.get(right.definition.metric)!)
    || left.scoringGeneration.localeCompare(right.scoringGeneration)
    || (left.profileId ?? "").localeCompare(right.profileId ?? ""));
}

function protectedPopulationIsSafe(
  candidates: readonly OrganizationEvidenceCandidate[],
  isCurrentSubject: CurrentSubjectClassifier,
): boolean {
  const protectedCandidates = candidates.filter((candidate) => !isCurrentSubject(candidate));
  const protectedCounts = contributorCounts(protectedCandidates);
  if (protectedCounts.size === 0) return true;
  if (protectedCounts.size < ORGANIZATION_PERFORMANCE_PROTECTED_CONTRIBUTOR_THRESHOLD) return false;

  const largestProtectedContributionShare = Math.max(...protectedCounts.values()) / protectedCandidates.length;
  return largestProtectedContributionShare <= ORGANIZATION_PERFORMANCE_CONCENTRATION_WARNING_SHARE;
}

function selectResponsePrivacyMode(
  candidates: readonly OrganizationEvidenceCandidate[],
  isCurrentSubject: CurrentSubjectClassifier,
): HistoricalPrivacyMode {
  const populations: Array<readonly OrganizationEvidenceCandidate[]> = [candidates];
  for (const population of completionPopulations(candidates)) {
    if (population.completionRows.length > 0) populations.push(population.completionRows);
    if (population.objectiveRows.length > 0) populations.push(population.objectiveRows);
  }
  for (const population of metricPopulations(candidates)) populations.push(population.rows);
  return populations.every((population) => protectedPopulationIsSafe(population, isCurrentSubject))
    ? "all_eligible_history"
    : "current_only";
}

function buildCompletionAggregate(
  rows: readonly OrganizationEvidenceCandidate[],
  adjustmentApplied: boolean,
): OrganizationPerformanceCompletionAggregate {
  const completeCount = rows.filter((candidate) => candidate.completionLevel === "complete").length;
  return {
    availableObservationCount: rows.length,
    completeCount,
    partialCount: rows.filter((candidate) => candidate.completionLevel === "partial").length,
    inconclusiveCount: rows.filter((candidate) => candidate.completionLevel === "inconclusive").length,
    completionRate: rows.length === 0 ? null : completeCount / rows.length,
    evidenceStrength: evidenceStrength(rows, rows.length),
    concentration: concentration(rows),
    historicalPrivacyAdjustmentApplied: adjustmentApplied,
  };
}

function buildObjectiveAggregate(
  rows: readonly OrganizationEvidenceCandidate[],
  adjustmentApplied: boolean,
): OrganizationPerformanceObjectiveAggregate {
  const achievedCount = rows.filter((candidate) => candidate.objectiveAchieved === true).length;
  return {
    availableObservationCount: rows.length,
    achievedCount,
    objectiveAchievementRate: rows.length === 0 ? null : achievedCount / rows.length,
    evidenceStrength: evidenceStrength(rows, rows.length),
    concentration: concentration(rows),
    historicalPrivacyAdjustmentApplied: adjustmentApplied,
  };
}

function buildCompletionGroups(
  candidates: readonly OrganizationEvidenceCandidate[],
  historicalPrivacyAdjustmentApplied: boolean,
): OrganizationPerformanceCompletionGroup[] {
  return completionPopulations(candidates).map(({ scoringGeneration, completionRows, objectiveRows }) => ({
    scoringGeneration,
    completion: buildCompletionAggregate(completionRows, historicalPrivacyAdjustmentApplied),
    objective: buildObjectiveAggregate(objectiveRows, historicalPrivacyAdjustmentApplied),
  }));
}

function buildMetricGroups(
  candidates: readonly OrganizationEvidenceCandidate[],
  historicalPrivacyAdjustmentApplied: boolean,
): OrganizationPerformanceMetricAggregate[] {
  return metricPopulations(candidates).map(({ definition, scoringGeneration, rows }) => {
    const values = rows.map((candidate) => definition.value(candidate)!).sort((left, right) => left - right);
    return {
      metric: definition.metric,
      scoringGeneration,
      ...(definition.composite ? { weightProfile: weightProfile(rows[0]!.scoringWeightsApplied) } : {}),
      mean: values.reduce((sum, metricValue) => sum + metricValue, 0) / values.length,
      qualifyingObservationCount: values.length,
      evidenceStrength: evidenceStrength(rows, values.length),
      concentration: concentration(rows),
      historicalPrivacyAdjustmentApplied,
    };
  });
}

function aggregateOrganizationPerformanceInternal(
  input: AggregateOrganizationPerformanceInput,
  isCurrentSubject: CurrentSubjectClassifier | undefined,
  scopeMode: "organization" | "current_population" = "organization",
): OrganizationPerformanceAggregate {
  const dimensionFilter = validateOrganizationPerformanceSelection(input);
  const start = Date.UTC(input.calendarMonth.year, input.calendarMonth.month - 1, 1);
  const before = Date.UTC(input.calendarMonth.year, input.calendarMonth.month, 1);
  const candidates = input.candidates.filter((candidate) => {
    const evidenceAt = Date.parse(candidate.evidenceAt);
    return evidenceAt >= start && evidenceAt < before && matchesDimension(candidate, dimensionFilter);
  });
  const historicalScope = scopeMode === "current_population" || dimensionFilter !== undefined
    ? "current_population"
    : "organization_history";
  let privacyMode: HistoricalPrivacyMode = "all_eligible_history";
  let historicalPrivacyAdjustmentApplied = false;
  let displayedCandidates = candidates;
  let suppressEmptyActivity = false;
  // Current-population callers have already limited candidates to authorized people.
  // No protected historical population enters that mode.
  if (scopeMode !== "current_population" && isCurrentSubject && dimensionFilter !== undefined) {
    privacyMode = "current_only";
    displayedCandidates = candidates.filter(isCurrentSubject);
  } else if (scopeMode !== "current_population" && isCurrentSubject) {
    privacyMode = selectResponsePrivacyMode(candidates, isCurrentSubject);
    if (privacyMode === "current_only") {
      historicalPrivacyAdjustmentApplied = candidates.some((candidate) => !isCurrentSubject(candidate));
      displayedCandidates = candidates.filter(isCurrentSubject);
      suppressEmptyActivity = historicalPrivacyAdjustmentApplied && displayedCandidates.length === 0;
    }
  }
  const completionGroups = buildCompletionGroups(displayedCandidates, historicalPrivacyAdjustmentApplied);
  const metricGroups = buildMetricGroups(displayedCandidates, historicalPrivacyAdjustmentApplied);

  return {
    calendarMonth: {
      year: input.calendarMonth.year,
      month: input.calendarMonth.month,
      timeZone: ORGANIZATION_PERFORMANCE_AGGREGATION_TIME_ZONE,
    },
    dimensionFilter: dimensionFilter ?? null,
    historicalScope,
    activity: suppressEmptyActivity ? null : {
      attemptCount: displayedCandidates.length,
      conclusiveAttemptCount: displayedCandidates.filter(isConclusive).length,
      evidenceStrength: evidenceStrength(displayedCandidates, displayedCandidates.length),
      concentration: concentration(displayedCandidates),
      historicalPrivacyAdjustmentApplied,
    },
    completionGroups,
    metricGroups,
    historicalPrivacyAdjustmentApplied,
  };
}

/**
 * INTERNAL - NOT ROUTE-SAFE.
 * Routes/controllers must use queryAuthorizedOrganizationPerformance.
 */
export function aggregateOrganizationPerformance(
  input: AggregateOrganizationPerformanceInput,
): UnprotectedOrganizationPerformanceAggregate {
  return aggregateOrganizationPerformanceInternal(input, undefined) as UnprotectedOrganizationPerformanceAggregate;
}

/**
 * INTERNAL - NOT ROUTE-SAFE.
 * Routes/controllers must use queryAuthorizedOrganizationPerformance.
 */
export function aggregateOrganizationPerformanceWithHistoricalPrivacy(
  input: AggregateOrganizationPerformanceInput,
  isCurrentSubject: CurrentSubjectClassifier,
): OrganizationPerformanceAggregate {
  return aggregateOrganizationPerformanceInternal(input, isCurrentSubject);
}

/** INTERNAL - NOT ROUTE-SAFE. Routes/controllers must use queryAuthorizedTeamPerformance. */
export function aggregateCurrentPopulationPerformance(
  input: Omit<AggregateOrganizationPerformanceInput, "dimensionFilter">,
): OrganizationPerformanceAggregate {
  if (Object.hasOwn(input, "dimensionFilter")) {
    throw new OrganizationPerformanceAggregationInputError(["Team performance does not support dimension filtering."]);
  }
  return aggregateOrganizationPerformanceInternal(input, undefined, "current_population");
}
