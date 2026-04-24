import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApiDatabase,
  TrainingPackAssignmentRecord,
  UserProfile,
} from "@voicepractice/shared";

import {
  deactivateInvalidTrainingPackAssignments,
  deactivateInvalidTrainingPackAssignmentsForUser,
  deactivateTrainingPackAssignmentsForUser,
  isTrainingPackAssignmentValidForUser,
  isTrainingPackAssignmentEligibleUser,
  listTrainingPackAssignmentEligibleUsers,
} from "./trainingPackAssignments.js";

function createUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-04-01T00:00:00.000Z",
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "America/Denver",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-04-01T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-04-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T00:00:00.000Z",
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
  };
}

function createAssignment(overrides: Partial<TrainingPackAssignmentRecord> = {}): TrainingPackAssignmentRecord {
  return {
    id: overrides.id ?? "assign_1",
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    active: overrides.active ?? true,
    assignedAt: overrides.assignedAt ?? "2026-04-01T09:00:00.000Z",
    assignedByUserId: overrides.assignedByUserId ?? null,
    requiredScenarioIds: overrides.requiredScenarioIds ?? ["scenario_1"],
    completionRule: overrides.completionRule ?? "scored_required_scenarios_v1",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-04-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T09:00:00.000Z",
  };
}

test("training pack assignment eligibility only allows active enterprise users in the org", () => {
  assert.equal(isTrainingPackAssignmentEligibleUser(createUser(), "org_1"), true);
  assert.equal(isTrainingPackAssignmentEligibleUser(createUser({ status: "disabled" }), "org_1"), false);
  assert.equal(isTrainingPackAssignmentEligibleUser(createUser({ accountType: "individual" }), "org_1"), false);
  assert.equal(isTrainingPackAssignmentEligibleUser(createUser({ orgId: "org_2" }), "org_1"), false);
  assert.equal(isTrainingPackAssignmentValidForUser(createAssignment({ orgId: "org_1" }), createUser()), true);
  assert.equal(
    isTrainingPackAssignmentValidForUser(createAssignment({ orgId: "org_1" }), createUser({ status: "disabled" })),
    false
  );
  assert.equal(
    isTrainingPackAssignmentValidForUser(createAssignment({ orgId: "org_1" }), createUser({ orgId: "org_2" })),
    false
  );
  assert.equal(isTrainingPackAssignmentValidForUser(createAssignment({ orgId: "org_1" }), null), false);

  const eligible = listTrainingPackAssignmentEligibleUsers(
    [
      createUser({ id: "user_active" }),
      createUser({ id: "user_disabled", status: "disabled" }),
      createUser({ id: "user_other_org", orgId: "org_2" }),
    ],
    "org_1"
  );
  assert.deepEqual(eligible.map((user) => user.id), ["user_active"]);
});

test("deactivateTrainingPackAssignmentsForUser deactivates only live assignments for the deleted user", () => {
  const assignments = [
    createAssignment({ id: "assign_keep_other_user", userId: "user_other" }),
    createAssignment({ id: "assign_keep_inactive", userId: "user_1", active: false }),
    createAssignment({ id: "assign_deactivate", userId: "user_1", updatedAt: "2026-04-01T10:00:00.000Z" }),
  ];

  const changedCount = deactivateTrainingPackAssignmentsForUser(assignments, "user_1", "2026-04-02T00:00:00.000Z");
  assert.equal(changedCount, 1);
  assert.equal(assignments[0]?.active, true);
  assert.equal(assignments[1]?.active, false);
  assert.equal(assignments[2]?.active, false);
  assert.equal(assignments[2]?.updatedAt, "2026-04-02T00:00:00.000Z");
});

test("deactivateInvalidTrainingPackAssignments repairs orphaned and otherwise ineligible live assignments", () => {
  const db = {
    users: [
      createUser({ id: "user_keep" }),
      createUser({ id: "user_disabled", status: "disabled" }),
      createUser({ id: "user_wrong_org", orgId: "org_2" }),
      createUser({ id: "user_individual", accountType: "individual", orgId: null }),
    ],
    trainingPackAssignments: [
      createAssignment({ id: "assign_keep", userId: "user_keep" }),
      createAssignment({ id: "assign_orphan", userId: "user_missing" }),
      createAssignment({ id: "assign_disabled", userId: "user_disabled" }),
      createAssignment({ id: "assign_wrong_org", userId: "user_wrong_org" }),
      createAssignment({ id: "assign_individual", userId: "user_individual" }),
      createAssignment({ id: "assign_orphan_inactive", userId: "user_missing", active: false }),
    ],
  } as ApiDatabase;

  const changedCount = deactivateInvalidTrainingPackAssignments({
    db,
    nowIso: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(changedCount, 4);
  assert.equal(db.trainingPackAssignments[0]?.active, true);
  assert.equal(db.trainingPackAssignments[1]?.active, false);
  assert.equal(db.trainingPackAssignments[1]?.updatedAt, "2026-04-03T00:00:00.000Z");
  assert.equal(db.trainingPackAssignments[2]?.active, false);
  assert.equal(db.trainingPackAssignments[3]?.active, false);
  assert.equal(db.trainingPackAssignments[4]?.active, false);
  assert.equal(db.trainingPackAssignments[5]?.active, false);
});

test("deactivateInvalidTrainingPackAssignmentsForUser deactivates only that user's invalid live assignments", () => {
  const assignments = [
    createAssignment({ id: "assign_keep_other_user", userId: "user_other" }),
    createAssignment({ id: "assign_disable_target_a", userId: "user_target", orgId: "org_1" }),
    createAssignment({ id: "assign_disable_target_b", userId: "user_target", trainingPackId: "pack_2" }),
    createAssignment({ id: "assign_keep_inactive", userId: "user_target", active: false }),
  ];

  const changedCount = deactivateInvalidTrainingPackAssignmentsForUser({
    assignments,
    userId: "user_target",
    user: createUser({ id: "user_target", status: "disabled" }),
    nowIso: "2026-04-03T12:00:00.000Z",
  });

  assert.equal(changedCount, 2);
  assert.equal(assignments[0]?.active, true);
  assert.equal(assignments[1]?.active, false);
  assert.equal(assignments[1]?.updatedAt, "2026-04-03T12:00:00.000Z");
  assert.equal(assignments[2]?.active, false);
  assert.equal(assignments[2]?.updatedAt, "2026-04-03T12:00:00.000Z");
  assert.equal(assignments[3]?.active, false);
});

test("deactivateInvalidTrainingPackAssignments can target one pack without touching valid rows elsewhere", () => {
  const db = {
    users: [
      createUser({ id: "user_keep" }),
      createUser({ id: "user_disabled", status: "disabled" }),
    ],
    trainingPackAssignments: [
      createAssignment({ id: "assign_keep_other_pack", userId: "user_keep", trainingPackId: "pack_2" }),
      createAssignment({ id: "assign_disabled_target_pack", userId: "user_disabled", trainingPackId: "pack_1" }),
    ],
  } as ApiDatabase;

  const changedCount = deactivateInvalidTrainingPackAssignments({
    db,
    nowIso: "2026-04-04T00:00:00.000Z",
    orgId: "org_1",
    trainingPackId: "pack_1",
  });

  assert.equal(changedCount, 1);
  assert.equal(db.trainingPackAssignments[0]?.active, true);
  assert.equal(db.trainingPackAssignments[1]?.active, false);
});
