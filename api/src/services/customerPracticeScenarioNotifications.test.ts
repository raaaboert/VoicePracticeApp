import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, CustomerPracticeScenario, UserProfile } from "@voicepractice/shared";
import {
  buildScenarioDecisionNotificationInputs,
  buildScenarioSubmittedNotificationInputs,
  canViewCustomerPracticeScenarioNotification,
} from "./customerPracticeScenarioNotifications.js";

const author = { id: "author", accountType: "enterprise", orgId: "org", orgRole: "manager",
  status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z" } as unknown as UserProfile;
const admin = { ...author, id: "admin", orgRole: "org_admin" } as unknown as UserProfile;
const db = { orgs: [{ id: "org", status: "active" }], users: [author, admin] } as ApiDatabase;
const scenario = { id: "scenario", orgId: "org", status: "in_review", createdByActorId: "author",
  currentVersionId: "version", currentVersion: { id: "version", title: "Discovery call" } } as CustomerPracticeScenario;

test("submission notifies eligible reviewers without granting authority", () => {
  const rows = buildScenarioSubmittedNotificationInputs({ db, scenario, actorId: "author", createdAt: new Date(0) });
  assert.deepEqual(rows.map((row) => row.recipientUserId), ["admin"]);
  const notification = { ...rows[0], id: "notice", kind: "scenario_submitted", createdAt: new Date(0).toISOString(),
    readAt: null, resolvedAt: null, resolution: null } as any;
  assert.equal(canViewCustomerPracticeScenarioNotification({ db, recipient: admin, notification,
    scenarios: [scenario] }), true);
  assert.equal(canViewCustomerPracticeScenarioNotification({ db, recipient: author, notification,
    scenarios: [scenario] }), false);
  assert.equal(canViewCustomerPracticeScenarioNotification({ db, recipient: admin, notification,
    scenarios: [{ ...scenario, status: "approved" }] }), false);
});

test("review and publication notify only the current scenario author", () => {
  for (const decision of ["approve", "reject", "publish"] as const) {
    const rows = buildScenarioDecisionNotificationInputs({ db, scenario, actorId: "admin", decision, createdAt: new Date(0) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.recipientUserId, "author");
    assert.match(rows[0]?.dedupKey ?? "", new RegExp(decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "published"));
  }
});
