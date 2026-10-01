import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { PromptRouteHarness } from "./simulationPromptRoutes.testSupport.js";
import { startPromptRouteHarness } from "./simulationPromptRoutes.testSupport.js";

let harness: PromptRouteHarness;

before(async () => {
  harness = await startPromptRouteHarness({
    modularEnvironmentEnabled: true,
    learnerOrgModularPromptEnabled: true,
    scoringModel: "gpt-6.1-sol",
    scoringReasoningEffort: "medium",
  });
});

after(async () => {
  await harness.close();
});

test("GPT-6.1 Sol uses the existing Responses scoring contract and persists its returned model ID", async () => {
  const simulationSessionId = "sim_gpt_6_1_sol_compatibility";
  await harness.startLearnerSession(simulationSessionId);

  const result = await harness.scoreLearnerSession({ simulationSessionId, userTurnCount: 3 });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.providerModel, "gpt-6.1-sol");
  assert.equal(result.providerReasoningEffort, "medium");
  assert.equal(result.usesResponsesShape, true);
  assert.equal(result.body.status, "scored");
  const responseScorecard = result.body.scorecard as Record<string, unknown>;
  assert.equal(responseScorecard.communicationScore, 80);
  assert.equal(responseScorecard.outcomeScore, 76);
  assert.equal(responseScorecard.overallScore, 79);
  assert.equal(responseScorecard.completionLevel, "complete");
  assert.equal(responseScorecard.objectiveAchieved, true);

  const records = await harness.readPersistedScoreRecords();
  const record = records.find((entry) => entry.simulationSessionId === simulationSessionId);
  assert.ok(record);
  assert.equal(record.model, "gpt-6.1-sol");
  assert.equal(record.rubricVersion, "2026-04-09.v1");
  assert.deepEqual(record.scoringWeightsApplied, {
    persuasion: 0.25,
    clarity: 0.25,
    empathy: 0.25,
    assertiveness: 0.25,
  });
});
