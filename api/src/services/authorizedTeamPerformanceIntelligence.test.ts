import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  queryAuthorizedTeamPerformanceIntelligence,
} from "./authorizedTeamPerformanceIntelligence.js";
import { AuthorizedTeamPerformanceDeniedError } from "./authorizedTeamPerformance.js";
import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";

const MONTH = { year: 2026, month: 9 } as const;
const COMPLETE_AS_OF = new Date("2026-10-01T00:00:00.000Z");
const WEIGHTS = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };

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
    isSuperUser: actor.isSuperUser === true,
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
    trainingId: "training_a",
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
    scoringWeightsApplied: WEIGHTS,
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
    organizations: [
      { id: "org_a", status: "active" },
      { id: "org_b", status: "active" },
    ],
    trainings: [{
      id: "training_a",
      orgId: "org_a",
      name: "Current mutable training name",
      status: "active",
      divisionId: null,
    }],
  };
}

function query(params: {
  actor?: PerformanceEvidenceSourceUser;
  users?: readonly PerformanceEvidenceSourceUser[];
  scores?: readonly SimulationScoreRecord[];
  asOf?: Date;
}) {
  const actor = params.actor ?? user("manager", { performanceAccess: "team" });
  return queryAuthorizedTeamPerformanceIntelligence({
    snapshot: snapshot(actor, params.users ?? [], params.scores ?? []),
    viewer: viewer(actor),
    organizationId: "org_a",
    calendarMonth: MONTH,
    asOf: params.asOf ?? COMPLETE_AS_OF,
  });
}

test("route-safe facade composes one-roster facts and complete-month signals without identity", () => {
  const direct = user("direct", { managerUserId: "manager" });
  const disabled = user("disabled", { managerUserId: "manager", status: "disabled" });
  const former = user("former");
  const result = query({
    users: [
      direct,
      disabled,
      former,
      user("indirect", { managerUserId: direct.id }),
      user("moved", { managerUserId: "manager", orgId: "org_b" }),
    ],
    scores: [
      score("direct_current", direct.id, "2026-09-15T12:00:00.000Z", {
        persuasion: 8,
        clarity: 7,
        empathy: 6,
        assertiveness: 5,
        communicationScore: 80,
        overallScore: 78,
      }),
      score("disabled_current", disabled.id, "2026-09-16T12:00:00.000Z", {
        persuasion: 8,
        clarity: 7,
        empathy: 6,
        assertiveness: 5,
        communicationScore: 80,
        overallScore: 78,
      }),
      score("direct_previous", direct.id, "2026-08-15T12:00:00.000Z", {
        persuasion: 6,
        clarity: 6,
        empathy: 6,
        assertiveness: 6,
        communicationScore: 60,
        overallScore: 60,
        objectiveAchieved: false,
      }),
      score("disabled_previous", disabled.id, "2026-08-16T12:00:00.000Z", {
        persuasion: 6,
        clarity: 6,
        empathy: 6,
        assertiveness: 6,
        communicationScore: 60,
        overallScore: 60,
        objectiveAchieved: false,
      }),
      score("direct_previous_partial", direct.id, "2026-08-18T12:00:00.000Z", {
        completionLevel: "partial",
        objectiveAchieved: false,
      }),
      score("disabled_previous_partial", disabled.id, "2026-08-19T12:00:00.000Z", {
        completionLevel: "partial",
        objectiveAchieved: false,
      }),
      score("former_previous", former.id, "2026-08-17T12:00:00.000Z"),
      score("self_current", "manager", "2026-09-17T12:00:00.000Z"),
    ],
  });

  assert.equal(result.asOf, COMPLETE_AS_OF.toISOString());
  assert.deepEqual(result.population, { currentReportCount: 2, hasCurrentReports: true });
  assert.equal(result.facts.activity.current.attemptCount, 2);
  assert.equal(result.facts.activity.previous.attemptCount, 4);
  assert.equal(
    result.signals.metricMovement.find((entry) => entry.metric === "persuasion")?.movement.direction,
    "up",
  );
  assert.equal(
    result.signals.metricMovement.find((entry) =>
      entry.metric === "communication" && entry.weightProfile?.kind === "known")?.movement.direction,
    "up",
  );
  assert.deepEqual(result.signals.relativeDimensions[0]?.highestDimensions, ["persuasion"]);
  assert.deepEqual(result.signals.relativeDimensions[0]?.lowestDimensions, ["assertiveness"]);
  assert.equal(result.signals.completionMovement[0]?.completion.movement.direction, "up");
  assert.equal(result.signals.completionMovement[0]?.objective.movement.direction, "up");
  assert.deepEqual(result.signals.metricMovement[0]?.qualifiers.current, {
    limitedEvidence: true,
    concentrationWarning: true,
  });
  assert.deepEqual(result.facts.focusReadiness, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });
  assert.deepEqual(result.signals.focus, result.facts.focusReadiness);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "userId", "subjectKey", "managerUserId", "evidenceId", "simulationSessionId",
    "scenarioId", "trainingId", "profileKey", "direct_current", "manager@example.test",
    "Current mutable training name",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("organization access remains constrained to actual direct reports", () => {
  const actor = user("manager", { performanceAccess: "organization" });
  const direct = user("direct", { managerUserId: actor.id });
  const unrelated = user("unrelated");
  const result = query({
    actor,
    users: [direct, unrelated],
    scores: [
      score("direct", direct.id, "2026-09-15T12:00:00.000Z"),
      score("unrelated", unrelated.id, "2026-09-15T12:00:00.000Z"),
    ],
  });

  assert.deepEqual(result.population, { currentReportCount: 1, hasCurrentReports: true });
  assert.equal(result.facts.activity.current.attemptCount, 1);
});

test("none access and admin role alone do not grant Team intelligence", () => {
  for (const actor of [
    user("manager", { performanceAccess: "none" }),
    user("manager", { orgRole: "org_admin", performanceAccess: "none" }),
    user("manager", { orgRole: "user_admin", performanceAccess: "none" }),
  ]) {
    assert.throws(() => query({ actor }), (error) =>
      error instanceof AuthorizedTeamPerformanceDeniedError
      && error.reason === "performance_scope_denied");
  }
});

test("authorized viewers with zero reports receive valid empty facts and signals", () => {
  const result = query({});
  assert.deepEqual(result.population, { currentReportCount: 0, hasCurrentReports: false });
  assert.equal(result.facts.activity.current.attemptCount, 0);
  assert.equal(result.facts.activity.previous.attemptCount, 0);
  assert.deepEqual(result.facts.metricComparisons, []);
  assert.deepEqual(result.facts.completionComparisons, []);
  assert.deepEqual(result.signals.metricMovement, []);
  assert.deepEqual(result.signals.relativeDimensions, []);
  assert.deepEqual(result.signals.completionMovement, []);
});

test("server asOf controls incomplete-month suppression and is serialized once consistently", () => {
  const direct = user("direct", { managerUserId: "manager" });
  const asOf = new Date("2026-09-15T12:34:56.789Z");
  const result = query({
    users: [direct],
    asOf,
    scores: [
      score("current", direct.id, "2026-09-10T12:00:00.000Z", { persuasion: 8 }),
      score("previous", direct.id, "2026-08-10T12:00:00.000Z", { persuasion: 6 }),
    ],
  });

  assert.equal(result.asOf, asOf.toISOString());
  assert.deepEqual(result.signals.monthCompleteness, {
    complete: false,
    completesAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(
    result.signals.metricMovement.find((entry) => entry.metric === "persuasion")?.movement.reason,
    "current_month_incomplete",
  );
  assert.equal(result.signals.activityMovement.attempts.reason, "current_month_incomplete");
});

test("balanced and incomplete relative-dimension contracts remain presentation-safe", () => {
  const direct = user("direct", { managerUserId: "manager" });
  const balanced = query({
    users: [direct],
    scores: [score("balanced", direct.id, "2026-09-10T12:00:00.000Z")],
  }).signals.relativeDimensions[0]!;

  assert.equal(balanced.relativePosition, "balanced");
  assert.deepEqual(balanced.highestDimensions, []);
  assert.deepEqual(balanced.lowestDimensions, []);
  assert.equal(balanced.dimensions.length, 4);
  assert.deepEqual(balanced.qualifiers, {
    limitedEvidence: true,
    concentrationWarning: true,
  });
});

test("unknown profiles and generation mismatches retain exact non-comparable reasons", () => {
  const direct = user("direct", { managerUserId: "manager" });
  const result = query({
    users: [direct],
    scores: [
      score("unknown_current", direct.id, "2026-09-10T12:00:00.000Z", {
        scoringWeightsApplied: undefined,
      }),
      score("unknown_previous", direct.id, "2026-08-10T12:00:00.000Z", {
        scoringWeightsApplied: undefined,
      }),
      score("previous_generation", direct.id, "2026-08-11T12:00:00.000Z", {
        rubricVersion: "generation_b",
      }),
    ],
  });

  const unknownCommunication = result.signals.metricMovement.find((entry) =>
    entry.metric === "communication" && entry.weightProfile?.kind === "unknown");
  assert.equal(unknownCommunication?.movement.reason, "unknown_weight_profile");
  const persuasion = result.signals.metricMovement.filter((entry) => entry.metric === "persuasion");
  assert.equal(persuasion.some((entry) => entry.movement.reason === "incompatible_scoring_generation"), true);
});
