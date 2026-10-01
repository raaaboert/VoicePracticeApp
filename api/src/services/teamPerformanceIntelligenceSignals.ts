import type {
  TeamPerformanceIntelligenceFacts,
  TeamPerformanceIntelligenceMetricComparison,
  TeamPerformanceIntelligenceNonComparableReason,
  TeamPerformanceIntelligenceWeightProfile,
} from "./teamPerformanceIntelligenceFacts.js";

export type TeamPerformanceMovementDirection = "up" | "down" | "unchanged";

export type TeamPerformanceMovementUnavailableReason =
  | "current_month_incomplete"
  | TeamPerformanceIntelligenceNonComparableReason;

export type TeamPerformanceMovementSignal =
  | {
      readonly available: true;
      readonly direction: TeamPerformanceMovementDirection;
      readonly reason: null;
    }
  | {
      readonly available: false;
      readonly direction: null;
      readonly reason: TeamPerformanceMovementUnavailableReason;
    };

export interface TeamPerformanceSignalPeriodQualifiers {
  readonly limitedEvidence: boolean;
  readonly concentrationWarning: boolean;
}

export interface TeamPerformanceSignalComparisonQualifiers {
  readonly current: TeamPerformanceSignalPeriodQualifiers | null;
  readonly previous: TeamPerformanceSignalPeriodQualifiers | null;
}

export type TeamPerformanceCoreDimension =
  | "persuasion"
  | "clarity"
  | "empathy"
  | "assertiveness";

export interface TeamPerformanceRelativeDimensionValue {
  readonly dimension: TeamPerformanceCoreDimension;
  readonly mean: number;
  readonly qualifiers: TeamPerformanceSignalPeriodQualifiers;
}

interface TeamPerformanceRelativeDimensionSignalBase {
  readonly scoringGeneration: string;
  readonly dimensions: readonly TeamPerformanceRelativeDimensionValue[];
  readonly qualifiers: TeamPerformanceSignalPeriodQualifiers;
}

export type TeamPerformanceRelativeDimensionSignal =
  | TeamPerformanceRelativeDimensionSignalBase & {
      readonly available: true;
      readonly relativePosition: "differentiated";
      readonly reason: null;
      readonly highestDimensions: readonly TeamPerformanceCoreDimension[];
      readonly lowestDimensions: readonly TeamPerformanceCoreDimension[];
    }
  | TeamPerformanceRelativeDimensionSignalBase & {
      readonly available: true;
      readonly relativePosition: "balanced";
      readonly reason: null;
      readonly highestDimensions: readonly [];
      readonly lowestDimensions: readonly [];
    }
  | TeamPerformanceRelativeDimensionSignalBase & {
      readonly available: false;
      readonly relativePosition: null;
      readonly reason: "incomplete_dimension_set";
      readonly highestDimensions: readonly [];
      readonly lowestDimensions: readonly [];
    };

export interface TeamPerformanceMetricMovementSignal {
  readonly metric: TeamPerformanceIntelligenceMetricComparison["metric"];
  readonly scoringGeneration: string;
  readonly weightProfile?: TeamPerformanceIntelligenceWeightProfile;
  readonly movement: TeamPerformanceMovementSignal;
  readonly qualifiers: TeamPerformanceSignalComparisonQualifiers;
}

export interface TeamPerformanceRateMovementSignal {
  readonly movement: TeamPerformanceMovementSignal;
  readonly qualifiers: TeamPerformanceSignalComparisonQualifiers;
}

export interface TeamPerformanceCompletionMovementSignals {
  readonly scoringGeneration: string;
  readonly completion: TeamPerformanceRateMovementSignal;
  readonly objective: TeamPerformanceRateMovementSignal;
}

export interface TeamPerformanceIntelligenceSignals {
  readonly scope: "team";
  readonly currentMonth: TeamPerformanceIntelligenceFacts["currentMonth"];
  readonly comparisonMonth: TeamPerformanceIntelligenceFacts["comparisonMonth"];
  readonly population: TeamPerformanceIntelligenceFacts["population"];
  readonly monthCompleteness: {
    readonly complete: boolean;
    readonly asOf: string;
    readonly completesAt: string;
  };
  readonly activityMovement: {
    readonly attempts: TeamPerformanceMovementSignal;
    readonly conclusiveAttempts: TeamPerformanceMovementSignal;
    readonly qualifiers: TeamPerformanceSignalComparisonQualifiers;
  };
  readonly metricMovement: readonly TeamPerformanceMetricMovementSignal[];
  readonly relativeDimensions: readonly TeamPerformanceRelativeDimensionSignal[];
  readonly completionMovement: readonly TeamPerformanceCompletionMovementSignals[];
  readonly focus: TeamPerformanceIntelligenceFacts["focusReadiness"];
}

export interface DeriveTeamPerformanceIntelligenceSignalsInput {
  readonly facts: TeamPerformanceIntelligenceFacts;
  /** An explicit instant. No ambient clock is read by this service. */
  readonly asOf: Date;
}

export class TeamPerformanceIntelligenceSignalInputError extends Error {
  constructor() {
    super("Team performance intelligence signals require a valid explicit asOf date.");
    this.name = "TeamPerformanceIntelligenceSignalInputError";
  }
}

const CORE_DIMENSIONS: readonly TeamPerformanceCoreDimension[] = [
  "persuasion",
  "clarity",
  "empathy",
  "assertiveness",
];

interface EvidenceQualifierSource {
  readonly evidenceStrength: { readonly limitedEvidence: boolean };
  readonly concentrationWarning: boolean;
}

function periodQualifiers(
  period: EvidenceQualifierSource | null,
): TeamPerformanceSignalPeriodQualifiers | null {
  return period === null
    ? null
    : {
        limitedEvidence: period.evidenceStrength.limitedEvidence,
        concentrationWarning: period.concentrationWarning,
      };
}

function comparisonQualifiers(
  current: EvidenceQualifierSource | null,
  previous: EvidenceQualifierSource | null,
): TeamPerformanceSignalComparisonQualifiers {
  return {
    current: periodQualifiers(current),
    previous: periodQualifiers(previous),
  };
}

function directionFor(delta: number): TeamPerformanceMovementDirection {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "unchanged";
}

function deriveMovement(params: {
  comparable: boolean;
  nonComparableReason: TeamPerformanceIntelligenceNonComparableReason | null;
  delta: number | null;
  currentMonthComplete: boolean;
}): TeamPerformanceMovementSignal {
  if (!params.comparable) {
    return {
      available: false,
      direction: null,
      reason: params.nonComparableReason ?? "metric_unavailable",
    };
  }
  if (!params.currentMonthComplete) {
    return { available: false, direction: null, reason: "current_month_incomplete" };
  }
  if (params.delta === null) {
    return { available: false, direction: null, reason: "metric_unavailable" };
  }
  return { available: true, direction: directionFor(params.delta), reason: null };
}

function activityMovement(
  delta: number,
  currentMonthComplete: boolean,
): TeamPerformanceMovementSignal {
  return currentMonthComplete
    ? { available: true, direction: directionFor(delta), reason: null }
    : { available: false, direction: null, reason: "current_month_incomplete" };
}

function deriveRelativeDimensions(
  facts: TeamPerformanceIntelligenceFacts,
): TeamPerformanceRelativeDimensionSignal[] {
  const currentGenerations = [...new Set(
    facts.metricComparisons
      .filter((comparison) => comparison.current !== null)
      .map((comparison) => comparison.scoringGeneration),
  )].sort();

  return currentGenerations.map((scoringGeneration) => {
    const byDimension = new Map<TeamPerformanceCoreDimension, TeamPerformanceRelativeDimensionValue>();
    for (const comparison of facts.metricComparisons) {
      if (
        comparison.scoringGeneration !== scoringGeneration
        || comparison.current === null
        || !CORE_DIMENSIONS.includes(comparison.metric as TeamPerformanceCoreDimension)
      ) continue;
      const dimension = comparison.metric as TeamPerformanceCoreDimension;
      byDimension.set(dimension, {
        dimension,
        mean: comparison.current.mean,
        qualifiers: periodQualifiers(comparison.current)!,
      });
    }

    const dimensions = CORE_DIMENSIONS.flatMap((dimension) => {
      const value = byDimension.get(dimension);
      return value === undefined ? [] : [value];
    });
    const qualifiers = {
      limitedEvidence: dimensions.some((dimension) => dimension.qualifiers.limitedEvidence),
      concentrationWarning: dimensions.some((dimension) => dimension.qualifiers.concentrationWarning),
    };

    if (dimensions.length !== CORE_DIMENSIONS.length) {
      return {
        scoringGeneration,
        available: false,
        relativePosition: null,
        reason: "incomplete_dimension_set",
        dimensions,
        highestDimensions: [],
        lowestDimensions: [],
        qualifiers,
      };
    }

    const highestMean = Math.max(...dimensions.map((dimension) => dimension.mean));
    const lowestMean = Math.min(...dimensions.map((dimension) => dimension.mean));
    if (highestMean === lowestMean) {
      return {
        scoringGeneration,
        available: true,
        relativePosition: "balanced",
        reason: null,
        dimensions,
        highestDimensions: [],
        lowestDimensions: [],
        qualifiers,
      };
    }
    return {
      scoringGeneration,
      available: true,
      relativePosition: "differentiated",
      reason: null,
      dimensions,
      highestDimensions: dimensions
        .filter((dimension) => dimension.mean === highestMean)
        .map((dimension) => dimension.dimension),
      lowestDimensions: dimensions
        .filter((dimension) => dimension.mean === lowestMean)
        .map((dimension) => dimension.dimension),
      qualifiers,
    };
  });
}

/**
 * Converts identity-free Team facts into deterministic, identity-free signals.
 * Movement is interpreted only after the selected UTC month has completed.
 */
export function deriveTeamPerformanceIntelligenceSignals(
  input: DeriveTeamPerformanceIntelligenceSignalsInput,
): TeamPerformanceIntelligenceSignals {
  const asOfTime = input.asOf.getTime();
  if (!Number.isFinite(asOfTime)) throw new TeamPerformanceIntelligenceSignalInputError();

  const completesAtTime = Date.UTC(
    input.facts.currentMonth.year,
    input.facts.currentMonth.month,
    1,
  );
  const currentMonthComplete = asOfTime >= completesAtTime;
  const activityQualifiers: TeamPerformanceSignalComparisonQualifiers = {
    current: periodQualifiers(input.facts.activity.current),
    previous: periodQualifiers(input.facts.activity.previous),
  };

  return {
    scope: "team",
    currentMonth: { ...input.facts.currentMonth },
    comparisonMonth: { ...input.facts.comparisonMonth },
    population: { ...input.facts.population },
    monthCompleteness: {
      complete: currentMonthComplete,
      asOf: input.asOf.toISOString(),
      completesAt: new Date(completesAtTime).toISOString(),
    },
    activityMovement: {
      attempts: activityMovement(input.facts.activity.attemptDelta, currentMonthComplete),
      conclusiveAttempts: activityMovement(
        input.facts.activity.conclusiveAttemptDelta,
        currentMonthComplete,
      ),
      qualifiers: activityQualifiers,
    },
    metricMovement: input.facts.metricComparisons.map((comparison) => ({
      metric: comparison.metric,
      scoringGeneration: comparison.scoringGeneration,
      ...(comparison.weightProfile === undefined
        ? {}
        : { weightProfile: comparison.weightProfile }),
      movement: deriveMovement({
        comparable: comparison.comparable,
        nonComparableReason: comparison.nonComparableReason,
        delta: comparison.delta,
        currentMonthComplete,
      }),
      qualifiers: comparisonQualifiers(comparison.current, comparison.previous),
    })),
    relativeDimensions: deriveRelativeDimensions(input.facts),
    completionMovement: input.facts.completionComparisons.map((comparison) => ({
      scoringGeneration: comparison.scoringGeneration,
      completion: {
        movement: deriveMovement({
          comparable: comparison.completion.comparable,
          nonComparableReason: comparison.completion.nonComparableReason,
          delta: comparison.completion.delta,
          currentMonthComplete,
        }),
        qualifiers: comparisonQualifiers(
          comparison.completion.current,
          comparison.completion.previous,
        ),
      },
      objective: {
        movement: deriveMovement({
          comparable: comparison.objective.comparable,
          nonComparableReason: comparison.objective.nonComparableReason,
          delta: comparison.objective.delta,
          currentMonthComplete,
        }),
        qualifiers: comparisonQualifiers(
          comparison.objective.current,
          comparison.objective.previous,
        ),
      },
    })),
    focus: { ...input.facts.focusReadiness },
  };
}
