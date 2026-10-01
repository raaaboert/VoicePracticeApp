import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  queryAuthorizedOrganizationPerformanceIntelligence,
} from "./authorizedOrganizationPerformanceIntelligence.js";
import { AuthorizedOrganizationPerformanceDeniedError } from "./authorizedOrganizationPerformance.js";
import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";

const MONTH = { year: 2026, month: 9 } as const;
const COMPLETE_AS_OF = new Date("2026-10-01T00:00:00.000Z");
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
  const superUser = actor.isSuperUser === true;
  return {
    accessType: superUser ? "super_user" : "customer_dashboard_user",
    userId: actor.id,
    email: `${actor.id}@example.test`,
    isSuperUser: superUser,
    orgId: actor.orgId,
    orgName: actor.orgId === null ? null : "Organization A",
    orgRole: actor.orgRole,
    performanceAccess: actor.performanceAccess ?? "none",
    capabilities: {
      viewOrganizationUsers: superUser,
      manageRegularOrganizationUsers: superUser,
      approveRejectAccessRequests: superUser,
      editEmployeeIds: superUser,
      editUserNames: superUser,
      manageUserRoles: superUser,
      assignUserManagers: superUser,
      managePerformanceAccess: superUser,
      manageOrganizationContent: superUser,
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
    scoringWeightsApplied: WEIGHTS_A,
    ...overrides,
  };
}

function run(params: {
  actor?: PerformanceEvidenceSourceUser;
  members?: readonly PerformanceEvidenceSourceUser[];
  scores?: readonly SimulationScoreRecord[];
  asOf?: Date;
} = {}) {
  const actor = params.actor ?? user("organization_viewer", {
    orgRole: "org_admin",
    performanceAccess: "organization",
  });
  const snapshot: PerformanceEvidenceSourceSnapshot = {
    users: [actor, ...(params.members ?? [])],
    scoreRecords: params.scores ?? [],
    organizations: [
      { id: "org_a", status: "active" },
      { id: "org_b", status: "active" },
    ],
    trainings: [{
      id: "training_a",
      orgId: "org_a",
      name: "Private mutable training name",
      status: "active",
      divisionId: null,
    }],
  };
  return queryAuthorizedOrganizationPerformanceIntelligence({
    snapshot,
    viewer: viewer(actor),
    organizationId: "org_a",
    calendarMonth: MONTH,
    asOf: params.asOf ?? COMPLETE_AS_OF,
  });
}

test("route-safe facade exposes current-members facts and signals without identity or history metadata", () => {
  const current = user("private_current_member");
  const moved = user("private_moved_member", { orgId: "org_b" });
  const result = run({
    members: [current, moved],
    scores: [
      score("private_current_score", current.id, "2026-09-15T12:00:00.000Z", {
        persuasion: 8,
        clarity: 8,
        empathy: 7,
        assertiveness: 6,
      }),
      score("private_previous_score", current.id, "2026-08-15T12:00:00.000Z", {
        persuasion: 6,
        clarity: 6,
        empathy: 6,
        assertiveness: 6,
        objectiveAchieved: false,
      }),
      score("former_history", "private_former_member", "2026-08-16T12:00:00.000Z"),
      score("moved_history", moved.id, "2026-08-17T12:00:00.000Z"),
    ],
  });

  assert.equal(result.scope, "organization");
  assert.equal(result.populationBasis, "current_members");
  assert.equal(result.asOf, COMPLETE_AS_OF.toISOString());
  assert.deepEqual(result.currentMonth, { year: 2026, month: 9, timeZone: "UTC" });
  assert.deepEqual(result.comparisonMonth, { year: 2026, month: 8, timeZone: "UTC" });
  assert.deepEqual(result.population, { currentMemberCount: 2, hasCurrentMembers: true });
  assert.equal(result.facts.activity.current.attemptCount, 1);
  assert.equal(result.facts.activity.previous.attemptCount, 1);
  assert.deepEqual(result.signals.relativeDimensions[0]?.highestDimensions, ["persuasion", "clarity"]);
  assert.deepEqual(result.signals.relativeDimensions[0]?.lowestDimensions, ["assertiveness"]);
  assert.equal(result.signals.completionMovement[0]?.objective.movement.direction, "up");
  assert.deepEqual(result.signals.focus, {
    available: false,
    reason: "historical_focus_topic_mapping_unavailable",
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "userId", "subjectKey", "name", "email", "memberIds", "managerUserId",
    "evidenceId", "sessionId", "simulationSessionId", "scenarioId", "trainingId",
    "trainingPackId", "transcript", "profileKey", "largestContributionShare",
    "organization_history", "historicalPrivacyAdjustmentApplied", "protectedContributor",
    "private_current_member", "private_moved_member", "private_former_member",
    "private_current_score", "Private mutable training name",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("organization scope is required independently of administrative role", () => {
  for (const actor of [
    user("team_admin", { orgRole: "org_admin", performanceAccess: "team" }),
    user("none_admin", { orgRole: "org_admin", performanceAccess: "none" }),
    user("none_user_admin", { orgRole: "user_admin", performanceAccess: "none" }),
  ]) {
    assert.throws(() => run({ actor }), (error) =>
      error instanceof AuthorizedOrganizationPerformanceDeniedError
      && error.reason === "performance_scope_denied");
  }
});

test("platform super-users retain explicit organization access and zero-member organizations stay coherent", () => {
  const actor = user("platform_super", {
    accountType: "individual",
    orgId: null,
    orgRole: "user",
    isSuperUser: true,
    dashboardAccessEnabled: false,
  });
  const result = run({ actor });
  assert.deepEqual(result.population, { currentMemberCount: 0, hasCurrentMembers: false });
  assert.equal(result.facts.activity.current.attemptCount, 0);
  assert.deepEqual(result.facts.metricComparisons, []);
  assert.deepEqual(result.signals.metricMovement, []);
  assert.deepEqual(result.signals.relativeDimensions, []);
});

test("current members without evidence receive a coherent identity-free empty evidence result", () => {
  const result = run();
  assert.deepEqual(result.population, { currentMemberCount: 1, hasCurrentMembers: true });
  assert.equal(result.facts.activity.current.attemptCount, 0);
  assert.deepEqual(result.facts.metricComparisons, []);
  assert.deepEqual(result.facts.completionComparisons, []);
  assert.deepEqual(result.signals.metricMovement, []);
  assert.deepEqual(result.signals.completionMovement, []);
});

test("server asOf is serialized once and incomplete-month movement remains suppressed", () => {
  const member = user("member");
  const asOf = new Date("2026-09-15T12:34:56.789Z");
  const result = run({
    members: [member],
    asOf,
    scores: [
      score("current", member.id, "2026-09-10T12:00:00.000Z", { persuasion: 8 }),
      score("previous", member.id, "2026-08-10T12:00:00.000Z", { persuasion: 6 }),
    ],
  });
  assert.equal(result.asOf, asOf.toISOString());
  assert.deepEqual(result.signals.monthCompleteness, {
    complete: false,
    completesAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(result.facts.activity.attemptDelta, 0);
  assert.equal(result.signals.activityMovement.attempts.reason, "current_month_incomplete");
  assert.equal(
    result.signals.metricMovement.find((entry) => entry.metric === "persuasion")?.movement.reason,
    "current_month_incomplete",
  );
});

test("balanced relative-dimension variants are explicitly preserved", () => {
  const member = user("member");
  const balanced = run({
    members: [member],
    scores: [score("balanced", member.id, "2026-09-10T12:00:00.000Z")],
  }).signals.relativeDimensions[0]!;
  assert.equal(balanced.relativePosition, "balanced");
  assert.deepEqual(balanced.highestDimensions, []);
  assert.deepEqual(balanced.lowestDimensions, []);
});

test("generations and known or unknown profiles remain separate without internal profile keys", () => {
  const member = user("member");
  const result = run({
    members: [member],
    scores: [
      score("current_a", member.id, "2026-09-10T12:00:00.000Z", { scoringWeightsApplied: WEIGHTS_A }),
      score("current_b", member.id, "2026-09-11T12:00:00.000Z", {
        rubricVersion: "generation_b",
        scoringWeightsApplied: WEIGHTS_B,
      }),
      score("previous_unknown", member.id, "2026-08-10T12:00:00.000Z", {
        scoringWeightsApplied: undefined,
      }),
    ],
  });
  assert.deepEqual(
    result.signals.relativeDimensions.map((entry) => entry.scoringGeneration),
    ["generation_a", "generation_b"],
  );
  const unknown = result.signals.metricMovement.find((entry) =>
    entry.metric === "communication" && entry.weightProfile?.kind === "unknown");
  assert.equal(unknown?.movement.reason, "unknown_weight_profile");
  assert.equal(JSON.stringify(result).includes("profileKey"), false);
  assert.equal("primaryGeneration" in result, false);
});
