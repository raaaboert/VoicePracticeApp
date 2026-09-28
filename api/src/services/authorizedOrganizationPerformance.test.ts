import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceInvariantError,
  queryAuthorizedOrganizationPerformance,
} from "./authorizedOrganizationPerformance.js";
import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";
import {
  aggregateOrganizationPerformanceWithHistoricalPrivacy,
  OrganizationPerformanceAggregationInputError,
  type OrganizationPerformanceMetric,
} from "./organizationPerformanceAggregation.js";
import { normalizePerformanceEvidence } from "./performanceEvidence.js";
import type { PerformanceEvidenceSourceSnapshot, PerformanceEvidenceSourceUser } from "./performanceEvidenceSourceSnapshot.js";

const MONTH = { year: 2026, month: 9 } as const;
const WEIGHTS_A = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
const WEIGHTS_B = { persuasion: 0.1, clarity: 0.2, empathy: 0.3, assertiveness: 0.4 };

function user(id: string, overrides: Partial<PerformanceEvidenceSourceUser> = {}): PerformanceEvidenceSourceUser {
  return {
    id,
    accountType: "enterprise",
    status: "active",
    orgId: "org_a",
    orgRole: "user",
    isSuperUser: false,
    dashboardAccessEnabled: false,
    managerUserId: null,
    performanceAccess: "none",
    divisionId: null,
    ...overrides,
  };
}

function actor(): PerformanceEvidenceSourceUser {
  return user("actor", { dashboardAccessEnabled: true, performanceAccess: "organization" });
}

function viewer(value: PerformanceEvidenceSourceUser): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: value.id,
    email: `${value.id}@example.test`,
    isSuperUser: false,
    orgId: value.orgId,
    orgName: "Organization A",
    orgRole: value.orgRole,
    performanceAccess: value.performanceAccess ?? "none",
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
}

function score(id: string, subjectKey: string, overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: `session_${id}`,
    userId: subjectKey,
    orgId: "org_a",
    divisionId: "division_a",
    segmentId: "segment_a",
    scenarioId: "scenario_a",
    trainingId: "training_a",
    startedAt: "2026-09-15T11:55:00.000Z",
    endedAt: "2026-09-15T12:00:00.000Z",
    createdAt: "2026-09-15T12:00:01.000Z",
    overallScore: 50,
    communicationScore: 50,
    outcomeScore: 50,
    persuasion: 5,
    clarity: 5,
    empathy: 5,
    assertiveness: 5,
    completionLevel: "complete",
    objectiveAchieved: true,
    rubricVersion: "generation_a",
    scoringWeightsApplied: WEIGHTS_A,
    ...overrides,
  };
}

function snapshot(
  scoreRecords: readonly SimulationScoreRecord[],
  subjectUsers: readonly PerformanceEvidenceSourceUser[] = [],
): PerformanceEvidenceSourceSnapshot {
  return {
    scoreRecords,
    users: [actor(), ...subjectUsers],
    organizations: [{ id: "org_a", status: "active" }, { id: "org_b", status: "active" }],
    trainings: [],
  };
}

function query(
  scoreRecords: readonly SimulationScoreRecord[],
  subjectUsers: readonly PerformanceEvidenceSourceUser[] = [],
  extras: Record<string, unknown> = {},
) {
  const currentActor = actor();
  return queryAuthorizedOrganizationPerformance({
    snapshot: snapshot(scoreRecords, subjectUsers),
    viewer: viewer(currentActor),
    organizationId: "org_a",
    calendarMonth: MONTH,
    ...extras,
  });
}

function metric(
  result: ReturnType<typeof query>,
  name: OrganizationPerformanceMetric,
) {
  return result.metricGroups.filter((group) => group.metric === name);
}

test("classifies only current same-org enterprise users as current without target access or active-status requirements", () => {
  const result = query(
    [
      score("disabled", "disabled_current", { overallScore: 40 }),
      score("moved", "moved_user", { overallScore: 90 }),
      score("absent", "absent_user", { overallScore: 100 }),
      score("deleted", "deleted_user", { overallScore: 80 }),
      score("individual", "individual_user", { overallScore: 70 }),
    ],
    [
      user("disabled_current", {
        status: "disabled",
        dashboardAccessEnabled: false,
        performanceAccess: "none",
      }),
      user("moved_user", { orgId: "org_b" }),
      user("individual_user", { accountType: "individual" }),
    ],
  );
  assert.equal(result.activity?.attemptCount, 1);
  assert.equal(metric(result, "overall")[0]?.mean, 40);
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
  assert.equal(result.activity?.historicalPrivacyAdjustmentApplied, true);
});

test("keeps one- and three-person current cohorts visible with limited-evidence metadata", () => {
  for (const count of [1, 3]) {
    const users = Array.from({ length: count }, (_, index) => user(`current_${count}_${index}`));
    const records = users.map((subject, index) => score(`current_${count}_${index}`, subject.id, { overallScore: 60 + index }));
    const result = query(records, users);
    const overall = metric(result, "overall")[0]!;
    assert.equal(result.activity?.attemptCount, count);
    assert.equal(overall.qualifyingObservationCount, count);
    assert.equal(overall.evidenceStrength.limitedEvidence, true);
    assert.equal(overall.historicalPrivacyAdjustmentApplied, false);
    assert.ok(Number.isFinite(overall.mean));
  }
});

test("excludes four known protected contributors and includes five", () => {
  const four = query(Array.from({ length: 4 }, (_, index) =>
    score(`former_four_${index}`, `former_four_${index}`, { overallScore: 90 })));
  assert.equal(four.activity, null);
  assert.deepEqual(four.metricGroups, []);
  assert.deepEqual(four.completionGroups, []);
  assert.equal(four.historicalPrivacyAdjustmentApplied, true);

  const five = query(Array.from({ length: 5 }, (_, index) =>
    score(`former_five_${index}`, `former_five_${index}`, { overallScore: 70 + index })));
  assert.equal(five.activity?.attemptCount, 5);
  assert.equal(metric(five, "overall")[0]?.qualifyingObservationCount, 5);
  assert.equal(five.historicalPrivacyAdjustmentApplied, false);
});

test("uses current-only fallback below the threshold and all evidence at the threshold", () => {
  const currentUsers = Array.from({ length: 3 }, (_, index) => user(`current_${index}`));
  const currentRows = currentUsers.map((subject, index) =>
    score(`current_${index}`, subject.id, { overallScore: 10 + (index * 10) }));
  const fourProtected = Array.from({ length: 4 }, (_, index) =>
    score(`former_${index}`, `former_${index}`, { overallScore: 100 }));
  const fallback = query([...currentRows, ...fourProtected], currentUsers);
  const fallbackOverall = metric(fallback, "overall")[0]!;
  assert.equal(fallback.activity?.attemptCount, 3);
  assert.equal(fallbackOverall.mean, 20);
  assert.equal(fallbackOverall.qualifyingObservationCount, 3);
  assert.deepEqual(fallbackOverall.evidenceStrength, {
    conservativeContributorCount: 3,
    limitedEvidence: true,
  });
  assert.deepEqual(fallbackOverall.concentration, {
    largestContributionShare: 1 / 3,
    concentrationWarning: false,
  });
  assert.equal(fallbackOverall.historicalPrivacyAdjustmentApplied, true);

  const fifth = score("former_4", "former_4", { overallScore: 100 });
  const included = query([...currentRows, ...fourProtected, fifth], currentUsers);
  assert.equal(included.activity?.attemptCount, 8);
  assert.equal(metric(included, "overall")[0]?.qualifyingObservationCount, 8);
  assert.equal(metric(included, "overall")[0]?.mean, 70);
  assert.equal(included.historicalPrivacyAdjustmentApplied, false);

  const fourCurrentUsers = Array.from({ length: 4 }, (_, index) => user(`four_current_${index}`));
  const fourCurrentRows = fourCurrentUsers.map((subject, index) =>
    score(`four_current_${index}`, subject.id, { overallScore: 10 + (index * 10) }));
  const oneProtected = score("one_former", "one_former", { overallScore: 100 });
  const fourPlusOne = query([...fourCurrentRows, oneProtected], fourCurrentUsers);
  assert.equal(fourPlusOne.activity?.attemptCount, 4);
  assert.equal(metric(fourPlusOne, "overall")[0]?.mean, 25);
  assert.equal(metric(fourPlusOne, "overall")[0]?.historicalPrivacyAdjustmentApplied, true);
});

test("counts all deidentified history as one protected contributor bucket", () => {
  const fiftyDeleted = Array.from({ length: 50 }, (_, index) =>
    score(`deleted_only_${index}`, "deleted_user"));
  const hidden = query(fiftyDeleted);
  assert.equal(hidden.activity, null);
  assert.deepEqual(hidden.metricGroups, []);

  const fourKnown = Array.from({ length: 4 }, (_, index) =>
    score(`known_${index}`, `known_${index}`));
  const included = query([...fourKnown, ...Array.from({ length: 100 }, (_, index) =>
    score(`deleted_mixed_${index}`, "deleted_user"))]);
  assert.equal(included.activity?.attemptCount, 104);
  assert.equal(included.activity?.evidenceStrength.conservativeContributorCount, 5);
  assert.equal(included.historicalPrivacyAdjustmentApplied, false);
});

test("enforces privacy independently for each metric generation and weight profile", () => {
  const oneProfileA = [score("profile_a", "former_a", { overallScore: 10, scoringWeightsApplied: WEIGHTS_A })];
  const fiveProfileB = Array.from({ length: 5 }, (_, index) =>
    score(`profile_b_${index}`, `former_b_${index}`, { overallScore: 80, scoringWeightsApplied: WEIGHTS_B }));
  const result = query([...oneProfileA, ...fiveProfileB]);
  const overall = metric(result, "overall");
  assert.equal(result.activity?.attemptCount, 6);
  assert.equal(overall.length, 1);
  assert.equal(overall[0]?.mean, 80);
  assert.deepEqual(overall[0]?.weightProfile, {
    kind: "known",
    profileKey: "known:100000000:200000000:300000000:400000000",
    weights: WEIGHTS_B,
  });
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("enforces completion and objective privacy on their exact independent populations", () => {
  const availability = (completion: boolean, objective: boolean) => ({
    overall: false,
    communication: false,
    outcome: false,
    persuasion: false,
    clarity: false,
    empathy: false,
    assertiveness: false,
    completion,
    objective,
  });
  const candidate = (
    subjectKey: string,
    scoringGeneration: string,
    completion: boolean,
    objective: boolean,
  ): OrganizationEvidenceCandidate => ({
    subjectKind: "user",
    subjectKey,
    orgId: "org_a",
    scenarioId: "scenario_a",
    evidenceAt: "2026-09-15T12:00:00.000Z",
    recordEra: "outcome_aware",
    scoringGeneration,
    metricAvailability: availability(completion, objective),
    overallScore: 50,
    persuasion: 5,
    clarity: 5,
    empathy: 5,
    assertiveness: 5,
    completionLevel: "complete",
    objectiveAchieved: true,
  });
  const rows = [
    ...Array.from({ length: 5 }, (_, index) =>
      candidate(`completion_${index}`, "completion_safe", true, index === 0)),
    ...Array.from({ length: 5 }, (_, index) =>
      candidate(`objective_${index}`, "objective_safe", index === 0, true)),
  ];
  const result = aggregateOrganizationPerformanceWithHistoricalPrivacy(
    { candidates: rows, calendarMonth: MONTH },
    () => false,
  );
  const completionSafe = result.completionGroups.find((group) => group.scoringGeneration === "completion_safe")!;
  const objectiveSafe = result.completionGroups.find((group) => group.scoringGeneration === "objective_safe")!;
  assert.equal(completionSafe.completion?.availableObservationCount, 5);
  assert.equal(completionSafe.objective, undefined);
  assert.equal(objectiveSafe.completion, undefined);
  assert.equal(objectiveSafe.objective?.availableObservationCount, 5);
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("supports one dimension only and validates before candidate acquisition", () => {
  const current = user("current");
  const result = query([
    score("matching", current.id, { scenarioId: "scenario_keep", overallScore: 20 }),
    score("other", current.id, { scenarioId: "scenario_other", overallScore: 80 }),
  ], [current], { dimensionFilter: { dimension: "scenario", id: "scenario_keep" } });
  assert.equal(result.activity?.attemptCount, 1);
  assert.equal(metric(result, "overall")[0]?.mean, 20);

  for (const extras of [
    { evidenceAtFrom: "2026-09-01T00:00:00.000Z" },
    { scenarioId: "scenario_keep", trainingId: "training_a" },
    { candidates: [] },
    { unsupportedField: true },
    { dimensionFilter: { dimension: "scenario", id: "scenario_keep", trainingId: "training_a" } },
    { dimensionFilter: [
      { dimension: "scenario", id: "scenario_keep" },
      { dimension: "training", id: "training_a" },
    ] },
  ]) {
    assert.throws(() => query([], [], extras), OrganizationPerformanceAggregationInputError);
  }

  const inaccessibleSnapshot = {
    get scoreRecords(): readonly SimulationScoreRecord[] {
      throw new Error("candidates were read before validation");
    },
    users: [actor()],
    organizations: [{ id: "org_a", status: "active" }],
    trainings: [],
  } as PerformanceEvidenceSourceSnapshot;
  assert.throws(() => queryAuthorizedOrganizationPerformance({
    snapshot: inaccessibleSnapshot,
    viewer: viewer(actor()),
    organizationId: "org_a",
    calendarMonth: { year: 2026, month: 13 },
  }), OrganizationPerformanceAggregationInputError);
});

test("fails closed on a mixed-organization candidate invariant", () => {
  const normalized = normalizePerformanceEvidence(score("malicious", "foreign"));
  assert.equal(normalized.status, "accepted");
  if (normalized.status !== "accepted") throw new Error("Expected canonical evidence");
  let orgIdReads = 0;
  const mixedEvidence = { ...normalized.evidence };
  Object.defineProperty(mixedEvidence, "orgId", {
    enumerable: true,
    get: () => (++orgIdReads <= 2 ? "org_a" : "org_b"),
  });
  const adversarialRecords = {
    *[Symbol.iterator]() {},
    map: () => [{ status: "accepted", evidence: mixedEvidence }],
  } as unknown as readonly SimulationScoreRecord[];
  const currentActor = actor();
  assert.throws(
    () => queryAuthorizedOrganizationPerformance({
      snapshot: {
        scoreRecords: adversarialRecords,
        users: [currentActor],
        organizations: [{ id: "org_a", status: "active" }],
        trainings: [],
      },
      viewer: viewer(currentActor),
      organizationId: "org_a",
      calendarMonth: MONTH,
    }),
    AuthorizedOrganizationPerformanceInvariantError,
  );
});

test("controlled output exposes aggregate privacy state without subject or evidence identity", () => {
  const records = [
    ...Array.from({ length: 5 }, (_, index) =>
      score(`secret_evidence_${index}`, `secret_former_${index}`, { overallScore: 75 })),
    score("deleted_secret", "deleted_user", { overallScore: 65 }),
  ];
  const result = query(records);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "subjectKey", "userId", "evidenceId", "simulationSessionId", "evidenceAt",
    "deleted_user", "secret_former", "secret_evidence", "2026-09-15T12:00:00.000Z",
    "protectedContributorCount", "subjectKind",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof result.historicalPrivacyAdjustmentApplied, "boolean");
});
