import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationScoreRecord } from "@voicepractice/shared";

import {
  buildRecoveredSimulationEvaluationResult,
  buildRecoveredSimulationScorecard,
  isRecoverableSimulationScoreRecord,
} from "./mobileScoreRecovery.js";

function createScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    simulationSessionId: overrides.simulationSessionId ?? "sim_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
    startedAt: overrides.startedAt ?? "2026-04-23T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-23T10:05:00.000Z",
    communicationScore: Object.prototype.hasOwnProperty.call(overrides, "communicationScore")
      ? overrides.communicationScore
      : 82,
    outcomeScore: Object.prototype.hasOwnProperty.call(overrides, "outcomeScore")
      ? overrides.outcomeScore
      : 76,
    overallScore: overrides.overallScore ?? 80,
    completionLevel: Object.prototype.hasOwnProperty.call(overrides, "completionLevel")
      ? overrides.completionLevel
      : "complete",
    objectiveAchieved: Object.prototype.hasOwnProperty.call(overrides, "objectiveAchieved")
      ? overrides.objectiveAchieved
      : true,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 9,
    empathy: overrides.empathy ?? 7,
    assertiveness: overrides.assertiveness ?? 8,
    summary: Object.prototype.hasOwnProperty.call(overrides, "summary")
      ? overrides.summary
      : "Handled the conversation well.",
    coachingArtifact: Object.prototype.hasOwnProperty.call(overrides, "coachingArtifact")
      ? overrides.coachingArtifact
      : {
          strengths: ["Clear framing"],
          improvementAreas: ["Tighter close"],
          coachingPriority: "Tighter close",
        },
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: Object.prototype.hasOwnProperty.call(overrides, "rubricVersion")
      ? overrides.rubricVersion
      : "rubric_v1",
    model: Object.prototype.hasOwnProperty.call(overrides, "model")
      ? overrides.model
      : "gpt-test",
    promptVersion: Object.prototype.hasOwnProperty.call(overrides, "promptVersion")
      ? overrides.promptVersion
      : "prompt_v1",
    inputTokens: Object.prototype.hasOwnProperty.call(overrides, "inputTokens")
      ? overrides.inputTokens
      : 120,
    outputTokens: Object.prototype.hasOwnProperty.call(overrides, "outputTokens")
      ? overrides.outputTokens
      : 45,
    totalTokens: Object.prototype.hasOwnProperty.call(overrides, "totalTokens")
      ? overrides.totalTokens
      : 165,
    createdAt: overrides.createdAt ?? "2026-04-23T10:05:30.000Z",
  };
}

test("buildRecoveredSimulationScorecard preserves persisted score detail and coaching guidance", () => {
  const scorecard = buildRecoveredSimulationScorecard(createScore());

  assert.deepEqual(scorecard, {
    communicationScore: 82,
    outcomeScore: 76,
    overallScore: 80,
    completionLevel: "complete",
    objectiveAchieved: true,
    persuasion: 8,
    clarity: 9,
    empathy: 7,
    assertiveness: 8,
    strengths: ["Clear framing"],
    improvements: ["Tighter close"],
    summary: "Handled the conversation well.",
  });
});

test("score recovery accepts only persisted records with real score fields", () => {
  assert.equal(isRecoverableSimulationScoreRecord(createScore()), true);
  assert.equal(
    isRecoverableSimulationScoreRecord(
      createScore({
        communicationScore: undefined,
        outcomeScore: undefined,
        completionLevel: undefined,
        objectiveAchieved: undefined,
      }),
    ),
    false,
  );
});

test("buildRecoveredSimulationEvaluationResult refuses sparse persisted records instead of creating fallback scores", () => {
  assert.throws(
    () =>
      buildRecoveredSimulationEvaluationResult(
        createScore({
          communicationScore: undefined,
          outcomeScore: undefined,
          completionLevel: undefined,
          objectiveAchieved: undefined,
          coachingArtifact: null,
          summary: "   ",
          model: undefined,
          promptVersion: undefined,
          rubricVersion: undefined,
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      ),
    /Recovered score record is incomplete/,
  );
});
