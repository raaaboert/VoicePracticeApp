import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import type { SimulationScoreRecord, TrainingPack } from "@voicepractice/shared";

import {
  LEARNER_USER_ID,
  type PromptRouteHarness,
  startPromptRouteHarness,
} from "./simulationPromptRoutes.testSupport.js";

type StableScoreRecord = Omit<SimulationScoreRecord, "createdAt">;

interface PromptGolden {
  roleplay: string;
  opening: string;
  evaluation: string;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "phase0-score-contract.json"),
    "utf8",
  ),
) as { persistedLearnerScore: StableScoreRecord };
const routePromptFixture = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "phase0-route-prompts.json"),
    "utf8",
  ),
) as { customNonModular: PromptGolden };

let harness: PromptRouteHarness;

const nonDefaultWeightTrainingPack: TrainingPack = {
  id: "pack_non_default_weights",
  organizationId: "org_prompt_base",
  title: "Non-default scoring weights",
  trainingTopic: "Verify applied scoring-weight provenance.",
  learningObjectives: [],
  successBehaviors: [],
  failurePatterns: [],
  requiredBehavioralTriggers: ["scenario:custom_recovery_route"],
  scoringWeightOverrides: { persuasion: 0.5 },
  complianceConstraints: "",
  audienceLevel: "test",
  active: true,
  createdAt: "2026-09-21T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
};

const nonDefaultNormalizedWeights = {
  persuasion: 0.4,
  clarity: 0.2,
  empathy: 0.2,
  assertiveness: 0.2,
};

before(async () => {
  harness = await startPromptRouteHarness({
    modularEnvironmentEnabled: true,
    learnerOrgModularPromptEnabled: true,
    trainingPacks: [nonDefaultWeightTrainingPack],
  });
});

after(async () => {
  await harness.close();
});

test("learner score route persists the current recognized-session score contract", async () => {
  const simulationSessionId = "sim_phase0_persisted_score";
  await harness.startLearnerSession(simulationSessionId);

  const result = await harness.scoreLearnerSession({ simulationSessionId, userTurnCount: 3 });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.status, "scored");
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.evaluationSystemPrompt, routePromptFixture.customNonModular.evaluation);

  const records = await harness.readPersistedScoreRecords();
  const record = records.find((entry) => entry.simulationSessionId === simulationSessionId);
  assert.ok(record);
  const { createdAt, ...stableRecord } = record;
  assert.equal(Number.isNaN(new Date(createdAt).getTime()), false);
  assert.deepEqual(stableRecord, fixture.persistedLearnerScore);
  assert.equal(record.userId, LEARNER_USER_ID);
  assert.equal(record.trainingId, "training_custom_recovery");
  assert.equal(record.trainingPackId, undefined);
  assert.equal(Object.hasOwn(record, "trainingPackId"), false);
  assert.equal(record.divisionId, undefined);
  assert.equal(Object.hasOwn(record, "divisionId"), false);
});

test("learner score route persists the non-default normalized weights actually applied", async () => {
  const simulationSessionId = "sim_non_default_applied_weights";
  await harness.startLearnerSession(simulationSessionId, {
    trainingPackId: nonDefaultWeightTrainingPack.id,
  });

  const result = await harness.scoreLearnerSession({
    simulationSessionId,
    userTurnCount: 3,
    trainingPackId: nonDefaultWeightTrainingPack.id,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.status, "scored");
  assert.equal(result.providerCallCount, 1);
  assert.match(
    result.evaluationSystemPrompt ?? "",
    /persuasion: 0\.4000[\s\S]*clarity: 0\.2000[\s\S]*empathy: 0\.2000[\s\S]*assertiveness: 0\.2000/,
  );

  const records = await harness.readPersistedScoreRecords();
  const record = records.find((entry) => entry.simulationSessionId === simulationSessionId);
  assert.ok(record);
  assert.equal(record.trainingPackId, nonDefaultWeightTrainingPack.id);
  assert.deepEqual(record.scoringWeightsApplied, nonDefaultNormalizedWeights);
});

test("learner score route returns not_scored below three user turns and writes no record", async () => {
  const simulationSessionId = "sim_phase0_insufficient_score";
  await harness.startLearnerSession(simulationSessionId);

  const result = await harness.scoreLearnerSession({ simulationSessionId, userTurnCount: 2 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body, {
    status: "not_scored",
    reason: "insufficient_evidence",
    userTurnCount: 2,
    minimumUserTurns: 3,
    message: "We need at least 3 real user responses to generate a reliable scorecard. This session was not scored.",
  });
  assert.equal(result.providerCallCount, 0);

  const records = await harness.readPersistedScoreRecords();
  assert.equal(
    records.some((entry) => entry.simulationSessionId === simulationSessionId),
    false,
  );
});
