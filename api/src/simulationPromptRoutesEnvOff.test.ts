import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MODULAR_ORG_ID,
  type PromptRouteHarness,
  STANDARD_SCENARIO_ID,
  startPromptRouteHarness,
} from "./simulationPromptRoutes.testSupport.js";

interface PromptGolden {
  roleplay: string;
  opening: string;
  evaluation: string;
}

const pureGoldens = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "phase0-prompts.json"),
    "utf8",
  ),
) as { standardNonModular: PromptGolden };

let harness: PromptRouteHarness;

before(async () => {
  harness = await startPromptRouteHarness({ modularEnvironmentEnabled: false });
});

after(async () => {
  await harness.close();
});

test("environment flag off keeps opening, turn, and score equivalent to the base route prompts", async () => {
  const prompts = await harness.captureFamily({
    orgId: MODULAR_ORG_ID,
    scenarioId: STANDARD_SCENARIO_ID,
    industryId: "technology",
    difficulty: "medium",
    personaStyle: "skeptical",
  });

  assert.deepEqual(
    {
      roleplay: prompts.opening.systemPrompt,
      opening: prompts.opening.userPrompt,
      evaluation: prompts.score.systemPrompt,
    },
    pureGoldens.standardNonModular,
  );
  assert.equal(prompts.turn.systemPrompt, pureGoldens.standardNonModular.roleplay);
});
