import assert from "node:assert/strict";
import test from "node:test";

import { deriveOverallScore } from "./simulationScoring.js";
import {
  buildTrainingPackScoringWeightsBlock,
  computeWeightedOverallScore,
  resolveTrainingPackScoringWeights,
} from "./trainingPackRuntime.js";

test("Training Pack invalid overrides retain default weights and do not activate the suffix", () => {
  const warnings: string[] = [];
  const result = resolveTrainingPackScoringWeights(
    {
      persuasion: 0,
      clarity: -1,
      empathy: Number.NaN,
      assertiveness: Number.POSITIVE_INFINITY,
      unsupportedDimension: 2,
    },
    { logger: (message) => warnings.push(message) },
  );

  assert.deepEqual(result, {
    weights: {
      persuasion: 0.25,
      clarity: 0.25,
      empathy: 0.25,
      assertiveness: 0.25,
    },
    usedOverrides: false,
  });
  assert.deepEqual(warnings, [
    '[training-pack] Ignoring invalid non-positive scoring override for key "persuasion".',
    '[training-pack] Ignoring invalid non-positive scoring override for key "clarity".',
    '[training-pack] Ignoring invalid non-positive scoring override for key "empathy".',
    '[training-pack] Ignoring invalid non-positive scoring override for key "assertiveness".',
    '[training-pack] Ignoring unsupported scoring override key "unsupportedDimension".',
    "[training-pack] No valid scoring override values found; falling back to default scoring weights.",
  ]);
});

test("Training Pack partial overrides merge with defaults and normalize all four dimensions", () => {
  const warnings: string[] = [];
  const result = resolveTrainingPackScoringWeights(
    { persuasion: 0.5 },
    { logger: (message) => warnings.push(message) },
  );

  assert.deepEqual(result, {
    weights: {
      persuasion: 0.4,
      clarity: 0.2,
      empathy: 0.2,
      assertiveness: 0.2,
    },
    usedOverrides: true,
  });
  assert.deepEqual(warnings, [
    "[training-pack] Normalizing scoring weights because total was 1.250000 (expected 1.0).",
  ]);
  assert.equal(
    buildTrainingPackScoringWeightsBlock(result.weights),
    [
      "TRAINING PACK SCORING WEIGHT OVERRIDES",
      "Apply these normalized rubric weights when evaluating the USER's communication sub-scores:",
      "- persuasion: 0.4000",
      "- clarity: 0.2000",
      "- empathy: 0.2000",
      "- assertiveness: 0.2000",
      "Use these weights for persuasion, clarity, empathy, and assertiveness only.",
      "Still return the full required JSON schema, including communicationScore, outcomeScore, overallScore, completionLevel, and objectiveAchieved.",
    ].join("\n"),
  );
});

test("Training Pack weights change Communication while the Overall formula remains 65/35 with its cap", () => {
  const weights = resolveTrainingPackScoringWeights({ persuasion: 0.5 }).weights;
  const communicationScore = computeWeightedOverallScore(
    { persuasion: 9, clarity: 7, empathy: 6, assertiveness: 8 },
    weights,
  );

  assert.equal(communicationScore, 78);
  assert.equal(
    deriveOverallScore({
      communicationScore,
      outcomeScore: 90,
      completionLevel: "complete",
      objectiveAchieved: true,
    }),
    82,
  );
  assert.equal(
    deriveOverallScore({
      communicationScore,
      outcomeScore: 90,
      completionLevel: "partial",
      objectiveAchieved: false,
    }),
    65,
  );
});
