import type { DashboardViewer } from "@voicepractice/shared";

import type { AuthorizedOrganizationPerformanceCalendarMonth } from "./authorizedOrganizationPerformance.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";
import {
  buildTeamPerformanceIntelligenceFacts,
  type TeamPerformanceIntelligenceCompletionPeriodFact,
  type TeamPerformanceIntelligenceFacts,
  type TeamPerformanceIntelligenceMetricPeriodFact,
  type TeamPerformanceIntelligenceObjectivePeriodFact,
  type TeamPerformanceIntelligenceWeightProfile,
} from "./teamPerformanceIntelligenceFacts.js";
import {
  deriveTeamPerformanceIntelligenceSignals,
  type TeamPerformanceIntelligenceSignals,
  type TeamPerformanceMovementSignal,
  type TeamPerformanceRelativeDimensionSignal,
  type TeamPerformanceSignalComparisonQualifiers,
  type TeamPerformanceSignalPeriodQualifiers,
} from "./teamPerformanceIntelligenceSignals.js";

export interface AuthorizedTeamPerformanceIntelligenceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
  readonly asOf: Date;
}

export interface AuthorizedTeamPerformanceIntelligenceResult {
  readonly scope: "team";
  readonly asOf: string;
  readonly currentMonth: TeamPerformanceIntelligenceFacts["currentMonth"];
  readonly comparisonMonth: TeamPerformanceIntelligenceFacts["comparisonMonth"];
  readonly population: TeamPerformanceIntelligenceFacts["population"];
  readonly facts: {
    readonly activity: TeamPerformanceIntelligenceFacts["activity"];
    readonly metricComparisons: TeamPerformanceIntelligenceFacts["metricComparisons"];
    readonly completionComparisons: TeamPerformanceIntelligenceFacts["completionComparisons"];
    readonly focusReadiness: TeamPerformanceIntelligenceFacts["focusReadiness"];
  };
  readonly signals: {
    readonly monthCompleteness: Omit<TeamPerformanceIntelligenceSignals["monthCompleteness"], "asOf">;
    readonly activityMovement: TeamPerformanceIntelligenceSignals["activityMovement"];
    readonly metricMovement: TeamPerformanceIntelligenceSignals["metricMovement"];
    readonly relativeDimensions: TeamPerformanceIntelligenceSignals["relativeDimensions"];
    readonly completionMovement: TeamPerformanceIntelligenceSignals["completionMovement"];
    readonly focus: TeamPerformanceIntelligenceSignals["focus"];
  };
}

function projectEvidenceStrength(
  strength: TeamPerformanceIntelligenceMetricPeriodFact["evidenceStrength"],
) {
  return {
    conservativeContributorCount: strength.conservativeContributorCount,
    limitedEvidence: strength.limitedEvidence,
  };
}

function projectActivityPeriod(period: TeamPerformanceIntelligenceFacts["activity"]["current"]) {
  return {
    attemptCount: period.attemptCount,
    conclusiveAttemptCount: period.conclusiveAttemptCount,
    evidenceStrength: projectEvidenceStrength(period.evidenceStrength),
    concentrationWarning: period.concentrationWarning,
  };
}

function projectMetricPeriod(period: TeamPerformanceIntelligenceMetricPeriodFact | null) {
  return period === null
    ? null
    : {
        mean: period.mean,
        observationCount: period.observationCount,
        evidenceStrength: projectEvidenceStrength(period.evidenceStrength),
        concentrationWarning: period.concentrationWarning,
      };
}

function projectCompletionPeriod(period: TeamPerformanceIntelligenceCompletionPeriodFact | null) {
  return period === null
    ? null
    : {
        availableObservationCount: period.availableObservationCount,
        completeCount: period.completeCount,
        partialCount: period.partialCount,
        inconclusiveCount: period.inconclusiveCount,
        completionRate: period.completionRate,
        evidenceStrength: projectEvidenceStrength(period.evidenceStrength),
        concentrationWarning: period.concentrationWarning,
      };
}

function projectObjectivePeriod(period: TeamPerformanceIntelligenceObjectivePeriodFact | null) {
  return period === null
    ? null
    : {
        availableObservationCount: period.availableObservationCount,
        achievedCount: period.achievedCount,
        objectiveAchievementRate: period.objectiveAchievementRate,
        evidenceStrength: projectEvidenceStrength(period.evidenceStrength),
        concentrationWarning: period.concentrationWarning,
      };
}

function projectWeightProfile(profile: TeamPerformanceIntelligenceWeightProfile | undefined) {
  if (profile === undefined) return undefined;
  return profile.kind === "unknown"
    ? { kind: "unknown" as const }
    : { kind: "known" as const, weights: { ...profile.weights } };
}

function projectFacts(facts: TeamPerformanceIntelligenceFacts): AuthorizedTeamPerformanceIntelligenceResult["facts"] {
  return {
    activity: {
      current: projectActivityPeriod(facts.activity.current),
      previous: projectActivityPeriod(facts.activity.previous),
      attemptDelta: facts.activity.attemptDelta,
      conclusiveAttemptDelta: facts.activity.conclusiveAttemptDelta,
    },
    metricComparisons: facts.metricComparisons.map((comparison) => ({
      metric: comparison.metric,
      scoringGeneration: comparison.scoringGeneration,
      ...(comparison.weightProfile === undefined
        ? {}
        : { weightProfile: projectWeightProfile(comparison.weightProfile)! }),
      current: projectMetricPeriod(comparison.current),
      previous: projectMetricPeriod(comparison.previous),
      delta: comparison.delta,
      comparable: comparison.comparable,
      nonComparableReason: comparison.nonComparableReason,
    })),
    completionComparisons: facts.completionComparisons.map((comparison) => ({
      scoringGeneration: comparison.scoringGeneration,
      completion: {
        current: projectCompletionPeriod(comparison.completion.current),
        previous: projectCompletionPeriod(comparison.completion.previous),
        delta: comparison.completion.delta,
        comparable: comparison.completion.comparable,
        nonComparableReason: comparison.completion.nonComparableReason,
      },
      objective: {
        current: projectObjectivePeriod(comparison.objective.current),
        previous: projectObjectivePeriod(comparison.objective.previous),
        delta: comparison.objective.delta,
        comparable: comparison.objective.comparable,
        nonComparableReason: comparison.objective.nonComparableReason,
      },
    })),
    focusReadiness: {
      available: false,
      reason: facts.focusReadiness.reason,
    },
  };
}

function projectMovement(movement: TeamPerformanceMovementSignal): TeamPerformanceMovementSignal {
  return movement.available
    ? { available: true, direction: movement.direction, reason: null }
    : { available: false, direction: null, reason: movement.reason };
}

function projectPeriodQualifiers(
  qualifiers: TeamPerformanceSignalPeriodQualifiers | null,
): TeamPerformanceSignalPeriodQualifiers | null {
  return qualifiers === null
    ? null
    : {
        limitedEvidence: qualifiers.limitedEvidence,
        concentrationWarning: qualifiers.concentrationWarning,
      };
}

function projectComparisonQualifiers(
  qualifiers: TeamPerformanceSignalComparisonQualifiers,
): TeamPerformanceSignalComparisonQualifiers {
  return {
    current: projectPeriodQualifiers(qualifiers.current),
    previous: projectPeriodQualifiers(qualifiers.previous),
  };
}

function projectRelativeDimensionSignal(
  entry: TeamPerformanceRelativeDimensionSignal,
): TeamPerformanceRelativeDimensionSignal {
  const common = {
    scoringGeneration: entry.scoringGeneration,
    dimensions: entry.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      mean: dimension.mean,
      qualifiers: projectPeriodQualifiers(dimension.qualifiers)!,
    })),
    qualifiers: projectPeriodQualifiers(entry.qualifiers)!,
  };
  if (!entry.available) {
    return {
      ...common,
      available: false,
      relativePosition: null,
      reason: "incomplete_dimension_set",
      highestDimensions: [],
      lowestDimensions: [],
    };
  }
  if (entry.relativePosition === "balanced") {
    return {
      ...common,
      available: true,
      relativePosition: "balanced",
      reason: null,
      highestDimensions: [],
      lowestDimensions: [],
    };
  }
  return {
    ...common,
    available: true,
    relativePosition: "differentiated",
    reason: null,
    highestDimensions: [...entry.highestDimensions],
    lowestDimensions: [...entry.lowestDimensions],
  };
}

function projectSignals(
  signals: TeamPerformanceIntelligenceSignals,
): AuthorizedTeamPerformanceIntelligenceResult["signals"] {
  return {
    monthCompleteness: {
      complete: signals.monthCompleteness.complete,
      completesAt: signals.monthCompleteness.completesAt,
    },
    activityMovement: {
      attempts: projectMovement(signals.activityMovement.attempts),
      conclusiveAttempts: projectMovement(signals.activityMovement.conclusiveAttempts),
      qualifiers: projectComparisonQualifiers(signals.activityMovement.qualifiers),
    },
    metricMovement: signals.metricMovement.map((entry) => ({
      metric: entry.metric,
      scoringGeneration: entry.scoringGeneration,
      ...(entry.weightProfile === undefined
        ? {}
        : { weightProfile: projectWeightProfile(entry.weightProfile)! }),
      movement: projectMovement(entry.movement),
      qualifiers: projectComparisonQualifiers(entry.qualifiers),
    })),
    relativeDimensions: signals.relativeDimensions.map(projectRelativeDimensionSignal),
    completionMovement: signals.completionMovement.map((entry) => ({
      scoringGeneration: entry.scoringGeneration,
      completion: {
        movement: projectMovement(entry.completion.movement),
        qualifiers: projectComparisonQualifiers(entry.completion.qualifiers),
      },
      objective: {
        movement: projectMovement(entry.objective.movement),
        qualifiers: projectComparisonQualifiers(entry.objective.qualifiers),
      },
    })),
    focus: {
      available: false,
      reason: signals.focus.reason,
    },
  };
}

/** Route-safe composition boundary for deterministic Team facts and signals. */
export function queryAuthorizedTeamPerformanceIntelligence(
  query: AuthorizedTeamPerformanceIntelligenceQuery,
): AuthorizedTeamPerformanceIntelligenceResult {
  const facts = buildTeamPerformanceIntelligenceFacts({
    snapshot: query.snapshot,
    viewer: query.viewer,
    organizationId: query.organizationId,
    calendarMonth: query.calendarMonth,
  });
  const signals = deriveTeamPerformanceIntelligenceSignals({ facts, asOf: query.asOf });

  return {
    scope: "team",
    asOf: signals.monthCompleteness.asOf,
    currentMonth: { ...facts.currentMonth },
    comparisonMonth: { ...facts.comparisonMonth },
    population: { ...facts.population },
    facts: projectFacts(facts),
    signals: projectSignals(signals),
  };
}
