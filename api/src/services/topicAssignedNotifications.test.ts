import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, UserProfile } from "@voicepractice/shared";

import type { FocusTopicAssignment } from "./focusTopicAuthority.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import {
  buildTopicAssignedNotificationInputs,
  canViewTopicAssignedNotification,
  shouldPreserveTopicAssignedNotificationInLegacyMode,
} from "./topicAssignedNotifications.js";

const NOW = "2026-10-07T12:00:00.000Z";
const member = (id: string, overrides: Partial<UserProfile> = {}): UserProfile => ({
  id, accountType: "enterprise", orgId: "org", orgRole: "user", status: "active",
  emailVerifiedAt: NOW, managerUserId: null, ...overrides,
}) as UserProfile;
const topic = { id: "topic", orgId: "org", name: "Coaching", status: "active" as const,
  description: "", createdAt: NOW, updatedAt: NOW };
const assignment: FocusTopicAssignment = {
  id: "assignment", orgId: "org", topicId: "topic", audience: "manager_with_team",
  subjectUserId: "manager", grantsManagement: false, createdBy: "admin",
  createdAt: NOW, revokedBy: null, revokedAt: null,
};
const db = {
  orgs: [{ id: "org", name: "Organization", status: "active" }],
  orgTrainings: [topic],
  users: [member("manager"), member("report", { managerUserId: "manager" }),
    member("other"), member("disabled", { managerUserId: "manager", status: "disabled" }),
    member("foreign", { managerUserId: "manager", orgId: "foreign" })],
} as unknown as ApiDatabase;

test("Topic assignment fan-out includes only current eligible audience and uses per-recipient dedup", () => {
  const rows = buildTopicAssignedNotificationInputs({
    db, topic, assignmentsBefore: [], assignmentsAfter: [assignment],
    eventKey: assignment.id, createdAt: new Date(NOW),
  });
  assert.deepEqual(rows.map((row) => row.recipientUserId), ["manager", "report"]);
  assert.equal(new Set(rows.map((row) => row.dedupKey)).size, 2);
  assert.equal(rows.every((row) => row.kind === "topic_assigned" && row.subjectId === topic.id), true);
});

test("management grants do not produce learner assignment notifications", () => {
  const management = {
    ...assignment,
    audience: "manager_only" as const,
    grantsManagement: true,
  };
  assert.deepEqual(buildTopicAssignedNotificationInputs({
    db, topic, assignmentsBefore: [], assignmentsAfter: [management],
    eventKey: management.id, createdAt: new Date(NOW),
  }), []);
});

test("Topic notification visibility rechecks current assignment, membership, and Topic status", () => {
  const row = buildTopicAssignedNotificationInputs({
    db, topic, assignmentsBefore: [], assignmentsAfter: [assignment],
    eventKey: assignment.id, createdAt: new Date(NOW),
  })[1]!;
  const notification = { ...row, id: "n", payload: row.payload ?? {}, createdAt: NOW,
    readAt: null, resolvedAt: null, resolution: null };
  const authority: FocusTopicAuthoritySnapshot = { assignments: [assignment], scenarioAttachments: [], contentAttachments: [] };
  assert.equal(canViewTopicAssignedNotification({ db, recipient: db.users[1]!, notification, authority }), true);
  assert.equal(canViewTopicAssignedNotification({ db, recipient: db.users[2]!, notification, authority }), false);
  assert.equal(canViewTopicAssignedNotification({ db, recipient: db.users[1]!, notification,
    authority: { ...authority, assignments: [{ ...assignment, revokedAt: NOW, revokedBy: "admin" }] } }), false);
  assert.equal(canViewTopicAssignedNotification({ db: { ...db, orgTrainings: [{ ...topic, status: "archived" }] },
    recipient: db.users[1]!, notification, authority }), false);
});

test("draft Topic and disabled organization produce no assignment notifications", () => {
  assert.deepEqual(buildTopicAssignedNotificationInputs({ db, topic: { ...topic, status: "draft" },
    assignmentsBefore: [], assignmentsAfter: [assignment], eventKey: "event", createdAt: new Date(NOW) }), []);
  assert.deepEqual(buildTopicAssignedNotificationInputs({ db: { ...db, orgs: [{ ...db.orgs[0]!, status: "disabled" }] },
    topic, assignmentsBefore: [], assignmentsAfter: [assignment], eventKey: "event", createdAt: new Date(NOW) }), []);
});

test("overlapping grants notify only users who gain effective access", () => {
  const individual = { ...assignment, id: "individual", audience: "individual" as const,
    subjectUserId: "report" };
  const first = buildTopicAssignedNotificationInputs({ db, topic, assignmentsBefore: [],
    assignmentsAfter: [individual], eventKey: individual.id, createdAt: new Date(NOW) });
  assert.deepEqual(first.map((row) => row.recipientUserId), ["report"]);
  const overlap = buildTopicAssignedNotificationInputs({ db, topic, assignmentsBefore: [individual],
    assignmentsAfter: [individual, { ...assignment, id: "organization", audience: "organization", subjectUserId: null }],
    eventKey: "organization", createdAt: new Date(NOW) });
  assert.deepEqual(overlap.map((row) => row.recipientUserId).sort(), ["manager", "other"]);
});

test("activation de-duplicates overlapping audiences and re-assignment after revocation is a new access gain", () => {
  const individual = { ...assignment, id: "individual", audience: "individual" as const,
    subjectUserId: "report" };
  const organization = { ...assignment, id: "organization", audience: "organization" as const,
    subjectUserId: null };
  const activated = buildTopicAssignedNotificationInputs({ db, topic,
    topicBefore: { ...topic, status: "draft" }, assignmentsBefore: [individual, organization],
    assignmentsAfter: [individual, organization], eventKey: "activated", createdAt: new Date(NOW) });
  assert.equal(activated.length, 3);
  assert.equal(new Set(activated.map((row) => row.recipientUserId)).size, 3);
  const revoked = { ...individual, revokedAt: NOW, revokedBy: "admin" };
  const reassigned = { ...individual, id: "individual_again", createdAt: "2026-10-08T12:00:00.000Z" };
  assert.deepEqual(buildTopicAssignedNotificationInputs({ db, topic, assignmentsBefore: [revoked],
    assignmentsAfter: [revoked, reassigned], eventKey: reassigned.id, createdAt: new Date(reassigned.createdAt) })
    .map((row) => row.recipientUserId), ["report"]);
});

test("legacy preservation applies only to structurally valid active Topic recipients", () => {
  const row = buildTopicAssignedNotificationInputs({ db, topic, assignmentsBefore: [], assignmentsAfter: [assignment],
    eventKey: assignment.id, createdAt: new Date(NOW) })[1]!;
  const notification = { ...row, id: "n", payload: row.payload ?? {}, createdAt: NOW,
    readAt: null, resolvedAt: null, resolution: null };
  assert.equal(shouldPreserveTopicAssignedNotificationInLegacyMode({
    db, recipient: db.users[1]!, notification,
  }), true);
  assert.equal(shouldPreserveTopicAssignedNotificationInLegacyMode({
    db: { ...db, orgTrainings: [{ ...topic, status: "archived" }] },
    recipient: db.users[1]!, notification,
  }), false);
});
