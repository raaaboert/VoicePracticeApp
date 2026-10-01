import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";
import {
  buildTeamPerformanceIntelligenceFacts,
  type TeamPerformanceIntelligenceFacts,
} from "./teamPerformanceIntelligenceFacts.js";

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

function viewer(actor: PerformanceEvidenceSourceUser): DashboardViewer {
  return {
    accessType: "customer_dashboard_user",
    userId: actor.id,
    email: `${actor.id}@example.test`,
    isSuperUser: false,
    orgId: actor.orgId,
    orgName: "Organization A",
    orgRole: actor.orgRole,
    performanceAccess: actor.performanceAccess ?? "none",
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

function snapshot(
  actor: PerformanceEvidenceSourceUser,
  users: readonly PerformanceEvidenceSourceUser[],
  scores: readonly SimulationScoreRecord[],
): PerformanceEvidenceSourceSnapshot {
  return {
    users: [actor, ...users],
    scoreRecords: scores,
    organizations: [{ id: "org_a", status: "active" }],
    trainings: [{
      id: "focus_topic_a",
      orgId: "org_a",
      name: "Current mutable topic name",
      status: "active",
      divisionId: null,
    }],
  };
}

function facts(params: {
  reports?: readonly PerformanceEvidenceSourceUser[];
  otherUsers?: readonly PerformanceEvidenceSourceUser[];
  scores?: readonly SimulationScoreRecord[];
  calendarMonth?: { year: number; month: number };
} = {}): TeamPerformanceIntelligenceFacts {
  const actor = user("manager", { performanceAccess: "team" });
  return buildTeamPerformanceIntelligenceFacts({
    snapshot: snapshot(actor, [...(params.reports ?? []), ...(params.otherUsers ?? [])], params.scores ?? []),
    viewer: viewer(actor),
    organizationId: "org_a",
    calendarMonth: params.calendarMonth ?? SEPTEMBER,
  });
}

function metric(
  result: TeamPerformanceIntelligenceFacts,
  metricName: TeamPerformanceIntelligenceFacts["metricComparisons"][number]["metric"],
) {
  return result.metricComparisons.filter((comparison) => comparison.metric === metricName);
}

test("both periods use the same current direct-report roster", () => {
  const retained = user("retained", { managerUserId: "manager" });
  const newlyCurrent = user("newly_current", { managerUserId: "manager" });
  const disabledCurrent = user("disabled_current", { managerUserId: "manager", status: "disabled" });
  const former = user("former");
  const moved = user("moved", { managerUserId: "manager", orgId: "org_b" });
  const indirect = user("indirect", { managerUserId: retained.id });

  const result = facts({
    reports: [retained, newlyCurrent, disabledCurrent],
    otherUsers: [former, moved, indirect],
    scores: [
      score("retained_current", retained.id, "2026-09-15T12:00:00.000Z"),
      score("retained_previous", retained.id, "2026-08-15T12:00:00.000Z"),
      score("new_previous", newlyCurrent.id, "2026-08-16T12:00:00.000Z"),
      score("disabled_previous", disabledCurrent.id, "2026-08-17T12:00:00.000Z"),
      score("former_previous", former.id, "2026-08-18T12:00:00.000Z"),
      score("moved_previous", moved.id, "2026-08-19T12:00:00.000Z"),
      score("indirect_previous", indirect.id, "2026-08-20T12:00:00.000Z"),
      score("viewer_previous", "manager", "2026-08-21T12:00:00.000Z"),
      score("deleted_previous", "deleted_user", "2026-08-22T12:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.population, { currentReportCount: 3, hasCurrentReports: true });
  assert.equal(result.activity.current.attemptCount, 1);
  assert.equal(result.activity.previous.attemptCount, 3);
  assert.equal(result.activity.attemptDelta, -2);
});

test("January comparison rolls to December and fixed UTC boundaries are start-inclusive and end-exclusive", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    calendarMonth: { year: 2026, month: 1 },
    scores: [
      score("before_previous", report.id, "2025-11-30T23:59:59.999Z"),
      score("previous_start", report.id, "2025-12-01T00:00:00.000Z"),
      score("previous_end", report.id, "2025-12-31T23:59:59.999Z"),
      score("current_start", report.id, "2026-01-01T00:00:00.000Z"),
      score("current_end", report.id, "2026-01-31T23:59:59.999Z"),
      score("after_current", report.id, "2026-02-01T00:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.currentMonth, { year: 2026, month: 1, timeZone: "UTC" });
  assert.deepEqual(result.comparisonMonth, { year: 2025, month: 12, timeZone: "UTC" });
  assert.equal(result.activity.current.attemptCount, 2);
  assert.equal(result.activity.previous.attemptCount, 2);
});

test("same-generation metric groups produce raw deltas without presentation rounding", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current", report.id, "2026-09-15T12:00:00.000Z", {
        persuasion: 8.123456789,
        communicationScore: 81.125,
        outcomeScore: 75.75,
        overallScore: 79.375,
      }),
      score("previous", report.id, "2026-08-15T12:00:00.000Z", {
        persuasion: 6.25,
        communicationScore: 70.5,
        outcomeScore: 65.25,
        overallScore: 68.125,
      }),
    ],
  });

  const persuasion = metric(result, "persuasion")[0]!;
  assert.equal(persuasion.comparable, true);
  assert.equal(persuasion.delta, 8.123456789 - 6.25);
  assert.equal(metric(result, "communication")[0]?.delta, 10.625);
  assert.equal(metric(result, "outcome")[0]?.delta, 10.5);
  assert.equal(metric(result, "overall")[0]?.delta, 11.25);
});

test("generation mismatches stay separate and never produce a delta", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current_b", report.id, "2026-09-15T12:00:00.000Z", { rubricVersion: "generation_b" }),
      score("previous_a", report.id, "2026-08-15T12:00:00.000Z", { rubricVersion: "generation_a" }),
    ],
  });

  const persuasion = metric(result, "persuasion");
  assert.deepEqual(persuasion.map((entry) => entry.scoringGeneration), ["generation_a", "generation_b"]);
  assert.equal(persuasion.every((entry) => entry.delta === null && !entry.comparable), true);
  assert.equal(persuasion.every((entry) => entry.nonComparableReason === "incompatible_scoring_generation"), true);
});

test("Communication and Overall require exact weight-profile alignment while Outcome does not split", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current_a", report.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
      score("current_b", report.id, "2026-09-11T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_B }),
      score("previous_a", report.id, "2026-08-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
    ],
  });

  const communication = metric(result, "communication");
  assert.equal(communication.length, 2);
  const matchingCommunication = communication.find((entry) => entry.comparable);
  assert.ok(matchingCommunication);
  assert.equal(matchingCommunication.delta, 0);
  assert.equal(
    communication.find((entry) => !entry.comparable)?.nonComparableReason,
    "incompatible_weight_profile",
  );
  const overall = metric(result, "overall");
  assert.equal(overall.length, 2);
  assert.equal(overall.find((entry) => entry.comparable)?.delta, 0);
  assert.equal(overall.find((entry) => !entry.comparable)?.nonComparableReason, "incompatible_weight_profile");
  assert.equal(metric(result, "outcome").length, 1);
  assert.equal(metric(result, "outcome")[0]?.comparable, true);
  assert.equal(metric(result, "persuasion")[0]?.comparable, true);
});

test("unknown Communication and Overall profiles retain both periods but never produce deltas", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current_unknown", report.id, "2026-09-15T12:00:00.000Z", {
        scoringWeightsApplied: undefined,
        communicationScore: 80,
        overallScore: 75,
        outcomeScore: 60,
        persuasion: 8,
      }),
      score("previous_unknown", report.id, "2026-08-15T12:00:00.000Z", {
        scoringWeightsApplied: undefined,
        communicationScore: 70,
        overallScore: 65,
        outcomeScore: 50,
        persuasion: 7,
      }),
    ],
  });

  for (const metricName of ["communication", "overall"] as const) {
    const comparison = metric(result, metricName)[0]!;
    assert.equal(comparison.current?.observationCount, 1);
    assert.equal(comparison.previous?.observationCount, 1);
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.delta, null);
    assert.equal(comparison.nonComparableReason, "unknown_weight_profile");
    assert.deepEqual(comparison.weightProfile, { kind: "unknown" });
  }
  assert.equal(metric(result, "outcome")[0]?.comparable, true);
  assert.equal(metric(result, "outcome")[0]?.delta, 10);
  assert.equal(metric(result, "persuasion")[0]?.comparable, true);
  assert.equal(metric(result, "persuasion")[0]?.delta, 1);
});

test("known versus unknown Communication and Overall profiles use the precise unknown reason", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current_known", report.id, "2026-09-15T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
      score("previous_unknown", report.id, "2026-08-15T12:00:00.000Z", { scoringWeightsApplied: undefined }),
    ],
  });

  for (const metricName of ["communication", "overall"] as const) {
    const comparisons = metric(result, metricName);
    assert.equal(comparisons.length, 2);
    assert.equal(comparisons.every((entry) => entry.comparable === false), true);
    assert.equal(comparisons.every((entry) => entry.delta === null), true);
    assert.equal(comparisons.every((entry) => entry.nonComparableReason === "unknown_weight_profile"), true);
    assert.equal(comparisons.some((entry) => entry.weightProfile?.kind === "unknown"), true);
  }
  assert.equal(metric(result, "outcome")[0]?.comparable, true);
  assert.equal(metric(result, "persuasion")[0]?.comparable, true);
  assert.equal(JSON.stringify(result).includes("0.25"), false);
  assert.equal(JSON.stringify(result).includes("profileKey"), false);
});

test("one-sided unknown composite facts remain visible without a fabricated comparison", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [score("previous_unknown", report.id, "2026-08-15T12:00:00.000Z", {
      scoringWeightsApplied: undefined,
      communicationScore: 64,
      overallScore: 61,
    })],
  });

  for (const metricName of ["communication", "overall"] as const) {
    const comparison = metric(result, metricName)[0]!;
    assert.equal(comparison.current, null);
    assert.ok(comparison.previous);
    assert.equal(comparison.delta, null);
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.nonComparableReason, "no_current_evidence");
  }
});

test("one-sided evidence is retained with an explicit unavailable comparison", () => {
  const report = user("report", { managerUserId: "manager" });
  const previousOnly = facts({
    reports: [report],
    scores: [score("previous", report.id, "2026-08-15T12:00:00.000Z")],
  });
  const previousPersuasion = metric(previousOnly, "persuasion")[0]!;
  assert.equal(previousPersuasion.current, null);
  assert.ok(previousPersuasion.previous);
  assert.equal(previousPersuasion.delta, null);
  assert.equal(previousPersuasion.nonComparableReason, "no_current_evidence");

  const currentOnly = facts({
    reports: [report],
    scores: [score("current", report.id, "2026-09-15T12:00:00.000Z")],
  });
  const currentPersuasion = metric(currentOnly, "persuasion")[0]!;
  assert.ok(currentPersuasion.current);
  assert.equal(currentPersuasion.previous, null);
  assert.equal(currentPersuasion.nonComparableReason, "no_previous_evidence");
});

test("activity, completion, and objective facts preserve canonical partial and inconclusive semantics", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("current_complete", report.id, "2026-09-10T12:00:00.000Z"),
      score("current_partial", report.id, "2026-09-11T12:00:00.000Z", {
        completionLevel: "partial", objectiveAchieved: false,
      }),
      score("current_inconclusive", report.id, "2026-09-12T12:00:00.000Z", {
        completionLevel: "inconclusive", objectiveAchieved: false,
      }),
      score("previous_complete", report.id, "2026-08-10T12:00:00.000Z"),
    ],
  });

  assert.equal(result.activity.current.attemptCount, 3);
  assert.equal(result.activity.current.conclusiveAttemptCount, 1);
  const comparison = result.completionComparisons[0]!;
  assert.deepEqual({
    complete: comparison.completion.current?.completeCount,
    partial: comparison.completion.current?.partialCount,
    inconclusive: comparison.completion.current?.inconclusiveCount,
    completionRate: comparison.completion.current?.completionRate,
    achieved: comparison.objective.current?.achievedCount,
    objectiveRate: comparison.objective.current?.objectiveAchievementRate,
  }, {
    complete: 1,
    partial: 1,
    inconclusive: 1,
    completionRate: 1 / 3,
    achieved: 1,
    objectiveRate: 1 / 3,
  });
  assert.equal(comparison.completion.delta, (1 / 3) - 1);
  assert.equal(comparison.objective.delta, (1 / 3) - 1);
});

test("existing limited-evidence and concentration facts are reused without confidence scores", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [score("current", report.id, "2026-09-15T12:00:00.000Z")],
  });

  assert.deepEqual(result.activity.current.evidenceStrength, {
    conservativeContributorCount: 1,
    limitedEvidence: true,
  });
  assert.equal(result.activity.current.concentrationWarning, true);
  assert.equal(JSON.stringify(result).includes("confidence"), false);
});

test("the fact DTO is grouped, identity-free, and does not fabricate Focus Topic attribution", () => {
  const report = user("private_report_id", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [score("private_evidence_id", report.id, "2026-09-15T12:00:00.000Z", {
      simulationSessionId: "private_session_id",
      scenarioId: "private_scenario_id",
      trainingId: "focus_topic_a",
    })],
  });
  const serialized = JSON.stringify(result);

  assert.deepEqual(result.focusReadiness, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });
  for (const forbidden of [
    "private_report_id", "private_evidence_id", "private_session_id", "private_scenario_id",
    "userId", "managerUserId", "subjectKey", "evidenceId", "sessionId", "trainingId",
    "focus_topic_a", "Current mutable topic name",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("duplicate-session quarantine and rejected evidence remain excluded", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [
      score("valid", report.id, "2026-09-15T12:00:00.000Z"),
      score("rejected", report.id, "2026-09-16T12:00:00.000Z", { overallScore: Number.NaN }),
      score("duplicate_a", report.id, "2026-09-17T12:00:00.000Z", {
        simulationSessionId: "duplicate_session",
      }),
      score("duplicate_b", report.id, "2026-09-18T12:00:00.000Z", {
        simulationSessionId: "duplicate_session",
      }),
    ],
  });

  assert.equal(result.activity.current.attemptCount, 1);
});

test("a current report's prior evidence from another organization is excluded", () => {
  const report = user("report", { managerUserId: "manager" });
  const result = facts({
    reports: [report],
    scores: [score("other_org_previous", report.id, "2026-08-15T12:00:00.000Z", {
      orgId: "org_b",
    })],
  });

  assert.equal(result.population.currentReportCount, 1);
  assert.equal(result.activity.previous.attemptCount, 0);
  assert.deepEqual(result.metricComparisons, []);
});

test("a current report who rejoined the organization retains same-org history only", () => {
  const report = user("rejoined_report", { managerUserId: "manager", orgId: "org_a" });
  const result = facts({
    reports: [report],
    scores: [
      score("same_org_previous", report.id, "2026-08-10T12:00:00.000Z", { orgId: "org_a" }),
      score("other_org_previous", report.id, "2026-08-11T12:00:00.000Z", { orgId: "org_b" }),
    ],
  });

  assert.equal(result.activity.previous.attemptCount, 1);
  assert.equal(metric(result, "persuasion")[0]?.previous?.observationCount, 1);
});
