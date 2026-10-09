import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, "index.ts"), "utf8");

test("learner and management assignment row classes are bound by their registered routes", () => {
  assert.match(source,
    /\/assignments",[\s\S]*?focusTopicGrantsManagement = false; next\(\);/);
  assert.match(source,
    /\/management-grants",[\s\S]*?focusTopicGrantsManagement = true; next\(\);/);
  assert.match(source, /const grantsManagement = response\.locals\.focusTopicGrantsManagement === true;/);
  assert.equal(source.includes("request.path.includes"), false);
  assert.equal(source.includes("request.path.endsWith"), false);
});

test("learner and management revocation row classes are route-bound independently", () => {
  assert.match(source,
    /\/assignments\/:assignmentId",[\s\S]*?focusTopicGrantsManagement = false; next\(\);/);
  assert.match(source,
    /\/management-grants\/:assignmentId",[\s\S]*?focusTopicGrantsManagement = true; next\(\);/);
});
