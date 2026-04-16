import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApiDatabase,
  DashboardViewer,
  SimulationScoreRecord,
  UsageSessionRecord,
} from "@voicepractice/shared";

import {
  buildDashboardDivisionScope,
  filterRecordsByDivision,
  resolveDashboardDivisionFilter,
} from "./dashboardDivisionFiltering.js";

function createUsage(overrides?: Partial<UsageSessionRecord>): UsageSessionRecord {
  return {
    id: overrides?.id ?? "usage_1",
    userId: overrides?.userId ?? "user_1",
    orgId: overrides?.orgId ?? "org_1",
    divisionId: overrides?.divisionId ?? null,
    segmentId: overrides?.segmentId ?? "segment_1",
    scenarioId: overrides?.scenarioId ?? "scenario_1",
    trainingId: overrides?.trainingId ?? null,
    trainingPackId: overrides?.trainingPackId ?? null,
    startedAt: overrides?.startedAt ?? "2026-04-01T10:00:00.000Z",
    endedAt: overrides?.endedAt ?? "2026-04-01T10:05:00.000Z",
    rawDurationSeconds: overrides?.rawDurationSeconds ?? 300,
    billedSecondsAdded: overrides?.billedSecondsAdded ?? 300,
    createdAt: overrides?.createdAt ?? "2026-04-01T10:05:00.000Z",
  };
}

function createScore(overrides?: Partial<SimulationScoreRecord>): SimulationScoreRecord {
  return {
    id: overrides?.id ?? "score_1",
    simulationSessionId: overrides?.simulationSessionId ?? "sim_1",
    userId: overrides?.userId ?? "user_1",
    orgId: overrides?.orgId ?? "org_1",
    divisionId: overrides?.divisionId ?? null,
    segmentId: overrides?.segmentId ?? "segment_1",
    scenarioId: overrides?.scenarioId ?? "scenario_1",
    trainingId: overrides?.trainingId ?? null,
    trainingPackId: overrides?.trainingPackId ?? null,
    industryId: overrides?.industryId ?? null,
    startedAt: overrides?.startedAt ?? "2026-04-01T10:00:00.000Z",
    endedAt: overrides?.endedAt ?? "2026-04-01T10:05:00.000Z",
    communicationScore: overrides?.communicationScore ?? 80,
    outcomeScore: overrides?.outcomeScore ?? 75,
    overallScore: overrides?.overallScore ?? 78,
    completionLevel: overrides?.completionLevel ?? "complete",
    objectiveAchieved: overrides?.objectiveAchieved ?? true,
    persuasion: overrides?.persuasion ?? 8,
    clarity: overrides?.clarity ?? 8,
    empathy: overrides?.empathy ?? 7,
    assertiveness: overrides?.assertiveness ?? 7,
    summary: overrides?.summary ?? "Good run",
    coachingArtifact: overrides?.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides?.normalizedCoachingThemes ?? null,
    rubricVersion: overrides?.rubricVersion ?? undefined,
    model: overrides?.model ?? undefined,
    promptVersion: overrides?.promptVersion ?? undefined,
    inputTokens: overrides?.inputTokens ?? undefined,
    outputTokens: overrides?.outputTokens ?? undefined,
    totalTokens: overrides?.totalTokens ?? undefined,
    createdAt: overrides?.createdAt ?? "2026-04-01T10:05:00.000Z",
  };
}

function createDb(): Pick<ApiDatabase, "orgDivisions" | "usageSessions" | "scoreRecords"> {
  return {
    orgDivisions: [
      {
        id: "division_a",
        orgId: "org_1",
        name: "Division A",
        active: true,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: "division_deleted",
        orgId: "org_1",
        name: "Deleted Division",
        active: false,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        deletedAt: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "division_other_org",
        orgId: "org_2",
        name: "Other Org Division",
        active: true,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    usageSessions: [
      createUsage({ id: "usage_general", divisionId: null }),
      createUsage({ id: "usage_division", divisionId: "division_a" }),
      createUsage({ id: "usage_deleted", divisionId: "division_deleted" }),
    ],
    scoreRecords: [
      createScore({ id: "score_general", divisionId: null }),
      createScore({ id: "score_division", divisionId: "division_a" }),
      createScore({ id: "score_deleted", divisionId: "division_deleted" }),
    ],
  };
}

function createViewer(overrides?: Partial<DashboardViewer>): DashboardViewer {
  return {
    accessType: overrides?.accessType ?? "customer_dashboard_user",
    userId: overrides?.userId ?? "user_1",
    email: overrides?.email ?? "user@example.com",
    isSuperUser: overrides?.isSuperUser ?? false,
    orgId: overrides?.orgId ?? "org_1",
    orgName: overrides?.orgName ?? "Org 1",
  };
}

test("filterRecordsByDivision preserves company totals when no division filter is applied", () => {
  const rows = [createUsage({ id: "general", divisionId: null }), createUsage({ id: "division", divisionId: "division_a" })];
  assert.deepEqual(
    filterRecordsByDivision(rows, null).map((row) => row.id),
    ["general", "division"]
  );
});

test("filterRecordsByDivision returns a subset and excludes unassigned records for division views", () => {
  const rows = [createUsage({ id: "general", divisionId: null }), createUsage({ id: "division", divisionId: "division_a" })];
  assert.deepEqual(
    filterRecordsByDivision(rows, "division_a").map((row) => row.id),
    ["division"]
  );
});

test("buildDashboardDivisionScope includes deleted divisions when historical activity exists", () => {
  const scope = buildDashboardDivisionScope({
    db: createDb(),
    orgId: "org_1",
    appliedDivisionId: "division_deleted",
  });

  assert.ok(scope);
  assert.deepEqual(
    scope?.divisions.map((division: { id: string }) => division.id),
    ["division_a", "division_deleted"]
  );
});

test("resolveDashboardDivisionFilter rejects divisions from another org on single-org views", () => {
  const result = resolveDashboardDivisionFilter({
    db: createDb(),
    viewer: createViewer(),
    requestedDivisionId: "division_other_org",
  });

  assert.equal(result.error, "divisionId must reference a division in this company.");
});

test("resolveDashboardDivisionFilter ignores division filters safely on aggregate views", () => {
  const result = resolveDashboardDivisionFilter({
    db: createDb(),
    viewer: createViewer({
      accessType: "super_user",
      isSuperUser: true,
      orgId: null,
      orgName: null,
    }),
    requestedDivisionId: "division_a",
  });

  assert.equal(result.error, null);
  assert.equal(result.appliedDivisionId, null);
  assert.equal(result.divisionScope, undefined);
});
