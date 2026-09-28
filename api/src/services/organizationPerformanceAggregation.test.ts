import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";
import {
  aggregateOrganizationPerformance,
  OrganizationPerformanceAggregationInputError,
  type OrganizationPerformanceMetric,
} from "./organizationPerformanceAggregation.js";

const MONTH = { year: 2026, month: 9 } as const;
const KNOWN_WEIGHTS_A = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
const KNOWN_WEIGHTS_B = { persuasion: 0.1, clarity: 0.2, empathy: 0.3, assertiveness: 0.4 };

function candidate(overrides: Partial<OrganizationEvidenceCandidate> & {
  subjectKind?: "user" | "deidentified";
  subjectKey?: string;
} = {}): OrganizationEvidenceCandidate {
  const subjectKind = overrides.subjectKind ?? "user";
  const base = {
    orgId: "org_a",
    divisionId: "division_a",
    scenarioId: "scenario_a",
    trainingId: "training_a",
    evidenceAt: "2026-09-15T12:00:00.000Z",
    recordEra: "outcome_aware" as const,
    scoringGeneration: "generation_a",
    metricAvailability: {
      overall: true, communication: true, outcome: true, persuasion: true, clarity: true,
      empathy: true, assertiveness: true, completion: true, objective: true,
    },
    scoringWeightsApplied: KNOWN_WEIGHTS_A,
    overallScore: 80,
    communicationScore: 80,
    outcomeScore: 80,
    persuasion: 8,
    clarity: 8,
    empathy: 8,
    assertiveness: 8,
    completionLevel: "complete" as const,
    objectiveAchieved: true,
    ...overrides,
  };
  if (subjectKind === "deidentified") {
    const { subjectKey: _subjectKey, ...withoutSubjectKey } = base;
    return { ...withoutSubjectKey, subjectKind: "deidentified" };
  }
  return { ...base, subjectKind: "user", subjectKey: overrides.subjectKey ?? "subject_a" };
}

function aggregate(candidates: readonly OrganizationEvidenceCandidate[], extras: Record<string, unknown> = {}) {
  return aggregateOrganizationPerformance({ candidates, calendarMonth: MONTH, ...extras });
}

function metric(
  result: ReturnType<typeof aggregateOrganizationPerformance>,
  name: OrganizationPerformanceMetric,
  generation = "generation_a",
) {
  return result.metricGroups.filter((group) => group.metric === name && group.scoringGeneration === generation);
}

test("UTC calendar month includes its first instant and excludes the next month", () => {
  const result = aggregate([
    candidate({ evidenceAt: "2026-08-31T23:59:59.999Z" }),
    candidate({ evidenceAt: "2026-09-01T00:00:00.000Z", subjectKey: "first" }),
    candidate({ evidenceAt: "2026-09-30T23:59:59.999Z", subjectKey: "last" }),
    candidate({ evidenceAt: "2026-10-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(result.calendarMonth, { year: 2026, month: 9, timeZone: "UTC" });
  assert.equal(result.activity.attemptCount, 2);
});

test("December includes its final UTC instant and excludes January rollover", () => {
  const result = aggregateOrganizationPerformance({
    candidates: [
      candidate({ evidenceAt: "2026-12-31T23:59:59.999Z", subjectKey: "december" }),
      candidate({ evidenceAt: "2027-01-01T00:00:00.000Z", subjectKey: "january" }),
    ],
    calendarMonth: { year: 2026, month: 12 },
  });
  assert.equal(result.activity.attemptCount, 1);
});

test("rejects invalid months, invalid dimensions, and arbitrary date windows", () => {
  for (const input of [
    { candidates: [], calendarMonth: { year: 1969, month: 9 } },
    { candidates: [], calendarMonth: { year: 2026, month: 0 } },
    { candidates: [], calendarMonth: { year: 2026, month: 13 } },
    { candidates: [], calendarMonth: MONTH, dimensionFilter: { dimension: "person", id: "x" } },
    { candidates: [], calendarMonth: MONTH, dimensionFilter: { dimension: "training", id: " " } },
    { candidates: [], calendarMonth: MONTH, evidenceAtFrom: "2026-09-01T00:00:00.000Z" },
    { candidates: [], calendarMonth: MONTH, evidenceAtBefore: "2026-10-01T00:00:00.000Z" },
    { candidates: [], calendarMonth: MONTH, startAt: "2026-09-01T00:00:00.000Z" },
    { candidates: [], calendarMonth: MONTH, endAt: "2026-10-01T00:00:00.000Z" },
    { candidates: [], calendarMonth: MONTH, dimensionFilter: null },
  ]) {
    assert.throws(
      () => aggregateOrganizationPerformance(input as Parameters<typeof aggregateOrganizationPerformance>[0]),
      OrganizationPerformanceAggregationInputError,
    );
  }
});

test("activity retains partial and inconclusive attempts while means remain conclusive only", () => {
  const result = aggregate([
    candidate({ overallScore: 90, persuasion: 9, subjectKey: "complete" }),
    candidate({ overallScore: 10, persuasion: 1, completionLevel: "partial", objectiveAchieved: false, subjectKey: "partial" }),
    candidate({ overallScore: 20, persuasion: 2, completionLevel: "inconclusive", objectiveAchieved: false, subjectKey: "inconclusive" }),
  ]);
  assert.equal(result.activity.attemptCount, 3);
  assert.equal(result.activity.conclusiveAttemptCount, 1);
  const completion = result.completionGroups[0]!.completion;
  assert.deepEqual(
    { complete: completion.completeCount, partial: completion.partialCount, inconclusive: completion.inconclusiveCount },
    { complete: 1, partial: 1, inconclusive: 1 },
  );
  assert.equal(metric(result, "overall")[0]?.mean, 90);
  assert.equal(metric(result, "persuasion")[0]?.mean, 9);
});

test("metric availability controls denominators without zero-filling legacy rows", () => {
  const result = aggregate([
    candidate({ subjectKey: "modern", outcomeScore: 80 }),
    candidate({
      subjectKey: "legacy", recordEra: "legacy_sparse", scoringGeneration: "legacy_generation",
      communicationScore: undefined, outcomeScore: undefined, completionLevel: undefined,
      objectiveAchieved: undefined, scoringWeightsApplied: undefined,
      metricAvailability: {
        overall: true, communication: false, outcome: false, persuasion: true, clarity: true,
        empathy: true, assertiveness: true, completion: false, objective: false,
      },
    }),
  ]);
  assert.equal(metric(result, "outcome")[0]?.qualifyingObservationCount, 1);
  assert.deepEqual(metric(result, "outcome", "legacy_generation"), []);
  assert.equal(metric(result, "communication", "legacy_generation").length, 0);
  assert.equal(metric(result, "overall", "legacy_generation")[0]?.qualifyingObservationCount, 1);
});

test("dimension metrics are session weighted and generation aware", () => {
  const result = aggregate([
    candidate({ subjectKey: "one", persuasion: 4 }),
    candidate({ subjectKey: "one", persuasion: 8 }),
    candidate({ subjectKey: "two", persuasion: 6 }),
    candidate({ subjectKey: "old", persuasion: 2, scoringGeneration: "generation_b" }),
  ]);
  assert.equal(metric(result, "persuasion")[0]?.mean, 6);
  assert.equal(metric(result, "persuasion")[0]?.qualifyingObservationCount, 3);
  assert.equal(metric(result, "persuasion", "generation_b")[0]?.mean, 2);
});

test("composites group by generation and exact known or unknown weight profile", () => {
  const result = aggregate([
    candidate({ subjectKey: "a", overallScore: 60, communicationScore: 70, scoringWeightsApplied: KNOWN_WEIGHTS_A }),
    candidate({ subjectKey: "b", overallScore: 80, communicationScore: 90, scoringWeightsApplied: KNOWN_WEIGHTS_A }),
    candidate({ subjectKey: "c", overallScore: 40, communicationScore: 50, scoringWeightsApplied: KNOWN_WEIGHTS_B }),
    candidate({ subjectKey: "d", overallScore: 30, communicationScore: 40, scoringWeightsApplied: undefined }),
    candidate({ subjectKey: "e", overallScore: 20, communicationScore: 30, scoringGeneration: "generation_b", scoringWeightsApplied: KNOWN_WEIGHTS_A }),
  ]);
  const overallA = metric(result, "overall");
  assert.equal(overallA.length, 3);
  assert.deepEqual(overallA.map((group) => group.mean), [40, 70, 30]);
  assert.deepEqual(overallA.map((group) => group.qualifyingObservationCount), [1, 2, 1]);
  assert.deepEqual(overallA.map((group) => group.weightProfile), [
    { kind: "known", profileKey: "known:100000000:200000000:300000000:400000000", weights: KNOWN_WEIGHTS_B },
    { kind: "known", profileKey: "known:400000000:300000000:200000000:100000000", weights: KNOWN_WEIGHTS_A },
    { kind: "unknown", profileKey: "unknown" },
  ]);
  assert.equal(metric(result, "overall", "generation_b")[0]?.mean, 20);
  assert.deepEqual(metric(result, "communication").map((group) => group.mean), [50, 80, 40]);
});

test("canonicalizes equivalent floating-point profiles while retaining materially different profiles", () => {
  const result = aggregate([
    candidate({ subjectKey: "exact", overallScore: 60, scoringWeightsApplied: KNOWN_WEIGHTS_A }),
    candidate({
      subjectKey: "nearby", overallScore: 80,
      scoringWeightsApplied: { persuasion: 0.4000000000000001, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 },
    }),
    candidate({ subjectKey: "different", overallScore: 40, scoringWeightsApplied: KNOWN_WEIGHTS_B }),
  ]);
  const groups = metric(result, "overall");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.mean), [40, 70]);
  assert.equal(groups[1]?.weightProfile?.profileKey, "known:400000000:300000000:200000000:100000000");
  assert.notEqual(groups[0]?.weightProfile?.profileKey, groups[1]?.weightProfile?.profileKey);
});

test("conservative contributors count known subjects distinctly and all deidentified rows once", () => {
  const result = aggregate([
    candidate({ subjectKey: "a" }), candidate({ subjectKey: "a" }), candidate({ subjectKey: "b" }),
    candidate({ subjectKind: "deidentified" }), candidate({ subjectKind: "deidentified" }), candidate({ subjectKind: "deidentified" }),
  ]);
  assert.equal(result.activity.evidenceStrength.conservativeContributorCount, 3);
  assert.equal(metric(result, "persuasion")[0]?.evidenceStrength.conservativeContributorCount, 3);
});

test("limited evidence never suppresses numeric results and clears only with enough evidence", () => {
  const low = aggregate([candidate({ overallScore: 73 })]);
  assert.equal(metric(low, "overall")[0]?.mean, 73);
  assert.equal(metric(low, "overall")[0]?.evidenceStrength.limitedEvidence, true);

  const fiveContributorsNineRows = Array.from({ length: 9 }, (_, index) =>
    candidate({ subjectKey: `subject_${index % 5}`, overallScore: 70 + index }));
  const observationLimited = aggregate(fiveContributorsNineRows);
  assert.equal(metric(observationLimited, "overall")[0]?.evidenceStrength.limitedEvidence, true);
  assert.ok(metric(observationLimited, "overall")[0]?.mean !== undefined);

  const contributorLimited = aggregate(Array.from({ length: 10 }, (_, index) =>
    candidate({ subjectKey: `subject_${index % 4}`, overallScore: 70 + index })));
  assert.equal(metric(contributorLimited, "overall")[0]?.evidenceStrength.limitedEvidence, true);

  const enough = aggregate(Array.from({ length: 10 }, (_, index) =>
    candidate({ subjectKey: `subject_${index % 5}`, overallScore: 70 + index })));
  assert.equal(metric(enough, "overall")[0]?.evidenceStrength.limitedEvidence, false);
});

test("completion and objective concentration use their own denominator populations", () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    if (index < 94) {
      return candidate({
        subjectKey: "completion_power",
        metricAvailability: {
          overall: true, communication: true, outcome: true, persuasion: true, clarity: true,
          empathy: true, assertiveness: true, completion: true, objective: false,
        },
      });
    }
    return candidate({
      subjectKey: index < 98 ? "objective_power" : `objective_other_${index}`,
      metricAvailability: {
        overall: true, communication: true, outcome: true, persuasion: true, clarity: true,
        empathy: true, assertiveness: true, completion: false, objective: true,
      },
    });
  });
  const group = aggregate(rows).completionGroups[0]!;
  assert.equal(group.completion.availableObservationCount, 94);
  assert.deepEqual(group.completion.concentration, { largestContributionShare: 1, concentrationWarning: true });
  assert.equal(group.objective.availableObservationCount, 6);
  assert.deepEqual(group.objective.concentration, { largestContributionShare: 4 / 6, concentrationWarning: true });
  assert.equal(group.completion.completionRate, 1);
  assert.equal(group.objective.objectiveAchievementRate, 1);
});

test("group evidence strength uses each metric's qualifying population", () => {
  const rows = Array.from({ length: 100 }, (_, index) => candidate({
    subjectKey: `subject_${index % 5}`,
    outcomeScore: index < 6 ? 80 : undefined,
    metricAvailability: {
      overall: true, communication: true, outcome: index < 6, persuasion: true, clarity: true,
      empathy: true, assertiveness: true, completion: true, objective: true,
    },
  }));
  const outcome = metric(aggregate(rows), "outcome")[0]!;
  assert.equal(outcome.qualifyingObservationCount, 6);
  assert.equal(outcome.evidenceStrength.limitedEvidence, true);
});

test("complete objective-false evidence remains conclusive but lowers only objective achievement", () => {
  const result = aggregate([candidate({ overallScore: 91, completionLevel: "complete", objectiveAchieved: false })]);
  assert.equal(result.activity.conclusiveAttemptCount, 1);
  assert.equal(metric(result, "overall")[0]?.mean, 91);
  const group = result.completionGroups[0]!;
  assert.equal(group.completion.completeCount, 1);
  assert.equal(group.objective.availableObservationCount, 1);
  assert.equal(group.objective.achievedCount, 0);
  assert.equal(group.objective.objectiveAchievementRate, 0);
});

test("concentration warns only above forty percent and retains the aggregate", () => {
  const exactly = aggregate([
    candidate({ subjectKey: "power", persuasion: 5 }), candidate({ subjectKey: "power", persuasion: 5 }),
    candidate({ subjectKey: "a", persuasion: 5 }), candidate({ subjectKey: "b", persuasion: 5 }), candidate({ subjectKey: "c", persuasion: 5 }),
  ]);
  assert.deepEqual(metric(exactly, "persuasion")[0]?.concentration, {
    largestContributionShare: 0.4, concentrationWarning: false,
  });
  assert.deepEqual(exactly.activity.concentration, { largestContributionShare: 0.4, concentrationWarning: false });

  const above = aggregate([
    candidate({ subjectKey: "power", persuasion: 9 }), candidate({ subjectKey: "power", persuasion: 9 }), candidate({ subjectKey: "power", persuasion: 9 }),
    candidate({ subjectKey: "a", persuasion: 4 }), candidate({ subjectKey: "b", persuasion: 4 }),
  ]);
  assert.equal(metric(above, "persuasion")[0]?.mean, 7);
  assert.deepEqual(metric(above, "persuasion")[0]?.concentration, {
    largestContributionShare: 0.6, concentrationWarning: true,
  });
  assert.deepEqual(above.activity.concentration, { largestContributionShare: 0.6, concentrationWarning: true });

  const deidentified = aggregate([
    candidate({ subjectKind: "deidentified" }), candidate({ subjectKind: "deidentified" }), candidate({ subjectKind: "deidentified" }),
    candidate({ subjectKey: "a" }), candidate({ subjectKey: "b" }),
  ]);
  assert.deepEqual(metric(deidentified, "persuasion")[0]?.concentration, {
    largestContributionShare: 0.6, concentrationWarning: true,
  });
  assert.deepEqual(deidentified.activity.concentration, { largestContributionShare: 0.6, concentrationWarning: true });
});

test("completion and objective rates use only available values within each generation", () => {
  const result = aggregate([
    candidate({ subjectKey: "complete_yes", completionLevel: "complete", objectiveAchieved: true }),
    candidate({ subjectKey: "partial_no", completionLevel: "partial", objectiveAchieved: false }),
    candidate({
      subjectKey: "legacy", scoringGeneration: "legacy_generation", recordEra: "legacy_sparse",
      completionLevel: undefined, objectiveAchieved: undefined, scoringWeightsApplied: undefined,
      metricAvailability: {
        overall: true, communication: false, outcome: false, persuasion: true, clarity: true,
        empathy: true, assertiveness: true, completion: false, objective: false,
      },
    }),
  ]);
  const modern = result.completionGroups.find((group) => group.scoringGeneration === "generation_a")!;
  assert.equal(modern.completion.availableObservationCount, 2);
  assert.equal(modern.completion.completionRate, 0.5);
  assert.equal(modern.objective.availableObservationCount, 2);
  assert.equal(modern.objective.objectiveAchievementRate, 0.5);
  const legacy = result.completionGroups.find((group) => group.scoringGeneration === "legacy_generation")!;
  assert.equal(legacy.completion.availableObservationCount, 0);
  assert.equal(legacy.completion.completionRate, null);
  assert.equal(legacy.objective.availableObservationCount, 0);
  assert.equal(legacy.objective.objectiveAchievementRate, null);
});

test("supports one exact historical dimension filter without inferring missing IDs", () => {
  const rows = [
    candidate({ overallScore: 10, divisionId: "d1", scenarioId: "s1", trainingId: "t1" }),
    candidate({ overallScore: 20, divisionId: "d2", scenarioId: "s2", trainingId: "t2" }),
    candidate({ overallScore: 30, divisionId: undefined, scenarioId: "s1", trainingId: undefined }),
  ];
  assert.equal(metric(aggregate(rows, { dimensionFilter: { dimension: "division", id: "d1" } }), "overall")[0]?.mean, 10);
  assert.equal(metric(aggregate(rows, { dimensionFilter: { dimension: "scenario", id: "s1" } }), "overall")[0]?.mean, 20);
  assert.equal(metric(aggregate(rows, { dimensionFilter: { dimension: "training", id: "t2" } }), "overall")[0]?.mean, 20);
  assert.equal(aggregate(rows, { dimensionFilter: { dimension: "division", id: "missing" } }).activity.attemptCount, 0);
  assert.equal(aggregate(rows, { dimensionFilter: { dimension: "training", id: "missing" } }).activity.attemptCount, 0);
});

test("output is deterministic and contains no candidate identity or exact timestamp data", () => {
  const rows = [
    candidate({ subjectKey: "moved-user-secret", scoringGeneration: "z_generation", scoringWeightsApplied: KNOWN_WEIGHTS_B }),
    candidate({ subjectKind: "deidentified", scoringGeneration: "a_generation", scoringWeightsApplied: undefined }),
    candidate({ subjectKey: "current-user-secret", scoringGeneration: "a_generation", scoringWeightsApplied: KNOWN_WEIGHTS_A }),
  ];
  const first = aggregate(rows);
  const second = aggregate([...rows].reverse());
  assert.deepEqual(second, first);
  const serialized = JSON.stringify(first);
  for (const forbidden of [
    "subjectKey", "userId", "evidenceId", "simulationSessionId", "evidenceAt",
    "moved-user-secret", "current-user-secret", "2026-09-15T12:00:00.000Z",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(first).sort(), [
    "activity", "calendarMonth", "completionGroups", "dimensionFilter",
    "historicalPrivacyAdjustmentApplied", "metricGroups",
  ]);
  assert.deepEqual(Object.keys(first.activity).sort(), [
    "attemptCount", "concentration", "conclusiveAttemptCount", "evidenceStrength",
    "historicalPrivacyAdjustmentApplied",
  ]);
  assert.deepEqual(Object.keys(first.calendarMonth).sort(), ["month", "timeZone", "year"]);
  assert.deepEqual(Object.keys(first.activity.evidenceStrength).sort(), ["conservativeContributorCount", "limitedEvidence"]);
  assert.deepEqual(Object.keys(first.completionGroups[0]!).sort(), ["completion", "objective", "scoringGeneration"]);
  assert.deepEqual(Object.keys(first.completionGroups[0]!.completion).sort(), [
    "availableObservationCount", "completeCount", "completionRate", "concentration", "evidenceStrength",
    "historicalPrivacyAdjustmentApplied", "inconclusiveCount", "partialCount",
  ]);
  assert.deepEqual(Object.keys(first.completionGroups[0]!.objective).sort(), [
    "achievedCount", "availableObservationCount", "concentration", "evidenceStrength",
    "historicalPrivacyAdjustmentApplied", "objectiveAchievementRate",
  ]);
  assert.deepEqual(Object.keys(first.metricGroups[0]!).sort(), [
    "concentration", "evidenceStrength", "historicalPrivacyAdjustmentApplied", "mean", "metric",
    "qualifyingObservationCount", "scoringGeneration", "weightProfile",
  ]);
  assert.deepEqual(Object.keys(first.metricGroups[0]!.concentration).sort(), ["concentrationWarning", "largestContributionShare"]);
});
