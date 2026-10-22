import assert from "node:assert/strict";
import test from "node:test";
import { contentTopicChoices, selectedContentTopicIds, sameTopicIds } from "./trainingContentTopicSelection";

test("Topic picker sorts case-insensitively, filters all authorized options, and retains unavailable selections", () => {
  const options = [{ id: "z", name: "zebra", status: "active" as const },
    { id: "a", name: "Alpha", status: "active" as const }, { id: "b", name: "beta", status: "draft" as const }];
  const existing = [{ id: "old", name: "Old Topic", status: "archived" as const, available: false }];
  assert.deepEqual(contentTopicChoices(options, existing, "").map((topic) => topic.id), ["a", "b", "old", "z"]);
  assert.deepEqual(contentTopicChoices(options, existing, " ALP ").map((topic) => topic.id), ["a"]);
  assert.deepEqual(contentTopicChoices(options, existing, "no matches"), []);
  assert.equal(contentTopicChoices(options, existing, "old")[0]?.available, false);
  assert.deepEqual(contentTopicChoices([], [], ""), []);
});

test("authoritative attachments preselect every Topic and never fall back to stale legacy metadata", () => {
  const item = { focusTopicId: "stale", focusTopicAuthority: "assignments" as const,
    relatedFocusTopics: [{ id: "a", name: "A", status: "active" as const, available: true },
      { id: "b", name: "B", status: "draft" as const, available: false }] };
  assert.deepEqual(selectedContentTopicIds(item), ["a", "b"]);
  assert.deepEqual(selectedContentTopicIds({ ...item, relatedFocusTopics: [] }), []);
  assert.deepEqual(selectedContentTopicIds({ focusTopicId: "old" }), ["old"]);
  assert.equal(sameTopicIds(["b", "a"], ["a", "b"]), true);
  assert.equal(sameTopicIds(["a"], ["a", "b"]), false);
});
