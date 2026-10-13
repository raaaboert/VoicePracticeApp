import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultConfig } from "@voicepractice/shared";
import { serializeMobileLearnerConfig } from "./mobileLearnerConfig.js";

test("learner config omits internal scoring guidance and generation provenance while retaining launch fields", () => {
  const config = createDefaultConfig("2026-10-13T00:00:00.000Z");
  config.orgCustomScenarios = [{
    id: "scenario_customer",
    orgId: "org_customer",
    segmentId: "manager",
    title: "Customer coaching",
    summary: "Practice a coaching conversation.",
    description: "Discuss a missed commitment.",
    desiredOutcome: "Agree on a next action.",
    aiRole: "A concerned team member",
    scoringGuidance: "1. Names the missed commitment.",
    applicableIndustryIds: ["people_management"],
    enabled: true,
    provenance: {
      sourceMode: "scratch",
      creationMethod: "ai",
      generatedPrompt: "internal-prompt-version",
      modelUsed: "internal-model",
      generatedAt: "2026-10-13T00:00:00.000Z",
    },
    createdBy: "internal_actor",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    customerScenarioVersionId: "version_published",
    customerScenarioVersionNumber: 3,
    homeFocusTopicId: "topic_customer",
  }];

  const serialized = serializeMobileLearnerConfig(config);
  const scenario = serialized.orgCustomScenarios?.[0] as unknown as Record<string, unknown>;
  assert.equal(scenario.scoringGuidance, undefined);
  assert.equal(scenario.provenance, undefined);
  assert.equal(scenario.id, "scenario_customer");
  assert.equal(scenario.aiRole, "A concerned team member");
  assert.equal(scenario.customerScenarioVersionId, "version_published");
  assert.deepEqual(scenario.applicableIndustryIds, ["people_management"]);
  assert.equal(JSON.stringify(serialized).includes("internal-prompt-version"), false);
  assert.equal(JSON.stringify(serialized).includes("internal-model"), false);
  assert.equal(JSON.stringify(serialized).includes("Names the missed commitment"), false);
});
