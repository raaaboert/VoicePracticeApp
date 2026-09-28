import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, SimulationScoreRecord } from "@voicepractice/shared";

import {
  AuthorizedOrganizationEvidenceCandidatesInputError,
  projectOrganizationEvidenceCandidate,
  queryAuthorizedOrganizationEvidenceCandidates,
  type AuthorizedOrganizationEvidenceCandidatesQuery,
} from "./authorizedOrganizationEvidenceCandidates.js";
import { queryAuthorizedPerformanceEvidence } from "./authorizedPerformanceEvidenceQuery.js";
import { normalizePerformanceEvidence } from "./performanceEvidence.js";
import type { PerformanceEvidenceSourceSnapshot, PerformanceEvidenceSourceUser } from "./performanceEvidenceSourceSnapshot.js";
import { SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS } from "./simulationSessionLifecycle.js";

const CREATED_AT = "2026-09-24T10:05:30.000Z";

function user(id: string, overrides: Partial<PerformanceEvidenceSourceUser> = {}): PerformanceEvidenceSourceUser {
  return {
    id, accountType: "enterprise", status: "active", orgId: "org_a", orgRole: "user",
    isSuperUser: false, dashboardAccessEnabled: true, managerUserId: null,
    performanceAccess: "none", divisionId: null, ...overrides,
  };
}

function viewer(actor: PerformanceEvidenceSourceUser, accessType: DashboardViewer["accessType"] = "customer_dashboard_user"): DashboardViewer {
  return {
    accessType, userId: actor.id, email: `${actor.id}@example.test`,
    isSuperUser: actor.isSuperUser === true,
    orgId: accessType === "super_user" ? null : actor.orgId,
    orgName: accessType === "super_user" ? null : "Organization",
    orgRole: accessType === "super_user" ? null : actor.orgRole,
    performanceAccess: actor.performanceAccess ?? "none",
    capabilities: {
      viewOrganizationUsers: false, manageRegularOrganizationUsers: false,
      approveRejectAccessRequests: false, editEmployeeIds: false, editUserNames: false,
      manageUserRoles: false, assignUserManagers: false, managePerformanceAccess: false,
      manageOrganizationContent: false,
    },
  };
}

function score(id: string, overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: Object.hasOwn(overrides, "simulationSessionId") ? overrides.simulationSessionId : `session_${id}`,
    userId: overrides.userId ?? "subject",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? null : "org_a",
    divisionId: overrides.divisionId,
    segmentId: overrides.segmentId ?? "segment_a",
    scenarioId: overrides.scenarioId ?? "scenario_a",
    trainingId: Object.hasOwn(overrides, "trainingId") ? overrides.trainingId : "training_a",
    startedAt: overrides.startedAt ?? "2026-09-24T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-09-24T10:05:00.000Z",
    createdAt: overrides.createdAt ?? CREATED_AT,
    overallScore: overrides.overallScore ?? 77,
    communicationScore: Object.hasOwn(overrides, "communicationScore") ? overrides.communicationScore : 80,
    outcomeScore: Object.hasOwn(overrides, "outcomeScore") ? overrides.outcomeScore : 70,
    persuasion: overrides.persuasion ?? 8, clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8, assertiveness: overrides.assertiveness ?? 8,
    completionLevel: Object.hasOwn(overrides, "completionLevel") ? overrides.completionLevel : "complete",
    objectiveAchieved: Object.hasOwn(overrides, "objectiveAchieved") ? overrides.objectiveAchieved : true,
    rubricVersion: Object.hasOwn(overrides, "rubricVersion") ? overrides.rubricVersion : "generation_a",
    scoringWeightsApplied: Object.hasOwn(overrides, "scoringWeightsApplied") ? overrides.scoringWeightsApplied : undefined,
    summary: "Private summary",
  };
}

function snapshot(users: readonly PerformanceEvidenceSourceUser[], scoreRecords: readonly SimulationScoreRecord[]): PerformanceEvidenceSourceSnapshot {
  return {
    users, scoreRecords,
    organizations: [{ id: "org_a", status: "active" }, { id: "org_b", status: "active" }],
    trainings: [],
  };
}

function candidates(actor: PerformanceEvidenceSourceUser, records: readonly SimulationScoreRecord[], options: {
  users?: readonly PerformanceEvidenceSourceUser[];
  viewer?: DashboardViewer;
  organizationId?: string;
  filters?: Partial<AuthorizedOrganizationEvidenceCandidatesQuery>;
} = {}) {
  return queryAuthorizedOrganizationEvidenceCandidates({
    snapshot: snapshot(options.users ?? [actor], records),
    viewer: options.viewer ?? viewer(actor),
    organizationId: options.organizationId ?? "org_a",
    ...options.filters,
  });
}

function scores(result: ReturnType<typeof candidates>): number[] {
  return result.map((candidate) => candidate.overallScore);
}

test("organization authority is independent of team access and administrative roles", () => {
  const records = [score("historical")];
  for (const [access, role] of [
    ["none", "user"], ["team", "user"], ["none", "org_admin"], ["team", "user_admin"],
  ] as const) {
    const actor = user("actor", { performanceAccess: access, orgRole: role });
    assert.deepEqual(candidates(actor, records), []);
  }
  const actor = user("actor", { performanceAccess: "organization" });
  assert.deepEqual(scores(candidates(actor, records)), [77]);
  assert.deepEqual(candidates(actor, records, { organizationId: "org_b" }), []);
  assert.deepEqual(candidates(actor, records, { organizationId: "missing" }), []);
});

test("actor is bound to viewer identity and current dashboard eligibility", () => {
  const orgActor = user("org_actor", { performanceAccess: "organization" });
  const teamActor = user("team_actor", { performanceAccess: "team" });
  const records = [score("historical")];
  const borrowedActorRequest = {
    snapshot: snapshot([orgActor, teamActor], records),
    viewer: viewer(teamActor), organizationId: "org_a", actorUserId: orgActor.id,
  };
  assert.deepEqual(queryAuthorizedOrganizationEvidenceCandidates(borrowedActorRequest), []);
  for (const badActor of [
    user("inactive", { status: "disabled", performanceAccess: "organization" }),
    user("disabled", { dashboardAccessEnabled: false, performanceAccess: "organization" }),
    user("deleted_user", { performanceAccess: "organization" }),
    user("individual", { accountType: "individual", performanceAccess: "organization" }),
  ]) {
    assert.deepEqual(candidates(badActor, records), []);
  }
  assert.deepEqual(candidates(orgActor, records, { users: [] }), []);
  const inactiveOrg = snapshot([orgActor], records);
  assert.deepEqual(queryAuthorizedOrganizationEvidenceCandidates({
    snapshot: { ...inactiveOrg, organizations: [{ id: "org_a", status: "disabled" }] },
    viewer: viewer(orgActor), organizationId: "org_a",
  }), []);
});

test("legitimate platform super-user can inspect a named existing organization without current org membership", () => {
  const actor = user("super", { accountType: "individual", orgId: null, isSuperUser: true });
  const records = [score("a", { overallScore: 11 }), score("b", { orgId: "org_b", overallScore: 22 })];
  const superViewer = viewer(actor, "super_user");
  assert.deepEqual(scores(candidates(actor, records, { viewer: superViewer })), [11]);
  assert.deepEqual(scores(candidates(actor, records, { viewer: superViewer, organizationId: "org_b" })), [22]);
  assert.deepEqual(candidates(actor, records, { viewer: superViewer, organizationId: "missing" }), []);
  assert.deepEqual(candidates(actor, records, { viewer: viewer(actor), organizationId: "org_a" }), []);
});

test("historical org membership includes moved-out and absent users, while person targets remain current", () => {
  const actorA = user("actor_a", { performanceAccess: "organization" });
  const actorB = user("actor_b", { orgId: "org_b", performanceAccess: "organization" });
  const moved = user("moved", { orgId: "org_b" });
  const records = [
    score("current", { userId: "current", overallScore: 11 }),
    score("moved", { userId: moved.id, overallScore: 22 }),
    score("absent", { userId: "absent", overallScore: 33 }),
    score("org_b", { orgId: "org_b", overallScore: 44 }),
    score("null_org", { orgId: null, overallScore: 55 }),
  ];
  const users = [actorA, actorB, user("current"), moved];
  assert.deepEqual(scores(candidates(actorA, records, { users })), [33, 11, 22]);
  assert.deepEqual(scores(candidates(actorB, records, { users, organizationId: "org_b" })), [44]);
  const source = snapshot(users, records);
  assert.deepEqual(queryAuthorizedPerformanceEvidence({
    snapshot: source, viewer: viewer(actorA), organizationId: "org_a", targetUserId: moved.id,
  }), []);
  assert.deepEqual(queryAuthorizedPerformanceEvidence({
    snapshot: source, viewer: viewer(actorA), organizationId: "org_a", targetUserId: "absent",
  }), []);
});

test("deidentified historical evidence has no subject key and never appears as a person", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const records = [
    score("deleted_a", { userId: "deleted_user", overallScore: 11 }),
    score("deleted_b", { userId: "deleted_user", orgId: "org_b", overallScore: 22 }),
  ];
  const result = candidates(actor, records);
  assert.deepEqual(scores(result), [11]);
  assert.equal(result[0]?.subjectKind, "deidentified");
  assert.equal(Object.hasOwn(result[0]!, "subjectKey"), false);
  assert.deepEqual(queryAuthorizedPerformanceEvidence({
    snapshot: snapshot([actor, user("deleted_user")], records),
    viewer: viewer(actor), organizationId: "org_a", targetUserId: "deleted_user",
  }), []);
});

test("rejects malformed and quarantined scores but retains partial and inconclusive outcomes", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const records = [
    score("duplicate_a", { simulationSessionId: "duplicate" }),
    score("duplicate_b", { simulationSessionId: "duplicate" }),
    score("invalid", { overallScore: 101 }),
    score("partial", { overallScore: 31, completionLevel: "partial", objectiveAchieved: false }),
    score("inconclusive", { overallScore: 42, completionLevel: "inconclusive", objectiveAchieved: false }),
  ];
  const result = candidates(actor, records);
  assert.deepEqual(scores(result), [42, 31]);
  assert.deepEqual(result.map((row) => row.completionLevel), ["inconclusive", "partial"]);
  assert.deepEqual(result.map((row) => row.objectiveAchieved), [false, false]);
});

test("filters exact historical IDs, division, and canonical half-open evidenceAt", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const createdAt = new Date(CREATED_AT);
  const anomalousEnd = new Date(createdAt.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS + 1).toISOString();
  const records = [
    score("lower", { overallScore: 11, scenarioId: "s1", trainingId: "t1", divisionId: "d1" }),
    score("upper", { overallScore: 22, endedAt: "2026-09-24T10:10:00.000Z", scenarioId: "s2", trainingId: "t2", divisionId: "d2", createdAt: "2026-09-24T10:10:30.000Z" }),
    score("missing_training", { overallScore: 33, trainingId: undefined }),
    score("missing_division", { overallScore: 44, divisionId: undefined }),
    score("clamped", { overallScore: 55, endedAt: anomalousEnd, createdAt: CREATED_AT }),
  ];
  const base = (filters: Partial<AuthorizedOrganizationEvidenceCandidatesQuery>) => candidates(actor, records, { filters });
  assert.deepEqual(scores(base({ scenarioId: "s1" })), [11]);
  assert.deepEqual(scores(base({ trainingId: "t1" })), [11]);
  assert.deepEqual(scores(base({ trainingId: "unknown" })), []);
  assert.deepEqual(scores(base({ divisionId: "d1" })), [11]);
  assert.deepEqual(scores(base({ divisionId: "unknown" })), []);
  assert.deepEqual(scores(base({ evidenceAtFrom: "2026-09-24T10:05:00.000Z", evidenceAtBefore: "2026-09-24T10:10:00.000Z" })), [11, 44, 33, 55]);
  assert.deepEqual(scores(base({ evidenceAtFrom: CREATED_AT, evidenceAtBefore: "2026-09-24T10:05:31.000Z" })), [55]);
  assert.deepEqual(scores(base({ evidenceAtFrom: "2026-09-24T10:10:00.000Z" })), [22]);
});

test("preserves scoring generations and unavailable metrics without fabricating zeros", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const records = [
    score("modern", { overallScore: 11, rubricVersion: "generation_modern" }),
    score("legacy", {
      overallScore: 22, rubricVersion: "2026-03-06.v2",
      communicationScore: undefined, outcomeScore: undefined,
      completionLevel: undefined, objectiveAchieved: undefined,
    }),
  ];
  const result = candidates(actor, records);
  assert.deepEqual(result.map((row) => row.scoringGeneration), ["2026-03-06.v2", "generation_modern"]);
  assert.equal(result[0]?.recordEra, "legacy_sparse");
  assert.equal(result[0]?.metricAvailability.communication, false);
  assert.equal(result[0]?.metricAvailability.outcome, false);
  assert.equal(result[0]?.metricAvailability.completion, false);
  assert.equal(result[0]?.metricAvailability.objective, false);
  for (const field of ["communicationScore", "outcomeScore", "completionLevel", "objectiveAchieved"]) {
    assert.equal(Object.hasOwn(result[0]!, field), false);
  }
  assert.equal(result[1]?.metricAvailability.communication, true);
  assert.equal(result[1]?.communicationScore, 80);
});

test("preserves distinct applied scoring weights without inventing legacy provenance", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const firstWeights = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
  const secondWeights = { persuasion: 0.1, clarity: 0.2, empathy: 0.3, assertiveness: 0.4 };
  const records = [
    score("first", { rubricVersion: "same_generation", scoringWeightsApplied: firstWeights }),
    score("second", { rubricVersion: "same_generation", scoringWeightsApplied: secondWeights }),
    score("legacy", {
      rubricVersion: "2026-03-06.v2", communicationScore: undefined, outcomeScore: undefined,
      completionLevel: undefined, objectiveAchieved: undefined, scoringWeightsApplied: undefined,
    }),
    score("deidentified", { userId: "deleted_user", scoringWeightsApplied: firstWeights }),
  ];
  const result = candidates(actor, records);
  const first = result.find((row) => row.subjectKind === "user" && row.subjectKey === "subject" && row.scoringGeneration === "same_generation");
  const second = result.filter((row) => row.subjectKind === "user" && row.scoringGeneration === "same_generation")[1];
  const legacy = result.find((row) => row.recordEra === "legacy_sparse");
  const deidentified = result.find((row) => row.subjectKind === "deidentified");

  assert.deepEqual(first?.scoringWeightsApplied, firstWeights);
  assert.deepEqual(second?.scoringWeightsApplied, secondWeights);
  assert.notDeepEqual(first?.scoringWeightsApplied, second?.scoringWeightsApplied);
  assert.equal(Object.hasOwn(legacy!, "scoringWeightsApplied"), false);
  assert.deepEqual(deidentified?.scoringWeightsApplied, firstWeights);
  assert.equal(Object.hasOwn(deidentified!, "subjectKey"), false);
});

test("copies applied scoring weights so candidates cannot mutate canonical provenance", () => {
  const sourceWeights = { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 };
  const source = score("weighted", { scoringWeightsApplied: sourceWeights });
  const normalized = normalizePerformanceEvidence(source);
  assert.equal(normalized.status, "accepted");
  if (normalized.status !== "accepted") throw new Error("Expected accepted canonical evidence");
  const candidate = projectOrganizationEvidenceCandidate(normalized.evidence);
  const returnedWeights = candidate.scoringWeightsApplied;
  assert.ok(returnedWeights);
  (returnedWeights as { persuasion: number }).persuasion = 0.9;
  assert.equal(sourceWeights.persuasion, 0.4);
  assert.equal(source.scoringWeightsApplied?.persuasion, 0.4);
  assert.equal(normalized.evidence.scoringWeightsApplied?.persuasion, 0.4);
});

test("candidate projection has an exact minimal key set and stable order", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const records = [
    score("z_same", { overallScore: 33 }),
    score("later", { overallScore: 44, endedAt: "2026-09-24T10:06:00.000Z", createdAt: "2026-09-24T10:06:30.000Z" }),
    score("a_same", {
      overallScore: 11,
      scoringWeightsApplied: { persuasion: 0.4, clarity: 0.3, empathy: 0.2, assertiveness: 0.1 },
    }),
  ];
  const result = candidates(actor, records);
  assert.deepEqual(scores(result), [11, 33, 44]);
  assert.deepEqual(Object.keys(result[0]!).sort(), [
    "orgId", "scenarioId", "trainingId", "evidenceAt", "recordEra", "scoringGeneration",
    "metricAvailability", "scoringWeightsApplied", "overallScore", "communicationScore", "outcomeScore",
    "persuasion", "clarity", "empathy", "assertiveness", "completionLevel",
    "objectiveAchieved", "subjectKind", "subjectKey",
  ].sort());
  assert.equal(result[0]?.subjectKey, "subject");
});

test("rejects invalid query filters before reading candidates", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  for (const filters of [
    { organizationId: " " }, { evidenceAtFrom: "invalid" }, { scenarioId: " " },
    { trainingId: " " }, { divisionId: " " },
    { evidenceAtFrom: CREATED_AT, evidenceAtBefore: CREATED_AT },
  ]) {
    assert.throws(() => candidates(actor, [], { filters }), AuthorizedOrganizationEvidenceCandidatesInputError);
  }
});
