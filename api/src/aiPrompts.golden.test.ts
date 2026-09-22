import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDefaultScoringGuidance, type Scenario } from "@voicepractice/shared";

import {
  buildEvaluationSystemPrompt,
  buildOpeningPrompt,
  buildRoleplaySystemPrompt,
} from "./aiPrompts.js";
import { buildAdditiveEvaluationScoringGuidance } from "./services/simulationScoring.js";

interface PromptGolden {
  roleplay: string;
  opening: string;
  evaluation: string;
}

interface Phase0PromptGoldens {
  standardNonModular: PromptGolden;
  customNonModular: PromptGolden;
}

const goldens = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "phase0-prompts.json"),
    "utf8",
  ),
) as Phase0PromptGoldens;

function assertGoldenPrompts(
  actual: { roleplay: string; opening: string; evaluation: string },
  expected: PromptGolden,
): void {
  assert.deepEqual(actual, expected);
}

test("Phase 0 golden: standard non-modular prompts preserve current composition", () => {
  const scenario: Scenario = {
    id: "standard_renewal",
    segmentId: "account_executive",
    title: "Resolve renewal concerns",
    summary: "Address a cautious customer's renewal concerns.",
    description: "A technology customer is questioning value before approving a renewal.",
    desiredOutcome: "Agree on a documented renewal decision and a dated next step.",
    aiRole: "a skeptical technology buyer",
    enabled: true,
  };
  const industryBaseline =
    "Technology buyers expect concise business-value evidence, credible implementation detail, and a clear owner for next steps.";
  const standardGuidance = buildDefaultScoringGuidance({
    scenarioTitle: scenario.title,
    segmentLabel: "Account Executive",
    industryContexts: [
      {
        id: "technology",
        label: "Technology",
        aiBaseline: industryBaseline,
        standardScoringGuidance:
          "Reward specific value evidence, direct objection handling, and a mutual renewal commitment.",
      },
    ],
  });
  const roleplay = buildRoleplaySystemPrompt({
    scenario,
    difficulty: "medium",
    segmentLabel: "Account Executive",
    personaStyle: "skeptical",
    industryLabel: "Technology",
    industryBaseline,
  });
  const opening = buildOpeningPrompt(scenario);
  const evaluation = buildEvaluationSystemPrompt({
    scenario,
    difficulty: "medium",
    segmentLabel: "Account Executive",
    personaStyle: "skeptical",
    industryLabel: "Technology",
    industryBaseline,
    scoringGuidance: buildAdditiveEvaluationScoringGuidance({ standardGuidance }),
  });

  assertGoldenPrompts({ roleplay, opening, evaluation }, goldens.standardNonModular);
  assert.match(roleplay, /Selected industry: Technology/);
  assert.match(roleplay, /Difficulty behavior: Raise meaningful objections and counterpoints/);
  assert.match(roleplay, /Persona behavior: Tone style: skeptical/);
  assert.match(evaluation, /Scenario desired outcome[\s\S]*Agree on a documented renewal decision/);
  assert.match(evaluation, /SCORING PARAMETERS v3 \(Standard Default\)/);
  assert.match(evaluation, /Technology buyers expect concise business-value evidence/);
});

test("Phase 0 golden: custom non-modular prompts preserve reinforced role and guidance boundary", () => {
  const segmentLabel = "Customer Success Manager";
  const scenario: Scenario = {
    id: "custom_recovery",
    segmentId: "customer_success",
    title: "Recover a delayed rollout",
    summary: "Restore confidence after an implementation delay.",
    description: "A healthcare operations leader is frustrated by a delayed rollout and unclear ownership.",
    desiredOutcome: "Secure agreement on owners, recovery dates, and the next executive check-in.",
    aiRole:
      "a healthcare operations leader. Counterpart rule: you are speaking with a Customer Success Manager; do not act as Customer Success Manager.",
    enabled: true,
  };
  const industryBaseline =
    "Healthcare client communication must be precise, accountable, and careful about operational and compliance impacts.";
  const guidancePrefix =
    "Prioritize ownership, recovery dates, and explicit stakeholder alignment.\n";
  const overflowMarker = "OVERFLOW_AFTER_ROLEPLAY_LIMIT";
  const customGuidance =
    guidancePrefix + "x".repeat(4_000 - guidancePrefix.length) + overflowMarker;
  const roleplayGuidance = customGuidance.slice(0, 4_000);
  const standardGuidance = buildDefaultScoringGuidance({
    scenarioTitle: scenario.title,
    segmentLabel,
    industryContexts: [
      {
        id: "healthcare",
        label: "Healthcare",
        aiBaseline: industryBaseline,
        standardScoringGuidance:
          "Reward de-escalation, accountable recovery planning, and operationally credible commitments.",
      },
    ],
  });
  const roleplay = buildRoleplaySystemPrompt({
    scenario,
    difficulty: "hard",
    segmentLabel,
    personaStyle: "frustrated",
    industryLabel: "Healthcare",
    industryBaseline,
    counterpartBehaviorGuidance: roleplayGuidance,
  });
  const opening = buildOpeningPrompt(scenario);
  const evaluation = buildEvaluationSystemPrompt({
    scenario,
    difficulty: "hard",
    segmentLabel,
    personaStyle: "frustrated",
    industryLabel: "Healthcare",
    industryBaseline,
    scoringGuidance: buildAdditiveEvaluationScoringGuidance({
      standardGuidance,
      customGuidance,
    }),
  });

  assertGoldenPrompts({ roleplay, opening, evaluation }, goldens.customNonModular);
  assert.match(roleplay, /Counterpart rule: you are speaking with a Customer Success Manager; do not act as Customer Success Manager/);
  assert.match(roleplay, /Scenario coaching priorities[\s\S]*Prioritize ownership, recovery dates/);
  assert.doesNotMatch(roleplay, new RegExp(overflowMarker));
  assert.match(evaluation, /INDUSTRY STANDARD SCENARIO SCORING GUIDANCE/);
  assert.match(evaluation, /CUSTOM SCENARIO SCORING GUIDANCE/);
  assert.match(evaluation, new RegExp(overflowMarker));
});
