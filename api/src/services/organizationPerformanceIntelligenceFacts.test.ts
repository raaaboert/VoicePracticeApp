import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  AuthorizedOrganizationPerformanceDeniedError,
  AuthorizedOrganizationPerformanceInputError,
} from "./authorizedOrganizationPerformance.js";
import {
  buildOrganizationPerformanceIntelligenceFacts,
  type OrganizationPerformanceIntelligenceFacts,
} from "./organizationPerformanceIntelligenceFacts.js";
import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";

const SEPTEMBER = { year: 2026, month: 9 } as const;
const WEIGHTS_A = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
const WEIGHTS_B = { persuasion: 0.1, clarity: 0.2, empathy: 0.3, assertiveness: 0.4 };

function user(
  id: string,
  overrides: Partial<PerformanceEvidenceSourceUser> = {},
): PerformanceEvidenceSourceUser {
  return {
    id,
    accountType: "enterprise",
    status: "active",
    orgId: "org_a",
    orgRole: "user",
    isSuperUser: false,
    dashboardAccessEnabled: true,
    managerUserId: null,
    performanceAccess: "none",
    divisionId: null,
    ...overrides,
  };
}

function actor(): PerformanceEvidenceSourceUser {
  return user("organization_viewer", {
    orgRole: "org_admin",
    performanceAccess: "organization",
  });
}

function viewer(source: PerformanceEvidenceSourceUser): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: source.id,
    email: "organization-viewer@example.test",
    isSuperUser: false,
    orgId: source.orgId,
    orgName: "Organization A",
    orgRole: source.orgRole,
    performanceAccess: source.performanceAccess ?? "none",
    capabilities: {
      viewOrganizationUsers: true,
      manageRegularOrganizationUsers: true,
      approveRejectAccessRequests: true,
      editEmployeeIds: true,
      editUserNames: true,
      manageUserRoles: true,
      assignUserManagers: true,
      managePerformanceAccess: true,
      manageOrganizationContent: true,
    },
  };
}

function score(
  id: string,
  userId: string,
  evidenceAt: string,
  overrides: Partial<SimulationScoreRecord> = {},
): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: `session_${id}`,
    userId,
    orgId: "org_a",
    divisionId: "division_a",
    segmentId: "segment_a",
    scenarioId: "scenario_a",
    trainingId: "focus_topic_a",
    startedAt: evidenceAt,
    endedAt: evidenceAt,
    createdAt: evidenceAt,
    overallScore: 70,
    communicationScore: 70,
    outcomeScore: 70,
    persuasion: 7,
    clarity: 7,
    empathy: 7,
    assertiveness: 7,
    completionLevel: "complete",
    objectiveAchieved: true,
    rubricVersion: "generation_a",
    scoringWeightsApplied: WEIGHTS_A,
    ...overrides,
  };
}

function facts(params: {
  users?: readonly PerformanceEvidenceSourceUser[];
  scores?: readonly SimulationScoreRecord[];
  calendarMonth?: { year: number; month: number };
} = {}): OrganizationPerformanceIntelligenceFacts {
  const currentActor = actor();
  const snapshot: PerformanceEvidenceSourceSnapshot = {
    users: [currentActor, ...(params.users ?? [])],
    scoreRecords: params.scores ?? [],
    organizations: [
      { id: "org_a", status: "active" },
      { id: "org_b", status: "active" },
    ],
    trainings: [{
      id: "focus_topic_a",
      orgId: "org_a",
      name: "Current mutable Focus Topic name",
      status: "active",
      divisionId: null,
    }],
  };
  return buildOrganizationPerformanceIntelligenceFacts({
    snapshot,
    viewer: viewer(currentActor),
    organizationId: "org_a",
    calendarMonth: params.calendarMonth ?? SEPTEMBER,
  });
}

function metric(
  result: OrganizationPerformanceIntelligenceFacts,
  name: OrganizationPerformanceIntelligenceFacts["metricComparisons"][number]["metric"],
) {
  return result.metricComparisons.filter((comparison) => comparison.metric === name);
}

test("one canonical current organization population governs both months across roles, status, and divisions", () => {
  const regular = user("regular", { orgRole: "user", divisionId: "division_a" });
  const userAdmin = user("user_admin", { orgRole: "user_admin", divisionId: "division_b" });
  const disabledAdmin = user("disabled_admin", { orgRole: "org_admin", status: "disabled", divisionId: null });
  const newCurrent = user("new_current", { orgRole: "user", divisionId: "division_c" });
  const movedOut = user("moved_out", { orgId: "org_b" });
  const consumer = user("consumer", { accountType: "individual", orgId: null });

  const result = facts({
    users: [regular, userAdmin, disabledAdmin, newCurrent, movedOut, consumer],
    scores: [
      score("regular_current", regular.id, "2026-09-15T12:00:00.000Z"),
      score("regular_previous", regular.id, "2026-08-15T12:00:00.000Z"),
      score("admin_previous", userAdmin.id, "2026-08-16T12:00:00.000Z"),
      score("disabled_previous", disabledAdmin.id, "2026-08-17T12:00:00.000Z"),
      score("new_previous", newCurrent.id, "2026-08-18T12:00:00.000Z"),
      score("former_current", "former_absent", "2026-09-18T12:00:00.000Z"),
      score("former_previous", "former_absent", "2026-08-19T12:00:00.000Z"),
      score("moved_previous", movedOut.id, "2026-08-20T12:00:00.000Z"),
      score("consumer_previous", consumer.id, "2026-08-21T12:00:00.000Z"),
      score("deleted_previous", "deleted_user", "2026-08-22T12:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.population, { currentMemberCount: 5, hasCurrentMembers: true });
  assert.equal(result.activity.current.attemptCount, 1);
  assert.equal(result.activity.previous.attemptCount, 4);
  assert.equal(result.activity.attemptDelta, -3);
});

test("current members retain prior same-org history, including leave/rejoin, while other-org history is excluded", () => {
  const rejoined = user("rejoined");
  const result = facts({
    users: [rejoined],
    scores: [
      score("same_org_previous", rejoined.id, "2026-08-10T12:00:00.000Z", { orgId: "org_a" }),
      score("other_org_previous", rejoined.id, "2026-08-11T12:00:00.000Z", { orgId: "org_b" }),
    ],
  });

  assert.equal(result.activity.previous.attemptCount, 1);
  assert.equal(metric(result, "persuasion")[0]?.previous?.observationCount, 1);
});

test("January rolls to December and UTC windows are start-inclusive and end-exclusive", () => {
  const member = user("member");
  const result = facts({
    users: [member],
    calendarMonth: { year: 2026, month: 1 },
    scores: [
      score("before_previous", member.id, "2025-11-30T23:59:59.999Z"),
      score("previous_start", member.id, "2025-12-01T00:00:00.000Z"),
      score("previous_end", member.id, "2025-12-31T23:59:59.999Z"),
      score("current_start", member.id, "2026-01-01T00:00:00.000Z"),
      score("current_end", member.id, "2026-01-31T23:59:59.999Z"),
      score("after_current", member.id, "2026-02-01T00:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.currentMonth, { year: 2026, month: 1, timeZone: "UTC" });
  assert.deepEqual(result.comparisonMonth, { year: 2025, month: 12, timeZone: "UTC" });
  assert.equal(result.activity.current.attemptCount, 2);
  assert.equal(result.activity.previous.attemptCount, 2);
});

test("generation and weight-profile comparison semantics exactly match Team facts", () => {
  const member = user("member");
  const same = facts({
    users: [member],
    scores: [
      score("current_a", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A, persuasion: 8, outcomeScore: 80 }),
      score("previous_a", member.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A, persuasion: 7, outcomeScore: 70 }),
    ],
  });
  assert.equal(metric(same, "communication")[0]?.comparable, true);
  assert.equal(metric(same, "overall")[0]?.comparable, true);
  assert.equal(metric(same, "outcome")[0]?.delta, 10);
  assert.equal(metric(same, "persuasion")[0]?.delta, 1);

  const different = facts({
    users: [member],
    scores: [
      score("current_b", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_B, rubricVersion: "generation_b" }),
      score("previous_a", member.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A, rubricVersion: "generation_a" }),
    ],
  });
  assert.deepEqual(metric(different, "persuasion").map((entry) => entry.scoringGeneration), ["generation_a", "generation_b"]);
  assert.equal(metric(different, "persuasion").every((entry) => entry.nonComparableReason === "incompatible_scoring_generation"), true);

  const differentProfiles = facts({
    users: [member],
    scores: [
      score("current_b", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_B }),
      score("previous_a", member.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
    ],
  });
  for (const name of ["communication", "overall"] as const) {
    assert.equal(metric(differentProfiles, name).length, 2);
    assert.equal(metric(differentProfiles, name).every((entry) => entry.nonComparableReason === "incompatible_weight_profile"), true);
  }
  assert.equal(metric(differentProfiles, "outcome").length, 1);
  assert.equal(metric(differentProfiles, "outcome")[0]?.comparable, true);
  assert.equal(metric(differentProfiles, "persuasion").length, 1);
  assert.equal(metric(differentProfiles, "persuasion")[0]?.comparable, true);
});

test("unknown composite profiles never compare, including unknown-to-unknown and known-to-unknown", () => {
  const member = user("member");
  const unknown = facts({
    users: [member],
    scores: [
      score("current_unknown", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: undefined }),
      score("previous_unknown", member.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: undefined }),
    ],
  });
  for (const name of ["communication", "overall"] as const) {
    const comparison = metric(unknown, name)[0]!;
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.delta, null);
    assert.equal(comparison.nonComparableReason, "unknown_weight_profile");
    assert.deepEqual(comparison.weightProfile, { kind: "unknown" });
  }

  const mixed = facts({
    users: [member],
    scores: [
      score("current_known", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
      score("previous_unknown", member.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: undefined }),
    ],
  });
  for (const name of ["communication", "overall"] as const) {
    assert.equal(metric(mixed, name).every((entry) => entry.nonComparableReason === "unknown_weight_profile"), true);
  }
  assert.equal(JSON.stringify(mixed).includes("profileKey"), false);
});

test("completion and objective denominators and generations remain canonical and separate", () => {
  const member = user("member");
  const result = facts({
    users: [member],
    scores: [
      score("current_complete", member.id, "2026-09-10T12:00:00.000Z"),
      score("current_partial", member.id, "2026-09-11T12:00:00.000Z", { completionLevel: "partial", objectiveAchieved: false }),
      score("current_inconclusive_b", member.id, "2026-09-12T12:00:00.000Z", { completionLevel: "inconclusive", objectiveAchieved: false, rubricVersion: "generation_b" }),
      score("previous_complete", member.id, "2026-08-10T12:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.completionComparisons.map((entry) => entry.scoringGeneration), ["generation_a", "generation_b"]);
  const generationA = result.completionComparisons[0]!;
  assert.deepEqual({
    denominator: generationA.completion.current?.availableObservationCount,
    complete: generationA.completion.current?.completeCount,
    partial: generationA.completion.current?.partialCount,
    inconclusive: generationA.completion.current?.inconclusiveCount,
    completionRate: generationA.completion.current?.completionRate,
    achieved: generationA.objective.current?.achievedCount,
    objectiveRate: generationA.objective.current?.objectiveAchievementRate,
  }, {
    denominator: 2,
    complete: 1,
    partial: 1,
    inconclusive: 0,
    completionRate: 0.5,
    achieved: 1,
    objectiveRate: 0.5,
  });
  assert.equal(generationA.completion.delta, -0.5);
  assert.equal(generationA.objective.delta, -0.5);
  assert.equal(result.completionComparisons[1]?.completion.nonComparableReason, "incompatible_scoring_generation");
});

test("maturity and concentration remain visible for small current populations without privacy fallback", () => {
  const power = user("power");
  const memberA = user("member_a");
  const memberB = user("member_b");
  const result = facts({
    users: [power, memberA, memberB],
    scores: [
      score("power_1", power.id, "2026-09-10T12:00:00.000Z"),
      score("power_2", power.id, "2026-09-11T12:00:00.000Z"),
      score("power_3", power.id, "2026-09-12T12:00:00.000Z"),
      score("member_a", memberA.id, "2026-09-13T12:00:00.000Z"),
      score("member_b", memberB.id, "2026-09-14T12:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.activity.current.evidenceStrength, {
    conservativeContributorCount: 3,
    limitedEvidence: true,
  });
  assert.equal(result.activity.current.concentrationWarning, true);
  assert.equal(result.activity.current.attemptCount, 5);
  assert.equal(JSON.stringify(result).includes("historicalPrivacyAdjustmentApplied"), false);
  assert.equal(JSON.stringify(result).includes("confidence"), false);
});

test("output is identity-free, excludes rejected/quarantined history, and does not fabricate Focus Topic facts", () => {
  const member = user("private_member_id");
  const result = facts({
    users: [member],
    scores: [
      score("private_evidence_id", member.id, "2026-09-10T12:00:00.000Z", {
        simulationSessionId: "private_session_id",
        scenarioId: "private_scenario_id",
      }),
      score("rejected", member.id, "2026-09-11T12:00:00.000Z", { overallScore: Number.NaN }),
      score("duplicate_a", member.id, "2026-09-12T12:00:00.000Z", { simulationSessionId: "duplicate_session" }),
      score("duplicate_b", member.id, "2026-09-13T12:00:00.000Z", { simulationSessionId: "duplicate_session" }),
      score("protected_former", "former_private_id", "2026-09-14T12:00:00.000Z"),
    ],
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.activity.current.attemptCount, 1);
  assert.deepEqual(result.focusReadiness, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });
  for (const forbidden of [
    "private_member_id", "private_evidence_id", "private_session_id", "private_scenario_id",
    "former_private_id", "userId", "subjectKey", "evidenceId", "sessionId", "scenarioId",
    "trainingId", "managerUserId", "profileKey", "focus_topic_a", "Current mutable Focus Topic name",
    "historicalPrivacyAdjustmentApplied",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("fact construction requires organization authorization and accepts no caller-supplied population", () => {
  const teamActor = user("team_viewer", {
    orgRole: "org_admin",
    performanceAccess: "team",
  });
  const snapshot: PerformanceEvidenceSourceSnapshot = {
    users: [teamActor, user("member")],
    scoreRecords: [],
    organizations: [{ id: "org_a", status: "active" }],
    trainings: [],
  };
  assert.throws(() => buildOrganizationPerformanceIntelligenceFacts({
    snapshot,
    viewer: viewer(teamActor),
    organizationId: "org_a",
    calendarMonth: SEPTEMBER,
  }), (error) =>
    error instanceof AuthorizedOrganizationPerformanceDeniedError
    && error.reason === "performance_scope_denied");

  const currentActor = actor();
  assert.throws(() => buildOrganizationPerformanceIntelligenceFacts({
    snapshot: { ...snapshot, users: [currentActor] },
    viewer: viewer(currentActor),
    organizationId: "org_a",
    calendarMonth: SEPTEMBER,
    memberIds: ["caller_controlled"],
  } as Parameters<typeof buildOrganizationPerformanceIntelligenceFacts>[0]),
  AuthorizedOrganizationPerformanceInputError);
});
