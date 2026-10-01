import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationPerformanceIntelligenceFacts } from "./organizationPerformanceIntelligenceFacts.js";
import type {
  TeamPerformanceIntelligenceCompletionPeriodFact,
  TeamPerformanceIntelligenceMetricComparison,
  TeamPerformanceIntelligenceMetricPeriodFact,
  TeamPerformanceIntelligenceNonComparableReason,
} from "./teamPerformanceIntelligenceFacts.js";
import {
  deriveOrganizationPerformanceIntelligenceSignals,
  OrganizationPerformanceIntelligenceSignalInputError,
} from "./organizationPerformanceIntelligenceSignals.js";

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
): OrganizationPerformanceIntelligenceFacts {
  return {
    scope: "organization",
    currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
    comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
    population: { currentMemberCount: 3, hasCurrentMembers: true },
    activity: {
      current: {
        attemptCount: 5,
        conclusiveAttemptCount: 4,
        evidenceStrength: LIMITED,
        concentrationWarning: true,
      },
      previous: {
        attemptCount: 3,
        conclusiveAttemptCount: 5,
        evidenceStrength: ESTABLISHED,
        concentrationWarning: false,
      },
      attemptDelta: 2,
      conclusiveAttemptDelta: -1,
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
  sourceFacts: OrganizationPerformanceIntelligenceFacts,
  asOf = COMPLETE_AS_OF,
) {
  return deriveOrganizationPerformanceIntelligenceSignals({ facts: sourceFacts, asOf });
}

test("month completeness uses only the explicit instant and following UTC boundary", () => {
  assert.equal(signals(facts(), new Date("2026-10-15T12:00:00.000Z")).monthCompleteness.complete, true);
  assert.equal(signals(facts(), new Date("2026-09-15T12:00:00.000Z")).monthCompleteness.complete, false);
  assert.deepEqual(signals(facts(), new Date("2026-10-01T00:00:00.000Z")).monthCompleteness, {
    complete: true,
    asOf: "2026-10-01T00:00:00.000Z",
    completesAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(
    signals(facts(), new Date("2026-09-30T18:00:00.000-06:00")).monthCompleteness.complete,
    true,
  );

  const decemberFacts: OrganizationPerformanceIntelligenceFacts = {
    ...facts(),
    currentMonth: { year: 2025, month: 12, timeZone: "UTC" },
    comparisonMonth: { year: 2025, month: 11, timeZone: "UTC" },
  };
  assert.deepEqual(
    signals(decemberFacts, new Date("2026-01-01T00:00:00.000Z")).monthCompleteness,
    {
      complete: true,
      asOf: "2026-01-01T00:00:00.000Z",
      completesAt: "2026-01-01T00:00:00.000Z",
    },
  );
  assert.throws(
    () => signals(facts(), new Date(Number.NaN)),
    OrganizationPerformanceIntelligenceSignalInputError,
  );
});

test("activity movement stays separate, honors partial months, and retains qualifiers", () => {
  const complete = signals(facts());
  assert.deepEqual(complete.activityMovement.attempts, {
    available: true,
    direction: "up",
    reason: null,
  });
  assert.deepEqual(complete.activityMovement.conclusiveAttempts, {
    available: true,
    direction: "down",
    reason: null,
  });
  assert.deepEqual(complete.activityMovement.qualifiers, {
    current: { limitedEvidence: true, concentrationWarning: true },
    previous: { limitedEvidence: false, concentrationWarning: false },
  });
  const incomplete = signals(facts(), new Date("2026-09-15T00:00:00.000Z"));
  assert.equal(incomplete.activityMovement.attempts.reason, "current_month_incomplete");
  assert.equal(incomplete.activityMovement.conclusiveAttempts.reason, "current_month_incomplete");
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

test("partial months suppress comparable movement while precise non-comparable reasons pass through", () => {
  const result = signals(facts([
    comparison({ metric: "persuasion", delta: 1 }),
    comparison({ metric: "clarity", current: null, reason: "incompatible_scoring_generation" }),
  ]), new Date("2026-09-30T23:59:59.999Z"));
  assert.equal(result.metricMovement[0]?.movement.reason, "current_month_incomplete");
  assert.equal(result.metricMovement[1]?.movement.reason, "incompatible_scoring_generation");
});

test("all fact-layer non-comparable reasons are preserved exactly", () => {
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
  assert.deepEqual(result.metricMovement.map((entry) => entry.movement.reason), reasons);
});

test("unknown, mismatched, and exact known profiles follow the fact decision without rechecking weights", () => {
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

test("relative core dimensions retain clear highs, ties, lows, and exclude /100 metrics", () => {
  const highTie = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 8 }),
    comparison({ metric: "empathy", current: 7 }),
    comparison({ metric: "assertiveness", current: 6 }),
    comparison({ metric: "communication", current: 99 }),
    comparison({ metric: "outcome", current: 1 }),
    comparison({ metric: "overall", current: 100 }),
  ])).relativeDimensions[0]!;
  assert.deepEqual(highTie.highestDimensions, ["persuasion", "clarity"]);
  assert.deepEqual(highTie.lowestDimensions, ["assertiveness"]);
  assert.equal(highTie.dimensions.length, 4);

  const lowTie = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 6 }),
    comparison({ metric: "assertiveness", current: 6 }),
  ])).relativeDimensions[0]!;
  assert.deepEqual(lowTie.highestDimensions, ["persuasion"]);
  assert.deepEqual(lowTie.lowestDimensions, ["empathy", "assertiveness"]);

  const clear = signals(facts([
    comparison({ metric: "persuasion", current: 8 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 6 }),
    comparison({ metric: "assertiveness", current: 5 }),
  ])).relativeDimensions[0]!;
  assert.deepEqual(clear.highestDimensions, ["persuasion"]);
  assert.deepEqual(clear.lowestDimensions, ["assertiveness"]);
});

test("balanced and incomplete dimension contracts preserve facts without misleading sets", () => {
  const balanced = signals(facts([
    comparison({ metric: "persuasion", current: 7 }),
    comparison({ metric: "clarity", current: 7 }),
    comparison({ metric: "empathy", current: 7 }),
    comparison({ metric: "assertiveness", current: 7 }),
  ])).relativeDimensions[0]!;
  assert.equal(balanced.relativePosition, "balanced");
  assert.deepEqual(balanced.highestDimensions, []);
  assert.deepEqual(balanced.lowestDimensions, []);
  assert.equal(balanced.dimensions.length, 4);

  const incomplete = signals(facts([
    comparison({ metric: "persuasion", current: 9 }),
    comparison({ metric: "clarity", current: 8 }),
    comparison({ metric: "empathy", current: 7 }),
  ])).relativeDimensions[0]!;
  assert.equal(incomplete.available, false);
  assert.equal(incomplete.reason, "incomplete_dimension_set");
  assert.equal(incomplete.dimensions.length, 3);
  assert.deepEqual(incomplete.highestDimensions, []);
  assert.deepEqual(incomplete.lowestDimensions, []);
});

test("limited evidence and concentration remain visible for a small organization", () => {
  const sourceFacts: OrganizationPerformanceIntelligenceFacts = {
    ...facts([comparison({ metric: "persuasion" })]),
    population: { currentMemberCount: 1, hasCurrentMembers: true },
  };
  const result = signals(sourceFacts);
  assert.deepEqual(result.population, { currentMemberCount: 1, hasCurrentMembers: true });
  assert.deepEqual(result.metricMovement[0]?.qualifiers.current, {
    limitedEvidence: true,
    concentrationWarning: true,
  });
  assert.equal(result.metricMovement[0]?.movement.available, true);
});

test("multiple scoring generations remain independent with no selected primary generation", () => {
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
  assert.equal("primaryGeneration" in result, false);
});

test("completion and objective rates move only when comparable and the month is complete", () => {
  const sourceFacts: OrganizationPerformanceIntelligenceFacts = {
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

test("scope states current-members analysis, Focus stays unavailable, and output is identity-free", () => {
  const result = signals(facts());
  assert.equal(result.scope, "organization");
  assert.equal(result.populationBasis, "current_members");
  assert.deepEqual(result.focus, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "userId",
    "subjectKey",
    "name",
    "email",
    "memberIds",
    "managerId",
    "sessionId",
    "scenarioId",
    "trainingId",
    "profileKey",
    "organization_history",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
