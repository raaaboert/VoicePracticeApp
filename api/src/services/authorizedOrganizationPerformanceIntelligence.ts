import type { DashboardViewer } from "@voicepractice/shared";

import type { AuthorizedOrganizationPerformanceCalendarMonth } from "./authorizedOrganizationPerformance.js";
import {
  buildOrganizationPerformanceIntelligenceFacts,
  type OrganizationPerformanceIntelligenceFacts,
} from "./organizationPerformanceIntelligenceFacts.js";
import {
  deriveOrganizationPerformanceIntelligenceSignals,
  type OrganizationPerformanceIntelligenceSignals,
} from "./organizationPerformanceIntelligenceSignals.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";
import type {
  TeamPerformanceIntelligenceCompletionPeriodFact,
  TeamPerformanceIntelligenceMetricPeriodFact,
  TeamPerformanceIntelligenceObjectivePeriodFact,
  TeamPerformanceIntelligenceWeightProfile,
} from "./teamPerformanceIntelligenceFacts.js";
import type {
  TeamPerformanceMovementSignal,
  TeamPerformanceRelativeDimensionSignal,
  TeamPerformanceSignalComparisonQualifiers,
  TeamPerformanceSignalPeriodQualifiers,
} from "./teamPerformanceIntelligenceSignals.js";

export interface AuthorizedOrganizationPerformanceIntelligenceQuery {
  readonly snapshot: PerformanceEvidenceSourceSnapshot;
  readonly viewer: DashboardViewer;
  readonly organizationId: string;
  readonly calendarMonth: AuthorizedOrganizationPerformanceCalendarMonth;
  readonly asOf: Date;
}

export interface AuthorizedOrganizationPerformanceIntelligenceResult {
  readonly scope: "organization";
  readonly populationBasis: "current_members";
  readonly asOf: string;
  readonly currentMonth: OrganizationPerformanceIntelligenceFacts["currentMonth"];
  readonly comparisonMonth: OrganizationPerformanceIntelligenceFacts["comparisonMonth"];
  readonly population: OrganizationPerformanceIntelligenceFacts["population"];
  readonly facts: {
    readonly activity: OrganizationPerformanceIntelligenceFacts["activity"];
    readonly metricComparisons: OrganizationPerformanceIntelligenceFacts["metricComparisons"];
    readonly completionComparisons: OrganizationPerformanceIntelligenceFacts["completionComparisons"];
    readonly focusReadiness: OrganizationPerformanceIntelligenceFacts["focusReadiness"];
  };
  readonly signals: {
    readonly monthCompleteness: Omit<
      OrganizationPerformanceIntelligenceSignals["monthCompleteness"],
      "asOf"
    >;
    readonly activityMovement: OrganizationPerformanceIntelligenceSignals["activityMovement"];
    readonly metricMovement: OrganizationPerformanceIntelligenceSignals["metricMovement"];
    readonly relativeDimensions: OrganizationPerformanceIntelligenceSignals["relativeDimensions"];
    readonly completionMovement: OrganizationPerformanceIntelligenceSignals["completionMovement"];
    readonly focus: OrganizationPerformanceIntelligenceSignals["focus"];
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

function projectActivityPeriod(
  period: OrganizationPerformanceIntelligenceFacts["activity"]["current"],
) {
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
  if (profile.kind === "unknown") return { kind: "unknown" as const };
  return {
    kind: "known" as const,
    weights: {
      persuasion: profile.weights.persuasion,
      clarity: profile.weights.clarity,
      empathy: profile.weights.empathy,
      assertiveness: profile.weights.assertiveness,
    },
  };
}

function projectFacts(
  facts: OrganizationPerformanceIntelligenceFacts,
): AuthorizedOrganizationPerformanceIntelligenceResult["facts"] {
  return {
    activity: {
      current: projectActivityPeriod(facts.activity.current),
      previous: projectActivityPeriod(facts.activity.previous),
      attemptDelta: facts.activity.attemptDelta,
      conclusiveAttemptDelta: facts.activity.conclusiveAttemptDelta,
    },
    metricComparisons: facts.metricComparisons.map((comparison) => {
      const weightProfile = projectWeightProfile(comparison.weightProfile);
      const current = projectMetricPeriod(comparison.current);
      const previous = projectMetricPeriod(comparison.previous);
      if (weightProfile === undefined) {
        return {
          metric: comparison.metric,
          scoringGeneration: comparison.scoringGeneration,
          current,
          previous,
          delta: comparison.delta,
          comparable: comparison.comparable,
          nonComparableReason: comparison.nonComparableReason,
        };
      }
      return {
        metric: comparison.metric,
        scoringGeneration: comparison.scoringGeneration,
        weightProfile,
        current,
        previous,
        delta: comparison.delta,
        comparable: comparison.comparable,
        nonComparableReason: comparison.nonComparableReason,
      };
    }),
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

function projectDimensions(entry: TeamPerformanceRelativeDimensionSignal) {
  return entry.dimensions.map((dimension) => ({
    dimension: dimension.dimension,
    mean: dimension.mean,
    qualifiers: {
      limitedEvidence: dimension.qualifiers.limitedEvidence,
      concentrationWarning: dimension.qualifiers.concentrationWarning,
    },
  }));
}

function projectRelativeDimensionSignal(
  entry: TeamPerformanceRelativeDimensionSignal,
): TeamPerformanceRelativeDimensionSignal {
  const dimensions = projectDimensions(entry);
  const qualifiers = {
    limitedEvidence: entry.qualifiers.limitedEvidence,
    concentrationWarning: entry.qualifiers.concentrationWarning,
  };
  if (!entry.available) {
    return {
      scoringGeneration: entry.scoringGeneration,
      dimensions,
      qualifiers,
      available: false,
      relativePosition: null,
      reason: "incomplete_dimension_set",
      highestDimensions: [],
      lowestDimensions: [],
    };
  }
  if (entry.relativePosition === "balanced") {
    return {
      scoringGeneration: entry.scoringGeneration,
      dimensions,
      qualifiers,
      available: true,
      relativePosition: "balanced",
      reason: null,
      highestDimensions: [],
      lowestDimensions: [],
    };
  }
  return {
    scoringGeneration: entry.scoringGeneration,
    dimensions,
    qualifiers,
    available: true,
    relativePosition: "differentiated",
    reason: null,
    highestDimensions: entry.highestDimensions.map((dimension) => dimension),
    lowestDimensions: entry.lowestDimensions.map((dimension) => dimension),
  };
}

function projectSignals(
  signals: OrganizationPerformanceIntelligenceSignals,
): AuthorizedOrganizationPerformanceIntelligenceResult["signals"] {
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
    metricMovement: signals.metricMovement.map((entry) => {
      const weightProfile = projectWeightProfile(entry.weightProfile);
      const movement = projectMovement(entry.movement);
      const qualifiers = projectComparisonQualifiers(entry.qualifiers);
      if (weightProfile === undefined) {
        return {
          metric: entry.metric,
          scoringGeneration: entry.scoringGeneration,
          movement,
          qualifiers,
        };
      }
      return {
        metric: entry.metric,
        scoringGeneration: entry.scoringGeneration,
        weightProfile,
        movement,
        qualifiers,
      };
    }),
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

/** Route-safe composition boundary for current-members Organization facts and signals. */
export function queryAuthorizedOrganizationPerformanceIntelligence(
  query: AuthorizedOrganizationPerformanceIntelligenceQuery,
): AuthorizedOrganizationPerformanceIntelligenceResult {
  const facts = buildOrganizationPerformanceIntelligenceFacts({
    snapshot: query.snapshot,
    viewer: query.viewer,
    organizationId: query.organizationId,
    calendarMonth: query.calendarMonth,
  });
  const signals = deriveOrganizationPerformanceIntelligenceSignals({ facts, asOf: query.asOf });

  return {
    scope: "organization",
    populationBasis: "current_members",
    asOf: signals.monthCompleteness.asOf,
    currentMonth: {
      year: facts.currentMonth.year,
      month: facts.currentMonth.month,
      timeZone: facts.currentMonth.timeZone,
    },
    comparisonMonth: {
      year: facts.comparisonMonth.year,
      month: facts.comparisonMonth.month,
      timeZone: facts.comparisonMonth.timeZone,
    },
    population: {
      currentMemberCount: facts.population.currentMemberCount,
      hasCurrentMembers: facts.population.hasCurrentMembers,
    },
    facts: projectFacts(facts),
    signals: projectSignals(signals),
  };
}
