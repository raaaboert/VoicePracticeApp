import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer } from "@voicepractice/shared";

import type { AuthorizedTeamPerformanceIntelligenceResult } from "./authorizedTeamPerformanceIntelligence.js";
import { AuthorizedOrganizationPerformanceInputError } from "./authorizedOrganizationPerformance.js";
import { AuthorizedTeamPerformanceDeniedError } from "./authorizedTeamPerformance.js";
import { queryDashboardTeamPerformanceIntelligenceRoute } from "./dashboardTeamPerformanceIntelligenceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

const viewer: DashboardViewer = {
  accessType: "customer_dashboard_user",
  userId: "manager",
  email: "manager@example.test",
  isSuperUser: false,
  orgId: "org_a",
  orgName: "Organization A",
  orgRole: "user",
  performanceAccess: "team",
  capabilities: {
    viewOrganizationUsers: false,
    manageRegularOrganizationUsers: false,
    approveRejectAccessRequests: false,
    editEmployeeIds: false,
    editUserNames: false,
    manageUserRoles: false,
    assignUserManagers: false,
    managePerformanceAccess: false,
    manageOrganizationContent: false,
  },
};
const snapshot: PerformanceEvidenceSourceSnapshot = {
  users: [], scoreRecords: [], organizations: [], trainings: [],
};
const result = { scope: "team" } as AuthorizedTeamPerformanceIntelligenceResult;

test("valid intelligence route captures once and supplies one exact server asOf to the route-safe facade", async () => {
  const events: string[] = [];
  const asOf = new Date("2026-10-01T00:00:00.000Z");
  const actual = await queryDashboardTeamPerformanceIntelligenceRoute({
    query: { orgId: "org_a", year: "2026", month: "9" },
    viewer,
    async captureSnapshot() {
      events.push("capture");
      return snapshot;
    },
    getAsOf() {
      events.push("asOf");
      return asOf;
    },
    queryTeamPerformanceIntelligence(input) {
      events.push("facade");
      assert.strictEqual(input.snapshot, snapshot);
      assert.strictEqual(input.viewer, viewer);
      assert.strictEqual(input.asOf, asOf);
      assert.equal(input.organizationId, "org_a");
      assert.deepEqual(input.calendarMonth, { year: 2026, month: 9 });
      return result;
    },
  });

  assert.strictEqual(actual, result);
  assert.deepEqual(events, ["capture", "asOf", "facade"]);
});

test("invalid, repeated, caller-authoritative, and unsupported query fields fail before capture", async () => {
  const invalidQueries = [
    { year: "2026", month: "9" },
    { orgId: "org_a", month: "9" },
    { orgId: "org_a", year: "2026" },
    { orgId: "org_a", year: "1969", month: "9" },
    { orgId: "org_a", year: "2026", month: "13" },
    { orgId: ["org_a", "org_a"], year: "2026", month: "9" },
    { orgId: "org_a", year: ["2026", "2027"], month: "9" },
    { orgId: "org_a", year: "2026", month: ["9", "10"] },
    { orgId: "org_a", year: "2026", month: "9", asOf: "2026-10-01T00:00:00Z" },
    { orgId: "org_a", year: "2026", month: "9", managerId: "manager" },
    { orgId: "org_a", year: "2026", month: "9", userId: "report" },
    { orgId: "org_a", year: "2026", month: "9", dimension: "division" },
    { orgId: "org_a", year: "2026", month: "9", trainingId: "training" },
    { orgId: "org_a", year: "2026", month: "9", scenarioId: "scenario" },
    { orgId: "org_a", year: "2026", month: "9", from: "2026-09-01" },
  ];

  for (const query of invalidQueries) {
    let captures = 0;
    let clockReads = 0;
    await assert.rejects(queryDashboardTeamPerformanceIntelligenceRoute({
      query,
      viewer,
      async captureSnapshot() {
        captures++;
        return snapshot;
      },
      getAsOf() {
        clockReads++;
        return new Date();
      },
    }), AuthorizedOrganizationPerformanceInputError);
    assert.equal(captures, 0);
    assert.equal(clockReads, 0);
  }
});

test("obvious customer cross-org intelligence requests fail before snapshot capture", async () => {
  let captures = 0;
  await assert.rejects(queryDashboardTeamPerformanceIntelligenceRoute({
    query: { orgId: "org_b", year: "2026", month: "9" },
    viewer,
    async captureSnapshot() {
      captures++;
      return snapshot;
    },
  }), (error) => error instanceof AuthorizedTeamPerformanceDeniedError
    && error.reason === "organization_not_found_or_inaccessible");
  assert.equal(captures, 0);
});

test("intelligence facade failures propagate for safe HTTP-layer classification", async () => {
  const failure = new Error("internal failure");
  await assert.rejects(queryDashboardTeamPerformanceIntelligenceRoute({
    query: { orgId: "org_a", year: "2026", month: "9" },
    viewer,
    captureSnapshot: async () => snapshot,
    queryTeamPerformanceIntelligence() {
      throw failure;
    },
  }), (error) => error === failure);
});
