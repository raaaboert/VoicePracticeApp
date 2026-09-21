import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDefaultScoringGuidance, type Scenario, type TrainingPack } from "@voicepractice/shared";

import { buildEvaluationSystemPrompt } from "../aiPrompts.js";
import {
  buildEvaluationPromptWithOrchestrator,
  buildRoleplayPromptsWithOrchestrator,
} from "./promptOrchestrator.js";
import { buildAdditiveEvaluationScoringGuidance } from "./simulationScoring.js";

interface PromptGolden {
  roleplay: string;
  opening: string;
  evaluation: string;
}

interface Phase0PromptGoldens {
  modularNoValidOverrides: PromptGolden;
  modularPartialOverrides: PromptGolden;
}

const goldens = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "phase0-prompts.json"),
    "utf8",
  ),
) as Phase0PromptGoldens;

const scenario: Scenario = {
  id: "coaching_conversation",
  segmentId: "people_manager",
  title: "Address missed commitments",
  summary: "Coach a direct report after repeated missed commitments.",
  description: "A direct report has missed two commitments and is defensive about the pattern.",
  desiredOutcome: "Agree on accountability, support, and a concrete follow-up date.",
  aiRole: "a defensive direct report",
  enabled: true,
};

const industryBaseline =
  "Professional-services managers should balance direct accountability with specific support and documented follow-through.";

const standardGuidance = buildDefaultScoringGuidance({
  scenarioTitle: scenario.title,
  segmentLabel: "People Manager",
  industryContexts: [
    {
      id: "professional_services",
      label: "Professional Services",
      aiBaseline: industryBaseline,
      standardScoringGuidance:
        "Reward clear accountability, active listening, and a specific mutual follow-up plan.",
    },
  ],
});

const scoringGuidance = buildAdditiveEvaluationScoringGuidance({ standardGuidance });

function createTrainingPack(scoringWeightOverrides: Record<string, number>): TrainingPack {
  return {
    id: "pack_manager_accountability",
    organizationId: "org_phase0",
    title: "Manager Accountability",
    trainingTopic: "Accountable coaching conversations",
    learningObjectives: [
      "Name the missed commitment without exaggeration.",
      "Agree on one supported next step.",
    ],
    successBehaviors: [
      "Ask for the employee's perspective before proposing a solution.",
      "Set a specific owner and follow-up date.",
    ],
    failurePatterns: [
      "Avoiding the missed commitment.",
      "Ending without a documented next step.",
    ],
    requiredBehavioralTriggers: [
      "scenario:coaching_conversation",
      "The employee questions whether the deadline was realistic.",
    ],
    scoringWeightOverrides,
    complianceConstraints: "Do not speculate about protected characteristics or medical causes.",
    audienceLevel: "First-line managers",
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

test("Phase 0 golden: modular Training Pack without valid overrides preserves current boundaries", () => {
  const trainingPack = createTrainingPack({ persuasion: 0, unsupportedDimension: 2 });
  const roleplay = buildRoleplayPromptsWithOrchestrator({
    scenario,
    difficulty: "medium",
    segmentLabel: "People Manager",
    personaStyle: "defensive",
    industryLabel: "Professional Services",
    industryBaseline,
    trainingPack,
  });
  const evaluation = buildEvaluationPromptWithOrchestrator({
    scenario,
    difficulty: "medium",
    segmentLabel: "People Manager",
    personaStyle: "defensive",
    industryLabel: "Professional Services",
    industryBaseline,
    scoringGuidance,
    trainingPack,
  });
  const baseEvaluation = buildEvaluationSystemPrompt({
    scenario,
    difficulty: "medium",
    segmentLabel: "People Manager",
    personaStyle: "defensive",
    industryLabel: "Professional Services",
    industryBaseline,
    scoringGuidance,
  });

  const prompts = {
    roleplay: roleplay.systemPrompt,
    opening: roleplay.openingPrompt,
    evaluation: evaluation.evaluationPrompt,
  };
  assert.deepEqual(prompts, goldens.modularNoValidOverrides);
  assert.match(roleplay.systemPrompt, /TRAINING PACK BRIEF/);
  assert.match(roleplay.systemPrompt, /Required Success Behaviors:/);
  assert.match(roleplay.systemPrompt, /Common Failure Patterns:/);
  assert.match(roleplay.systemPrompt, /Compliance Constraints:/);
  assert.match(roleplay.systemPrompt, /REQUIRED BEHAVIORAL TRIGGERS/);
  assert.match(roleplay.systemPrompt, /- scenario:coaching_conversation/);
  assert.equal(evaluation.evaluationPrompt, baseEvaluation);
  assert.deepEqual(evaluation.scoringWeights, {
    persuasion: 0.25,
    clarity: 0.25,
    empathy: 0.25,
    assertiveness: 0.25,
  });
  assert.equal(evaluation.usesTrainingPackScoringOverrides, false);
});

test("Phase 0 golden: modular Training Pack with a partial override preserves normalized suffix", () => {
  const trainingPack = createTrainingPack({ persuasion: 0.5 });
  const roleplay = buildRoleplayPromptsWithOrchestrator({
    scenario,
    difficulty: "hard",
    segmentLabel: "People Manager",
    personaStyle: "defensive",
    industryLabel: "Professional Services",
    industryBaseline,
    trainingPack,
  });
  const evaluation = buildEvaluationPromptWithOrchestrator({
    scenario,
    difficulty: "hard",
    segmentLabel: "People Manager",
    personaStyle: "defensive",
    industryLabel: "Professional Services",
    industryBaseline,
    scoringGuidance,
    trainingPack,
  });

  const prompts = {
    roleplay: roleplay.systemPrompt,
    opening: roleplay.openingPrompt,
    evaluation: evaluation.evaluationPrompt,
  };
  assert.deepEqual(prompts, goldens.modularPartialOverrides);
  assert.deepEqual(evaluation.scoringWeights, {
    persuasion: 0.4,
    clarity: 0.2,
    empathy: 0.2,
    assertiveness: 0.2,
  });
  assert.equal(evaluation.usesTrainingPackScoringOverrides, true);
  assert.match(
    evaluation.evaluationPrompt,
    /TRAINING PACK SCORING WEIGHT OVERRIDES[\s\S]*- persuasion: 0\.4000[\s\S]*- clarity: 0\.2000[\s\S]*- empathy: 0\.2000[\s\S]*- assertiveness: 0\.2000/,
  );
  assert.match(
    evaluation.evaluationPrompt,
    /Still return the full required JSON schema, including communicationScore, outcomeScore, overallScore, completionLevel, and objectiveAchieved\.$/,
  );
});
