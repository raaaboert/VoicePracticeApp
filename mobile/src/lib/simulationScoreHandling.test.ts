import assert from "node:assert/strict";
import test from "node:test";

import { resolveSimulationScoreOutcome, shouldUsePracticeOnlyFallbackScore } from "./simulationScoreHandling";

test("resolveSimulationScoreOutcome keeps not-scored responses on the non-fallback path", () => {
  const outcome = resolveSimulationScoreOutcome({
    status: "not_scored",
    reason: "insufficient_evidence",
    userTurnCount: 2,
    minimumUserTurns: 3,
    message: "We need at least 3 real user responses to generate a reliable scorecard."
  });

  assert.deepEqual(outcome, {
    kind: "not_scored",
    scorecard: null,
    message: "We need at least 3 real user responses to generate a reliable scorecard."
  });
});

test("resolveSimulationScoreOutcome preserves scored payloads", () => {
  const outcome = resolveSimulationScoreOutcome({
    status: "scored",
    scorecard: {
      communicationScore: 78,
      outcomeScore: 64,
      overallScore: 73,
      completionLevel: "partial",
      objectiveAchieved: false,
      persuasion: 8,
      clarity: 8,
      empathy: 7,
      assertiveness: 8,
      strengths: ["Clear opener"],
      improvements: ["Resolve the core issue"],
      summary: "Solid communication, but the outcome remained unresolved."
    },
    record: {
      id: "score_1",
      createdAt: "2026-04-09T00:00:00.000Z",
      trainingPackId: null,
      model: "gpt-test",
      promptVersion: "prompt_v1",
      rubricVersion: "rubric_v1",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    }
  });

  assert.equal(outcome.kind, "scored");
  assert.equal(outcome.scorecard?.overallScore, 73);
  assert.equal(outcome.message, null);
});

test("shouldUsePracticeOnlyFallbackScore stays limited to explicit mock or offline flows", () => {
  assert.equal(
    shouldUsePracticeOnlyFallbackScore({
      scoringEnabled: true,
      usedMockMode: true,
      apiConfigured: true
    }),
    true
  );

  assert.equal(
    shouldUsePracticeOnlyFallbackScore({
      scoringEnabled: true,
      usedMockMode: false,
      apiConfigured: false
    }),
    true
  );

  assert.equal(
    shouldUsePracticeOnlyFallbackScore({
      scoringEnabled: true,
      usedMockMode: false,
      apiConfigured: true
    }),
    false
  );

  assert.equal(
    shouldUsePracticeOnlyFallbackScore({
      scoringEnabled: false,
      usedMockMode: true,
      apiConfigured: true
    }),
    false
  );
});
