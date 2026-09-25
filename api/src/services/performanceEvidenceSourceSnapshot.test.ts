import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApiDatabase,
  EnterpriseOrg,
  OrgTrainingRecord,
  SimulationScoreRecord,
  UserProfile,
} from "@voicepractice/shared";

import {
  capturePerformanceEvidenceSourceSnapshot,
  type PerformanceEvidenceSourceSnapshotDependencies,
} from "./performanceEvidenceSourceSnapshot.js";

const NOW = "2026-09-24T10:05:30.000Z";

function user(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_current",
    email: overrides.email ?? "user@example.test",
    firstName: overrides.firstName ?? "Current",
    lastName: overrides.lastName ?? "User",
    employeeId: overrides.employeeId ?? "EMP-1",
    managerUserId: overrides.managerUserId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt ?? NOW,
    isPlatformAdmin: overrides.isPlatformAdmin,
    isSuperUser: overrides.isSuperUser,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? true,
    mobileProfileReonboardingRequired: overrides.mobileProfileReonboardingRequired,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? null : "org_current",
    orgRole: overrides.orgRole ?? "user",
    performanceAccess: overrides.performanceAccess ?? "team",
    divisionId: Object.hasOwn(overrides, "divisionId") ? overrides.divisionId ?? null : "division_current",
    timezone: overrides.timezone ?? "America/Denver",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? NOW,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    dailyOverageMode: overrides.dailyOverageMode ?? null,
    dailyOverageStartedAt: overrides.dailyOverageStartedAt ?? null,
    dailyOverageBaseSecondsCap: overrides.dailyOverageBaseSecondsCap ?? null,
    dailyOverageExtraSecondsGranted: overrides.dailyOverageExtraSecondsGranted ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function organization(overrides: Partial<EnterpriseOrg> = {}): EnterpriseOrg {
  return {
    id: overrides.id ?? "org_current",
    name: overrides.name ?? "Current Organization",
    status: overrides.status ?? "active",
    contactName: overrides.contactName ?? "Contact",
    contactEmail: overrides.contactEmail ?? "contact@example.test",
    emailDomain: overrides.emailDomain ?? null,
    joinCode: overrides.joinCode ?? "CURRENT",
    activeIndustries: overrides.activeIndustries ?? [],
    dailySecondsQuota: overrides.dailySecondsQuota ?? 0,
    perUserDailySecondsCap: overrides.perUserDailySecondsCap ?? 0,
    pendingPerUserDailySecondsCap: overrides.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    contractSignedAt: overrides.contractSignedAt ?? NOW,
    monthlyMinutesAllotted: overrides.monthlyMinutesAllotted ?? 0,
    renewalTotalUsd: overrides.renewalTotalUsd ?? 0,
    softLimitPercentTriggers: overrides.softLimitPercentTriggers ?? [],
    maxSimulationMinutes: overrides.maxSimulationMinutes ?? 30,
    enableModularPromptArchitecture: overrides.enableModularPromptArchitecture,
    divisionsEnabled: overrides.divisionsEnabled,
    customScenarios: overrides.customScenarios,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function training(overrides: Partial<OrgTrainingRecord> = {}): OrgTrainingRecord {
  return {
    id: overrides.id ?? "training_current",
    orgId: overrides.orgId ?? "org_current",
    name: overrides.name ?? "Current Training",
    status: overrides.status ?? "active",
    description: overrides.description ?? "Presentation-only description",
    divisionId: Object.hasOwn(overrides, "divisionId") ? overrides.divisionId ?? null : "division_current",
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function score(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_current",
    simulationSessionId: Object.hasOwn(overrides, "simulationSessionId")
      ? overrides.simulationSessionId
      : "sim_current",
    userId: overrides.userId ?? "user_current",
    orgId: Object.hasOwn(overrides, "orgId") ? overrides.orgId ?? null : "org_current",
    divisionId: Object.hasOwn(overrides, "divisionId") ? overrides.divisionId : "division_current",
    segmentId: overrides.segmentId ?? "segment_current",
    scenarioId: overrides.scenarioId ?? "scenario_current",
    trainingId: Object.hasOwn(overrides, "trainingId") ? overrides.trainingId : "training_current",
    trainingPackId: overrides.trainingPackId,
    industryId: overrides.industryId,
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
    summary: overrides.summary ?? "Not part of the source projection work.",
    coachingArtifact: overrides.coachingArtifact,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes,
    rubricVersion: overrides.rubricVersion ?? "2026-04-09.v1",
    promptVersion: overrides.promptVersion ?? "2026-04-09.v1",
    model: overrides.model ?? "gpt-score",
    scoringWeightsApplied: overrides.scoringWeightsApplied,
    inputTokens: overrides.inputTokens,
    outputTokens: overrides.outputTokens,
    totalTokens: overrides.totalTokens,
    createdAt: overrides.createdAt ?? NOW,
  };
}

function appState(overrides: Partial<Pick<ApiDatabase, "users" | "orgs" | "orgTrainings">> = {}) {
  return {
    users: overrides.users ?? [user()],
    orgs: overrides.orgs ?? [organization()],
    orgTrainings: overrides.orgTrainings ?? [training()],
  };
}

function createDependencies(params: {
  appState: Pick<ApiDatabase, "users" | "orgs" | "orgTrainings">;
  scoreSnapshot: readonly SimulationScoreRecord[];
  events?: string[];
}): PerformanceEvidenceSourceSnapshotDependencies {
  const events = params.events ?? [];
  return {
    async refreshScoreRecords() {
      events.push("refresh");
    },
    getScoreSnapshot() {
      events.push("score-snapshot");
      return params.scoreSnapshot;
    },
    async withDatabaseLock<T>(runner: () => Promise<T>): Promise<T> {
      events.push("lock:start");
      try {
        return await runner();
      } finally {
        events.push("lock:end");
      }
    },
    async loadAppState() {
      events.push("app-state");
      return params.appState;
    },
  };
}

test("refreshes scores before the global lock and captures only raw sources under it", async () => {
  const events: string[] = [];
  const rawScores = [score({ overallScore: 101, simulationSessionId: "sim_duplicate" })];
  const snapshot = await capturePerformanceEvidenceSourceSnapshot(createDependencies({
    appState: appState(),
    scoreSnapshot: rawScores,
    events,
  }));

  assert.deepEqual(events, ["refresh", "lock:start", "score-snapshot", "app-state", "lock:end"]);
  assert.strictEqual(snapshot.scoreRecords, rawScores);
  assert.equal(snapshot.scoreRecords[0]?.overallScore, 101);
  assert.equal(Object.hasOwn(snapshot.scoreRecords[0]!, "anomalies"), false);
});

test("copies minimal app-state projections that remain independent from later and caller mutation", async () => {
  const state = appState();
  const snapshot = await capturePerformanceEvidenceSourceSnapshot(createDependencies({
    appState: state,
    scoreSnapshot: [score()],
  }));

  assert.deepEqual(Object.keys(snapshot.users[0]!).sort(), [
    "accountType",
    "dashboardAccessEnabled",
    "divisionId",
    "id",
    "isSuperUser",
    "managerUserId",
    "orgId",
    "orgRole",
    "performanceAccess",
    "status",
  ]);
  assert.deepEqual(Object.keys(snapshot.organizations[0]!).sort(), ["id", "status"]);
  assert.deepEqual(Object.keys(snapshot.trainings[0]!).sort(), ["divisionId", "id", "name", "orgId", "status"]);

  state.users[0]!.orgId = "org_changed";
  state.orgs[0]!.status = "disabled";
  state.orgTrainings[0]!.name = "Renamed Training";
  (snapshot.users[0] as { orgId: string | null }).orgId = "caller_changed";
  (snapshot.organizations[0] as { status: EnterpriseOrg["status"] }).status = "disabled";
  (snapshot.trainings[0] as { name: string }).name = "Caller Training";

  assert.equal(snapshot.users[0]?.orgId, "caller_changed");
  assert.equal(snapshot.organizations[0]?.status, "disabled");
  assert.equal(snapshot.trainings[0]?.name, "Caller Training");
  assert.equal(state.users[0]?.orgId, "org_changed");
  assert.equal(state.orgs[0]?.status, "disabled");
  assert.equal(state.orgTrainings[0]?.name, "Renamed Training");
  assert.equal(state.users[0]?.email, "user@example.test");
  assert.equal(Object.hasOwn(snapshot.users[0]!, "email"), false);
  assert.equal(Object.hasOwn(snapshot.trainings[0]!, "description"), false);
});

test("preserves historical score organization identity when the current user moved organizations", async () => {
  const historicalScore = score({ orgId: "org_a", divisionId: "division_a", trainingId: "training_a" });
  const snapshot = await capturePerformanceEvidenceSourceSnapshot(createDependencies({
    appState: appState({
      users: [user({ orgId: "org_b", divisionId: "division_b" })],
      orgs: [organization({ id: "org_b" })],
      orgTrainings: [training({ id: "training_b", orgId: "org_b" })],
    }),
    scoreSnapshot: [historicalScore],
  }));

  assert.strictEqual(snapshot.scoreRecords[0], historicalScore);
  assert.deepEqual(
    {
      orgId: snapshot.scoreRecords[0]?.orgId,
      divisionId: snapshot.scoreRecords[0]?.divisionId,
      trainingId: snapshot.scoreRecords[0]?.trainingId,
    },
    { orgId: "org_a", divisionId: "division_a", trainingId: "training_a" },
  );
});

test("retains deleted_user scores without synthesizing current-user projections", async () => {
  const deletedUserScore = score({ id: "score_deleted", userId: "deleted_user" });
  const snapshot = await capturePerformanceEvidenceSourceSnapshot(createDependencies({
    appState: appState({ users: [] }),
    scoreSnapshot: [deletedUserScore],
  }));

  assert.strictEqual(snapshot.scoreRecords[0], deletedUserScore);
  assert.equal(snapshot.scoreRecords[0]?.userId, "deleted_user");
  assert.deepEqual(snapshot.users, []);
});

test("retains scores for missing current trainings without backfilling training metadata", async () => {
  const historicalScore = score({ id: "score_deleted_training", trainingId: "training_deleted" });
  const snapshot = await capturePerformanceEvidenceSourceSnapshot(createDependencies({
    appState: appState({ orgTrainings: [] }),
    scoreSnapshot: [historicalScore],
  }));

  assert.strictEqual(snapshot.scoreRecords[0], historicalScore);
  assert.equal(snapshot.scoreRecords[0]?.trainingId, "training_deleted");
  assert.deepEqual(snapshot.trainings, []);
});

test("keeps the captured score reference stable when the store later replaces its copy-on-write snapshot", async () => {
  const capturedScores = [score({ id: "score_before_refresh" })];
  let currentScores: readonly SimulationScoreRecord[] = capturedScores;
  const dependencies = createDependencies({ appState: appState(), scoreSnapshot: capturedScores });
  dependencies.getScoreSnapshot = () => currentScores;

  const snapshot = await capturePerformanceEvidenceSourceSnapshot(dependencies);
  currentScores = [score({ id: "score_after_refresh" })];

  assert.strictEqual(snapshot.scoreRecords, capturedScores);
  assert.equal(snapshot.scoreRecords[0]?.id, "score_before_refresh");
  assert.equal(currentScores[0]?.id, "score_after_refresh");
});
