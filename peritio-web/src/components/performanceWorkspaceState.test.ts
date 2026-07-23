import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPerformancePlanRow, DashboardPerformanceUserOption, PerformancePlan } from "@voicepractice/shared";

import {
  buildPerformanceUserDisplayName,
  filterPerformanceRowsForUser,
  filterPerformanceUsers,
  resolveSelectedPerformanceUser,
} from "./performanceWorkspaceState";

function createUser(overrides?: Partial<DashboardPerformanceUserOption>): DashboardPerformanceUserOption {
  return {
    userId: overrides?.userId ?? "user_1",
    email: overrides?.email ?? "rob.dautel@example.com",
    displayName: overrides?.displayName ?? "Rob Dautel",
    orgId: overrides?.orgId ?? "org_1",
    orgName: overrides?.orgName ?? "Acme Health",
    timeZone: overrides?.timeZone ?? "America/Denver",
    divisionId: overrides?.divisionId ?? null,
    divisionName: overrides?.divisionName ?? null,
    status: overrides?.status ?? "active",
    orgRole: overrides?.orgRole ?? "user",
    activePlanCount: overrides?.activePlanCount ?? 0,
    canManagePerformancePlans: overrides?.canManagePerformancePlans ?? true,
    assignableFocusTopics: overrides?.assignableFocusTopics ?? [],
    assignableScenarios: overrides?.assignableScenarios ?? [],
  };
}

function createPlan(overrides?: Partial<PerformancePlan>): PerformancePlan {
  return {
    id: overrides?.id ?? "plan_1",
    orgId: overrides?.orgId ?? "org_1",
    userId: overrides?.userId ?? "user_1",
    createdByActorType: "dashboard_user",
    createdByActorId: "manager_1",
    createdAt: "2026-07-20T12:00:00.000Z",
    submittedAt: "2026-07-20T12:00:00.000Z",
    effectiveAt: "2026-07-20T12:00:00.000Z",
    startDate: "2026-07-20",
    endDate: "2026-08-20",
    timeZone: "UTC",
    status: "active",
    completedAt: null,
    cancelledAt: null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: { enabled: true, metricType: "weekly_session_count", targetValue: 2 },
    performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null },
    scope: { allAssignedScenarios: false, selectedFocusTopicIds: [], selectedScenarioIds: [], scenarios: [] },
    baseline: null,
    finalResult: null,
    updatedAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function createRow(overrides?: Partial<DashboardPerformancePlanRow>): DashboardPerformancePlanRow {
  return {
    plan: overrides?.plan ?? createPlan(),
    userEmail: overrides?.userEmail ?? "rob.dautel@example.com",
    orgName: overrides?.orgName ?? "Acme Health",
    divisionId: overrides?.divisionId ?? null,
    divisionName: overrides?.divisionName ?? null,
    progress: overrides?.progress ?? null,
    insights: overrides?.insights ?? [],
    canCancel: overrides?.canCancel ?? true,
    canEdit: overrides?.canEdit ?? true,
  };
}

test("Performance user selector prefers real display names, sorts by name, and searches name or email", () => {
  const users = [
    createUser({ userId: "zoe", email: "zoe.internal@example.com", displayName: "Zoe Bell" }),
    createUser({ userId: "amy", email: "amy.adams@example.com", displayName: "amy Adams" }),
    createUser({ userId: "ben", email: "ben.carter@example.com", displayName: "Ben Carter" }),
  ];

  assert.deepEqual(filterPerformanceUsers(users, "").map((user) => user.userId), ["amy", "ben", "zoe"]);
  assert.deepEqual(filterPerformanceUsers(users, "Zoe").map((user) => user.userId), ["zoe"]);
  assert.deepEqual(filterPerformanceUsers(users, "Bell").map((user) => user.userId), ["zoe"]);
  assert.deepEqual(filterPerformanceUsers(users, "Ben Carter").map((user) => user.userId), ["ben"]);
  assert.deepEqual(filterPerformanceUsers(users, "amy.adams@example.com").map((user) => user.userId), ["amy"]);
  assert.equal(buildPerformanceUserDisplayName(users[0]), "Zoe Bell");
});

test("Performance user selector falls back safely when a name is missing", () => {
  assert.equal(buildPerformanceUserDisplayName(createUser({ displayName: "", email: "fallback@example.com" })), "fallback@example.com");
  assert.equal(buildPerformanceUserDisplayName(createUser({ displayName: "", email: "" })), "Account user");
});

test("Performance selected user resolution keeps unauthorized users excluded", () => {
  const users = [createUser({ userId: "visible_user" })];

  assert.equal(resolveSelectedPerformanceUser(users, ""), null);
  assert.equal(resolveSelectedPerformanceUser(users, "other_org_user"), null);
  assert.equal(resolveSelectedPerformanceUser(users, "visible_user")?.userId, "visible_user");
});

test("Performance rows are filtered to the explicitly selected user only", () => {
  const rows = [
    createRow({ plan: createPlan({ id: "selected_active", userId: "selected_user" }) }),
    createRow({ plan: createPlan({ id: "other_active", userId: "other_user" }), userEmail: "other@example.com" }),
  ];

  assert.deepEqual(filterPerformanceRowsForUser(rows, null).map((row) => row.plan.id), []);
  assert.deepEqual(filterPerformanceRowsForUser(rows, "selected_user").map((row) => row.plan.id), ["selected_active"]);
});
