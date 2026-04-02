import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  AiUsageEvent,
  ApiDatabase,
  SimulationScoreRecord,
  SimulationSessionRecord,
  SupportCaseRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord
} from "@voicepractice/shared";

import { createAiUsageEventAccess } from "./aiUsageEvents.js";
import {
  pruneStaleRecognizedSimulationSessions,
  RECOGNIZED_SIMULATION_SESSION_STALE_RETENTION_MS,
  repairOrphanedUserScopedHistory,
  resetDisposablePreTesterHistory
} from "./integrityMaintenance.js";
import { createScoreRecordAccess } from "./scoreRecordAccess.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";
import { createAiUsageEventStore } from "../storage/aiUsageEventStore.js";
import { createScoreRecordStore } from "../storage/scoreRecordStore.js";
import { createSimulationSessionStore } from "../storage/simulationSessionStore.js";
import { createSupportCaseStore } from "../storage/supportCaseStore.js";
import { createUsageSessionStore } from "../storage/usageSessionStore.js";

function createUsageSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? `usage_${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "user_keep",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-04-01T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-01T10:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 300,
    billedSecondsAdded: overrides.billedSecondsAdded ?? 300,
    createdAt: overrides.createdAt ?? "2026-04-01T10:05:00.000Z"
  };
}

function createScoreRecord(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? `score_${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "user_keep",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
    startedAt: overrides.startedAt ?? "2026-04-01T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-01T10:05:00.000Z",
    overallScore: overrides.overallScore ?? 82,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 8,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 8,
    summary: overrides.summary ?? "Solid attempt",
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: overrides.rubricVersion ?? "rubric_v1",
    model: overrides.model ?? undefined,
    promptVersion: overrides.promptVersion ?? undefined,
    inputTokens: overrides.inputTokens ?? 10,
    outputTokens: overrides.outputTokens ?? 20,
    totalTokens: overrides.totalTokens ?? 30,
    createdAt: overrides.createdAt ?? "2026-04-01T10:05:00.000Z"
  };
}

function createSimulationSession(overrides: Partial<SimulationSessionRecord> = {}): SimulationSessionRecord {
  return {
    simulationSessionId: overrides.simulationSessionId ?? `sim_${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "user_keep",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    clientStartedAt: overrides.clientStartedAt ?? "2026-04-01T10:00:00.000Z",
    serverStartedAt: overrides.serverStartedAt ?? "2026-04-01T10:00:01.000Z",
    lastSeenAt: overrides.lastSeenAt ?? "2026-04-01T10:05:00.000Z",
    status: overrides.status ?? "started",
    usageRecordedAt: overrides.usageRecordedAt ?? null,
    usageSessionRecordId: overrides.usageSessionRecordId ?? null
  };
}

function createAiEvent(overrides: Partial<AiUsageEvent> = {}): AiUsageEvent {
  return {
    id: overrides.id ?? `ai_${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind ?? "turn",
    userId: overrides.userId ?? "user_keep",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    model: overrides.model ?? "gpt-test",
    promptVersion: overrides.promptVersion ?? "prompt_v1",
    rubricVersion: overrides.rubricVersion ?? null,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    totalTokens: overrides.totalTokens ?? 150,
    createdAt: overrides.createdAt ?? "2026-04-01T10:05:00.000Z"
  };
}

function createSupportCase(overrides: Partial<SupportCaseRecord> = {}): SupportCaseRecord {
  return {
    id: overrides.id ?? `case_${Math.random().toString(36).slice(2, 8)}`,
    status: overrides.status ?? "open",
    userId: overrides.userId ?? "user_keep",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    message: overrides.message ?? "Help",
    transcriptEncrypted: overrides.transcriptEncrypted ?? null,
    transcriptExpiresAt: overrides.transcriptExpiresAt ?? null,
    transcriptFileName: overrides.transcriptFileName ?? null,
    transcriptMeta: overrides.transcriptMeta ?? null,
    createdAt: overrides.createdAt ?? "2026-04-01T10:05:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T10:05:00.000Z"
  };
}

function createAssignment(overrides: Partial<TrainingPackAssignmentRecord> = {}): TrainingPackAssignmentRecord {
  return {
    id: overrides.id ?? "assign_1",
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_keep",
    active: overrides.active ?? true,
    assignedAt: overrides.assignedAt ?? "2026-04-01T09:00:00.000Z",
    assignedByUserId: overrides.assignedByUserId ?? "user_keep",
    requiredScenarioIds: overrides.requiredScenarioIds ?? ["scenario_1"],
    completionRule: overrides.completionRule ?? "scored_required_scenarios_v1",
    startedAt: overrides.startedAt ?? "2026-04-01T10:00:00.000Z",
    completedAt: overrides.completedAt ?? "2026-04-01T10:10:00.000Z",
    createdAt: overrides.createdAt ?? "2026-04-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T10:10:00.000Z"
  };
}

async function createStores(tempDir: string) {
  const common = {
    provider: "file" as const,
    dbPath: path.join(tempDir, "db.local.json"),
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1_000,
    pgIdleTimeoutMs: 1_000
  };
  const usageStore = createUsageSessionStore(common);
  const scoreStore = createScoreRecordStore(common);
  const simulationSessionStore = createSimulationSessionStore(common);
  const aiStore = createAiUsageEventStore(common);
  const supportStore = createSupportCaseStore(common);
  await usageStore.initialize();
  await scoreStore.initialize();
  await simulationSessionStore.initialize();
  await aiStore.initialize();
  await supportStore.initialize({ now: new Date("2026-04-01T00:00:00.000Z") });
  return { usageStore, scoreStore, simulationSessionStore, aiStore, supportStore };
}

function createDb(overrides: Partial<ApiDatabase> = {}): ApiDatabase {
  return {
    users: [
      {
        id: "user_keep",
        email: "keep@example.com",
        emailVerifiedAt: "2026-04-01T00:00:00.000Z",
        accountType: "enterprise",
        tier: "free",
        status: "active",
        orgId: "org_1",
        orgRole: "user",
        timezone: "UTC",
        pendingTimezone: null,
        pendingTimezoneEffectiveAt: null,
        planAnchorAt: "2026-04-01T00:00:00.000Z",
        manualBonusSeconds: 0,
        dailySecondsCapOverride: null,
        allowDailyOverageThisCycle: false,
        dailyOverageExpiresAt: null,
        dashboardAccessEnabled: false,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      }
    ],
    orgs: [
      {
        id: "org_1",
        name: "Org One",
        status: "active",
        contactName: "Owner",
        contactEmail: "owner@example.com",
        emailDomain: "example.com",
        joinCode: "JOIN",
        activeIndustries: [],
        dailySecondsQuota: 3600,
        perUserDailySecondsCap: 1800,
        pendingPerUserDailySecondsCap: null,
        pendingPerUserDailySecondsCapEffectiveAt: null,
        manualBonusSeconds: 0,
        contractSignedAt: "2026-04-01T00:00:00.000Z",
        monthlyMinutesAllotted: 100,
        renewalTotalUsd: 100,
        softLimitPercentTriggers: [80, 90],
        maxSimulationMinutes: 20,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      }
    ],
    config: {
      activeSegmentId: "segment_1",
      defaultDifficulty: "medium",
      defaultPersonaStyle: "skeptical",
      industries: [],
      roleIndustries: [],
      segments: [],
      tiers: [],
      enterprise: {
        visibleInApp: true,
        contactEmail: "support@example.com",
        contactUrl: "https://example.com",
        defaultOrgDailySecondsQuota: 3600,
        defaultPerUserDailySecondsCap: 1800,
        allowManualBonusSeconds: true
      },
      featureFlags: {
        scoringEnabled: true,
        customScenarioBuilder: true
      },
      updatedAt: "2026-04-01T00:00:00.000Z"
    },
    mobileAuthTokens: [],
    emailVerifications: [],
    adminTokens: [],
    auditEvents: [],
    sessions: [],
    usageSessions: [],
    aiUsageEvents: [],
    scoreRecords: [],
    webAuthChallenges: [],
    webAuthSessions: [],
    supportCases: [],
    orgJoinRequests: [],
    enterpriseJoinRequests: [],
    orgCustomScenarios: [],
    orgTrainingPacks: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    trainingPackAssignments: [createAssignment()],
    ...overrides
  } as unknown as ApiDatabase;
}

test("integrity maintenance repairs orphaned user-scoped history and prunes stale started sessions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-integrity-maintenance-"));
  try {
    const { usageStore, scoreStore, simulationSessionStore, aiStore, supportStore } = await createStores(tempDir);
    const usageSessionAccess = createUsageSessionAccess(usageStore);
    const scoreRecordAccess = createScoreRecordAccess(scoreStore);
    const aiUsageEventAccess = createAiUsageEventAccess(aiStore);
    const db = createDb();

    await usageSessionAccess.append(db, createUsageSession({ id: "usage_keep", userId: "user_keep" }));
    await usageSessionAccess.append(db, createUsageSession({ id: "usage_orphan", userId: "user_orphan" }));
    await scoreRecordAccess.append(db, createScoreRecord({ id: "score_keep", userId: "user_keep" }));
    await scoreRecordAccess.append(db, createScoreRecord({ id: "score_orphan", userId: "user_orphan" }));
    await simulationSessionStore.upsertStartedSession(
      createSimulationSession({ simulationSessionId: "sim_keep_recent", userId: "user_keep", lastSeenAt: "2026-04-01T12:00:00.000Z" })
    );
    await simulationSessionStore.upsertStartedSession(
      createSimulationSession({ simulationSessionId: "sim_orphan", userId: "user_orphan", lastSeenAt: "2026-04-01T12:00:00.000Z" })
    );
    await simulationSessionStore.upsertStartedSession(
      createSimulationSession({ simulationSessionId: "sim_keep_stale", userId: "user_keep", lastSeenAt: "2026-03-25T12:00:00.000Z" })
    );
    await aiUsageEventAccess.append(createAiEvent({ id: "ai_keep", userId: "user_keep" }));
    await aiUsageEventAccess.append(createAiEvent({ id: "ai_orphan", userId: "user_orphan" }));
    await supportStore.saveCase(createSupportCase({ id: "case_keep", userId: "user_keep" }), { now: new Date("2026-04-01T00:00:00.000Z") });
    await supportStore.saveCase(createSupportCase({ id: "case_orphan", userId: "user_orphan" }), { now: new Date("2026-04-01T00:00:00.000Z") });

    const repaired = await repairOrphanedUserScopedHistory({
      db,
      usageSessionAccess,
      simulationSessionStore,
      scoreRecordAccess,
      aiUsageEventAccess,
      supportCaseStore: supportStore
    });
    assert.deepEqual(repaired, {
      orphanedUsageSessionsDeleted: 1,
      orphanedSimulationSessionsDeleted: 1,
      orphanedScoreRecordsDeleted: 1,
      orphanedAiUsageEventsDeleted: 1,
      orphanedSupportCasesDeleted: 1
    });
    assert.deepEqual(usageStore.listRecords().map((record) => record.userId), ["user_keep"]);
    assert.deepEqual(scoreStore.listRecords().map((record) => record.userId), ["user_keep"]);
    assert.deepEqual((await simulationSessionStore.listSessions()).map((record) => record.userId).sort(), ["user_keep", "user_keep"]);
    assert.deepEqual((await aiUsageEventAccess.list()).map((event) => event.userId), ["user_keep"]);
    assert.deepEqual((await supportStore.listCases({ now: new Date("2026-04-01T00:00:00.000Z") })).map((record) => record.userId), ["user_keep"]);

    const pruned = await pruneStaleRecognizedSimulationSessions({
      simulationSessionStore,
      now: new Date("2026-04-01T12:00:00.000Z"),
      retentionMs: RECOGNIZED_SIMULATION_SESSION_STALE_RETENTION_MS
    });
    assert.equal(pruned.prunedStartedSessions, 1);
    assert.deepEqual((await simulationSessionStore.listSessions()).map((record) => record.simulationSessionId), ["sim_keep_recent"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("integrity maintenance resets disposable pre-tester history while preserving users, orgs, and assignments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-pretester-reset-"));
  try {
    const { usageStore, scoreStore, simulationSessionStore, aiStore, supportStore } = await createStores(tempDir);
    const usageSessionAccess = createUsageSessionAccess(usageStore);
    const scoreRecordAccess = createScoreRecordAccess(scoreStore);
    const aiUsageEventAccess = createAiUsageEventAccess(aiStore);
    const db = createDb();

    await usageSessionAccess.append(db, createUsageSession({ id: "usage_keep", userId: "user_keep" }));
    await scoreRecordAccess.append(db, createScoreRecord({ id: "score_keep", userId: "user_keep" }));
    await simulationSessionStore.upsertStartedSession(createSimulationSession({ simulationSessionId: "sim_keep", userId: "user_keep" }));
    await aiUsageEventAccess.append(createAiEvent({ id: "ai_keep", userId: "user_keep" }));
    await supportStore.saveCase(createSupportCase({ id: "case_keep", userId: "user_keep" }), { now: new Date("2026-04-01T00:00:00.000Z") });

    const reset = await resetDisposablePreTesterHistory({
      db,
      usageSessionAccess,
      simulationSessionStore,
      scoreRecordAccess,
      aiUsageEventAccess,
      supportCaseStore: supportStore,
      now: new Date("2026-04-01T12:00:00.000Z")
    });

    assert.deepEqual(reset.cleared, {
      usageSessions: 1,
      recognizedSimulationSessions: 1,
      scoreRecords: 1,
      aiUsageEvents: 1,
      supportCases: 1
    });
    assert.equal(reset.resetAssignmentProgressCount, 1);
    assert.equal(reset.preservedUsers.length, 1);
    assert.equal(reset.preservedUsers[0]?.email, "keep@example.com");
    assert.equal(reset.preservedOrgCount, 1);
    assert.equal(usageStore.listRecords().length, 0);
    assert.equal(scoreStore.listRecords().length, 0);
    assert.equal((await simulationSessionStore.listSessions()).length, 0);
    assert.equal((await aiUsageEventAccess.list()).length, 0);
    assert.equal((await supportStore.listCases({ now: new Date("2026-04-01T12:00:00.000Z") })).length, 0);
    assert.equal(db.trainingPackAssignments[0]?.startedAt, null);
    assert.equal(db.trainingPackAssignments[0]?.completedAt, null);
    assert.equal("usageSessions" in db, false);
    assert.equal("scoreRecords" in db, false);
    assert.equal("aiUsageEvents" in db, false);
    assert.equal("supportCases" in db, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
