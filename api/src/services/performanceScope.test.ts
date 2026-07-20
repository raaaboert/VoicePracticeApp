import assert from "node:assert/strict";
import test from "node:test";

import { freezePerformancePlanScope } from "./performanceScope.js";

const candidates = [
  {
    scenarioId: "scenario_1",
    displayName: "Difficult Performance Review",
    source: "custom" as const,
    segmentId: "manager",
    segmentLabel: "Manager",
    focusTopics: [{ id: "focus_1", name: "Coaching" }],
    metadata: { version: 1 }
  },
  {
    scenarioId: "scenario_2",
    displayName: "Missed Deadlines",
    source: "standard" as const,
    segmentId: "manager",
    segmentLabel: "Manager",
    focusTopics: [{ id: "focus_1", name: "Coaching" }]
  },
  {
    scenarioId: "scenario_3",
    displayName: "Unmotivated Team Member",
    source: "standard" as const,
    segmentId: "manager",
    segmentLabel: "Manager",
    focusTopics: [{ id: "focus_2", name: "Motivation" }]
  }
];

test("performance scope freezes direct and Focus Topic selections with deduplication", () => {
  const frozen = freezePerformancePlanScope({
    selection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_1"],
      selectedScenarioIds: ["scenario_1"]
    },
    candidates,
    planId: "plan_1",
    orgId: "org_1",
    userId: "user_1",
    createdAt: "2026-07-20T16:00:00.000Z"
  });

  assert.deepEqual(
    frozen.scope.scenarios.map((scenario) => scenario.scenarioId).sort(),
    ["scenario_1", "scenario_2"]
  );
  const deduped = frozen.scope.scenarios.find((scenario) => scenario.scenarioId === "scenario_1");
  assert.deepEqual(deduped?.selectionSources, ["focus_topic", "direct"]);
  assert.equal(frozen.scopeItems.length, 2);
  assert.equal(frozen.scopeItems[0].metadataSnapshot.focusTopics instanceof Array, true);
});

test("performance scope freezes all assigned scenarios instead of staying dynamic", () => {
  const frozen = freezePerformancePlanScope({
    selection: {
      allAssignedScenarios: true,
      selectedFocusTopicIds: [],
      selectedScenarioIds: []
    },
    candidates,
    planId: "plan_all",
    orgId: "org_1",
    userId: "user_1",
    createdAt: "2026-07-20T16:00:00.000Z"
  });

  assert.equal(frozen.scope.allAssignedScenarios, true);
  assert.equal(frozen.scope.scenarios.length, 3);
  assert(frozen.scope.scenarios.every((scenario) => scenario.selectionSources.includes("all_assigned")));
});

test("performance scope rejects unavailable Focus Topics and scenarios", () => {
  assert.throws(
    () =>
      freezePerformancePlanScope({
        selection: { allAssignedScenarios: false, selectedFocusTopicIds: ["missing"], selectedScenarioIds: [] },
        candidates,
        planId: "plan_1",
        orgId: "org_1",
        userId: "user_1",
        createdAt: "2026-07-20T16:00:00.000Z"
      }),
    /Focus Topic is not available/
  );

  assert.throws(
    () =>
      freezePerformancePlanScope({
        selection: { allAssignedScenarios: false, selectedFocusTopicIds: [], selectedScenarioIds: ["missing"] },
        candidates,
        planId: "plan_1",
        orgId: "org_1",
        userId: "user_1",
        createdAt: "2026-07-20T16:00:00.000Z"
      }),
    /Scenario is not available/
  );
});
