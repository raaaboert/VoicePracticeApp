import assert from "node:assert/strict";
import test from "node:test";

import { CustomerPracticeScenarioGenerationReceiptRegistry } from "./customerPracticeScenarioGenerationReceipt.js";
import { normalizeCustomerPracticeScenarioServerProvenance, normalizeCustomerPracticeScenarioStoredDraft } from "../storage/customerPracticeScenarioStore.js";

test("server generation receipt binds AI provenance to actor, Topic, and canonical sources", () => {
  const registry = new CustomerPracticeScenarioGenerationReceiptRegistry(() => 1_000);
  const receipt = registry.issue({ actorId: "actor_1", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_b", "source_a"],
    provenance: { sourceMode: "scratch", creationMethod: "ai", modelUsed: "server-model", generatedPrompt: "v1", generatedAt: "2026-10-10T00:00:00.000Z" } });
  assert.deepEqual(registry.resolve({ token: receipt.token, actorId: "actor_1", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_a", "source_b"] }), receipt.provenance);
  assert.equal(registry.resolve({ token: receipt.token, actorId: "actor_2", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_a", "source_b"] }), null);
  assert.equal(registry.resolve({ token: receipt.token, actorId: "actor_1", orgId: "org_1", topicId: "topic_2", sourceContentIds: ["source_a", "source_b"] }), null);
  assert.equal(registry.resolve({ token: receipt.token, actorId: "actor_1", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_a"] }), null);
});

test("expired receipt cannot turn a stale or forged save into generated provenance", () => {
  let now = 1_000;
  const registry = new CustomerPracticeScenarioGenerationReceiptRegistry(() => now);
  const receipt = registry.issue({ actorId: "actor_1", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_a"],
    provenance: { sourceMode: "scratch", creationMethod: "ai", modelUsed: "server-model", generatedPrompt: "v1", generatedAt: "2026-10-10T00:00:00.000Z" } });
  now += 15 * 60 * 1000;
  assert.equal(registry.resolve({ token: receipt.token, actorId: "actor_1", orgId: "org_1", topicId: "topic_1", sourceContentIds: ["source_a"] }), null);
});

test("save lifecycle accepts only server-issued AI provenance and preserves manual distinction", () => {
  const generated = normalizeCustomerPracticeScenarioServerProvenance({ sourceMode: "scratch", creationMethod: "ai",
    modelUsed: "server-model", generatedPrompt: "customer-practice-scenario-generation-v1", generatedAt: "2026-10-10T00:00:00.000Z" });
  assert.equal(generated.creationMethod, "ai"); assert.equal(generated.modelUsed, "server-model");
  assert.equal(normalizeCustomerPracticeScenarioServerProvenance(undefined).creationMethod, "manual");
  assert.equal(normalizeCustomerPracticeScenarioServerProvenance({ sourceMode: "standard_base", creationMethod: "ai" }).creationMethod, "manual");
  assert.equal(normalizeCustomerPracticeScenarioServerProvenance({ sourceMode: "scratch", creationMethod: "ai", modelUsed: "forged", generatedPrompt: "forged", generatedAt: "not-a-date" }).creationMethod, "manual");
});

test("mocked generation receipt flows into one immutable draft version with sources and no publication state", () => {
  const provenance = normalizeCustomerPracticeScenarioServerProvenance({ sourceMode: "scratch", creationMethod: "ai",
    modelUsed: "server-model", generatedPrompt: "customer-practice-scenario-generation-v1", generatedAt: "2026-10-10T00:00:00.000Z" });
  const persisted = normalizeCustomerPracticeScenarioStoredDraft({ title: "Generated draft", description: "Grounded scenario context.",
    desiredOutcome: "Practice discovery.", aiRole: "A cautious buyer.", scoringGuidance: "Use the standard rubric.", segmentId: "sales",
    applicableIndustryIds: ["technology"], sourceReferences: [{ kind: "training_content", referenceId: "source_1", label: "Playbook" }],
    serverProvenance: provenance });
  assert.equal(persisted.provenance.creationMethod, "ai"); assert.equal(persisted.provenance.generatedPrompt, "customer-practice-scenario-generation-v1");
  assert.deepEqual(persisted.sourceReferences, [{ kind: "training_content", referenceId: "source_1", label: "Playbook" }]);
  // Publication is an aggregate transition and cannot be produced by draft normalization.
  assert.equal("publishedAt" in persisted, false);
});
