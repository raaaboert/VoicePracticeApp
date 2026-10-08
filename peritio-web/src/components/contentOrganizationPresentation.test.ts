import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { OrgTrainingStatus, OrgTrainingSummary } from "@voicepractice/shared";

import {
  buildFocusTopicOrderRequest,
  moveActiveFocusTopic,
  projectActiveFocusTopicOrder,
  projectInactiveFocusTopics,
} from "../lib/contentOrganizationOrdering";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(componentsDir, "..", "..");
const manager = readFileSync(join(componentsDir, "ContentOrganizationManager.tsx"), "utf8");
const nav = readFileSync(join(componentsDir, "TrainingContentAdminNav.tsx"), "utf8");
const auth = readFileSync(join(webRoot, "src", "lib", "auth.ts"), "utf8");
const page = readFileSync(
  join(webRoot, "app", "app", "admin", "content-organization", "page.tsx"),
  "utf8",
);

test("customer Focus Topic Order page is capability-gated and narrowly describes learner ordering", () => {
  assert.equal(page.includes("viewer.capabilities.manageOrganizationContent"), true);
  assert.equal(nav.includes("Focus Topic Order"), true);
  assert.equal(nav.includes("Content Organization"), false);
  assert.equal(nav.includes('"admin" | "focus-topics" | "training-content" | "focus-topic-order"'), true);
  assert.equal(page.includes('title="Focus Topic Order"'), true);
  assert.equal(page.includes("Set the order learners see Focus Topics."), true);
  assert.equal(manager.includes("Learner discovery"), true);
  assert.equal(existsSync(join(webRoot, "app", "app", "admin", "content-organization", "page.tsx")), true);
});

test("customer ordering uses the full Focus Topic list and existing authoritative API path", () => {
  assert.equal(manager.includes("Move ${itemLabel} up"), true);
  assert.equal(manager.includes("Move ${itemLabel} down"), true);
  assert.equal(manager.includes("Save company order"), true);
  assert.equal(manager.includes("buildFocusTopicOrderRequest(focusTopics, focusTopicRevision)"), true);
  assert.equal(auth.includes("/orgs/${encodeURIComponent(orgId)}/trainings/order"), true);
});

test("Training Pack ordering is absent from the customer Focus Topic Order page while APIs remain intact", () => {
  assert.equal(manager.includes("Training Packs"), false);
  assert.equal(manager.includes("initialTrainingPacks"), false);
  assert.equal(page.includes("getDashboardTrainingPackOrder"), false);
  assert.equal(page.includes("initialTrainingPacks"), false);
  assert.equal(auth.includes("/orgs/${encodeURIComponent(orgId)}/training-packs/order"), true);
});

function focusTopic(id: string, name: string, status: OrgTrainingStatus): OrgTrainingSummary {
  return {
    id,
    orgId: "org_1",
    name,
    status,
    description: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    attachedTrainingPackIds: [],
    attachedCustomScenarioIds: [],
    attachedTrainingPackCount: 0,
    attachedCustomScenarioCount: 0,
  };
}

test("mixed-status customer Focus Topics produce an active-only interactive order and payload", () => {
  const allTopics = [
    focusTopic("a", "Active Topic A", "active"),
    focusTopic("b", "Archived Topic B", "archived"),
    focusTopic("c", "Active Topic C", "active"),
    focusTopic("d", "Draft Topic D", "draft"),
  ];

  const active = projectActiveFocusTopicOrder(allTopics);
  const inactive = projectInactiveFocusTopics(allTopics);
  assert.deepEqual(active.map((topic, index) => ({ id: topic.id, position: index + 1 })), [
    { id: "a", position: 1 },
    { id: "c", position: 2 },
  ]);
  assert.deepEqual(inactive.map((topic) => ({ id: topic.id, orderable: false })), [
    { id: "b", orderable: false },
    { id: "d", orderable: false },
  ]);

  const moved = moveActiveFocusTopic(active, "c", -1);
  assert.deepEqual(buildFocusTopicOrderRequest(moved, "current-revision"), {
    expectedOrderRevision: "current-revision",
    trainingIds: ["c", "a"],
  });

  const inactiveStart = manager.indexOf('className="content-organization-inactive-topics"');
  const inactivePresentation = manager.slice(inactiveStart, manager.indexOf("</section>", inactiveStart));
  assert.ok(inactiveStart >= 0);
  assert.equal(inactivePresentation.includes("training-content-order-controls"), false);
  assert.equal(inactivePresentation.includes("onMove"), false);
  assert.equal(inactivePresentation.includes("Not active"), true);
});

test("fresh mixed-status data rebuilds active ordering state from current status", () => {
  const refreshed = [
    focusTopic("a", "Topic A", "archived"),
    focusTopic("b", "Topic B", "active"),
    focusTopic("c", "Topic C", "active"),
  ];
  assert.deepEqual(projectActiveFocusTopicOrder(refreshed).map((topic) => topic.id), ["b", "c"]);
  assert.equal(manager.includes("setFocusTopics(activeTopics)"), true);
  assert.equal(manager.includes("setFocusTopicRevision(initialFocusTopicOrderRevision)"), true);
});
