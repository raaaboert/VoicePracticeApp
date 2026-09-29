import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceDeniedError,
  AuthorizedOrganizationPerformanceInputError,
  AuthorizedOrganizationPerformanceInvariantError,
  type AuthorizedOrganizationPerformanceResult,
} from "./authorizedOrganizationPerformance.js";
import { queryDashboardOrganizationPerformanceRoute } from "./dashboardOrganizationPerformanceRoute.js";
import type { PerformanceEvidenceSourceSnapshot } from "./performanceEvidenceSourceSnapshot.js";

const viewer: DashboardViewer = {
  accessType: "customer_dashboard_user",
  userId: "viewer",
  email: "viewer@example.test",
  isSuperUser: false,
  orgId: "org_1",
  orgName: "Organization",
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
  scoreRecords: [],
  users: [],
  organizations: [],
  trainings: [],
};

const result: AuthorizedOrganizationPerformanceResult = {
  calendarMonth: { year: 2026, month: 9, timeZone: "UTC" },
  dimensionFilter: null,
  historicalScope: "organization_history",
  activity: null,
  completionGroups: [],
  metricGroups: [],
  historicalPrivacyAdjustmentApplied: false,
};

test("captures the snapshot before invoking the route-safe facade", async () => {
  const events: string[] = [];
  const actual = await queryDashboardOrganizationPerformanceRoute({
    query: { orgId: "org_1", year: "2026", month: "9" },
    viewer,
    async captureSnapshot() {
      events.push("lock:start");
      events.push("app-state:read-only");
      events.push("lock:end");
      return snapshot;
    },
    queryOrganizationPerformance(query) {
      events.push("facade");
      assert.strictEqual(query.snapshot, snapshot);
      assert.strictEqual(query.viewer, viewer);
      assert.equal(query.organizationId, "org_1");
      assert.deepEqual(query.calendarMonth, { year: 2026, month: 9 });
      return result;
    },
  });

  assert.strictEqual(actual, result);
  assert.deepEqual(events, ["lock:start", "app-state:read-only", "lock:end", "facade"]);
});

test("rejects every snapshot-independent invalid request before capture", async () => {
  for (const query of [
    { year: "2026", month: "9" },
    { orgId: "org_1", month: "9" },
    { orgId: "org_1", year: "2026" },
    { orgId: "org_1", year: "1969", month: "9" },
    { orgId: "org_1", year: "2026", month: "13" },
    { orgId: "org_1", year: ["2026", "2027"], month: "9" },
    { orgId: "org_1", year: "2026", month: ["9", "10"] },
    { orgId: "org_1", year: "2026", month: "9", dimension: "person", dimensionId: "user_1" },
    { orgId: "org_1", year: "2026", month: "9", dimension: "division" },
    { orgId: "org_1", year: "2026", month: "9", dimensionId: "division_1" },
    { orgId: "org_1", year: "2026", month: "9", dimension: ["division", "scenario"], dimensionId: "id" },
    { orgId: "org_1", year: "2026", month: "9", from: "2026-09-01" },
  ]) {
    let captureCalled = false;
    await assert.rejects(
      queryDashboardOrganizationPerformanceRoute({
        query,
        viewer,
        captureSnapshot: async () => {
          captureCalled = true;
          return snapshot;
        },
      }),
      AuthorizedOrganizationPerformanceInputError,
    );
    assert.equal(captureCalled, false);
  }
});

test("rejects an obvious customer cross-organization request before snapshot capture", async () => {
  let captureCalled = false;
  await assert.rejects(
    queryDashboardOrganizationPerformanceRoute({
      query: { orgId: "org_2", year: "2026", month: "9" },
      viewer,
      captureSnapshot: async () => {
        captureCalled = true;
        return snapshot;
      },
    }),
    (error) =>
      error instanceof AuthorizedOrganizationPerformanceDeniedError
      && error.reason === "organization_not_found_or_inaccessible",
  );
  assert.equal(captureCalled, false);
});

test("propagates mixed-organization invariants as internal errors", async () => {
  const invariant = new AuthorizedOrganizationPerformanceInvariantError();
  await assert.rejects(
    queryDashboardOrganizationPerformanceRoute({
      query: { orgId: "org_1", year: "2026", month: "9" },
      viewer,
      captureSnapshot: async () => snapshot,
      queryOrganizationPerformance() {
        throw invariant;
      },
    }),
    (error) => error === invariant && !(error instanceof AuthorizedOrganizationPerformanceInputError),
  );
});
