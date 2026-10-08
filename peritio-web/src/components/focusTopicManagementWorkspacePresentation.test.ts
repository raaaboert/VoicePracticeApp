import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(componentsDir, "FocusTopicAdministration.tsx"), "utf8");
const page = readFileSync(join(componentsDir, "../../app/app/admin/focus-topics/page.tsx"), "utf8");
const proxy = readFileSync(join(componentsDir, "../../app/api/admin/focus-topic-management/route.ts"), "utf8");

test("Focus Topic workspace separates details, learner access, scoped managers, and Related Content", () => {
  for (const copy of [
    "Topic details",
    "Learner assignments",
    "Topic managers",
    "Related Content",
    "Attached Content",
    "Available Organization Content",
  ]) {
    assert.equal(source.includes(copy), true, copy);
  }
  assert.match(source, /canManageAllTopics \? <div className="focus-topic-actions">/);
  assert.match(source, /Scoped Topic managers can inspect assignments/);
  assert.match(source, /disabled=\{busy \|\| !canManageAllTopics/);
});

test("Related Content only attaches and detaches existing organization items", () => {
  assert.match(source, /action: "list_related_content"/);
  assert.match(source, /action: "attach_content"/);
  assert.match(source, /action: "detach_content"/);
  assert.equal(source.includes("upload"), false);
  assert.equal(source.includes("Create Learning Resource"), false);
  assert.match(source, /related\?\.permissions\.canManageRelatedContent/);
  assert.match(source, /Learning Resources are not enabled for this organization/);
  assert.match(proxy, /case "list_related_content"/);
  assert.match(proxy, /case "attach_content"/);
  assert.match(proxy, /case "detach_content"/);
});

test("scoped dashboard page uses server-derived Topic capability and filtered workspace metadata", () => {
  assert.match(page, /viewer\.capabilities\.manageFocusTopics/);
  assert.match(page, /topics\.management\.canManageAllTopics/);
  assert.match(page, /topics\.management\.learningResourcesEnabled/);
  assert.match(page, /usersPayload\?\.users \?\? \[\]/);
});
