import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(componentsDir, "..", "..");
const source = (path: string) => readFileSync(join(webRoot, path), "utf8");
const nav = source("src/components/TrainingContentAdminNav.tsx");
const admin = source("src/components/AdminWorkspace.tsx");
const focusTopics = source("src/components/FocusTopicAdministration.tsx");
const styles = source("app/globals.css");
const pages = {
  admin: source("app/app/admin/page.tsx"),
  organization: source("app/app/admin/content-organization/page.tsx"),
  topics: source("app/app/admin/focus-topics/page.tsx"),
  resources: source("app/app/admin/training-content/page.tsx"),
};

test("all Admin sections use one canonical four-item navigation in the same order", () => {
  const labels = ["Users &amp; Access", "Content Organization", "Focus Topics", "Learning Resources"];
  let previous = -1;
  for (const label of labels) {
    const position = nav.indexOf(label);
    assert.ok(position > previous, `${label} must follow the previous Admin destination`);
    previous = position;
  }
  assert.equal(nav.includes("showFocusTopics"), false);
  assert.match(nav, /aria-label="Admin sections"/);
  assert.match(admin, /<TrainingContentAdminNav orgId=\{orgId\} active="admin" \/>/);
  assert.match(pages.organization, /active="content-organization"/);
  assert.match(pages.topics, /active="focus-topics"/);
  assert.match(pages.resources, /active="training-content"/);
});

test("Users and Access Requests remain local views inside Users & Access", () => {
  assert.match(admin, /aria-label="Users and access views"/);
  assert.match(admin, />\s*Users\s*<\/button>/);
  assert.match(admin, />\s*Access Requests\s*<\/button>/);
  assert.equal(admin.includes('href={`/app/admin/training-content'), false);
  assert.equal(admin.includes('href={`/app/admin/content-organization'), false);
});

test("Focus Topic fields and actions use shared controls with accessible labels", () => {
  for (const id of ["focus-topic-select", "focus-topic-name", "focus-topic-description", "focus-topic-status", "focus-topic-audience", "focus-topic-subject"]) {
    assert.match(focusTopics, new RegExp(`htmlFor="${id}"`));
    assert.match(focusTopics, new RegExp(`(?:input|select|textarea)[^>]*id="${id}"`));
  }
  assert.match(focusTopics, /className="text-input" id="focus-topic-select"/);
  assert.match(focusTopics, /className="text-input" id="focus-topic-audience"/);
  assert.match(focusTopics, /audience === "individual" \? "Learner" : "Manager"/);
  assert.match(focusTopics, /"Save Focus Topic"/);
  assert.match(focusTopics, />Archive Focus Topic</);
  assert.match(focusTopics, />Add Assignment</);
  assert.match(styles, /\.focus-topic-assignment-controls\s*\{/);
  assert.match(styles, /\.focus-topic-description\s*\{/);
});

test("active assignments and revoked history have distinct presentation without changing operations", () => {
  assert.match(focusTopics, /const activeAssignments = assignments\.filter\(\(row\) => !row\.revokedAt\)/);
  assert.match(focusTopics, /const assignmentHistory = assignments\.filter/);
  assert.match(focusTopics, />Active assignments</);
  assert.match(focusTopics, />Assignment history</);
  assert.match(focusTopics, /className="focus-topic-assignment-row revoked"/);
  assert.match(focusTopics, /onClick=\{\(\) => revokeAssignment\(row\.id\)\}/);
  for (const operation of ["create_topic", "update_topic", "create_assignment", "revoke_assignment"]) {
    assert.match(focusTopics, new RegExp(`action: "${operation}"`));
  }
});
