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

interface PrivacySelection {
  readonly rows: readonly OrganizationEvidenceCandidate[] | null;
  readonly adjustmentApplied: boolean;
}

interface PrivacyBuildResult<T> {
  readonly value: T;
  readonly adjustmentApplied: boolean;
}

type CurrentSubjectClassifier = (candidate: OrganizationEvidenceCandidate) => boolean;

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

function applyHistoricalPrivacy(
  candidates: readonly OrganizationEvidenceCandidate[],
  isCurrentSubject: CurrentSubjectClassifier | undefined,
): PrivacySelection {
  if (!isCurrentSubject) return { rows: candidates, adjustmentApplied: false };
  const currentRows: OrganizationEvidenceCandidate[] = [];
  const protectedRows: OrganizationEvidenceCandidate[] = [];
  for (const candidate of candidates) {
    (isCurrentSubject(candidate) ? currentRows : protectedRows).push(candidate);
  }
  const protectedContributorCount = contributorCounts(protectedRows).size;
  if (protectedContributorCount === 0 || protectedContributorCount >= ORGANIZATION_PERFORMANCE_PROTECTED_CONTRIBUTOR_THRESHOLD) {
    return { rows: candidates, adjustmentApplied: false };
  }
  return { rows: currentRows.length > 0 ? currentRows : null, adjustmentApplied: true };
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
  isCurrentSubject: CurrentSubjectClassifier | undefined,
): PrivacyBuildResult<OrganizationPerformanceCompletionGroup[]> {
  const groups: OrganizationPerformanceCompletionGroup[] = [];
  let adjustmentApplied = false;
  const generations = [...new Set(candidates.map((candidate) => candidate.scoringGeneration))].sort();
  for (const scoringGeneration of generations) {
    const generationRows = candidates.filter((candidate) => candidate.scoringGeneration === scoringGeneration);
    const completion = applyHistoricalPrivacy(
      generationRows.filter((candidate) => candidate.metricAvailability.completion),
      isCurrentSubject,
    );
    const objective = applyHistoricalPrivacy(
      generationRows.filter((candidate) => candidate.metricAvailability.objective),
      isCurrentSubject,
    );
    adjustmentApplied ||= completion.adjustmentApplied || objective.adjustmentApplied;
    if (completion.rows === null && objective.rows === null) continue;
    if (
      (completion.rows === null || completion.rows.length === 0)
      && (objective.rows === null || objective.rows.length === 0)
      && (completion.adjustmentApplied || objective.adjustmentApplied)
    ) continue;
    groups.push({
      scoringGeneration,
      ...(completion.rows === null ? {} : { completion: buildCompletionAggregate(completion.rows, completion.adjustmentApplied) }),
      ...(objective.rows === null ? {} : { objective: buildObjectiveAggregate(objective.rows, objective.adjustmentApplied) }),
    });
  }
  return { value: groups, adjustmentApplied };
}

function buildMetricGroups(
  candidates: readonly OrganizationEvidenceCandidate[],
  isCurrentSubject: CurrentSubjectClassifier | undefined,
): PrivacyBuildResult<OrganizationPerformanceMetricAggregate[]> {
  const sourceGroups: Array<{
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
      sourceGroups.push({ definition, scoringGeneration: scoringGeneration!, profileId: profileId || undefined, rows });
    }
  }

  let adjustmentApplied = false;
  const value = sourceGroups
    .sort((left, right) =>
      (METRIC_ORDER.get(left.definition.metric)! - METRIC_ORDER.get(right.definition.metric)!)
      || left.scoringGeneration.localeCompare(right.scoringGeneration)
      || (left.profileId ?? "").localeCompare(right.profileId ?? ""))
    .flatMap(({ definition, scoringGeneration, rows }) => {
      const selection = applyHistoricalPrivacy(rows, isCurrentSubject);
      adjustmentApplied ||= selection.adjustmentApplied;
      if (selection.rows === null) return [];
      const displayedRows = selection.rows;
      const values = displayedRows.map((candidate) => definition.value(candidate)!).sort((left, right) => left - right);
      return [{
        metric: definition.metric,
        scoringGeneration,
        ...(definition.composite ? { weightProfile: weightProfile(displayedRows[0]!.scoringWeightsApplied) } : {}),
        mean: values.reduce((sum, metricValue) => sum + metricValue, 0) / values.length,
        qualifyingObservationCount: values.length,
        evidenceStrength: evidenceStrength(displayedRows, values.length),
        concentration: concentration(displayedRows),
        historicalPrivacyAdjustmentApplied: selection.adjustmentApplied,
      }];
    });
  return { value, adjustmentApplied };
}

function aggregateOrganizationPerformanceInternal(
  input: AggregateOrganizationPerformanceInput,
  isCurrentSubject: CurrentSubjectClassifier | undefined,
): OrganizationPerformanceAggregate {
  const dimensionFilter = validateOrganizationPerformanceSelection(input);
  const start = Date.UTC(input.calendarMonth.year, input.calendarMonth.month - 1, 1);
  const before = Date.UTC(input.calendarMonth.year, input.calendarMonth.month, 1);
  const candidates = input.candidates.filter((candidate) => {
    const evidenceAt = Date.parse(candidate.evidenceAt);
    return evidenceAt >= start && evidenceAt < before && matchesDimension(candidate, dimensionFilter);
  });
  const activitySelection = applyHistoricalPrivacy(candidates, isCurrentSubject);
  const completionGroups = buildCompletionGroups(candidates, isCurrentSubject);
  const metricGroups = buildMetricGroups(candidates, isCurrentSubject);
  const historicalPrivacyAdjustmentApplied =
    activitySelection.adjustmentApplied || completionGroups.adjustmentApplied || metricGroups.adjustmentApplied;

  return {
    calendarMonth: {
      year: input.calendarMonth.year,
      month: input.calendarMonth.month,
      timeZone: ORGANIZATION_PERFORMANCE_AGGREGATION_TIME_ZONE,
    },
    dimensionFilter: dimensionFilter ?? null,
    activity: activitySelection.rows === null ? null : {
      attemptCount: activitySelection.rows.length,
      conclusiveAttemptCount: activitySelection.rows.filter(isConclusive).length,
      evidenceStrength: evidenceStrength(activitySelection.rows, activitySelection.rows.length),
      concentration: concentration(activitySelection.rows),
      historicalPrivacyAdjustmentApplied: activitySelection.adjustmentApplied,
    },
    completionGroups: completionGroups.value,
    metricGroups: metricGroups.value,
    historicalPrivacyAdjustmentApplied,
  };
}

/** Existing pure Slice 4B aggregate for already-safe/internal candidate populations. */
export function aggregateOrganizationPerformance(
  input: AggregateOrganizationPerformanceInput,
): UnprotectedOrganizationPerformanceAggregate {
  return aggregateOrganizationPerformanceInternal(input, undefined) as UnprotectedOrganizationPerformanceAggregate;
}

/** Internal privacy-aware aggregation primitive used only by the controlled organization facade. */
export function aggregateOrganizationPerformanceWithHistoricalPrivacy(
  input: AggregateOrganizationPerformanceInput,
  isCurrentSubject: CurrentSubjectClassifier,
): OrganizationPerformanceAggregate {
  return aggregateOrganizationPerformanceInternal(input, isCurrentSubject);
}
