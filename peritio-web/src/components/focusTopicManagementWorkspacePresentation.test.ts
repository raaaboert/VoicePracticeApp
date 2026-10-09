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
    "Available Content",
    "Upload New",
  ]) {
    assert.equal(source.includes(copy), true, copy);
  }
  assert.match(source, /canManageAllTopics \? <div className="focus-topic-actions">/);
  assert.match(source, /Scoped Topic managers can inspect assignments/);
  assert.match(source, /disabled=\{busy \|\| !canManageAllTopics/);
});

test("Related Content separates attach-existing from scoped draft upload and editing", () => {
  assert.match(source, /action: "list_related_content"/);
  assert.match(source, /action: "attach_content"/);
  assert.match(source, /action: "detach_content"/);
  assert.match(source, /action: "create_content"/);
  assert.match(source, /action: "initiate_content_upload"/);
  assert.match(source, /action: "finalize_content_upload"/);
  assert.match(source, /action: "update_content"/);
  assert.match(source, /"publish_content" \| "unpublish_content"/);
  assert.match(source, /item\?\.canMutate/);
  assert.match(source, /item\.mutationRestriction/);
  assert.match(source, /related\?\.permissions\.canManageRelatedContent/);
  assert.match(source, /Learning Resources are not enabled for this organization/);
  assert.match(proxy, /case "list_related_content"/);
  assert.match(proxy, /case "attach_content"/);
  assert.match(proxy, /case "detach_content"/);
  assert.match(proxy, /case "create_content"/);
  assert.match(proxy, /case "initiate_content_upload"/);
  assert.match(proxy, /case "finalize_content_upload"/);
});

test("scoped dashboard page uses server-derived Topic capability and filtered workspace metadata", () => {
  assert.match(page, /viewer\.capabilities\.manageFocusTopics/);
  assert.match(page, /topics\.management\.canManageAllTopics/);
  assert.match(page, /topics\.management\.learningResourcesEnabled/);
  assert.match(page, /usersPayload\?\.users \?\? \[\]/);
});
