import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import { SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS } from "./simulationSessionLifecycle.js";
import {
  AuthorizedPerformanceEvidenceQueryInputError,
  queryAuthorizedPerformanceEvidence,
} from "./authorizedPerformanceEvidenceQuery.js";
import type {
  PerformanceEvidenceSourceSnapshot,
  PerformanceEvidenceSourceUser,
} from "./performanceEvidenceSourceSnapshot.js";

const NOW = "2026-09-24T12:00:00.000Z";

function user(id: string, overrides: Partial<PerformanceEvidenceSourceUser> = {}): PerformanceEvidenceSourceUser {
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

function viewer(actor: PerformanceEvidenceSourceUser, accessType: DashboardViewer["accessType"] = "customer_dashboard_user"): DashboardViewer {
  return {
    accessType,
    userId: actor.id,
    email: `${actor.id}@example.test`,
    isSuperUser: actor.isSuperUser === true,
    orgId: accessType === "super_user" ? null : actor.orgId,
    orgName: accessType === "super_user" ? null : "Organization",
    orgRole: accessType === "super_user" ? null : actor.orgRole,
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

function score(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  const id = overrides.id ?? "score_default";
  return {
    id,
    simulationSessionId: Object.hasOwn(overrides, "simulationSessionId") ? overrides.simulationSessionId : `session_${id}`,
    userId: overrides.userId ?? "actor",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? "org_a" : "org_a",
    segmentId: overrides.segmentId ?? "segment_a",
    scenarioId: overrides.scenarioId ?? "scenario_a",
    trainingId: Object.hasOwn(overrides, "trainingId") ? overrides.trainingId : "training_a",
    startedAt: overrides.startedAt ?? "2026-09-24T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-09-24T10:05:00.000Z",
    communicationScore: Object.hasOwn(overrides, "communicationScore") ? overrides.communicationScore : 80,
    outcomeScore: Object.hasOwn(overrides, "outcomeScore") ? overrides.outcomeScore : 70,
    overallScore: overrides.overallScore ?? 77,
    completionLevel: Object.hasOwn(overrides, "completionLevel") ? overrides.completionLevel : "complete",
    objectiveAchieved: Object.hasOwn(overrides, "objectiveAchieved") ? overrides.objectiveAchieved : true,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    rubricVersion: Object.hasOwn(overrides, "rubricVersion") ? overrides.rubricVersion : "2026-04-09.v1",
    createdAt: overrides.createdAt ?? NOW,
  };
}

function snapshot(params: {
  users: readonly PerformanceEvidenceSourceUser[];
  scoreRecords?: readonly SimulationScoreRecord[];
  organizations?: readonly { id: string; status: "active" | "disabled" }[];
}): PerformanceEvidenceSourceSnapshot {
  return {
    users: params.users,
    scoreRecords: params.scoreRecords ?? [],
    organizations: params.organizations ?? [{ id: "org_a", status: "active" }, { id: "org_b", status: "active" }],
    trainings: [],
  };
}

function query(params: {
  actor: PerformanceEvidenceSourceUser;
  users?: readonly PerformanceEvidenceSourceUser[];
  scoreRecords?: readonly SimulationScoreRecord[];
  organizationId?: string;
  targetUserId?: string;
  evidenceAtFrom?: string;
  evidenceAtBefore?: string;
  scenarioId?: string;
  trainingId?: string;
  viewer?: DashboardViewer;
}) {
  return queryAuthorizedPerformanceEvidence({
    snapshot: snapshot({ users: params.users ?? [params.actor], scoreRecords: params.scoreRecords }),
    actorUserId: params.actor.id,
    viewer: params.viewer ?? viewer(params.actor),
    organizationId: params.organizationId ?? "org_a",
    targetUserId: params.targetUserId,
    evidenceAtFrom: params.evidenceAtFrom,
    evidenceAtBefore: params.evidenceAtBefore,
    scenarioId: params.scenarioId,
    trainingId: params.trainingId,
  });
}

function evidenceIds(evidence: ReturnType<typeof queryAuthorizedPerformanceEvidence>): string[] {
  return evidence.map((entry) => entry.evidenceId);
}

test("validates required identifiers and UTC half-open range input", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  for (const invalid of [
    { actorUserId: " ", organizationId: "org_a" },
    { actorUserId: "actor", organizationId: "" },
    { actorUserId: "actor", organizationId: "org_a", evidenceAtFrom: "invalid" },
    {
      actorUserId: "actor",
      organizationId: "org_a",
      evidenceAtFrom: "2026-09-24T11:00:00.000Z",
      evidenceAtBefore: "2026-09-24T11:00:00.000Z",
    },
  ]) {
    assert.throws(
      () => queryAuthorizedPerformanceEvidence({ snapshot: snapshot({ users: [actor] }), viewer: viewer(actor), ...invalid }),
      AuthorizedPerformanceEvidenceQueryInputError,
    );
  }
});

test("none, team, direct-report, disabled-report, and organization scope preserve Phase 1A semantics", () => {
  const noneActor = user("actor", { performanceAccess: "none" });
  assert.deepEqual(evidenceIds(query({ actor: noneActor, scoreRecords: [score()] })), []);

  const actor = user("actor", { performanceAccess: "team" });
  const direct = user("direct", { managerUserId: actor.id });
  const disabledDirect = user("disabled_direct", { managerUserId: actor.id, status: "disabled" });
  const unrelated = user("unrelated");
  const users = [actor, direct, disabledDirect, unrelated];
  const records = [
    score({ id: "self", userId: actor.id }),
    score({ id: "direct", userId: direct.id }),
    score({ id: "disabled_direct", userId: disabledDirect.id }),
    score({ id: "unrelated", userId: unrelated.id }),
  ];
  assert.deepEqual(evidenceIds(query({ actor, users, scoreRecords: records })), ["direct", "disabled_direct", "self"]);

  const organizationActor = user("actor", { performanceAccess: "organization" });
  assert.deepEqual(
    evidenceIds(query({ actor: organizationActor, users: [organizationActor, direct, disabledDirect, unrelated], scoreRecords: records })),
    ["direct", "disabled_direct", "self", "unrelated"],
  );
});

test("target filtering only narrows Phase 1A scope and hides nonexistent and unauthorized targets alike", () => {
  const actor = user("actor", { performanceAccess: "team" });
  const direct = user("direct", { managerUserId: actor.id });
  const unrelated = user("unrelated");
  const crossOrg = user("cross_org", { orgId: "org_b" });
  const users = [actor, direct, unrelated, crossOrg];
  const records = [
    score({ id: "self", userId: actor.id }),
    score({ id: "direct", userId: direct.id }),
    score({ id: "unrelated", userId: unrelated.id }),
  ];

  assert.deepEqual(evidenceIds(query({ actor, users, scoreRecords: records, targetUserId: direct.id })), ["direct"]);
  assert.deepEqual(evidenceIds(query({ actor, users, scoreRecords: records, targetUserId: unrelated.id })), []);
  assert.deepEqual(evidenceIds(query({ actor, users, scoreRecords: records, targetUserId: crossOrg.id })), []);
  assert.deepEqual(evidenceIds(query({ actor, users, scoreRecords: records, targetUserId: "missing" })), []);
});

test("historical organization identity, null organization, and deidentified evidence remain isolated from current state", () => {
  const actor = user("actor", { orgId: "org_b", performanceAccess: "organization" });
  const moved = user("moved", { orgId: "org_b" });
  const deleted = user("deleted_user", { orgId: "org_b" });
  const records = [
    score({ id: "historical_a", userId: moved.id, orgId: "org_a" }),
    score({ id: "historical_b", userId: moved.id, orgId: "org_b" }),
    score({ id: "null_org", userId: moved.id, orgId: null }),
    score({ id: "mismatched_org", userId: moved.id, orgId: "org_other" }),
    score({ id: "deidentified", userId: deleted.id, orgId: "org_b" }),
  ];
  assert.deepEqual(
    evidenceIds(query({ actor, users: [actor, moved, deleted], scoreRecords: records, organizationId: "org_b" })),
    ["historical_b"],
  );
});

test("uses canonical evidenceAt, exact historical scenario/training filters, and half-open UTC time ranges", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const createdAt = new Date("2026-09-24T10:05:30.000Z");
  const futureEndedAt = new Date(createdAt.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS + 1);
  const records = [
    score({ id: "at_lower", endedAt: "2026-09-24T10:05:00.000Z", scenarioId: "scenario_match", trainingId: "training_match" }),
    score({ id: "at_upper", endedAt: "2026-09-24T10:10:00.000Z", scenarioId: "scenario_other", trainingId: "training_other" }),
    score({ id: "missing_training", trainingId: undefined }),
    score({ id: "clamped", endedAt: futureEndedAt.toISOString(), createdAt: createdAt.toISOString() }),
  ];
  const base = { actor, scoreRecords: records };
  assert.deepEqual(evidenceIds(query(base)), ["at_lower", "missing_training", "clamped", "at_upper"]);
  assert.deepEqual(evidenceIds(query({ ...base, trainingId: "training_match" })), ["at_lower"]);
  assert.deepEqual(evidenceIds(query({ ...base, trainingId: "training_missing" })), []);
  assert.deepEqual(evidenceIds(query({ ...base, scenarioId: "scenario_match" })), ["at_lower"]);
  assert.deepEqual(
    evidenceIds(query({
      ...base,
      evidenceAtFrom: "2026-09-24T10:05:00.000Z",
      evidenceAtBefore: "2026-09-24T10:10:00.000Z",
    })),
    ["at_lower", "missing_training", "clamped"],
  );
  assert.deepEqual(
    evidenceIds(query({
      ...base,
      evidenceAtFrom: createdAt.toISOString(),
      evidenceAtBefore: new Date(createdAt.getTime() + 1).toISOString(),
    })),
    ["clamped"],
  );
});

test("excludes quarantined and rejected evidence while preserving partial, inconclusive, and scoring generation", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const records = [
    score({ id: "duplicate_a", simulationSessionId: "duplicate" }),
    score({ id: "duplicate_b", simulationSessionId: "duplicate" }),
    score({ id: "rejected", overallScore: 101 }),
    score({ id: "partial", completionLevel: "partial", objectiveAchieved: false, rubricVersion: "partial_generation" }),
    score({ id: "inconclusive", completionLevel: "inconclusive", objectiveAchieved: false, rubricVersion: "inconclusive_generation" }),
  ];
  const result = query({ actor, scoreRecords: records });
  assert.deepEqual(evidenceIds(result), ["inconclusive", "partial"]);
  assert.equal(result.find((entry) => entry.evidenceId === "partial")?.scoringGeneration, "partial_generation");
  assert.equal(result.find((entry) => entry.evidenceId === "inconclusive")?.scoringGeneration, "inconclusive_generation");
});

test("orders canonical evidence chronologically then by evidence ID", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  assert.deepEqual(
    evidenceIds(query({
      actor,
      scoreRecords: [
        score({ id: "z_same_time", endedAt: "2026-09-24T10:05:00.000Z" }),
        score({ id: "later", endedAt: "2026-09-24T10:06:00.000Z" }),
        score({ id: "a_same_time", endedAt: "2026-09-24T10:05:00.000Z" }),
      ],
    })),
    ["a_same_time", "z_same_time", "later"],
  );
});

test("super users remain constrained to the supplied existing organization", () => {
  const actor = user("super", {
    accountType: "individual",
    orgId: null,
    isSuperUser: true,
    performanceAccess: "none",
  });
  const orgAUser = user("org_a_user", { orgId: "org_a" });
  const orgBUser = user("org_b_user", { orgId: "org_b" });
  const records = [
    score({ id: "org_a_score", userId: orgAUser.id, orgId: "org_a" }),
    score({ id: "org_b_score", userId: orgBUser.id, orgId: "org_b" }),
  ];
  const superViewer = viewer(actor, "super_user");

  assert.deepEqual(evidenceIds(query({ actor, users: [actor, orgAUser, orgBUser], scoreRecords: records, viewer: superViewer })), ["org_a_score"]);
  assert.deepEqual(
    evidenceIds(query({ actor, users: [actor, orgAUser, orgBUser], scoreRecords: records, organizationId: "org_b", viewer: superViewer })),
    ["org_b_score"],
  );
});
