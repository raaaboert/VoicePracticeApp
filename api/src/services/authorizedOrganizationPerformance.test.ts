import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceInputError,
  AuthorizedOrganizationPerformanceInvariantError,
  queryAuthorizedOrganizationPerformance,
} from "./authorizedOrganizationPerformance.js";
import type { OrganizationEvidenceCandidate } from "./authorizedOrganizationEvidenceCandidates.js";
import {
  aggregateOrganizationPerformanceWithHistoricalPrivacy,
  type OrganizationPerformanceMetric,
} from "./organizationPerformanceAggregation.js";
import { queryAuthorizedPerformanceEvidence } from "./authorizedPerformanceEvidenceQuery.js";
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

  const current = user("deidentified_current");
  const fourKnown = Array.from({ length: 4 }, (_, index) =>
    score(`known_${index}`, `known_${index}`));
  const dominated = query([
    score("deidentified_current", current.id),
    ...fourKnown,
    ...Array.from({ length: 5 }, (_, index) => score(`deleted_mixed_${index}`, "deleted_user")),
  ], [current]);
  assert.equal(dominated.activity?.attemptCount, 1);
  assert.equal(dominated.historicalPrivacyAdjustmentApplied, true);
});

test("protected dominance treats exactly forty percent as safe and greater than forty percent as unsafe", () => {
  const rows = (prefix: string, counts: readonly number[]) => counts.flatMap((count, subjectIndex) =>
    Array.from({ length: count }, (_, observationIndex) =>
      score(`${prefix}_${subjectIndex}_${observationIndex}`, `${prefix}_${subjectIndex}`)));

  const equal = query(rows("equal", [1, 1, 1, 1, 1]));
  assert.equal(equal.activity?.attemptCount, 5);
  assert.equal(equal.historicalPrivacyAdjustmentApplied, false);

  const exact = query(rows("exact", [4, 2, 2, 1, 1]));
  assert.equal(exact.activity?.attemptCount, 10);
  assert.equal(exact.historicalPrivacyAdjustmentApplied, false);

  const current = user("dominance_current");
  const currentRows = Array.from({ length: 100 }, (_, index) =>
    score(`dominance_current_${index}`, current.id));
  const unsafe = query([
    ...currentRows,
    ...rows("unsafe", [5, 2, 1, 1, 1]),
  ], [current]);
  assert.equal(unsafe.activity?.attemptCount, 100);
  assert.equal(unsafe.historicalPrivacyAdjustmentApplied, true);
});

test("deidentified protected dominance treats exactly forty percent as safe", () => {
  const knownRows = [2, 2, 1, 1].flatMap((count, subjectIndex) =>
    Array.from({ length: count }, (_, observationIndex) =>
      score(`known_exact_${subjectIndex}_${observationIndex}`, `known_exact_${subjectIndex}`)));
  const result = query([
    ...Array.from({ length: 4 }, (_, index) => score(`deleted_exact_${index}`, "deleted_user")),
    ...knownRows,
  ]);
  assert.equal(result.activity?.attemptCount, 10);
  assert.equal(result.activity?.evidenceStrength.conservativeContributorCount, 5);
  assert.equal(result.historicalPrivacyAdjustmentApplied, false);
});

test("a dominant current contributor remains visible when protected history is independently safe", () => {
  const current = user("power_user");
  const currentRows = Array.from({ length: 20 }, (_, index) => score(`power_${index}`, current.id));
  const protectedRows = Array.from({ length: 5 }, (_, index) => score(`protected_power_${index}`, `protected_power_${index}`));
  const result = query([...currentRows, ...protectedRows], [current]);
  assert.equal(result.activity?.attemptCount, 25);
  assert.equal(result.activity?.concentration.concentrationWarning, true);
  assert.equal(result.historicalPrivacyAdjustmentApplied, false);
});

test("protected profile dominance forces response-wide current-only fallback even when activity is safe", () => {
  const current = user("profile_current");
  const protectedRows = [
    ...[3, 1, 1, 1, 1].flatMap((count, subjectIndex) =>
      Array.from({ length: count }, (_, observationIndex) => score(
        `profile_a_${subjectIndex}_${observationIndex}`,
        `profile_subject_${subjectIndex}`,
        { scoringWeightsApplied: WEIGHTS_A },
      ))),
    ...[1, 2, 2, 2, 2].flatMap((count, subjectIndex) =>
      Array.from({ length: count }, (_, observationIndex) => score(
        `profile_b_${subjectIndex}_${observationIndex}`,
        `profile_subject_${subjectIndex}`,
        { scoringWeightsApplied: WEIGHTS_B },
      ))),
  ];
  const result = query([
    score("profile_current", current.id, { scoringWeightsApplied: WEIGHTS_A }),
    ...protectedRows,
  ], [current]);
  assert.equal(result.activity?.attemptCount, 1);
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("protected completion dominance forces response-wide fallback when activity and metric populations are safe", () => {
  const availability = (completion: boolean) => ({
    overall: false,
    communication: false,
    outcome: true,
    persuasion: false,
    clarity: false,
    empathy: false,
    assertiveness: false,
    completion,
    objective: false,
  });
  const candidate = (
    subjectKey: string,
    observation: number,
    completion: boolean,
  ): OrganizationEvidenceCandidate => ({
    subjectKind: "user",
    subjectKey,
    orgId: "org_a",
    scenarioId: "scenario_a",
    evidenceAt: "2026-09-15T12:00:00.000Z",
    recordEra: "outcome_aware",
    scoringGeneration: "generation_a",
    metricAvailability: availability(completion),
    overallScore: 50,
    outcomeScore: 50,
    persuasion: 5,
    clarity: 5,
    empathy: 5,
    assertiveness: 5,
    completionLevel: "complete",
    objectiveAchieved: true,
    divisionId: `observation_${observation}`,
  });
  const protectedRows = [3, 3, 3, 3, 3].flatMap((count, subjectIndex) =>
    Array.from({ length: count }, (_, observationIndex) =>
      candidate(`completion_subject_${subjectIndex}`, observationIndex, subjectIndex === 0 || observationIndex === 0)));
  const rows = [candidate("current_completion", 0, true), ...protectedRows];
  const result = aggregateOrganizationPerformanceWithHistoricalPrivacy(
    { candidates: rows, calendarMonth: MONTH },
    (row) => row.subjectKind === "user" && row.subjectKey === "current_completion",
  );
  assert.equal(result.activity?.attemptCount, 1);
  assert.equal(result.metricGroups.find((group) => group.metric === "outcome")?.qualifyingObservationCount, 1);
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("uses current-only response mode when any protected metric/profile population is unsafe", () => {
  const current = user("current_profile");
  const currentRow = score("current_profile", current.id, { overallScore: 20, scoringWeightsApplied: WEIGHTS_B });
  const oneProfileA = [score("profile_a", "former_a", { overallScore: 10, scoringWeightsApplied: WEIGHTS_A })];
  const fiveProfileB = Array.from({ length: 5 }, (_, index) =>
    score(`profile_b_${index}`, `former_b_${index}`, { overallScore: 80, scoringWeightsApplied: WEIGHTS_B }));
  const result = query([currentRow, ...oneProfileA, ...fiveProfileB], [current]);
  const overall = metric(result, "overall");
  assert.equal(result.activity?.attemptCount, 1);
  assert.equal(overall.length, 1);
  assert.equal(overall[0]?.mean, 20);
  assert.deepEqual(overall[0]?.weightProfile, {
    kind: "known",
    profileKey: "known:100000000:200000000:300000000:400000000",
    weights: WEIGHTS_B,
  });
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("response precheck covers completion and objective populations and removes their protected-only labels", () => {
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
    candidate("current", "current_generation", true, true),
    ...Array.from({ length: 5 }, (_, index) =>
      candidate(`completion_${index}`, "completion_safe", true, index === 0)),
    ...Array.from({ length: 5 }, (_, index) =>
      candidate(`objective_${index}`, "objective_safe", index === 0, true)),
  ];
  const result = aggregateOrganizationPerformanceWithHistoricalPrivacy(
    { candidates: rows, calendarMonth: MONTH },
    (row) => row.subjectKind === "user" && row.subjectKey === "current",
  );
  assert.equal(result.activity?.attemptCount, 1);
  assert.deepEqual(result.completionGroups.map((group) => group.scoringGeneration), ["current_generation"]);
  assert.equal(result.completionGroups[0]?.completion?.availableObservationCount, 1);
  assert.equal(result.completionGroups[0]?.objective?.availableObservationCount, 1);
  assert.equal(result.historicalPrivacyAdjustmentApplied, true);
});

test("dimension-filtered views never include protected history, preventing cross-query differencing", () => {
  const current = user("current_e", { divisionId: "division_e" });
  const protectedD = Array.from({ length: 5 }, (_, index) =>
    score(`protected_d_${index}`, `protected_d_${index}`, {
      divisionId: "division_d",
      overallScore: 10 + (index * 10),
    }));
  const protectedE = score("protected_e", "protected_e", { divisionId: "division_e", overallScore: 90 });
  const currentE = score("current_e", current.id, { divisionId: "division_e", overallScore: 20 });
  const records = [...protectedD, protectedE, currentE];

  const organization = query(records, [current]);
  const divisionD = query(records, [current], { dimensionFilter: { dimension: "division", id: "division_d" } });
  const divisionE = query(records, [current], { dimensionFilter: { dimension: "division", id: "division_e" } });
  const divisionEWithoutProtected = query([currentE], [current], {
    dimensionFilter: { dimension: "division", id: "division_e" },
  });

  assert.equal(organization.activity?.attemptCount, 7);
  assert.equal(organization.historicalScope, "organization_history");
  assert.equal(metric(organization, "overall")[0]?.qualifyingObservationCount, 7);
  assert.equal(divisionD.activity?.attemptCount, 0);
  assert.deepEqual(divisionD.metricGroups, []);
  assert.equal(divisionE.activity?.attemptCount, 1);
  assert.equal(metric(divisionE, "overall")[0]?.mean, 20);
  assert.deepEqual(divisionE, divisionEWithoutProtected);
  assert.equal(divisionD.historicalScope, "current_population");
  assert.equal(divisionE.historicalScope, "current_population");
  assert.equal(divisionD.historicalPrivacyAdjustmentApplied, false);
  assert.equal(divisionE.historicalPrivacyAdjustmentApplied, false);
  assert.equal(divisionE.activity?.historicalPrivacyAdjustmentApplied, false);
  assert.equal(metric(divisionE, "overall")[0]?.historicalPrivacyAdjustmentApplied, false);

  const oldRecoveredProtectedScore =
    metric(organization, "overall")[0]!.mean * 7
    - 30 * 5
    - metric(divisionE, "overall")[0]!.mean;
  assert.equal(oldRecoveredProtectedScore, 90);
  assert.equal(metric(divisionD, "overall").length, 0);
});

test("protected-only and empty filtered participation cells are observationally identical", () => {
  const protectedOnly = query([
    score("protected_training", "former_training", { trainingId: "training_secret" }),
  ], [], { dimensionFilter: { dimension: "training", id: "training_secret" } });
  const empty = query([], [], { dimensionFilter: { dimension: "training", id: "training_secret" } });
  assert.deepEqual(protectedOnly, empty);
  assert.equal(protectedOnly.activity?.attemptCount, 0);
  assert.equal(protectedOnly.historicalPrivacyAdjustmentApplied, false);
  assert.equal(protectedOnly.historicalScope, "current_population");
});

test("one response mode keeps activity, completion, objective, and metric counts privacy-consistent", () => {
  const currentUsers = [user("consistent_current_a"), user("consistent_current_b")];
  const currentRows = currentUsers.map((subject, index) =>
    score(`consistent_current_${index}`, subject.id, { overallScore: 10 + (index * 10), scoringWeightsApplied: WEIGHTS_A }));
  const protectedRows = [
    ...Array.from({ length: 4 }, (_, index) =>
      score(`consistent_b_${index}`, `consistent_b_${index}`, { overallScore: 80, scoringWeightsApplied: WEIGHTS_B })),
    score("consistent_a", "consistent_a", { overallScore: 90, scoringWeightsApplied: WEIGHTS_A }),
  ];
  const result = query([...currentRows, ...protectedRows], currentUsers);
  const completion = result.completionGroups[0]!;
  const overall = metric(result, "overall");
  assert.equal(result.activity?.attemptCount, 2);
  assert.equal(result.activity?.conclusiveAttemptCount, 2);
  assert.equal(completion.completion?.availableObservationCount, 2);
  assert.equal(completion.objective?.availableObservationCount, 2);
  assert.equal(overall.length, 1);
  assert.equal(overall[0]?.qualifyingObservationCount, 2);
  assert.equal(result.activity?.historicalPrivacyAdjustmentApplied, true);
  assert.equal(completion.completion?.historicalPrivacyAdjustmentApplied, true);
  assert.equal(completion.objective?.historicalPrivacyAdjustmentApplied, true);
  assert.equal(overall[0]?.historicalPrivacyAdjustmentApplied, true);
});

test("current-only fallback leaves no protected-only generation or profile shell", () => {
  const current = user("current_label");
  const currentRow = score("current_label", current.id, { rubricVersion: "current_generation" });
  const protectedLegacy = score("protected_legacy", "former_legacy", {
    rubricVersion: "2026-03-06.v2",
    communicationScore: undefined,
    outcomeScore: undefined,
    completionLevel: undefined,
    objectiveAchieved: undefined,
    scoringWeightsApplied: undefined,
  });
  const result = query([currentRow, protectedLegacy], [current]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("2026-03-06.v2"), false);
  assert.equal(serialized.includes('"profileKey":"unknown"'), false);
  assert.deepEqual(result.completionGroups.map((group) => group.scoringGeneration), ["current_generation"]);
  assert.equal(result.metricGroups.every((group) => group.scoringGeneration === "current_generation"), true);
});

test("small filtered current cohorts remain visible under the static current-population contract", () => {
  for (const count of [1, 3]) {
    const users = Array.from({ length: count }, (_, index) => user(`filtered_current_${count}_${index}`));
    const rows = users.map((subject, index) =>
      score(`filtered_current_${count}_${index}`, subject.id, { divisionId: "division_current", overallScore: 60 + index }));
    const result = query(rows, users, { dimensionFilter: { dimension: "division", id: "division_current" } });
    const overall = metric(result, "overall")[0]!;
    assert.equal(result.activity?.attemptCount, count);
    assert.equal(overall.qualifyingObservationCount, count);
    assert.equal(overall.evidenceStrength.limitedEvidence, true);
    assert.equal(result.historicalPrivacyAdjustmentApplied, false);
    assert.equal(result.historicalScope, "current_population");
  }
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
    assert.throws(() => query([], [], extras), AuthorizedOrganizationPerformanceInputError);
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
  }), AuthorizedOrganizationPerformanceInputError);

  assert.throws(
    () => queryAuthorizedOrganizationPerformance({
      snapshot: snapshot([]),
      viewer: viewer(actor()),
      organizationId: " ",
      calendarMonth: MONTH,
    }),
    AuthorizedOrganizationPerformanceInputError,
  );

  const unexpected = new Error("unexpected source failure");
  const failingSnapshot = {
    get scoreRecords(): readonly SimulationScoreRecord[] {
      throw unexpected;
    },
    users: [actor()],
    organizations: [{ id: "org_a", status: "active" }],
    trainings: [],
  } as PerformanceEvidenceSourceSnapshot;
  assert.throws(
    () => queryAuthorizedOrganizationPerformance({
      snapshot: failingSnapshot,
      viewer: viewer(actor()),
      organizationId: "org_a",
      calendarMonth: MONTH,
    }),
    (error) => error === unexpected && !(error instanceof AuthorizedOrganizationPerformanceInputError),
  );
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
    (error) =>
      error instanceof AuthorizedOrganizationPerformanceInvariantError
      && !(error instanceof AuthorizedOrganizationPerformanceInputError),
  );
});

test("authorized person evidence remains directly visible outside aggregate privacy", () => {
  const manager = user("manager", { dashboardAccessEnabled: true, performanceAccess: "team" });
  const report = user("report", { managerUserId: manager.id });
  const reportScore = score("report_visible", report.id);
  const result = queryAuthorizedPerformanceEvidence({
    snapshot: {
      scoreRecords: [reportScore],
      users: [manager, report],
      organizations: [{ id: "org_a", status: "active" }],
      trainings: [],
    },
    viewer: viewer(manager),
    organizationId: "org_a",
    targetUserId: report.id,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.userId, report.id);
  assert.equal(result[0]?.evidenceId, reportScore.id);
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
    "protectedContributorCount", "subjectKind", "largestContributionShare",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof result.historicalPrivacyAdjustmentApplied, "boolean");
  assert.equal(typeof result.activity?.concentration.concentrationWarning, "boolean");
});
