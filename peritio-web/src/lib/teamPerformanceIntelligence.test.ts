import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getTeamPerformanceIntelligence,
  isTeamPerformanceIntelligenceRequestCurrent,
  type TeamPerformanceIntelligenceResponse,
} from "./teamPerformanceIntelligence";

const libRoot = dirname(fileURLToPath(import.meta.url));

const RESPONSE = {
  scope: "team",
  asOf: "2026-10-01T00:00:00.000Z",
  currentMonth: { year: 2026, month: 9, timeZone: "UTC" },
  comparisonMonth: { year: 2026, month: 8, timeZone: "UTC" },
  population: { currentReportCount: 1, hasCurrentReports: true },
  facts: {
    activity: {
      current: { attemptCount: 1, conclusiveAttemptCount: 1, evidenceStrength: { conservativeContributorCount: 1, limitedEvidence: true }, concentrationWarning: false },
      previous: { attemptCount: 0, conclusiveAttemptCount: 0, evidenceStrength: { conservativeContributorCount: 0, limitedEvidence: false }, concentrationWarning: false },
      attemptDelta: 1,
      conclusiveAttemptDelta: 1,
    },
    metricComparisons: [],
    completionComparisons: [],
    focusReadiness: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
  },
  signals: {
    monthCompleteness: { complete: true, completesAt: "2026-10-01T00:00:00.000Z" },
    activityMovement: {
      attempts: { available: true, direction: "up", reason: null },
      conclusiveAttempts: { available: true, direction: "up", reason: null },
      qualifiers: { current: { limitedEvidence: true, concentrationWarning: false }, previous: { limitedEvidence: false, concentrationWarning: false } },
    },
    metricMovement: [],
    relativeDimensions: [],
    completionMovement: [],
    focus: { available: false, reason: "historical_focus_topic_mapping_unavailable" },
  },
} satisfies TeamPerformanceIntelligenceResponse;

test("Team intelligence client requests only the selected organization month with no-store", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await getTeamPerformanceIntelligence({
    orgId: "org 1",
    year: 2026,
    month: 9,
  }, async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json(RESPONSE);
  });

  assert.equal(result.kind, "success");
  assert.equal(requestUrl, "/api/performance/team/intelligence?orgId=org+1&year=2026&month=9");
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(requestInit?.headers, { Accept: "application/json" });
});

test("Team intelligence failure is isolated and aborted requests remain stale", async () => {
  assert.deepEqual(await getTeamPerformanceIntelligence(
    { orgId: "org_1", year: 2026, month: 9 },
    async () => Response.json({ error: "unavailable" }, { status: 503 }),
  ), { kind: "error" });

  const controller = new AbortController();
  assert.equal(isTeamPerformanceIntelligenceRequestCurrent(controller.signal), true);
  controller.abort();
  assert.equal(isTeamPerformanceIntelligenceRequestCurrent(controller.signal), false);
});

test("same-origin proxy forwards with server-held auth and no-store", () => {
  const authSource = readFileSync(join(libRoot, "auth.ts"), "utf8");
  const routeSource = readFileSync(join(libRoot, "../../app/api/performance/team/intelligence/route.ts"), "utf8");
  assert.equal(authSource.includes("export async function getDashboardTeamPerformanceIntelligence"), true);
  assert.equal(authSource.includes("`/dashboard/performance/team/intelligence?${params.toString()}`"), true);
  assert.equal(routeSource.includes("getDashboardTeamPerformanceIntelligence"), true);
  assert.equal(routeSource.includes('searchParams.get("orgId")'), true);
  assert.equal(routeSource.includes('searchParams.get("year")'), true);
  assert.equal(routeSource.includes('searchParams.get("month")'), true);
  assert.equal(routeSource.includes("noStore(NextResponse.json(response))"), true);
  assert.equal(routeSource.includes("Authorization"), false);
});
