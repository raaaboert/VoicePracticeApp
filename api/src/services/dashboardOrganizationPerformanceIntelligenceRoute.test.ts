import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer } from "@voicepractice/shared";

import type { AuthorizedOrganizationPerformanceIntelligenceResult } from "./authorizedOrganizationPerformanceIntelligence.js";
import {
  AuthorizedOrganizationPerformanceDeniedError,
  AuthorizedOrganizationPerformanceInputError,
} from "./authorizedOrganizationPerformance.js";
import { queryDashboardOrganizationPerformanceIntelligenceRoute } from "./dashboardOrganizationPerformanceIntelligenceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

const viewer: DashboardViewer = {
  accessType: "customer_dashboard_user",
  userId: "organization_viewer",
  email: "organization-viewer@example.test",
  isSuperUser: false,
  orgId: "org_a",
  orgName: "Organization A",
  orgRole: "user",
  performanceAccess: "organization",
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
const result = { scope: "organization" } as AuthorizedOrganizationPerformanceIntelligenceResult;

test("valid route captures once and supplies one exact server-owned asOf to the facade", async () => {
  const events: string[] = [];
  const asOf = new Date("2026-10-01T00:00:00.000Z");
  const actual = await queryDashboardOrganizationPerformanceIntelligenceRoute({
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
    queryOrganizationPerformanceIntelligence(input) {
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

test("only orgId, year, and month are accepted, with validation before capture or clock access", async () => {
  const invalidQueries = [
    { year: "2026", month: "9" },
    { orgId: "org_a", month: "9" },
    { orgId: "org_a", year: "2026" },
    { orgId: "org_a", year: "1969", month: "9" },
    { orgId: "org_a", year: "2026", month: "13" },
    { orgId: ["org_a", "org_a"], year: "2026", month: "9" },
    { orgId: "org_a", year: ["2026", "2027"], month: "9" },
    { orgId: "org_a", year: "2026", month: ["9", "10"] },
    { orgId: "org_a", year: "2026", month: "9", asOf: "2026-10-01" },
    { orgId: "org_a", year: "2026", month: "9", userId: "user" },
    { orgId: "org_a", year: "2026", month: "9", managerId: "manager" },
    { orgId: "org_a", year: "2026", month: "9", memberId: "member" },
    { orgId: "org_a", year: "2026", month: "9", dimension: "division" },
    { orgId: "org_a", year: "2026", month: "9", dimensionId: "division_a" },
    { orgId: "org_a", year: "2026", month: "9", trainingId: "training" },
    { orgId: "org_a", year: "2026", month: "9", scenarioId: "scenario" },
    { orgId: "org_a", year: "2026", month: "9", trainingPackId: "pack" },
    { orgId: "org_a", year: "2026", month: "9", from: "2026-09-01" },
    { orgId: "org_a", year: "2026", month: "9", to: "2026-10-01" },
    { orgId: "org_a", year: "2026", month: "9", unexpected: "value" },
  ];
  for (const query of invalidQueries) {
    let captures = 0;
    let clockReads = 0;
    await assert.rejects(queryDashboardOrganizationPerformanceIntelligenceRoute({
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

test("obvious customer cross-organization requests preserve existence hiding before capture", async () => {
  let captures = 0;
  await assert.rejects(queryDashboardOrganizationPerformanceIntelligenceRoute({
    query: { orgId: "org_b", year: "2026", month: "9" },
    viewer,
    async captureSnapshot() {
      captures++;
      return snapshot;
    },
  }), (error) => error instanceof AuthorizedOrganizationPerformanceDeniedError
    && error.reason === "organization_not_found_or_inaccessible");
  assert.equal(captures, 0);
});

test("facade failures propagate for HTTP classification", async () => {
  const failure = new Error("internal failure");
  await assert.rejects(queryDashboardOrganizationPerformanceIntelligenceRoute({
    query: { orgId: "org_a", year: "2026", month: "9" },
    viewer,
    captureSnapshot: async () => snapshot,
    queryOrganizationPerformanceIntelligence() {
      throw failure;
    },
  }), (error) => error === failure);
});
