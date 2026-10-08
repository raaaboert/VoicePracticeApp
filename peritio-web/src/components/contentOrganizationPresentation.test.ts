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
const admin = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const nav = readFileSync(join(componentsDir, "TrainingContentAdminNav.tsx"), "utf8");
const auth = readFileSync(join(webRoot, "src", "lib", "auth.ts"), "utf8");
const page = readFileSync(
  join(webRoot, "app", "app", "admin", "content-organization", "page.tsx"),
  "utf8",
);

test("customer content organization is capability-gated and keeps Focus Topics separate from Training Packs", () => {
  assert.equal(page.includes("viewer.capabilities.manageOrganizationContent"), true);
  assert.equal(nav.includes("Content Organization"), true);
  assert.equal(nav.includes('active: "admin" | "training-content" | "content-organization" | "focus-topics"'), true);
  assert.equal(manager.includes("Learner discovery"), true);
  assert.equal(manager.includes("Delivery configuration"), true);
  assert.equal(manager.includes("Order does not change assignments or scoring."), true);
  assert.equal(existsSync(join(webRoot, "app", "app", "admin", "content-organization", "page.tsx")), true);
});

test("customer ordering uses full lists, explicit saves, and existing authoritative API paths", () => {
  assert.equal(manager.includes("Move ${itemLabel} up"), true);
  assert.equal(manager.includes("Move ${itemLabel} down"), true);
  assert.equal(manager.includes("Save company order"), true);
  assert.equal(manager.match(/Save order/g)?.length, 1);
  assert.equal(manager.includes("buildFocusTopicOrderRequest(focusTopics, focusTopicRevision)"), true);
  assert.equal(manager.includes("expectedOrderRevision: trainingPackRevision"), true);
  assert.equal(manager.includes("trainingPackIds: trainingPacks.map"), true);
  assert.equal(auth.includes("/orgs/${encodeURIComponent(orgId)}/trainings/order"), true);
  assert.equal(auth.includes("/orgs/${encodeURIComponent(orgId)}/training-packs/order"), true);
  assert.equal(manager.includes("Position ${index + 1} · ${pack.active ? \"Active\" : \"Inactive\"}"), true);
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

test("customer Content Organization props use only the explicit Training Pack ordering summary", () => {
  assert.equal(manager.includes("initialTrainingPacks: CustomerTrainingPackOrderSummary[]"), true);
  assert.equal(manager.includes("initialTrainingPacks: TrainingPack[]"), false);
  assert.equal(auth.includes("minimizeCustomerTrainingPackOrderResponse(response)"), true);
  assert.equal(page.includes("initialTrainingPacks={trainingPacks.packs}"), true);
});
