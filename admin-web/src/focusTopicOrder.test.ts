import assert from "node:assert/strict";
import test from "node:test";
import type { OrgTrainingSummary } from "@voicepractice/shared";

import { activeFocusTopicIds, focusTopicOrderChanged, moveActiveFocusTopic } from "./focusTopicOrder";

function topic(id: string, status: OrgTrainingSummary["status"] = "active"): OrgTrainingSummary {
  return {
    id,
    orgId: "org",
    name: id,
    status,
    description: "",
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    attachedTrainingPackIds: [],
    attachedCustomScenarioIds: [],
    attachedTrainingPackCount: 0,
    attachedCustomScenarioCount: 0,
  };
}

test("active company order moves without making draft or archived topics reorderable", () => {
  const initial = [topic("a"), topic("b"), topic("draft", "draft"), topic("archived", "archived")];
  const moved = moveActiveFocusTopic(initial, "b", -1);
  assert.deepEqual(activeFocusTopicIds(moved), ["b", "a"]);
  assert.deepEqual(moved.slice(2).map((entry) => entry.id), ["draft", "archived"]);
  assert.deepEqual(moveActiveFocusTopic(moved, "b", -1), moved);
  assert.deepEqual(moveActiveFocusTopic(moved, "archived", 1), moved);
});

test("order dirtiness compares the complete active list", () => {
  const initial = [topic("a"), topic("b"), topic("draft", "draft")];
  assert.equal(focusTopicOrderChanged(initial, ["a", "b"]), false);
  assert.equal(focusTopicOrderChanged(initial, ["b", "a"]), true);
  assert.equal(focusTopicOrderChanged(initial, ["a"]), true);
});
