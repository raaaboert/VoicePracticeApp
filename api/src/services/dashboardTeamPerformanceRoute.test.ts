import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer } from "@voicepractice/shared";

import { AuthorizedOrganizationPerformanceInputError, type AuthorizedOrganizationPerformanceResult } from "./authorizedOrganizationPerformance.js";
import { AuthorizedTeamPerformanceDeniedError } from "./authorizedTeamPerformance.js";
import { queryDashboardTeamPerformanceRoute } from "./dashboardTeamPerformanceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

const viewer: DashboardViewer = {
  accessType: "customer_dashboard_user", userId: "manager", email: "manager@example.test",
  isSuperUser: false, orgId: "org_a", orgName: "Organization A", orgRole: "user",
  performanceAccess: "team",
  capabilities: {
    viewOrganizationUsers: false, manageRegularOrganizationUsers: false,
    approveRejectAccessRequests: false, editEmployeeIds: false, editUserNames: false,
    manageUserRoles: false, assignUserManagers: false, managePerformanceAccess: false,
    manageOrganizationContent: false,
  },
};
const snapshot: PerformanceEvidenceSourceSnapshot = {
  users: [], scoreRecords: [], organizations: [], trainings: [],
};
const result: AuthorizedOrganizationPerformanceResult = {
  calendarMonth: { year: 2026, month: 9, timeZone: "UTC" },
  dimensionFilter: null, historicalScope: "current_population", activity: null,
  completionGroups: [], metricGroups: [], historicalPrivacyAdjustmentApplied: false,
};

test("valid team route captures one snapshot before invoking only the route-safe facade", async () => {
  const events: string[] = [];
  const actual = await queryDashboardTeamPerformanceRoute({
    query: { orgId: "org_a", year: "2026", month: "9" }, viewer,
    async captureSnapshot() { events.push("capture"); return snapshot; },
    queryTeamPerformance(input) {
      events.push("facade");
      assert.strictEqual(input.snapshot, snapshot);
      assert.strictEqual(input.viewer, viewer);
      assert.equal(input.organizationId, "org_a");
      assert.deepEqual(input.calendarMonth, { year: 2026, month: 9 });
      return result;
    },
  });
  assert.strictEqual(actual, result);
  assert.deepEqual(events, ["capture", "facade"]);
});

test("invalid and unsupported team query fields fail before snapshot capture", async () => {
  for (const query of [
    { year: "2026", month: "9" },
    { orgId: "org_a", month: "9" },
    { orgId: "org_a", year: "2026" },
    { orgId: "org_a", year: "1969", month: "9" },
    { orgId: "org_a", year: "2026", month: "13" },
    { orgId: ["org_a", "org_a"], year: "2026", month: "9" },
    { orgId: "org_a", year: ["2026", "2027"], month: "9" },
    { orgId: "org_a", year: "2026", month: ["9", "10"] },
    { orgId: "org_a", year: "2026", month: "9", dimension: "division", dimensionId: "division_a" },
    { orgId: "org_a", year: "2026", month: "9", from: "2026-09-01" },
  ]) {
    let captures = 0;
    await assert.rejects(queryDashboardTeamPerformanceRoute({
      query, viewer, async captureSnapshot() { captures++; return snapshot; },
    }), AuthorizedOrganizationPerformanceInputError);
    assert.equal(captures, 0);
  }
});

test("obvious cross-org team request fails before snapshot capture", async () => {
  let captures = 0;
  await assert.rejects(queryDashboardTeamPerformanceRoute({
    query: { orgId: "org_b", year: "2026", month: "9" }, viewer,
    async captureSnapshot() { captures++; return snapshot; },
  }), (error) => error instanceof AuthorizedTeamPerformanceDeniedError
    && error.reason === "organization_not_found_or_inaccessible");
  assert.equal(captures, 0);
});

test("team route does not turn facade invariants into validation or scope denials", async () => {
  const invariant = new Error("internal invariant");
  await assert.rejects(queryDashboardTeamPerformanceRoute({
    query: { orgId: "org_a", year: "2026", month: "9" }, viewer,
    captureSnapshot: async () => snapshot,
    queryTeamPerformance() { throw invariant; },
  }), (error) => error === invariant);
});
