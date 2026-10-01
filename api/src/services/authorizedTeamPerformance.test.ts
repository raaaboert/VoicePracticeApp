import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import { queryAuthorizedPerformanceEvidence } from "./authorizedPerformanceEvidenceQuery.js";
import { AuthorizedOrganizationPerformanceInputError } from "./authorizedOrganizationPerformance.js";
import {
  AuthorizedTeamPerformanceDeniedError,
  queryAuthorizedTeamPerformance,
} from "./authorizedTeamPerformance.js";
import type { PerformanceEvidenceSourceSnapshot, PerformanceEvidenceSourceUser } from "./performanceEvidenceSourceSnapshot.js";

const MONTH = { year: 2026, month: 9 } as const;
const WEIGHTS_A = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
const WEIGHTS_B = { persuasion: 0.1, clarity: 0.2, empathy: 0.3, assertiveness: 0.4 };

function user(id: string, overrides: Partial<PerformanceEvidenceSourceUser> = {}): PerformanceEvidenceSourceUser {
  return {
    id, accountType: "enterprise", status: "active", orgId: "org_a", orgRole: "user",
    isSuperUser: false, dashboardAccessEnabled: true, managerUserId: null,
    performanceAccess: "none", divisionId: null, ...overrides,
  };
}

function viewer(actor: PerformanceEvidenceSourceUser): DashboardViewer {
  return {
    accessType: "customer_dashboard_user", userId: actor.id, email: `${actor.id}@example.test`,
    isSuperUser: false, orgId: actor.orgId, orgName: "Organization A", orgRole: actor.orgRole,
    performanceAccess: actor.performanceAccess ?? "none",
    capabilities: {
      viewOrganizationUsers: false, manageRegularOrganizationUsers: false,
      approveRejectAccessRequests: false, editEmployeeIds: false, editUserNames: false,
      manageUserRoles: false, assignUserManagers: false, managePerformanceAccess: false,
      manageOrganizationContent: false,
    },
  };
}

function score(id: string, userId: string, overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id, simulationSessionId: `session_${id}`, userId, orgId: "org_a", divisionId: "division_a",
    segmentId: "segment_a", scenarioId: "scenario_a", trainingId: "training_a",
    startedAt: "2026-09-15T11:55:00.000Z", endedAt: "2026-09-15T12:00:00.000Z",
    createdAt: "2026-09-15T12:00:01.000Z", overallScore: 50, communicationScore: 50,
    outcomeScore: 50, persuasion: 5, clarity: 5, empathy: 5, assertiveness: 5,
    completionLevel: "complete", objectiveAchieved: true, rubricVersion: "generation_a",
    scoringWeightsApplied: WEIGHTS_A, ...overrides,
  };
}

function source(
  actor: PerformanceEvidenceSourceUser,
  users: readonly PerformanceEvidenceSourceUser[],
  scores: readonly SimulationScoreRecord[],
): PerformanceEvidenceSourceSnapshot {
  return {
    users: [actor, ...users], scoreRecords: scores,
    organizations: [{ id: "org_a", status: "active" }, { id: "org_b", status: "active" }],
    trainings: [],
  };
}

function query(
  reports: readonly PerformanceEvidenceSourceUser[],
  scores: readonly SimulationScoreRecord[],
  actor = user("manager", { performanceAccess: "team" }),
  overrides: Partial<Parameters<typeof queryAuthorizedTeamPerformance>[0]> = {},
) {
  return queryAuthorizedTeamPerformance({
    snapshot: source(actor, reports, scores), viewer: viewer(actor),
    organizationId: "org_a", calendarMonth: MONTH, ...overrides,
  });
}

test("one and three current direct reports remain visible without protected-history suppression", () => {
  const one = query([user("direct", { managerUserId: "manager" })], [score("one", "direct")]);
  assert.equal(one.historicalScope, "current_population");
  assert.equal(one.dimensionFilter, null);
  assert.equal(one.historicalPrivacyAdjustmentApplied, false);
  assert.equal(one.activity?.attemptCount, 1);
  assert.equal(one.activity?.evidenceStrength.limitedEvidence, true);
  assert.equal(one.activity?.concentration.concentrationWarning, true);
  assert.equal(one.metricGroups.find((metric) => metric.metric === "overall")?.mean, 50);

  const three = ["a", "b", "c"].map((id) => user(id, { managerUserId: "manager" }));
  const result = query(three, three.map((report) => score(`score_${report.id}`, report.id)));
  assert.equal(result.activity?.attemptCount, 3);
  assert.equal(result.activity?.evidenceStrength.conservativeContributorCount, 3);
  assert.equal(result.historicalPrivacyAdjustmentApplied, false);
});

test("a dominant direct report raises concentration without hiding a small team", () => {
  const reports = ["a", "b", "c"].map((id) => user(id, { managerUserId: "manager" }));
  const result = query(reports, [
    score("a1", "a"), score("a2", "a"), score("a3", "a"),
    score("b1", "b"), score("c1", "c"),
  ]);
  assert.equal(result.activity?.attemptCount, 5);
  assert.equal(result.activity?.concentration.concentrationWarning, true);
  assert.equal(result.metricGroups.find((metric) => metric.metric === "overall")?.concentration.concentrationWarning, true);
  assert.equal(JSON.stringify(result).includes("largestContributionShare"), false);
});

test("only current direct reports contribute: no self, indirect, former, moved, or deidentified history", () => {
  const direct = user("direct", { managerUserId: "manager", divisionId: "division_b" });
  const disabledDirect = user("disabled_direct", { managerUserId: "manager", status: "disabled" });
  const result = query([
    direct,
    disabledDirect,
    user("indirect", { managerUserId: direct.id }),
    user("former"),
    user("moved", { managerUserId: "manager", orgId: "org_b" }),
    user("non_regular", { managerUserId: "manager", orgRole: "user_admin" }),
  ], [
    score("direct_current", direct.id),
    score("direct_historical", direct.id, { createdAt: "2026-09-01T00:00:00.000Z" }),
    score("disabled", disabledDirect.id),
    score("self", "manager"),
    score("indirect", "indirect"),
    score("former", "former"),
    score("moved", "moved"),
    score("non_regular", "non_regular"),
    score("deidentified", "deleted_user"),
    score("cross_org_history", direct.id, { orgId: "org_b" }),
  ]);
  assert.equal(result.activity?.attemptCount, 3);
  assert.equal(result.metricGroups.find((metric) => metric.metric === "overall")?.qualifyingObservationCount, 3);
  assert.equal(result.activity?.evidenceStrength.conservativeContributorCount, 2);
  assert.equal(result.historicalScope, "current_population");
  assert.equal(result.historicalPrivacyAdjustmentApplied, false);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "subjectKey", "subjectKind", "userId", "managerUserId", "evidenceId",
    "simulationSessionId", "evidenceAt", "largestContributionShare",
    "direct_historical", "deleted_user", "@example.test",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("a valid team viewer with no reports gets a legitimate empty aggregate", () => {
  const result = query([], [score("self", "manager")]);
  assert.equal(result.activity?.attemptCount, 0);
  assert.deepEqual(result.completionGroups, []);
  assert.deepEqual(result.metricGroups, []);
  assert.equal(result.historicalScope, "current_population");
});

test("performance access is independent of manager assignment and admin role", () => {
  const report = user("direct", { managerUserId: "manager" });
  for (const actor of [
    user("manager", { performanceAccess: "none" }),
    user("manager", { orgRole: "org_admin", performanceAccess: "none" }),
    user("manager", { orgRole: "user_admin", performanceAccess: "none" }),
  ]) {
    assert.throws(() => query([report], [score("direct", report.id)], actor),
      (error) => error instanceof AuthorizedTeamPerformanceDeniedError && error.reason === "performance_scope_denied");
  }
  const orgAccess = query([report], [score("direct", report.id)],
    user("manager", { performanceAccess: "organization" }));
  assert.equal(orgAccess.activity?.attemptCount, 1);
  assert.equal(query([report], [score("direct", report.id)],
    user("manager", { orgRole: "org_admin", performanceAccess: "team" })).activity?.attemptCount, 1);
});

test("snapshot performance access overrides stale viewer access metadata", () => {
  const report = user("direct", { managerUserId: "manager" });
  const noneActor = user("manager", { performanceAccess: "none" });
  assert.throws(() => query([report], [score("direct", report.id)], noneActor, {
    viewer: { ...viewer(noneActor), performanceAccess: "team" },
  }), (error) => error instanceof AuthorizedTeamPerformanceDeniedError && error.reason === "performance_scope_denied");

  const teamActor = user("manager", { performanceAccess: "team" });
  assert.equal(query([report], [score("direct", report.id)], teamActor, {
    viewer: { ...viewer(teamActor), performanceAccess: "none" },
  }).activity?.attemptCount, 1);
});

test("cross-org, nonexistent, inactive, and absent viewer actors fail closed", () => {
  const actor = user("manager", { performanceAccess: "team" });
  const snapshot = source(actor, [user("direct", { managerUserId: actor.id })], []);
  for (const [organizationId, expected] of [
    ["org_b", "organization_not_found_or_inaccessible"],
    ["org_missing", "organization_not_found_or_inaccessible"],
  ] as const) {
    assert.throws(() => queryAuthorizedTeamPerformance({ snapshot, viewer: viewer(actor), organizationId, calendarMonth: MONTH }),
      (error) => error instanceof AuthorizedTeamPerformanceDeniedError && error.reason === expected);
  }
  for (const ineligible of [
    user("manager", { performanceAccess: "team", status: "disabled" }),
    user("manager", { performanceAccess: "team", dashboardAccessEnabled: false }),
  ]) {
    assert.throws(() => query([], [], ineligible), AuthorizedTeamPerformanceDeniedError);
  }
  assert.throws(() => queryAuthorizedTeamPerformance({
    snapshot, viewer: { ...viewer(actor), userId: "absent" }, organizationId: "org_a", calendarMonth: MONTH,
  }), AuthorizedTeamPerformanceDeniedError);
  assert.throws(() => queryAuthorizedTeamPerformance({
    snapshot: { ...snapshot, organizations: [{ id: "org_a", status: "disabled" }] },
    viewer: viewer(actor), organizationId: "org_a", calendarMonth: MONTH,
  }), AuthorizedTeamPerformanceDeniedError);
});

test("UTC month, completion counts, generations, and weight profiles reuse organization math", () => {
  const direct = user("direct", { managerUserId: "manager" });
  const result = query([direct], [
    score("before", direct.id, { startedAt: "2026-08-31T23:55:00.000Z", endedAt: "2026-08-31T23:59:59.999Z", createdAt: "2026-08-31T23:59:59.999Z" }),
    score("first", direct.id, { startedAt: "2026-08-31T23:55:00.000Z", endedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:01.000Z", overallScore: 20 }),
    score("partial", direct.id, { completionLevel: "partial", objectiveAchieved: false, overallScore: 99 }),
    score("inconclusive", direct.id, { completionLevel: "inconclusive", objectiveAchieved: false, overallScore: 99 }),
    score("profile_b", direct.id, { scoringWeightsApplied: WEIGHTS_B, overallScore: 80 }),
    score("generation_b", direct.id, { rubricVersion: "generation_b", overallScore: 90 }),
    score("after", direct.id, { startedAt: "2026-09-30T23:55:00.000Z", endedAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:01.000Z" }),
  ]);
  assert.deepEqual(result.calendarMonth, { year: 2026, month: 9, timeZone: "UTC" });
  assert.equal(result.activity?.attemptCount, 5);
  assert.equal(result.activity?.conclusiveAttemptCount, 3);
  assert.deepEqual(result.completionGroups.map((group) => group.scoringGeneration), ["generation_a", "generation_b"]);
  assert.equal(result.completionGroups[0]?.completion?.partialCount, 1);
  assert.equal(result.completionGroups[0]?.completion?.inconclusiveCount, 1);
  const overall = result.metricGroups.filter((metric) => metric.metric === "overall");
  assert.equal(overall.length, 3);
  assert.deepEqual(overall.map((metric) => metric.scoringGeneration).sort(),
    ["generation_a", "generation_a", "generation_b"]);
  assert.deepEqual(overall.map((metric) => metric.mean).sort((a, b) => a - b), [20, 80, 90]);
  assert.equal(result.metricGroups.filter((metric) => metric.metric === "communication").length, 3);
  assert.equal(result.historicalPrivacyAdjustmentApplied, false);
});

test("canonical rejection and quarantine remain excluded; person query behavior is unchanged", () => {
  const actor = user("manager", { performanceAccess: "team" });
  const direct = user("direct", { managerUserId: actor.id });
  const snapshot = source(actor, [direct], [
    score("valid", direct.id),
    score("rejected", direct.id, { overallScore: Number.NaN }),
    score("duplicate_1", direct.id, { simulationSessionId: "duplicate_session", overallScore: 10 }),
    score("duplicate_2", direct.id, { simulationSessionId: "duplicate_session", overallScore: 90 }),
  ]);
  const team = queryAuthorizedTeamPerformance({ snapshot, viewer: viewer(actor), organizationId: "org_a", calendarMonth: MONTH });
  assert.equal(team.activity?.attemptCount, 1);
  assert.equal(queryAuthorizedPerformanceEvidence({ snapshot, viewer: viewer(actor), organizationId: "org_a", targetUserId: direct.id }).length, 1);
  assert.deepEqual(queryAuthorizedPerformanceEvidence({ snapshot, viewer: viewer(actor), organizationId: "org_a", targetUserId: "former" }), []);
});

test("facade rejects unsupported fields and invalid month before evidence work", () => {
  const actor = user("manager", { performanceAccess: "team" });
  const base = { snapshot: source(actor, [], []), viewer: viewer(actor), organizationId: "org_a", calendarMonth: MONTH };
  assert.throws(() => queryAuthorizedTeamPerformance({ ...base, dimensionFilter: { dimension: "division", id: "division_a" } } as Parameters<typeof queryAuthorizedTeamPerformance>[0]),
    AuthorizedOrganizationPerformanceInputError);
  assert.throws(() => queryAuthorizedTeamPerformance({ ...base, calendarMonth: { year: 2026, month: 13 } }),
    AuthorizedOrganizationPerformanceInputError);
});
