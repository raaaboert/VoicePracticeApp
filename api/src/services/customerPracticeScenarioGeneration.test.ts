import assert from "node:assert/strict";
import test from "node:test";

import type { CustomerPracticeScenario } from "@voicepractice/shared";
import {
  buildCustomerPracticeScenarioGenerationMessages,
  CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION,
  CustomerPracticeScenarioGenerationError,
  generateCustomerPracticeScenarioDraft,
} from "./customerPracticeScenarioGeneration.js";

const config = { model: "test-model", apiFamily: "responses" as const, maxOutputTokens: 1600, reasoningEffort: "low" as const };
const bundle = { text: "Approved sales playbook: establish discovery before proposing a solution.", sources: [{ contentId: "content_1", label: "Playbook", sourceKind: "native_text" as const, characterCount: 72 }] };
const response = JSON.stringify({ title: "Discovery conversation", description: "Practice discovery before a solution proposal.", desiredOutcome: "Clarify needs.", aiRole: "A cautious prospect." });

test("generation uses versioned grounded structured prompt and returns an unsaved draft", async () => {
  let request: Parameters<typeof buildCustomerPracticeScenarioGenerationMessages>[0] | null = null;
  const result = await generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: "Focus on open questions.", existingScenarios: [], modelConfig: config,
    complete: async (params) => { request = { sourceText: params.messages[1]!.content, practiceGuidance: "Focus on open questions." }; return { text: response }; } });
  assert.equal(result.title, "Discovery conversation"); assert.deepEqual(result.sourceContentIds, ["content_1"]);
  assert.equal(result.promptVersion, CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION);
  assert.match(request!.sourceText, /SOURCE MATERIAL/); assert.equal("id" in result, false);
  assert.match(buildCustomerPracticeScenarioGenerationMessages({ sourceText: "x", practiceGuidance: null })[0]!.content, /only valid JSON/i);
});

test("invalid model output fails without a draft", async () => {
  await assert.rejects(generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: null, existingScenarios: [], modelConfig: config,
    complete: async () => ({ text: "not json" }) }), (error: unknown) => error instanceof CustomerPracticeScenarioGenerationError && error.code === "generation_invalid_response");
});

test("strong same-topic text similarity is flagged rather than discarded", async () => {
  const existing = [{ id: "scenario_existing", currentVersion: { title: "Discovery conversation", description: "Practice discovery before a solution proposal." } }] as CustomerPracticeScenario[];
  const result = await generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: null, existingScenarios: existing, modelConfig: config,
    complete: async () => ({ text: response }) });
  assert.deepEqual(result.similarity, { flagged: true, matchingScenarioIds: ["scenario_existing"] });
});
