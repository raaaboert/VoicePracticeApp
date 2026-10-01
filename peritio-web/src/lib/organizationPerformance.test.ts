import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getPerformanceGroupSummary,
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

const libRoot = dirname(fileURLToPath(import.meta.url));

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

test("team and organization clients call only their selected endpoint", async () => {
  const urls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ ...EMPTY_RESPONSE, historicalScope: "current_population" });
  };
  assert.equal((await getPerformanceGroupSummary({
    scope: "team", orgId: "org_1", year: 2026, month: 9,
  }, fetcher)).kind, "success");
  assert.deepEqual(urls, ["/api/performance/team?orgId=org_1&year=2026&month=9"]);

  urls.length = 0;
  assert.equal((await getPerformanceGroupSummary({
    scope: "organization", orgId: "org_1", year: 2026, month: 9,
  }, async (input) => {
    urls.push(String(input));
    return Response.json(EMPTY_RESPONSE);
  })).kind, "success");
  assert.deepEqual(urls, ["/api/performance/organization?orgId=org_1&year=2026&month=9"]);
});

test("team client maps denials distinctly and rejects historical team responses", async () => {
  const input = { scope: "team" as const, orgId: "org_1", year: 2026, month: 9 };
  assert.deepEqual(await getPerformanceGroupSummary(input,
    async () => Response.json({ error: "denied", code: "dashboard_scope_denied" }, { status: 403 })),
    { kind: "access_denied" });
  assert.deepEqual(await getPerformanceGroupSummary(input,
    async () => Response.json({ error: "missing" }, { status: 404 })),
    { kind: "not_found" });
  assert.deepEqual(await getPerformanceGroupSummary(input,
    async () => Response.json({ error: "unavailable" }, { status: 500 })),
    { kind: "error", message: "unavailable" });
  assert.deepEqual(await getPerformanceGroupSummary(input,
    async () => Response.json(EMPTY_RESPONSE)),
    { kind: "error", message: "Team performance data could not be loaded. Please retry." });
  assert.deepEqual(await getPerformanceGroupSummary(input,
    async () => Response.json({
      ...EMPTY_RESPONSE,
      historicalScope: "current_population",
      historicalPrivacyAdjustmentApplied: true,
    })), { kind: "error", message: "Team performance data could not be loaded. Please retry." });
});

test("team-only viewer resolves to an explicit team scope with organization context", () => {
  assert.deepEqual(resolvePerformanceOverviewScope({
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    orgName: "Customer",
    performanceAccess: "team",
  }), { kind: "team", orgId: "org_1", orgName: "Customer" });

  assert.deepEqual(resolvePerformanceOverviewScope({
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    orgName: "Customer",
    performanceAccess: "organization",
  }), { kind: "organization", orgId: "org_1", orgName: "Customer" });
});

test("none resolves without a data target and never inherits an organization endpoint", () => {
  assert.deepEqual(resolvePerformanceOverviewScope({
    accessType: "customer_dashboard_user",
    orgId: "org_1",
    orgName: "Customer",
    performanceAccess: "none",
  }), { kind: "no_access" });
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

test("Team same-origin proxy forwards only month inputs with server-held authentication", () => {
  const authSource = readFileSync(join(libRoot, "auth.ts"), "utf8");
  const routeSource = readFileSync(join(libRoot, "../../app/api/performance/team/route.ts"), "utf8");
  assert.equal(authSource.includes("export async function getDashboardTeamPerformance"), true);
  assert.equal(authSource.includes("`/dashboard/performance/team?${params.toString()}`"), true);
  assert.equal(authSource.includes("{ token }"), true);
  assert.equal(routeSource.includes("getDashboardTeamPerformance"), true);
  assert.equal(routeSource.includes('searchParams.get("orgId")'), true);
  assert.equal(routeSource.includes('searchParams.get("year")'), true);
  assert.equal(routeSource.includes('searchParams.get("month")'), true);
  assert.equal(routeSource.includes("noStore(NextResponse.json(response))"), true);
  assert.equal(routeSource.includes("Authorization"), false);
});
