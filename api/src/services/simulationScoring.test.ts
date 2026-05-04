import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultScoringGuidance } from "@voicepractice/shared";

import { buildEvaluationSystemPrompt } from "../aiPrompts.js";
import { getDefaultScoringWeights } from "./trainingPackRuntime.js";
import {
  assertValidSimulationScorePayload,
  buildAdditiveEvaluationScoringGuidance,
  countUserTurnsForScoring,
  hasOutcomeAwareSimulationScoreRecord,
  isConclusiveSimulationScoreRecord,
  isSuccessfulSimulationScoreRecord,
  MIN_USER_TURNS_FOR_SCORE,
  MAX_UNACHIEVED_OUTCOME_SCORE,
  normalizeSimulationScorecard,
  SimulationScorePayloadValidationError
} from "./simulationScoring.js";

test("evaluation prompt layers desired outcome and standard scoring guidance for standard scenarios", () => {
  const prompt = buildEvaluationSystemPrompt({
    scenario: {
      id: "scenario_standard",
      segmentId: "sales",
      title: "Handle the renewal pushback",
      summary: "Summary",
      description: "A customer is pushing back on renewal terms.",
      desiredOutcome: "Reach a clear renewal next step with mutual commitment.",
      aiRole: "customer",
      enabled: true
    },
    difficulty: "medium",
    segmentLabel: "Account Executive",
    personaStyle: "skeptical",
    industryLabel: "Technology",
    industryBaseline: "Talk like a real technology account team.",
    scoringGuidance: buildAdditiveEvaluationScoringGuidance({
      standardGuidance: "Measure whether the user earns commitment and handles objections credibly."
    })
  });

  assert.match(prompt, /Industry baseline guidance/i);
  assert.match(prompt, /Scenario desired outcome/i);
  assert.match(prompt, /Reach a clear renewal next step/i);
  assert.match(prompt, /INDUSTRY STANDARD SCENARIO SCORING GUIDANCE/i);
});

test("custom evaluation guidance is additive rather than replacing the industry standard layer", () => {
  const prompt = buildEvaluationSystemPrompt({
    scenario: {
      id: "scenario_custom",
      segmentId: "sales",
      title: "Recover a delayed implementation",
      summary: "Summary",
      description: "A client is upset about delays.",
      desiredOutcome: "Secure agreement on a recovery plan and next check-in.",
      aiRole: "frustrated client",
      enabled: true
    },
    difficulty: "hard",
    segmentLabel: "Customer Success Manager",
    personaStyle: "frustrated",
    industryLabel: "Healthcare",
    industryBaseline: "Stay grounded in healthcare client communication norms.",
    scoringGuidance: buildAdditiveEvaluationScoringGuidance({
      standardGuidance: "Measure de-escalation, ownership, and concrete next steps.",
      customGuidance: "Reward explicit timeline repair and stakeholder alignment."
    })
  });

  assert.match(prompt, /INDUSTRY STANDARD SCENARIO SCORING GUIDANCE/i);
  assert.match(prompt, /CUSTOM SCENARIO SCORING GUIDANCE/i);
  assert.match(prompt, /timeline repair and stakeholder alignment/i);
});

test("evaluation prompt no longer embeds legacy output-schema instructions inside layered scoring guidance", () => {
  const prompt = buildEvaluationSystemPrompt({
    scenario: {
      id: "scenario_standard",
      segmentId: "sales",
      title: "Handle the renewal pushback",
      summary: "Summary",
      description: "A customer is pushing back on renewal terms.",
      desiredOutcome: "Reach a clear renewal next step with mutual commitment.",
      aiRole: "customer",
      enabled: true
    },
    difficulty: "medium",
    segmentLabel: "Account Executive",
    personaStyle: "skeptical",
    industryLabel: "Technology",
    industryBaseline: "Talk like a real technology account team.",
    scoringGuidance: buildDefaultScoringGuidance({
      scenarioTitle: "Handle the renewal pushback",
      segmentLabel: "Account Executive",
      industryContexts: [
        {
          id: "technology",
          label: "Technology",
          aiBaseline: "Talk like a real technology account team.",
          standardScoringGuidance: "Reward concrete renewal commitment."
        }
      ]
    })
  });

  assert.doesNotMatch(prompt, /Output compatibility rules/i);
  assert.doesNotMatch(prompt, /Preserve required output schema: overallScore, persuasion, clarity, empathy, assertiveness/i);
  assert.match(prompt, /Return ONLY strict JSON with this exact schema/i);
  assert.match(prompt, /Treat the required JSON schema below as authoritative/i);
});

test("normalizeSimulationScorecard derives communication score from legacy categories and caps unresolved attempts at 65", () => {
  const resolved = normalizeSimulationScorecard(
    {
      communicationScore: 10,
      outcomeScore: 92,
      completionLevel: "complete",
      objectiveAchieved: true,
      persuasion: 8,
      clarity: 9,
      empathy: 7,
      assertiveness: 8,
      strengths: ["Clear structure"],
      improvements: ["Tighter close"],
      summary: "Strong attempt."
    },
    getDefaultScoringWeights()
  );

  assert.equal(resolved.communicationScore, 80);
  assert.equal(resolved.outcomeScore, 92);
  assert.equal(resolved.overallScore, 84);

  const unresolved = normalizeSimulationScorecard(
    {
      outcomeScore: 95,
      completionLevel: "partial",
      objectiveAchieved: false,
      persuasion: 9,
      clarity: 9,
      empathy: 8,
      assertiveness: 9
    },
    getDefaultScoringWeights()
  );

  assert.equal(unresolved.communicationScore, 88);
  assert.equal(unresolved.overallScore, 65);
});

test("normalizeSimulationScorecard uses safer fallbacks when newer and legacy fields are partially missing", () => {
  const normalized = normalizeSimulationScorecard(
    {
      communicationScore: 82,
      outcomeScore: 74,
      objectiveAchieved: true,
      persuasion: 8,
      clarity: 8,
      empathy: 8,
      assertiveness: undefined
    },
    getDefaultScoringWeights()
  );

  assert.equal(normalized.communicationScore, 82);
  assert.equal(normalized.completionLevel, "complete");
  assert.equal(normalized.objectiveAchieved, true);
  assert.equal(normalized.overallScore, 79);
});

test("normalizeSimulationScorecard resolves inconsistent completion and outcome states conservatively", () => {
  const partialButClaimedSuccess = normalizeSimulationScorecard(
    {
      outcomeScore: 94,
      completionLevel: "partial",
      objectiveAchieved: true,
      persuasion: 9,
      clarity: 9,
      empathy: 8,
      assertiveness: 9
    },
    getDefaultScoringWeights()
  );

  assert.equal(partialButClaimedSuccess.completionLevel, "partial");
  assert.equal(partialButClaimedSuccess.objectiveAchieved, false);
  assert.equal(partialButClaimedSuccess.outcomeScore, MAX_UNACHIEVED_OUTCOME_SCORE);
  assert.equal(partialButClaimedSuccess.overallScore, 65);

  const lowOutcomeClaimedSuccess = normalizeSimulationScorecard(
    {
      outcomeScore: 42,
      completionLevel: "complete",
      objectiveAchieved: true,
      persuasion: 9,
      clarity: 8,
      empathy: 8,
      assertiveness: 9
    },
    getDefaultScoringWeights()
  );

  assert.equal(lowOutcomeClaimedSuccess.completionLevel, "complete");
  assert.equal(lowOutcomeClaimedSuccess.objectiveAchieved, false);
  assert.equal(lowOutcomeClaimedSuccess.outcomeScore, 42);
  assert.equal(lowOutcomeClaimedSuccess.overallScore, 65);
});

test("assertValidSimulationScorePayload rejects fully missing scorer JSON instead of allowing neutral scores", () => {
  assert.throws(
    () => assertValidSimulationScorePayload({}),
    (error) =>
      error instanceof SimulationScorePayloadValidationError
      && /communicationScore is missing or invalid/.test(error.message)
  );
});

test("assertValidSimulationScorePayload rejects sparse or malformed scorer JSON", () => {
  assert.throws(
    () =>
      assertValidSimulationScorePayload({
        communicationScore: 82,
        outcomeScore: 76,
        overallScore: 80,
        completionLevel: "complete",
        objectiveAchieved: true,
        persuasion: 8,
        clarity: 9,
        empathy: 7,
        assertiveness: 8,
        strengths: [],
        improvements: ["Tighter close"],
        summary: "Handled the conversation well."
      }),
    (error) =>
      error instanceof SimulationScorePayloadValidationError
      && /strengths is missing or invalid/.test(error.message)
  );
});

test("assertValidSimulationScorePayload accepts complete scorer JSON before normalization", () => {
  const payload = {
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
    summary: "Handled the conversation well."
  };

  assert.doesNotThrow(() => assertValidSimulationScorePayload(payload));
  const normalized = normalizeSimulationScorecard(payload, getDefaultScoringWeights());
  assert.equal(normalized.communicationScore, 80);
  assert.equal(normalized.overallScore, 79);
});

test("countUserTurnsForScoring enforces the minimum turn threshold and conclusive helper treats legacy records as reportable", () => {
  const history = [
    { role: "assistant" as const, content: "Opening prompt" },
    { role: "user" as const, content: "First response" },
    { role: "assistant" as const, content: "Pushback" },
    { role: "user" as const, content: "Second response" }
  ];

  assert.equal(countUserTurnsForScoring(history), 2);
  assert.equal(MIN_USER_TURNS_FOR_SCORE, 3);
  assert.equal(isConclusiveSimulationScoreRecord({ completionLevel: undefined }), true);
  assert.equal(isConclusiveSimulationScoreRecord({ completionLevel: "partial" }), false);
  assert.equal(isConclusiveSimulationScoreRecord({ completionLevel: "complete" }), true);
  assert.equal(hasOutcomeAwareSimulationScoreRecord({ completionLevel: undefined, objectiveAchieved: undefined, outcomeScore: undefined, communicationScore: undefined }), false);
  assert.equal(hasOutcomeAwareSimulationScoreRecord({ completionLevel: "complete", objectiveAchieved: true, outcomeScore: 81, communicationScore: 84 }), true);
  assert.equal(isSuccessfulSimulationScoreRecord({ completionLevel: undefined, objectiveAchieved: undefined }), false);
  assert.equal(isSuccessfulSimulationScoreRecord({ completionLevel: "complete", objectiveAchieved: true }), true);
});
