import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getOrganizationPerformanceIntelligence,
  isOrganizationPerformanceIntelligenceRequestCurrent,
  type OrganizationPerformanceIntelligenceResponse,
} from "./organizationPerformanceIntelligence";

const libRoot = dirname(fileURLToPath(import.meta.url));

const RESPONSE = {
  scope: "organization",
  populationBasis: "current_members",
  asOf: "2026-10-01T00:00:00.000Z",
  currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
  comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
  population: { currentMemberCount: 0, hasCurrentMembers: false },
  facts: {
    activity: {
      current: { attemptCount: 0, conclusiveAttemptCount: 0, evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: false }, concentrationWarning: false },
      previous: { attemptCount: 0, conclusiveAttemptCount: 0, evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: false }, concentrationWarning: false },
      attemptDelta: 0,
      conclusiveAttemptDelta: 0,
    },
    metricComparisons: [],
    completionComparisons: [],
    focusReadiness: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
  },
  signals: {
    monthCompleteness: { complete: true, completesAt: "2026-10-01T00:00:00.000Z" },
    activityMovement: {
      attempts: { available: true, direction: "unchanged", reason: null },
      conclusiveAttempts: { available: true, direction: "unchanged", reason: null },
      qualifiers: { current: { limitedEvidence: false, concentrationWarning: false }, previous: { limitedEvidence: false, concentrationWarning: false } },
    },
    metricMovement: [],
    relativeDimensions: [],
    completionMovement: [],
    focus: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
  },
} satisfies OrganizationPerformanceIntelligenceResponse;

test("Organization intelligence client requests only the selected organization month with no-store and AbortSignal", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const controller = new AbortController();
  const result = await getOrganizationPerformanceIntelligence({
    orgId: "org 1",
    year: 2026,
    month: 9,
    signal: controller.signal,
  }, async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json(RESPONSE);
  });

  assert.equal(result.kind, "success");
  assert.equal(requestUrl, "/api/performance/organization/intelligence?orgId=org+1&year=2026&month=9");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.signal, controller.signal);
  assert.deepEqual(requestInit?.headers, { Accept: "application/json" });
});

test("Organization intelligence failure is isolated and aborted requests remain stale", async () => {
  assert.deepEqual(await getOrganizationPerformanceIntelligence(
    { orgId: "org_1", year: 2026, month: 9 },
    async () => Response.json({ error: "unavailable" }, { status: 503 }),
  ), { kind: "error" });

  const controller = new AbortController();
  assert.equal(isOrganizationPerformanceIntelligenceRequestCurrent(controller.signal), true);
  controller.abort();
  assert.equal(isOrganizationPerformanceIntelligenceRequestCurrent(controller.signal), false);
});

test("same-origin proxy uses server-held auth, no-store, and forwards cancellation", () => {
  const authSource = readFileSync(join(libRoot, "auth.ts"), "utf8");
  const routeSource = readFileSync(join(libRoot, "../../app/api/performance/organization/intelligence/route.ts"), "utf8");
  assert.equal(authSource.includes("export async function getDashboardOrganizationPerformanceIntelligence"), true);
  assert.equal(authSource.includes("`/dashboard/performance/organization/intelligence?${params.toString()}`"), true);
  assert.equal(routeSource.includes("getDashboardOrganizationPerformanceIntelligence"), true);
  assert.equal(routeSource.includes('searchParams.get("orgId")'), true);
  assert.equal(routeSource.includes('searchParams.get("year")'), true);
  assert.equal(routeSource.includes('searchParams.get("month")'), true);
  assert.equal(routeSource.includes("signal: request.signal"), true);
  assert.equal(routeSource.includes("noStore(NextResponse.json(response))"), true);
  assert.equal(routeSource.includes("Authorization"), false);
});
