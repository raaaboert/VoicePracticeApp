import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { partitionFocusTopicAssignments } from "./focusTopicAssignmentPresentation";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(componentsDir, "FocusTopicAdministration.tsx"), "utf8");
const styles = readFileSync(join(componentsDir, "../../app/globals.css"), "utf8");

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
  assert.match(source, /Revoked \$\{formatDateTime\(row\.revokedAt\)\}/);
  assert.match(source, /!options\.revoked && canManageAllTopics/);
  assert.match(source, /onClick=\{\(\) => revokeAssignment\(row\.id, options\.management === true\)\}/);
});

test("assignment composer keeps fields in one row and a normal-sized action beneath them", () => {
  const composerStart = source.indexOf('<div className="focus-topic-assignment-composer">');
  const fieldsStart = source.indexOf("focus-topic-assignment-fields", composerStart);
  const fieldsEnd = source.indexOf("</div>", source.indexOf("</select>", fieldsStart)) + "</div>".length;
  const buttonStart = source.indexOf("focus-topic-add-assignment", composerStart);

  assert.ok(composerStart >= 0);
  assert.ok(fieldsStart > composerStart);
  assert.ok(buttonStart > fieldsEnd, "Add Assignment must follow the field row");
  assert.match(source, /focus-topic-assignment-fields\$\{targeted \? " targeted" : ""\}/);
  assert.match(styles, /\.focus-topic-assignment-fields\.targeted\s*\{[\s\S]*?grid-template-columns: minmax\(15rem, 22rem\) minmax\(15rem, 24rem\)/);
  assert.match(styles, /\.focus-topic-add-assignment\s*\{[\s\S]*?justify-self: start;[\s\S]*?width: auto;/);
});
