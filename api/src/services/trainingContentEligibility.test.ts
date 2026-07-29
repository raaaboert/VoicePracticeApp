import assert from "node:assert/strict";
import test from "node:test";

import type {
  TrainingContentAssignment,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import { resolveTrainingContentEligibility } from "./trainingContentEligibility.js";

const NOW = "2026-07-28T12:00:00.000Z";

function user(
  id: string,
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: id,
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    timezone: "UTC",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function content(overrides: Partial<TrainingContentItem> = {}): TrainingContentItem {
  return {
    id: "content_1",
    orgId: "org_1",
    title: "Coaching",
    description: "",
    focusTopicId: null,
    focusTopicNameSnapshot: null,
    contentType: "native",
    publicationState: "published",
    nativeBody: "# Coaching",
    externalUrl: null,
    displayOrder: 0,
    contentVersion: 1,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function assignment(
  assignmentType: TrainingContentAssignment["assignmentType"],
  subjectUserId: string | null,
  overrides: Partial<TrainingContentAssignment> = {}
): TrainingContentAssignment {
  return {
    id: `${assignmentType}_${subjectUserId ?? "org"}`,
    orgId: "org_1",
    contentId: "content_1",
    assignmentType,
    subjectUserId,
    createdByActorId: "admin",
    createdAt: NOW,
    revokedByActorId: null,
    revokedAt: null,
    ...overrides,
  };
}

test("eligibility applies OR semantics across organization, direct, manager, and dynamic team grants", () => {
  const manager = user("manager", { orgRole: "user_admin" });
  const report = user("report", { managerUserId: manager.id });
  const assignments = [
    assignment("organization", null),
    assignment("user", report.id),
    assignment("manager_team", manager.id),
  ];
  const result = resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: report.id,
    moduleEnabled: true,
    content: content(),
    assignments,
    users: [manager, report],
  });
  assert.deepEqual(result, {
    eligible: true,
    grants: ["organization", "user", "manager_team"],
    reason: "eligible",
  });

  const managerResult = resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: manager.id,
    moduleEnabled: true,
    content: content(),
    assignments: [assignment("manager", manager.id)],
    users: [manager, report],
  });
  assert.deepEqual(managerResult.grants, ["manager"]);
});

test("manager-team eligibility follows the current direct-report relationship without materialization", () => {
  const manager = user("manager", { orgRole: "user_admin" });
  const report = user("report", { managerUserId: manager.id });
  const teamRule = assignment("manager_team", manager.id);
  const eligible = resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: report.id,
    moduleEnabled: true,
    content: content(),
    assignments: [teamRule],
    users: [manager, report],
  });
  assert.equal(eligible.eligible, true);

  const moved = resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: report.id,
    moduleEnabled: true,
    content: content(),
    assignments: [teamRule],
    users: [manager, { ...report, managerUserId: null }],
  });
  assert.deepEqual(moved, { eligible: false, grants: [], reason: "not_assigned" });
});

test("demoted, deactivated, cross-org, and revoked manager rules stop granting access", () => {
  const report = user("report", { managerUserId: "manager" });
  for (const manager of [
    user("manager", { orgRole: "user" }),
    user("manager", { orgRole: "user_admin", status: "disabled" }),
    user("manager", { orgRole: "user_admin", orgId: "org_2" }),
  ]) {
    const result = resolveTrainingContentEligibility({
      orgId: "org_1",
      userId: report.id,
      moduleEnabled: true,
      content: content(),
      assignments: [assignment("manager_team", "manager")],
      users: [manager, report],
    });
    assert.equal(result.eligible, false);
  }

  const revoked = resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: report.id,
    moduleEnabled: true,
    content: content(),
    assignments: [
      assignment("manager_team", "manager", {
        revokedAt: NOW,
        revokedByActorId: "admin",
      }),
    ],
    users: [user("manager", { orgRole: "user_admin" }), report],
  });
  assert.equal(revoked.eligible, false);
});

test("eligibility fails closed for disabled modules, non-published content, and inactive membership", () => {
  const learner = user("learner");
  assert.equal(resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: learner.id,
    moduleEnabled: false,
    content: content(),
    assignments: [assignment("organization", null)],
    users: [learner],
  }).reason, "module_disabled");

  assert.equal(resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: learner.id,
    moduleEnabled: true,
    content: content({ publicationState: "draft" }),
    assignments: [assignment("organization", null)],
    users: [learner],
  }).reason, "content_unavailable");

  assert.equal(resolveTrainingContentEligibility({
    orgId: "org_1",
    userId: learner.id,
    moduleEnabled: true,
    content: content(),
    assignments: [assignment("organization", null)],
    users: [{ ...learner, status: "disabled" }],
  }).reason, "inactive_membership");
});
