import assert from "node:assert/strict";
import test from "node:test";

import type {
  TeamPerformanceIntelligenceCompletionPeriodFact,
  TeamPerformanceIntelligenceFacts,
  TeamPerformanceIntelligenceMetricComparison,
  TeamPerformanceIntelligenceMetricPeriodFact,
  TeamPerformanceIntelligenceNonComparableReason,
} from "./teamPerformanceIntelligenceFacts.js";
import {
  deriveTeamPerformanceIntelligenceSignals,
  TeamPerformanceIntelligenceSignalInputError,
} from "./teamPerformanceIntelligenceSignals.js";

const COMPLETE_AS_OF = new Date("2026-10-01T00:00:00.000Z");
const LIMITED = { conservativeContributorCount: 1, limitedEvidence: true };
const ESTABLISHED = { conservativeContributorCount: 6, limitedEvidence: false };

function metricPeriod(
  mean: number,
  options: { limitedEvidence?: boolean; concentrationWarning?: boolean } = {},
): TeamPerformanceIntelligenceMetricPeriodFact {
  return {
    mean,
    observationCount: 2,
    evidenceStrength: options.limitedEvidence === false ? ESTABLISHED : LIMITED,
    concentrationWarning: options.concentrationWarning ?? true,
  };
}

function completionPeriod(rate: number): TeamPerformanceIntelligenceCompletionPeriodFact {
  return {
    availableObservationCount: 2,
    completeCount: rate === 1 ? 2 : 1,
    partialCount: rate === 1 ? 0 : 1,
    inconclusiveCount: 0,
    completionRate: rate,
    evidenceStrength: LIMITED,
    concentrationWarning: true,
  };
}

function comparison(params: {
  metric: TeamPerformanceIntelligenceMetricComparison["metric"];
  generation?: string;
  current?: number | null;
  previous?: number | null;
  delta?: number | null;
  reason?: TeamPerformanceIntelligenceNonComparableReason | null;
  weightProfile?: TeamPerformanceIntelligenceMetricComparison["weightProfile"];
  limitedEvidence?: boolean;
  concentrationWarning?: boolean;
}): TeamPerformanceIntelligenceMetricComparison {
  const current = params.current === null
    ? null
    : metricPeriod(params.current ?? 8, {
        limitedEvidence: params.limitedEvidence,
        concentrationWarning: params.concentrationWarning,
      });
  const previous = params.previous === null ? null : metricPeriod(params.previous ?? 7);
  const comparable = params.reason === undefined || params.reason === null;
  return {
    metric: params.metric,
    scoringGeneration: params.generation ?? "generation_a",
    ...(params.weightProfile === undefined ? {} : { weightProfile: params.weightProfile }),
    current,
    previous,
    delta: comparable ? (params.delta ?? (current!.mean - previous!.mean)) : null,
    comparable,
    nonComparableReason: params.reason ?? null,
  };
}

function facts(
  metricComparisons: readonly TeamPerformanceIntelligenceMetricComparison[] = [],
): TeamPerformanceIntelligenceFacts {
  return {
    scope: "team",
    currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
    comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
    population: { currentReportCount: 1, hasCurrentReports: true },
    activity: {
      current: {
        attemptCount: 5,
        conclusiveAttemptCount: 4,
        evidenceStrength: LIMITED,
        concentrationWarning: true,
      },
      previous: {
        attemptCount: 3,
        conclusiveAttemptCount: 4,
        evidenceStrength: ESTABLISHED,
        concentrationWarning: false,
      },
      attemptDelta: 2,
      conclusiveAttemptDelta: 0,
    },
    metricComparisons,
    completionComparisons: [],
    focusReadiness: {
      available: false,
      reason: "historical_focus_topic_mapping_unavailable",
    },
  };
}

function signals(
  sourceFacts: TeamPerformanceIntelligenceFacts,
  asOf = COMPLETE_AS_OF,
) {
  return deriveTeamPerformanceIntelligenceSignals({ facts: sourceFacts, asOf });
}

test("month completeness uses the explicit asOf instant and the following UTC month boundary", () => {
  assert.equal(signals(facts(), new Date("2026-10-15T12:00:00.000Z")).monthCompleteness.complete, true);
  assert.equal(signals(facts(), new Date("2026-09-15T12:00:00.000Z")).monthCompleteness.complete, false);

  const atBoundary = signals(facts(), new Date("2026-10-01T00:00:00.000Z"));
  assert.deepEqual(atBoundary.monthCompleteness, {
    complete: true,
    asOf: "2026-10-01T00:00:00.000Z",
    completesAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(
    signals(facts(), new Date("2026-09-30T18:00:00.000-06:00")).monthCompleteness.complete,
    true,
  );
  assert.throws(
    () => signals(facts(), new Date(Number.NaN)),
    TeamPerformanceIntelligenceSignalInputError,
  );
});

test("activity movement stays separate, directional only for complete months, and retains qualifiers", () => {
  const complete = signals(facts());
  assert.deepEqual(complete.activityMovement.attempts, {
    available: true,
    direction: "up",
    reason: null,
  });
  assert.deepEqual(complete.activityMovement.conclusiveAttempts, {
    available: true,
    direction: "unchanged",
    reason: null,
  });
  assert.deepEqual(complete.activityMovement.qualifiers, {
    current: { limitedEvidence: true, concentrationWarning: true },
    previous: { limitedEvidence: false, concentrationWarning: false },
  });

  const incomplete = signals(facts(), new Date("2026-09-15T00:00:00.000Z"));
  assert.deepEqual(incomplete.activityMovement.attempts, {
    available: false,
    direction: null,
    reason: "current_month_incomplete",
  });
});

test("complete-month metric deltas map exactly to up, down, and unchanged", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", delta: 0.00001 }),
    comparison({ metric: "clarity", delta: -0.00001 }),
    comparison({ metric: "empathy", delta: 0 }),
  ]));
  assert.deepEqual(
    result.metricMovement.map((entry) => entry.movement.direction),
    ["up", "down", "unchanged"],
  );
});

test("incomplete months suppress compatible movement while non-comparable reasons remain precise", () => {
  const incomplete = signals(facts([
    comparison({ metric: "persuasion", delta: 1 }),
    comparison({
      metric: "clarity",
      current: null,
      reason: "incompatible_scoring_generation",
    }),
  ]), new Date("2026-09-30T23:59:59.999Z"));

  assert.equal(incomplete.metricMovement[0]?.movement.reason, "current_month_incomplete");
  assert.equal(incomplete.metricMovement[1]?.movement.reason, "incompatible_scoring_generation");
});

test("metric movement trusts Slice 4A unknown, mismatched, and exact weight-profile decisions", () => {
  const known = {
    kind: "known" as const,
    weights: { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 },
  };
  const result = signals(facts([
    comparison({ metric: "communication", reason: "unknown_weight_profile", weightProfile: { kind: "unknown" } }),
    comparison({ metric: "overall", reason: "incompatible_weight_profile", weightProfile: known }),
    comparison({ metric: "communication", delta: 1, weightProfile: known }),
  ]));

  assert.equal(result.metricMovement[0]?.movement.reason, "unknown_weight_profile");
  assert.equal(result.metricMovement[1]?.movement.reason, "incompatible_weight_profile");
  assert.equal(result.metricMovement[2]?.movement.direction, "up");
  assert.deepEqual(result.metricMovement[2]?.weightProfile, known);
});

test("every Slice 4A non-comparable reason is carried forward unchanged", () => {
  const reasons: readonly TeamPerformanceIntelligenceNonComparableReason[] = [
    "no_current_evidence",
    "no_previous_evidence",
    "incompatible_scoring_generation",
    "incompatible_weight_profile",
    "unknown_weight_profile",
    "metric_unavailable",
  ];
  const result = signals(facts(reasons.map((reason) => comparison({
    metric: "communication",
    current: null,
    reason,
  }))));

  assert.deepEqual(
    result.metricMovement.map((entry) => entry.movement.reason),
    reasons,
  );
});

test("relative dimensions retain high ties and exclude /100 metrics", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 8 }),
    comparison({ metric: "empathy", current: 7 }),
    comparison({ metric: "assertiveness", current: 6 }),
    comparison({ metric: "communication", current: 99 }),
    comparison({ metric: "outcome", current: 1 }),
    comparison({ metric: "overall", current: 100 }),
  ])).relativeDimensions[0]!;

  assert.equal(result.available, true);
  assert.equal(result.relativePosition, "differentiated");
  assert.deepEqual(result.highestDimensions, ["persuasion", "clarity"]);
  assert.deepEqual(result.lowestDimensions, ["assertiveness"]);
  assert.equal(result.dimensions.length, 4);
});

test("relative dimensions retain low ties", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 6 }),
    comparison({ metric: "assertiveness", current: 6 }),
  ])).relativeDimensions[0]!;

  assert.equal(result.relativePosition, "differentiated");
  assert.deepEqual(result.highestDimensions, ["persuasion"]);
  assert.deepEqual(result.lowestDimensions, ["empathy", "assertiveness"]);
});

test("relative dimensions retain a single clear high and low", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 6 }),
    comparison({ metric: "assertiveness", current: 5 }),
  ])).relativeDimensions[0]!;

  assert.equal(result.relativePosition, "differentiated");
  assert.deepEqual(result.highestDimensions, ["persuasion"]);
  assert.deepEqual(result.lowestDimensions, ["assertiveness"]);
});

test("one-report all-equal dimensions are balanced with facts and qualifiers but no high or low", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", current: 7 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 7 }),
    comparison({ metric: "assertiveness", current: 7 }),
  ])).relativeDimensions[0]!;

  assert.equal(result.relativePosition, "balanced");
  assert.deepEqual(result.highestDimensions, []);
  assert.deepEqual(result.lowestDimensions, []);
  assert.deepEqual(result.dimensions.map(({ dimension, mean }) => ({ dimension, mean })), [
    { dimension: "persuasion", mean: 7 },
    { dimension: "clarity", mean: 7 },
    { dimension: "empathy", mean: 7 },
    { dimension: "assertiveness", mean: 7 },
  ]);
  assert.deepEqual(result.qualifiers, {
    limitedEvidence: true,
    concentrationWarning: true,
  });
});

test("incomplete dimension sets preserve available values but emit no high or low", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", current: 9 }),
    comparison({ metric: "clarity", current: 8 }),
    comparison({ metric: "empathy", current: 7 }),
  ])).relativeDimensions[0]!;

  assert.deepEqual(result, {
    scoringGeneration: "generation_a",
    available: false,
    relativePosition: null,
    reason: "incomplete_dimension_set",
    dimensions: [
      { dimension: "persuasion", mean: 9, qualifiers: { limitedEvidence: true, concentrationWarning: true } },
      { dimension: "clarity", mean: 8, qualifiers: { limitedEvidence: true, concentrationWarning: true } },
      { dimension: "empathy", mean: 7, qualifiers: { limitedEvidence: true, concentrationWarning: true } },
    ],
    highestDimensions: [],
    lowestDimensions: [],
    qualifiers: { limitedEvidence: true, concentrationWarning: true },
  });
});

test("limited evidence and concentration remain visible for a one-report team", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", limitedEvidence: true, concentrationWarning: true }),
  ]));

  assert.deepEqual(result.population, { currentReportCount: 1, hasCurrentReports: true });
  assert.deepEqual(result.metricMovement[0]?.qualifiers.current, {
    limitedEvidence: true,
    concentrationWarning: true,
  });
  assert.equal(result.metricMovement[0]?.movement.available, true);
});

test("relative positions remain independent across scoring generations", () => {
  const comparisons = ["persuasion", "clarity", "empathy", "assertiveness"].flatMap((metric, index) => [
    comparison({
      metric: metric as TeamPerformanceIntelligenceMetricComparison["metric"],
      generation: "generation_a",
      current: index + 1,
    }),
    comparison({
      metric: metric as TeamPerformanceIntelligenceMetricComparison["metric"],
      generation: "generation_b",
      current: 4 - index,
    }),
  ]);
  const result = signals(facts(comparisons));

  assert.equal(result.relativeDimensions.length, 2);
  assert.deepEqual(result.relativeDimensions[0]?.highestDimensions, ["assertiveness"]);
  assert.deepEqual(result.relativeDimensions[1]?.highestDimensions, ["persuasion"]);
  assert.equal(result.metricMovement.every((entry) => entry.scoringGeneration !== ""), true);
});

test("completion and objective rates require both Slice 4A comparability and a complete month", () => {
  const sourceFacts: TeamPerformanceIntelligenceFacts = {
    ...facts(),
    completionComparisons: [{
      scoringGeneration: "generation_a",
      completion: {
        current: completionPeriod(1),
        previous: completionPeriod(0.5),
        delta: 0.5,
        comparable: true,
        nonComparableReason: null,
      },
      objective: {
        current: {
          availableObservationCount: 2,
          achievedCount: 1,
          objectiveAchievementRate: 0.5,
          evidenceStrength: LIMITED,
          concentrationWarning: true,
        },
        previous: {
          availableObservationCount: 2,
          achievedCount: 2,
          objectiveAchievementRate: 1,
          evidenceStrength: ESTABLISHED,
          concentrationWarning: false,
        },
        delta: -0.5,
        comparable: true,
        nonComparableReason: null,
      },
    }],
  };

  const complete = signals(sourceFacts).completionMovement[0]!;
  assert.equal(complete.completion.movement.direction, "up");
  assert.equal(complete.objective.movement.direction, "down");
  const incomplete = signals(sourceFacts, new Date("2026-09-15T00:00:00.000Z"));
  assert.equal(incomplete.completionMovement[0]?.completion.movement.reason, "current_month_incomplete");
  assert.equal(incomplete.completionMovement[0]?.objective.movement.reason, "current_month_incomplete");
});

test("output is identity-free and Focus Topic readiness remains unavailable", () => {
  const result = signals(facts());
  assert.deepEqual(result.focus, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });
  const serialized = JSON.stringify(result);
  for (const identityKey of ["userId", "managerUserId", "organizationId", "orgId"]) {
    assert.equal(serialized.includes(identityKey), false);
  }
});
