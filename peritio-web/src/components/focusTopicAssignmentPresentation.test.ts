import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { partitionFocusTopicAssignments } from "./focusTopicAssignmentPresentation";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(componentsDir, "FocusTopicAdministration.tsx"), "utf8");

const revoked = {
  id: "assignment_old",
  subjectUserId: "user_a",
  createdAt: "2026-10-01T01:00:00.000Z",
  revokedAt: "2026-10-01T02:00:00.000Z",
};
const recreated = {
  id: "assignment_new",
  subjectUserId: "user_a",
  createdAt: "2026-10-01T03:00:00.000Z",
  revokedAt: null,
};
const secondSubject = {
  id: "assignment_second_subject",
  subjectUserId: "user_b",
  createdAt: "2026-10-01T04:00:00.000Z",
  revokedAt: null,
};

test("revoked history remains after an equivalent assignment is recreated", () => {
  const result = partitionFocusTopicAssignments([revoked, recreated]);
  assert.deepEqual(result.activeAssignments.map((row) => row.id), ["assignment_new"]);
  assert.deepEqual(result.assignmentHistory.map((row) => row.id), ["assignment_old"]);
});

test("two different active individual subjects remain distinct", () => {
  const result = partitionFocusTopicAssignments([recreated, secondSubject]);
  assert.deepEqual(result.activeAssignments.map((row) => row.subjectUserId), ["user_a", "user_b"]);
  assert.deepEqual(result.assignmentHistory, []);
});

test("active rows show created time and revoke while history shows both times without revoke", () => {
  assert.match(source, /Assigned \{formatDateTime\(row\.createdAt\)\}/);
  assert.match(source, /Revoked \{formatDateTime\(row\.revokedAt\)\}/);
  const historyStart = source.indexOf("<details className=\"focus-topic-assignment-section focus-topic-assignment-history\"");
  const history = source.slice(historyStart, source.indexOf("</details>", historyStart));
  assert.ok(historyStart >= 0);
  assert.equal(history.includes("revokeAssignment("), false);
  assert.match(source.slice(0, historyStart), /onClick=\{\(\) => revokeAssignment\(row\.id\)\}/);
});
