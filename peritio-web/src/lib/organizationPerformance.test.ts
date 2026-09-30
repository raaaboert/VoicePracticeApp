import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrganizationPerformance,
  resolvePerformanceOverviewScope,
  type OrganizationPerformanceResponse,
} from "./organizationPerformance";

const EMPTY_RESPONSE: OrganizationPerformanceResponse = {
  calendarMonth: { year: 2026, month: 9, timeZone: "UTC" },
  dimensionFilter: null,
  historicalScope: "organization_history",
  activity: {
    attemptCount: 0,
    conclusiveAttemptCount: 0,
    evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: false },
    concentration: { concentrationWarning: false },
    historicalPrivacyAdjustmentApplied: false,
  },
  completionGroups: [],
  metricGroups: [],
  historicalPrivacyAdjustmentApplied: false,
};

test("organization performance client sends the explicit month and optional dimension", async () => {
  let requestedUrl = "";
  const result = await getOrganizationPerformance({
    orgId: "org 1",
    year: 2026,
    month: 9,
    dimension: "training",
    dimensionId: "topic/1",
  }, async (input) => {
    requestedUrl = String(input);
    return Response.json(EMPTY_RESPONSE);
  });

  assert.equal(result.kind, "success");
  assert.equal(
    requestedUrl,
    "/api/performance/organization?orgId=org+1&year=2026&month=9&dimension=training&dimensionId=topic%2F1"
  );
});

test("organization performance client maps scope denial, not-found, and other errors distinctly", async () => {
  const denied = await getOrganizationPerformance(
    { orgId: "org_1", year: 2026, month: 9 },
    async () => Response.json({ error: "denied", code: "dashboard_scope_denied" }, { status: 403 })
  );
  const missing = await getOrganizationPerformance(
    { orgId: "org_1", year: 2026, month: 9 },
    async () => Response.json({ error: "missing" }, { status: 404 })
  );
  const failed = await getOrganizationPerformance(
    { orgId: "org_1", year: 2026, month: 9 },
    async () => Response.json({ error: "temporarily unavailable" }, { status: 500 })
  );

  assert.deepEqual(denied, { kind: "access_denied" });
  assert.deepEqual(missing, { kind: "not_found" });
  assert.deepEqual(failed, { kind: "error", message: "temporarily unavailable" });
});

test("team-only viewer resolves to the pending team scope without an organization target", () => {
  assert.deepEqual(resolvePerformanceOverviewScope({
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    orgName: "Customer",
    performanceAccess: "team",
  }), { kind: "team_pending" });

  assert.deepEqual(resolvePerformanceOverviewScope({
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    orgName: "Customer",
    performanceAccess: "organization",
  }), { kind: "organization", orgId: "org_1", orgName: "Customer" });
});

test("super-user organization context is explicit", () => {
  const viewer = {
    accessType: "super_user" as const,
    orgId: null,
    orgName: null,
    performanceAccess: "organization" as const,
  };
  assert.deepEqual(resolvePerformanceOverviewScope(viewer), { kind: "select_organization" });
  assert.deepEqual(resolvePerformanceOverviewScope(viewer, "org_2"), {
    kind: "organization",
    orgId: "org_2",
    orgName: null,
  });
});
