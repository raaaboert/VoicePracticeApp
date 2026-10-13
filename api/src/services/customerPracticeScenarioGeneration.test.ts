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
const response = JSON.stringify({
  title: "Discovery conversation",
  description: "Practice discovery before a solution proposal.",
  desiredOutcome: "Clarify needs.",
  aiRole: "A cautious prospect.",
  scoringCriteria: [
    "Asks at least two open questions before proposing a solution.",
    "Summarizes the prospect's stated needs accurately.",
    "Secures agreement on a concrete next step.",
  ],
});

test("generation uses versioned grounded structured prompt and returns an unsaved draft", async () => {
  let request: Parameters<typeof buildCustomerPracticeScenarioGenerationMessages>[0] | null = null;
  const result = await generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: "Focus on open questions.", existingScenarios: [], modelConfig: config,
    complete: async (params) => { request = { sourceText: params.messages[1]!.content, practiceGuidance: "Focus on open questions." }; return { text: response }; } });
  assert.equal(result.draft.title, "Discovery conversation"); assert.deepEqual(result.draft.sourceContentIds, ["content_1"]);
  assert.equal(result.draft.scoringGuidance, [
    "1. Asks at least two open questions before proposing a solution.",
    "2. Summarizes the prospect's stated needs accurately.",
    "3. Secures agreement on a concrete next step.",
  ].join("\n"));
  assert.equal(result.draft.promptVersion, CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION);
  assert.equal(result.serverProvenance.creationMethod, "ai"); assert.equal(result.serverProvenance.modelUsed, "test-model");
  assert.match(request!.sourceText, /SOURCE MATERIAL/); assert.equal("id" in result.draft, false);
  const prompt = buildCustomerPracticeScenarioGenerationMessages({ sourceText: "x", practiceGuidance: null })[0]!.content;
  assert.match(prompt, /only valid JSON/i);
  assert.match(prompt, /exactly title, description, desiredOutcome, aiRole, and scoringCriteria/);
  assert.match(prompt, /3 to 6 unique, concise, observable, scenario-specific criteria/);
  assert.match(prompt, /supplement the existing industry scoring framework/i);
  assert.match(CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION, /-v2$/);
});

test("invalid model output fails without a draft", async () => {
  await assert.rejects(generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: null, existingScenarios: [], modelConfig: config,
    complete: async () => ({ text: "not json" }) }), (error: unknown) => error instanceof CustomerPracticeScenarioGenerationError && error.code === "generation_invalid_response");
});

test("generation rejects missing, malformed, too few, excessive, blank, or duplicate scoring criteria", async () => {
  const base = JSON.parse(response) as Record<string, unknown>;
  const invalidCriteria: unknown[] = [
    undefined,
    "not-an-array",
    ["One", "Two"],
    ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
    ["One", "", "Three"],
    ["Observe discovery", "observe discovery", "Confirm next step"],
  ];
  for (const scoringCriteria of invalidCriteria) {
    const candidate = { ...base };
    if (scoringCriteria === undefined) delete candidate.scoringCriteria;
    else candidate.scoringCriteria = scoringCriteria;
    await assert.rejects(generateCustomerPracticeScenarioDraft({
      sourceBundle: bundle, practiceGuidance: null, existingScenarios: [], modelConfig: config,
      complete: async () => ({ text: JSON.stringify(candidate) }),
    }), (error: unknown) => error instanceof CustomerPracticeScenarioGenerationError
      && error.code === "generation_invalid_response");
  }
});

test("strong same-topic text similarity is flagged rather than discarded", async () => {
  const existing = [{ id: "scenario_existing", currentVersion: { title: "Discovery conversation", description: "Practice discovery before a solution proposal." } }] as CustomerPracticeScenario[];
  const result = await generateCustomerPracticeScenarioDraft({ sourceBundle: bundle, practiceGuidance: null, existingScenarios: existing, modelConfig: config,
    complete: async () => ({ text: response }) });
  assert.deepEqual(result.draft.similarity, { flagged: true, matchingScenarioIds: ["scenario_existing"] });
});
