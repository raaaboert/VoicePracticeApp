import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLIENT_BASELINE_SENTINEL,
  CUSTOM_SCENARIO_ID,
  CUSTOM_SCORING_GUIDANCE,
  CUSTOM_TRAINING_ID,
  INACTIVE_CUSTOM_TRAINING_ID,
  LONG_GUIDANCE_SCENARIO_ID,
  MODULAR_ORG_ID,
  ROLEPLAY_GUIDANCE_OVERFLOW_MARKER,
  type PromptRouteHarness,
  STANDARD_ORG_ID,
  STANDARD_SCENARIO_ID,
  startPromptRouteHarness,
  WRONG_CUSTOM_TRAINING_ID,
} from "./simulationPromptRoutes.testSupport.js";

interface PromptGolden {
  roleplay: string;
  opening: string;
  evaluation: string;
}

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "test-fixtures");
const pureGoldens = JSON.parse(
  readFileSync(resolve(fixtureDirectory, "phase0-prompts.json"), "utf8"),
) as { standardNonModular: PromptGolden };
const routeGoldens = JSON.parse(
  readFileSync(resolve(fixtureDirectory, "phase0-route-prompts.json"), "utf8"),
) as { customNonModular: PromptGolden };

let harness: PromptRouteHarness;

before(async () => {
  harness = await startPromptRouteHarness({ modularEnvironmentEnabled: true });
});

after(async () => {
  await harness.close();
});

function assertFamilyMatchesGolden(
  actual: Awaited<ReturnType<PromptRouteHarness["captureFamily"]>>,
  expected: PromptGolden,
): void {
  assert.deepEqual(
    {
      roleplay: actual.opening.systemPrompt,
      opening: actual.opening.userPrompt,
      evaluation: actual.score.systemPrompt,
    },
    expected,
  );
  assert.equal(actual.turn.systemPrompt, expected.roleplay);
}

test("standard opening, turn, and score routes send the current base prompts when the organization flag is off", async () => {
  const prompts = await harness.captureFamily({
    orgId: STANDARD_ORG_ID,
    scenarioId: STANDARD_SCENARIO_ID,
    industryId: "technology",
    difficulty: "medium",
    personaStyle: "skeptical",
  });

  assertFamilyMatchesGolden(prompts, pureGoldens.standardNonModular);
  assert.match(prompts.opening.userPrompt, /Resolve renewal concerns/);
  assert.match(prompts.opening.systemPrompt, /Technology buyers expect concise business-value evidence/);
  assert.doesNotMatch(prompts.opening.systemPrompt, new RegExp(CLIENT_BASELINE_SENTINEL));
  assert.match(prompts.score.systemPrompt, /Agree on a documented renewal decision and a dated next step/);
  assert.match(prompts.score.systemPrompt, /SCORING PARAMETERS v3 \(Standard Default\)/);
  assert.equal(
    prompts.score.userPrompt,
    [
      "Conversation transcript:",
      "AI: What would help you move forward?",
      "User: First, I would confirm the concern and ask what evidence is missing.",
      "AI: I still need a concrete reason to trust the plan.",
      "User: Second, I would offer specific evidence and confirm who owns each action.",
      "AI: How will you make sure this does not drift again?",
      "User: Third, I would document the date, owner, and next review before we close.",
    ].join("\n"),
  );
});

test("custom opening, turn, and score routes preserve custom resolution and additive guidance", async () => {
  const prompts = await harness.captureFamily({
    orgId: STANDARD_ORG_ID,
    scenarioId: CUSTOM_SCENARIO_ID,
    trainingId: CUSTOM_TRAINING_ID,
    industryId: "healthcare",
    difficulty: "hard",
    personaStyle: "frustrated",
  });

  assertFamilyMatchesGolden(prompts, routeGoldens.customNonModular);
  assert.match(
    prompts.opening.systemPrompt,
    /Counterpart rule: you are speaking with a Customer Success Manager; do not act as Customer Success Manager/,
  );
  assert.match(prompts.opening.systemPrompt, new RegExp(CUSTOM_SCORING_GUIDANCE));
  assert.match(prompts.score.systemPrompt, /INDUSTRY STANDARD SCENARIO SCORING GUIDANCE/);
  assert.match(prompts.score.systemPrompt, /CUSTOM SCENARIO SCORING GUIDANCE/);
  assert.match(prompts.score.systemPrompt, new RegExp(CUSTOM_SCORING_GUIDANCE));
  assert.match(prompts.score.systemPrompt, /Healthcare client communication must be precise/);
  assert.doesNotMatch(prompts.score.systemPrompt, new RegExp(CLIENT_BASELINE_SENTINEL));
});

test("custom roleplay routes cap scoring guidance while evaluation receives the full guidance", async () => {
  const prompts = await harness.captureFamily({
    orgId: STANDARD_ORG_ID,
    scenarioId: LONG_GUIDANCE_SCENARIO_ID,
    trainingId: CUSTOM_TRAINING_ID,
    industryId: "healthcare",
    difficulty: "hard",
    personaStyle: "frustrated",
  });

  assert.doesNotMatch(prompts.opening.systemPrompt, new RegExp(ROLEPLAY_GUIDANCE_OVERFLOW_MARKER));
  assert.doesNotMatch(prompts.turn.systemPrompt, new RegExp(ROLEPLAY_GUIDANCE_OVERFLOW_MARKER));
  assert.match(prompts.score.systemPrompt, new RegExp(ROLEPLAY_GUIDANCE_OVERFLOW_MARKER));
});

test("custom scenario opening rejects an unrelated active Focus Topic", async () => {
  const result = await harness.requestOpening({
    orgId: STANDARD_ORG_ID,
    scenarioId: CUSTOM_SCENARIO_ID,
    trainingId: WRONG_CUSTOM_TRAINING_ID,
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "Invalid scenario for this account." });
  assert.equal(result.providerCallCount, 0);
});

test("custom scenario opening rejects an archived Focus Topic", async () => {
  const result = await harness.requestOpening({
    orgId: STANDARD_ORG_ID,
    scenarioId: CUSTOM_SCENARIO_ID,
    trainingId: INACTIVE_CUSTOM_TRAINING_ID,
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "Invalid scenario for this account." });
  assert.equal(result.providerCallCount, 0);
});

test("modular prompting with no applicable pack remains equivalent to the base route prompts", async () => {
  const prompts = await harness.captureFamily({
    orgId: MODULAR_ORG_ID,
    scenarioId: STANDARD_SCENARIO_ID,
    industryId: "technology",
    difficulty: "medium",
    personaStyle: "skeptical",
  });

  assertFamilyMatchesGolden(prompts, pureGoldens.standardNonModular);
});
