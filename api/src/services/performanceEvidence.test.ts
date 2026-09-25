import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationScoreRecord } from "@voicepractice/shared";

import {
  annotateDuplicateSimulationSessionConflict,
  detectDuplicateSimulationSessionConflicts,
  isPerformanceEvidenceQuarantined,
  LEGACY_UNVERSIONED_SCORING_GENERATION,
  normalizePerformanceEvidenceBatch,
  normalizePerformanceEvidence,
  PERFORMANCE_EVIDENCE_EXTREME_BACKDATING_TOLERANCE_MS,
  UNVERSIONED_OUTCOME_AWARE_SCORING_GENERATION,
} from "./performanceEvidence.js";
import { SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS } from "./simulationSessionLifecycle.js";

const DEFAULT_WEIGHTS = {
  persuasion: 0.25,
  clarity: 0.25,
  empathy: 0.25,
  assertiveness: 0.25,
} as const;

function modernScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_current",
    simulationSessionId: Object.hasOwn(overrides, "simulationSessionId")
      ? overrides.simulationSessionId
      : "sim_current",
    userId: overrides.userId ?? "user_current",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? null : "org_current",
    divisionId: overrides.divisionId,
    segmentId: overrides.segmentId ?? "segment_current",
    scenarioId: overrides.scenarioId ?? "scenario_current",
    trainingId: Object.hasOwn(overrides, "trainingId") ? overrides.trainingId : "training_current",
    trainingPackId: overrides.trainingPackId,
    industryId: overrides.industryId,
    startedAt: overrides.startedAt ?? "2026-09-24T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-09-24T10:05:00.000Z",
    communicationScore: Object.hasOwn(overrides, "communicationScore")
      ? overrides.communicationScore
      : 80,
    outcomeScore: Object.hasOwn(overrides, "outcomeScore") ? overrides.outcomeScore : 70,
    overallScore: overrides.overallScore ?? 77,
    completionLevel: Object.hasOwn(overrides, "completionLevel")
      ? overrides.completionLevel
      : "complete",
    objectiveAchieved: Object.hasOwn(overrides, "objectiveAchieved")
      ? overrides.objectiveAchieved
      : true,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    summary: "Presentation-only summary",
    normalizedCoachingThemes: {
      strengths: [{ id: "clarity", label: "Clarity" }],
      improvementAreas: [],
      coachingPriority: null,
    },
    rubricVersion: Object.hasOwn(overrides, "rubricVersion")
      ? overrides.rubricVersion
      : "2026-04-09.v1",
    promptVersion: Object.hasOwn(overrides, "promptVersion")
      ? overrides.promptVersion
      : "2026-04-09.v1",
    model: Object.hasOwn(overrides, "model") ? overrides.model : "gpt-score",
    scoringWeightsApplied: Object.hasOwn(overrides, "scoringWeightsApplied")
      ? overrides.scoringWeightsApplied
      : DEFAULT_WEIGHTS,
    createdAt: overrides.createdAt ?? "2026-09-24T10:05:30.000Z",
  };
}

function legacyScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_legacy",
    userId: overrides.userId ?? "user_legacy",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? null : "org_legacy",
    segmentId: overrides.segmentId ?? "segment_legacy",
    scenarioId: overrides.scenarioId ?? "scenario_legacy",
    startedAt: overrides.startedAt ?? "2026-03-01T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-01T10:05:00.000Z",
    communicationScore: overrides.communicationScore,
    outcomeScore: overrides.outcomeScore,
    overallScore: overrides.overallScore ?? 74,
    completionLevel: overrides.completionLevel,
    objectiveAchieved: overrides.objectiveAchieved,
    persuasion: overrides.persuasion ?? 7,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 7,
    assertiveness: overrides.assertiveness ?? 8,
    rubricVersion: overrides.rubricVersion,
    promptVersion: overrides.promptVersion,
    model: overrides.model,
    createdAt: overrides.createdAt ?? "2026-03-01T10:05:30.000Z",
  };
}

function accepted(record: SimulationScoreRecord) {
  const result = normalizePerformanceEvidence(record);
  assert.equal(result.status, "accepted", JSON.stringify(result));
  return result.evidence;
}

function acceptedBatchEvidence(
  result: ReturnType<typeof normalizePerformanceEvidenceBatch>,
  index: number,
) {
  const normalized = result.results[index];
  assert.ok(normalized, `missing batch result at index ${index}`);
  assert.equal(normalized.status, "accepted", JSON.stringify(normalized));
  if (normalized.status !== "accepted") {
    throw new Error("Expected accepted batch evidence");
  }
  return normalized.evidence;
}

test("normalizes a full current score without qualitative or token payloads", () => {
  const evidence = accepted(modernScore());

  assert.equal(evidence.recordEra, "outcome_aware");
  assert.equal(evidence.scoringGeneration, "2026-04-09.v1");
  assert.deepEqual(
    {
      overallScore: evidence.overallScore,
      communicationScore: evidence.communicationScore,
      outcomeScore: evidence.outcomeScore,
      persuasion: evidence.persuasion,
      clarity: evidence.clarity,
      empathy: evidence.empathy,
      assertiveness: evidence.assertiveness,
      completionLevel: evidence.completionLevel,
      objectiveAchieved: evidence.objectiveAchieved,
    },
    {
      overallScore: 77,
      communicationScore: 80,
      outcomeScore: 70,
      persuasion: 8,
      clarity: 8,
      empathy: 8,
      assertiveness: 8,
      completionLevel: "complete",
      objectiveAchieved: true,
    },
  );
  assert.deepEqual(
    {
      evidenceId: evidence.evidenceId,
      simulationSessionId: evidence.simulationSessionId,
      userId: evidence.userId,
      orgId: evidence.orgId,
      segmentId: evidence.segmentId,
      scenarioId: evidence.scenarioId,
      trainingId: evidence.trainingId,
      rubricVersion: evidence.rubricVersion,
      promptVersion: evidence.promptVersion,
      model: evidence.model,
    },
    {
      evidenceId: "score_current",
      simulationSessionId: "sim_current",
      userId: "user_current",
      orgId: "org_current",
      segmentId: "segment_current",
      scenarioId: "scenario_current",
      trainingId: "training_current",
      rubricVersion: "2026-04-09.v1",
      promptVersion: "2026-04-09.v1",
      model: "gpt-score",
    },
  );
  assert.deepEqual(evidence.metricAvailability, {
    overall: true,
    communication: true,
    outcome: true,
    persuasion: true,
    clarity: true,
    empathy: true,
    assertiveness: true,
    completion: true,
    objective: true,
  });
  assert.deepEqual(evidence.scoringWeightsApplied, DEFAULT_WEIGHTS);
  assert.equal(Object.hasOwn(evidence, "summary"), false);
  assert.equal(Object.hasOwn(evidence, "normalizedCoachingThemes"), false);
  assert.equal(Object.hasOwn(evidence, "inputTokens"), false);
});

test("accepts partial, inconclusive, objective-false, and low-scoring persisted results", () => {
  for (const record of [
    modernScore({ id: "partial", completionLevel: "partial", objectiveAchieved: false, outcomeScore: 55, overallScore: 61 }),
    modernScore({ id: "inconclusive", completionLevel: "inconclusive", objectiveAchieved: false, outcomeScore: 20, overallScore: 35 }),
    modernScore({ id: "objective_false", objectiveAchieved: false, outcomeScore: 69, overallScore: 65 }),
    modernScore({ id: "low", objectiveAchieved: false, outcomeScore: 0, overallScore: 0 }),
  ]) {
    const evidence = accepted(record);
    assert.equal(evidence.completionLevel, record.completionLevel);
    assert.equal(evidence.objectiveAchieved, record.objectiveAchieved);
    assert.equal(evidence.outcomeScore, record.outcomeScore);
    assert.equal(evidence.overallScore, record.overallScore);
  }
});

test("accepts genuine sparse legacy records across shipped pre-outcome rubric generations", () => {
  for (const rubricVersion of ["2026-02-16.v1", "2026-03-06.v2"]) {
    const evidence = accepted(legacyScore({ rubricVersion }));
    assert.equal(evidence.recordEra, "legacy_sparse");
    assert.equal(evidence.scoringGeneration, rubricVersion);
    assert.equal(evidence.communicationScore, undefined);
    assert.equal(evidence.outcomeScore, undefined);
    assert.equal(evidence.completionLevel, undefined);
    assert.equal(evidence.objectiveAchieved, undefined);
    assert.equal(evidence.metricAvailability.communication, false);
    assert.equal(evidence.metricAvailability.outcome, false);
    assert.equal(evidence.metricAvailability.completion, false);
    assert.equal(evidence.metricAvailability.objective, false);
  }

  const unversioned = accepted(legacyScore());
  assert.equal(unversioned.scoringGeneration, LEGACY_UNVERSIONED_SCORING_GENERATION);
});

test("keeps unversioned outcome-aware records in a distinct scoring generation", () => {
  const evidence = accepted(modernScore({ rubricVersion: undefined }));
  assert.equal(evidence.recordEra, "outcome_aware");
  assert.equal(evidence.scoringGeneration, UNVERSIONED_OUTCOME_AWARE_SCORING_GENERATION);
  assert.notEqual(evidence.scoringGeneration, LEGACY_UNVERSIONED_SCORING_GENERATION);
});

test("rejects partial outcome-aware field groups as modern contract violations", () => {
  for (const record of [
    legacyScore({ communicationScore: 75 }),
    modernScore({ objectiveAchieved: undefined }),
    modernScore({ communicationScore: undefined, outcomeScore: undefined }),
    legacyScore({ rubricVersion: "2026-04-09.v1" }),
  ]) {
    const result = normalizePerformanceEvidence(record);
    assert.equal(result.status, "rejected");
    assert.equal(result.recordEra, "modern_contract_violation");
    assert.deepEqual(result.anomalies, ["modern_contract_violation"]);
    assert.equal(result.rejections.some((entry) => entry.code === "modern_contract_violation"), true);
  }
});

test("accepts absent topic, simulation, and organization attribution without inference", () => {
  const evidence = accepted(modernScore({
    trainingId: undefined,
    simulationSessionId: undefined,
    orgId: null,
  }));
  assert.equal(evidence.trainingId, undefined);
  assert.equal(evidence.simulationSessionId, undefined);
  assert.equal(evidence.orgId, null);
});

test("classifies deleted_user as deidentified evidence", () => {
  assert.equal(accepted(modernScore({ userId: "deleted_user" })).subjectKind, "deidentified");
  assert.equal(accepted(modernScore({ userId: "user_active" })).subjectKind, "user");
});

test("rejects missing identity, out-of-range metrics, and non-finite metrics", () => {
  for (const [record, expectedField] of [
    [modernScore({ id: " " }), "id"],
    [modernScore({ overallScore: 101 }), "overallScore"],
    [modernScore({ persuasion: 0 }), "persuasion"],
    [modernScore({ clarity: Number.NaN }), "clarity"],
    [modernScore({ communicationScore: Number.POSITIVE_INFINITY }), "communicationScore"],
    [modernScore({ outcomeScore: -1 }), "outcomeScore"],
  ] as const) {
    const result = normalizePerformanceEvidence(record);
    assert.equal(result.status, "rejected");
    assert.equal(result.rejections.some((entry) => entry.field === expectedField), true);
  }
});

test("rejects invalid timestamps and hard timestamp order violations", () => {
  for (const record of [
    modernScore({ startedAt: "not-a-date" }),
    modernScore({
      startedAt: "2026-09-24T10:06:00.000Z",
      endedAt: "2026-09-24T10:05:00.000Z",
    }),
  ]) {
    assert.equal(normalizePerformanceEvidence(record).status, "rejected");
  }
});

test("uses endedAt for normal evidence timing", () => {
  const evidence = accepted(modernScore());
  assert.equal(evidence.evidenceAt, "2026-09-24T10:05:00.000Z");
  assert.equal(evidence.evidenceAtSource, "endedAt");
  assert.deepEqual(evidence.anomalies, []);
});

test("clamps implausibly future endedAt to server-controlled createdAt", () => {
  const createdAt = new Date("2026-09-24T10:05:30.000Z");
  const endedAt = new Date(createdAt.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS + 1);
  const evidence = accepted(modernScore({
    startedAt: "2026-09-24T10:00:00.000Z",
    endedAt: endedAt.toISOString(),
    createdAt: createdAt.toISOString(),
  }));

  assert.equal(evidence.evidenceAt, createdAt.toISOString());
  assert.equal(evidence.evidenceAtSource, "createdAt_clamped");
  assert.deepEqual(evidence.anomalies, ["timing_anomaly"]);
  assert.equal(evidence.endedAt, endedAt.toISOString());
});

test("does not invent an extreme-backdating policy", () => {
  assert.equal(PERFORMANCE_EVIDENCE_EXTREME_BACKDATING_TOLERANCE_MS, null);
  const evidence = accepted(legacyScore({
    startedAt: "2025-01-01T10:00:00.000Z",
    endedAt: "2025-01-01T10:05:00.000Z",
    createdAt: "2026-09-24T10:05:30.000Z",
  }));
  assert.deepEqual(evidence.anomalies, []);
  assert.equal(evidence.evidenceAtSource, "endedAt");
});

test("allows missing legacy provenance and scoring weights without fabricating values", () => {
  const evidence = accepted(legacyScore());
  assert.equal(evidence.rubricVersion, undefined);
  assert.equal(evidence.promptVersion, undefined);
  assert.equal(evidence.model, undefined);
  assert.equal(evidence.scoringWeightsApplied, undefined);
});

test("rejects malformed applied scoring weights instead of preserving false provenance", () => {
  const result = normalizePerformanceEvidence(modernScore({
    scoringWeightsApplied: { persuasion: 1, clarity: 1, empathy: 1, assertiveness: 1 },
  }));
  assert.equal(result.status, "rejected");
  assert.equal(result.rejections.some((entry) => entry.code === "invalid_scoring_weights"), true);
});

test("A: flags two valid distinct score IDs for the same simulation session", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_a", simulationSessionId: "sim_duplicate" }),
    modernScore({ id: "score_b", simulationSessionId: "sim_duplicate" }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, [{
    simulationSessionId: "sim_duplicate",
    scoreIds: ["score_a", "score_b"],
  }]);
  assert.deepEqual(acceptedBatchEvidence(result, 0).anomalies, ["duplicate_session_conflict"]);
  assert.deepEqual(acceptedBatchEvidence(result, 1).anomalies, ["duplicate_session_conflict"]);
});

test("B: reports one conflict and flags all three distinct score IDs for a session", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_c", simulationSessionId: "sim_triple" }),
    modernScore({ id: "score_a", simulationSessionId: "sim_triple" }),
    modernScore({ id: "score_b", simulationSessionId: "sim_triple" }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, [{
    simulationSessionId: "sim_triple",
    scoreIds: ["score_a", "score_b", "score_c"],
  }]);
  for (const index of [0, 1, 2]) {
    assert.equal(
      acceptedBatchEvidence(result, index).anomalies.includes("duplicate_session_conflict"),
      true,
    );
  }
});

test("C: does not treat repeated snapshots of one score ID as a duplicate-session conflict", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_authoritative", simulationSessionId: "sim_retry" }),
    modernScore({ id: "score_authoritative", simulationSessionId: "sim_retry" }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, []);
  assert.deepEqual(acceptedBatchEvidence(result, 0).anomalies, []);
  assert.deepEqual(acceptedBatchEvidence(result, 1).anomalies, []);
});

test("D: keeps different simulation sessions independent", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_one", simulationSessionId: "sim_one" }),
    modernScore({ id: "score_two", simulationSessionId: "sim_two" }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, []);
  assert.deepEqual(acceptedBatchEvidence(result, 0).anomalies, []);
  assert.deepEqual(acceptedBatchEvidence(result, 1).anomalies, []);
});

test("E: null, absent, and empty simulation session IDs do not collide", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_null", simulationSessionId: null }),
    modernScore({ id: "score_absent", simulationSessionId: undefined }),
    modernScore({ id: "score_empty", simulationSessionId: " " }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, []);
  for (const index of [0, 1, 2]) {
    assert.deepEqual(acceptedBatchEvidence(result, index).anomalies, []);
  }
});

test("F: a rejected sibling still quarantines valid evidence from the same raw session", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_valid", simulationSessionId: "sim_mixed" }),
    modernScore({ id: "score_invalid", simulationSessionId: "sim_mixed", overallScore: 101 }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, [{
    simulationSessionId: "sim_mixed",
    scoreIds: ["score_invalid", "score_valid"],
  }]);
  assert.deepEqual(acceptedBatchEvidence(result, 0).anomalies, ["duplicate_session_conflict"]);
  assert.equal(result.results[1]?.status, "rejected");
});

test("G: reports malformed duplicate-session siblings without inventing accepted evidence", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_invalid_a", simulationSessionId: "sim_invalid", overallScore: 101 }),
    modernScore({ id: "score_invalid_b", simulationSessionId: "sim_invalid", persuasion: 0 }),
  ]);

  assert.deepEqual(result.duplicateSessionConflicts, [{
    simulationSessionId: "sim_invalid",
    scoreIds: ["score_invalid_a", "score_invalid_b"],
  }]);
  assert.deepEqual(result.results.map((entry) => entry.status), ["rejected", "rejected"]);
});

test("H: preserves timing anomalies when duplicate-session evidence is quarantined", () => {
  const createdAt = new Date("2026-09-24T10:05:30.000Z");
  const futureEndedAt = new Date(
    createdAt.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS + 1,
  );
  const result = normalizePerformanceEvidenceBatch([
    modernScore({
      id: "score_timing",
      simulationSessionId: "sim_timing_duplicate",
      endedAt: futureEndedAt.toISOString(),
      createdAt: createdAt.toISOString(),
    }),
    modernScore({ id: "score_sibling", simulationSessionId: "sim_timing_duplicate" }),
  ]);

  const evidence = acceptedBatchEvidence(result, 0);
  assert.deepEqual(evidence.anomalies, ["timing_anomaly", "duplicate_session_conflict"]);
  assert.equal(isPerformanceEvidenceQuarantined(evidence), true);
});

test("I: does not mutate raw records or independently normalized canonical evidence", () => {
  const records = [
    modernScore({ id: "score_immutable_a", simulationSessionId: "sim_immutable" }),
    modernScore({ id: "score_immutable_b", simulationSessionId: "sim_immutable" }),
  ];
  const rawSnapshot = structuredClone(records);
  const canonical = accepted(records[0]!);
  const canonicalSnapshot = structuredClone(canonical);
  const annotatedCanonical = annotateDuplicateSimulationSessionConflict(canonical);

  const result = normalizePerformanceEvidenceBatch(records);

  assert.deepEqual(records, rawSnapshot);
  assert.deepEqual(canonical, canonicalSnapshot);
  assert.notStrictEqual(annotatedCanonical, canonical);
  assert.deepEqual(annotatedCanonical.anomalies, ["duplicate_session_conflict"]);
  assert.notStrictEqual(acceptedBatchEvidence(result, 0), canonical);
  assert.deepEqual(canonical.anomalies, []);
});

test("J: conflict diagnostics and ordered batch results are deterministic", () => {
  const records = [
    modernScore({ id: "score_z", simulationSessionId: "sim_b" }),
    modernScore({ id: "score_a", simulationSessionId: "sim_b" }),
    modernScore({ id: "score_y", simulationSessionId: "sim_a" }),
    modernScore({ id: "score_b", simulationSessionId: "sim_a" }),
  ];

  assert.deepEqual(
    detectDuplicateSimulationSessionConflicts(records),
    [
      { simulationSessionId: "sim_a", scoreIds: ["score_b", "score_y"] },
      { simulationSessionId: "sim_b", scoreIds: ["score_a", "score_z"] },
    ],
  );
  assert.deepEqual(normalizePerformanceEvidenceBatch(records), normalizePerformanceEvidenceBatch(records));
});

test("K: one authoritative recognized-retry row has no duplicate-session anomaly", () => {
  const result = normalizePerformanceEvidenceBatch([
    modernScore({ id: "score_sim_recognized_retry", simulationSessionId: "sim_recognized_retry" }),
  ]);

  const evidence = acceptedBatchEvidence(result, 0);
  assert.deepEqual(result.duplicateSessionConflicts, []);
  assert.deepEqual(evidence.anomalies, []);
  assert.equal(isPerformanceEvidenceQuarantined(evidence), false);
});
