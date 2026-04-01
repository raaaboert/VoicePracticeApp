import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  EnterpriseOrg,
  SimulationScoreCoachingArtifact,
  SimulationScoreRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

import {
  buildDashboardAttemptDetailAttempt,
  type DashboardAttemptScenarioCatalogEntry
} from "./dashboardAttemptDetails.js";
import { createScoreRecordAccess } from "./scoreRecordAccess.js";
import { createSimulationHistoryAccess } from "./simulationHistory.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";
import { createScoreRecordStore } from "../storage/scoreRecordStore.js";

const usageSessionAccess = createUsageSessionAccess();
const scoreRecordAccess = createScoreRecordAccess();
const simulationHistoryAccess = createSimulationHistoryAccess({
  usageSessionAccess,
  scoreRecordAccess
});

function createUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-03-01T00:00:00.000Z",
    isPlatformAdmin: overrides.isPlatformAdmin,
    isSuperUser: overrides.isSuperUser,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? true,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "org_admin",
    timezone: overrides.timezone ?? "UTC",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-03-01T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T00:00:00.000Z"
  };
}

function createOrg(overrides: Partial<EnterpriseOrg> = {}): EnterpriseOrg {
  return {
    id: overrides.id ?? "org_1",
    name: overrides.name ?? "Org One",
    status: overrides.status ?? "active",
    contactName: overrides.contactName ?? "Owner",
    contactEmail: overrides.contactEmail ?? "owner@example.com",
    emailDomain: overrides.emailDomain ?? "example.com",
    joinCode: overrides.joinCode ?? "JOINME",
    activeIndustries: overrides.activeIndustries ?? ["industry_a"],
    dailySecondsQuota: overrides.dailySecondsQuota ?? 7200,
    perUserDailySecondsCap: overrides.perUserDailySecondsCap ?? 900,
    pendingPerUserDailySecondsCap: overrides.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    contractSignedAt: overrides.contractSignedAt ?? "2026-03-01T00:00:00.000Z",
    monthlyMinutesAllotted: overrides.monthlyMinutesAllotted ?? 120,
    renewalTotalUsd: overrides.renewalTotalUsd ?? 499,
    softLimitPercentTriggers: overrides.softLimitPercentTriggers ?? [75, 90],
    maxSimulationMinutes: overrides.maxSimulationMinutes ?? 60,
    enableModularPromptArchitecture: overrides.enableModularPromptArchitecture,
    customScenarios: overrides.customScenarios,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T00:00:00.000Z"
  };
}

function createCoachingArtifact(priority: string): SimulationScoreCoachingArtifact {
  return {
    strengths: [`${priority} strength`],
    improvementAreas: [`${priority} improvement`],
    coachingPriority: priority
  };
}

function createScore(overrides: Partial<SimulationScoreRecord> = {}): SimulationScoreRecord {
  return {
    id: overrides.id ?? "score_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    industryId: overrides.industryId ?? "industry_a",
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    overallScore: overrides.overallScore ?? 88,
    persuasion: overrides.persuasion ?? 8,
    clarity: overrides.clarity ?? 9,
    empathy: overrides.empathy ?? 8,
    assertiveness: overrides.assertiveness ?? 10,
    summary: overrides.summary ?? "Strong attempt",
    coachingArtifact: overrides.coachingArtifact ?? createCoachingArtifact("clarity"),
    normalizedCoachingThemes: overrides.normalizedCoachingThemes,
    rubricVersion: overrides.rubricVersion ?? "rubric_v1",
    model: overrides.model ?? "gpt-test",
    promptVersion: overrides.promptVersion ?? "prompt_v1",
    inputTokens: overrides.inputTokens ?? 40,
    outputTokens: overrides.outputTokens ?? 20,
    totalTokens: overrides.totalTokens ?? 60,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

function createSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "sess_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 305,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

function createAssignment(overrides: Partial<TrainingPackAssignmentRecord> = {}): TrainingPackAssignmentRecord {
  return {
    id: overrides.id ?? "assignment_1",
    trainingPackId: overrides.trainingPackId ?? "pack_1",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_1",
    active: overrides.active ?? true,
    assignedAt: overrides.assignedAt ?? "2026-03-30T00:00:00.000Z",
    assignedByUserId: overrides.assignedByUserId ?? null,
    requiredScenarioIds: overrides.requiredScenarioIds ?? ["scenario_1", "scenario_2"],
    completionRule: overrides.completionRule ?? "scored_required_scenarios_v1",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-30T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-30T00:00:00.000Z"
  };
}

function createScenarioCatalog(): Map<string, DashboardAttemptScenarioCatalogEntry> {
  return new Map([
    [
      "scenario_1",
      {
        scenarioId: "scenario_1",
        title: "Scenario One",
        summary: "Scenario One",
        segmentId: "segment_1",
        segmentLabel: "Segment One",
        source: "standard"
      }
    ],
    [
      "scenario_2",
      {
        scenarioId: "scenario_2",
        title: "Scenario Two",
        summary: "Scenario Two",
        segmentId: "segment_1",
        segmentLabel: "Segment One",
        source: "standard"
      }
    ]
  ]);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createScoreCutoverDb(legacyDb: { usageSessions: UsageSessionRecord[]; scoreRecords: SimulationScoreRecord[] }) {
  let extractedScoreRecords = cloneJson(legacyDb.scoreRecords).reverse();
  const cutoverDb = {
    usageSessions: cloneJson(legacyDb.usageSessions)
  } as { usageSessions: UsageSessionRecord[]; scoreRecords: SimulationScoreRecord[] };

  Object.defineProperty(cutoverDb, "scoreRecords", {
    configurable: true,
    enumerable: true,
    get() {
      return extractedScoreRecords;
    },
    set(nextValue: SimulationScoreRecord[]) {
      extractedScoreRecords = cloneJson(nextValue);
    }
  });

  return cutoverDb;
}

test("dashboard attempt detail helper preserves full route-faithful scored-attempt payload", () => {
  const user = createUser();
  const org = createOrg();
  const score = createScore();
  const relatedSession = createSession();
  const assignment = createAssignment();

  const attempt = buildDashboardAttemptDetailAttempt({
    score,
    user,
    org,
    scenarioCatalog: createScenarioCatalog(),
    trainingPackTitles: new Map([["pack_1", "Pack One"]]),
    industryLabelById: new Map([["industry_a", "Industry A"]]),
    relatedSession,
    assignment
  });

  assert.deepEqual(attempt, {
    activityId: "score_1",
    activityKind: "scored_attempt",
    userId: "user_1",
    userEmail: "user@example.com",
    userStatus: "active",
    orgId: "org_1",
    orgName: "Org One",
    scenarioId: "scenario_1",
    scenarioTitle: "Scenario One",
    segmentId: "segment_1",
    segmentLabel: "Segment One",
    trainingPackId: "pack_1",
    trainingPackTitle: "Pack One",
    packAttributed: true,
    assignmentId: "assignment_1",
    assignmentContextStatus: "counts_toward_completion",
    startedAt: "2026-03-31T10:00:00.000Z",
    endedAt: "2026-03-31T10:05:00.000Z",
    rawDurationSeconds: 305,
    overallScore: 88,
    summary: "Strong attempt",
    coachingPriority: "clarity",
    model: "gpt-test",
    promptVersion: "prompt_v1",
    rubricVersion: "rubric_v1",
    industryId: "industry_a",
    industryLabel: "Industry A",
    scoreBreakdown: {
      overallScore: 88,
      persuasion: 8,
      clarity: 9,
      empathy: 8,
      assertiveness: 10
    },
    derivedSignals: {
      strongestCategory: "Assertiveness",
      weakestCategory: "Empathy",
      coachingFocus: "clarity"
    },
    coachingArtifact: createCoachingArtifact("clarity"),
    transcriptAvailable: false
  });
});

test("dashboard attempt detail helper keeps exact-match linkage and ordering-stable fuzzy fallback semantics", () => {
  const db = {
    usageSessions: [
      createSession({
        id: "sess_fuzzy",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:20.000Z",
        endedAt: "2026-03-31T11:05:20.000Z",
        rawDurationSeconds: 300
      }),
      createSession({
        id: "sess_exact",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z",
        rawDurationSeconds: 280
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_exact",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z"
      }),
      createScore({
        id: "score_fuzzy",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:05.000Z",
        endedAt: "2026-03-31T11:05:03.000Z"
      })
    ]
  };

  const exactScore = scoreRecordAccess.getById(db, "score_exact");
  const fuzzyScore = scoreRecordAccess.getById(db, "score_fuzzy");
  assert.ok(exactScore);
  assert.ok(fuzzyScore);

  const exactRelated = simulationHistoryAccess.findRelatedUsageSessionForScore(db.usageSessions, exactScore);
  const fuzzyRelated = simulationHistoryAccess.findRelatedUsageSessionForScore(db.usageSessions.slice().reverse(), fuzzyScore);

  assert.equal(exactRelated?.id, "sess_exact");
  assert.equal(fuzzyRelated?.id, "sess_exact");
});

test("dashboard attempt detail helper preserves full payloads after scoreRecords cutover into extracted-like backing storage", () => {
  const legacyDb = {
    usageSessions: [
      createSession({
        id: "sess_exact",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z",
        rawDurationSeconds: 305
      }),
      createSession({
        id: "sess_fuzzy",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:15.000Z",
        endedAt: "2026-03-31T11:05:10.000Z",
        rawDurationSeconds: 450
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_exact",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z"
      }),
      createScore({
        id: "score_fuzzy",
        scenarioId: "scenario_2",
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z",
        overallScore: 92,
        persuasion: 9,
        clarity: 9,
        empathy: 10,
        assertiveness: 9,
        coachingArtifact: createCoachingArtifact("empathy")
      })
    ]
  };
  const cutoverDb = createScoreCutoverDb(legacyDb);
  const user = createUser();
  const org = createOrg();
  const scenarioCatalog = createScenarioCatalog();
  const trainingPackTitles = new Map([["pack_1", "Pack One"]]);
  const industryLabelById = new Map([["industry_a", "Industry A"]]);
  const assignment = createAssignment();

  const buildAttempt = (db: { usageSessions: UsageSessionRecord[]; scoreRecords: SimulationScoreRecord[] }, scoreId: string) => {
    const score = scoreRecordAccess.getById(db, scoreId);
    assert.ok(score);
    const relatedSession = simulationHistoryAccess.findRelatedUsageSessionForScore(
      usageSessionAccess.listByUserRange(db, {
        userId: score.userId,
        orgId: score.orgId ?? null
      }),
      score
    );

    return {
      relatedSessionId: relatedSession?.id ?? null,
      attempt: buildDashboardAttemptDetailAttempt({
        score,
        user,
        org,
        scenarioCatalog,
        trainingPackTitles,
        industryLabelById,
        relatedSession,
        assignment
      })
    };
  };

  assert.deepEqual(buildAttempt(cutoverDb, "score_exact"), buildAttempt(legacyDb, "score_exact"));
  assert.deepEqual(buildAttempt(cutoverDb, "score_fuzzy"), buildAttempt(legacyDb, "score_fuzzy"));
});

test("dashboard attempt detail helper preserves full payloads through the real store-backed scoreRecordAccess path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-dashboard-attempt-score-store-"));
  try {
    const legacyDb = {
      usageSessions: [
        createSession({
          id: "sess_exact",
          startedAt: "2026-03-31T10:00:00.000Z",
          endedAt: "2026-03-31T10:05:00.000Z",
          rawDurationSeconds: 305
        }),
        createSession({
          id: "sess_fuzzy",
          scenarioId: "scenario_2",
          startedAt: "2026-03-31T11:00:15.000Z",
          endedAt: "2026-03-31T11:05:10.000Z",
          rawDurationSeconds: 450
        })
      ],
      scoreRecords: [
        createScore({
          id: "score_exact",
          startedAt: "2026-03-31T10:00:00.000Z",
          endedAt: "2026-03-31T10:05:00.000Z"
        }),
        createScore({
          id: "score_fuzzy",
          scenarioId: "scenario_2",
          trainingPackId: "pack_1",
          startedAt: "2026-03-31T11:00:00.000Z",
          endedAt: "2026-03-31T11:05:00.000Z",
          overallScore: 92,
          persuasion: 9,
          clarity: 9,
          empathy: 10,
          assertiveness: 9,
          coachingArtifact: createCoachingArtifact("empathy")
        })
      ]
    };
    const user = createUser();
    const org = createOrg();
    const scenarioCatalog = createScenarioCatalog();
    const trainingPackTitles = new Map([["pack_1", "Pack One"]]);
    const industryLabelById = new Map([["industry_a", "Industry A"]]);
    const assignment = createAssignment();
    const store = createScoreRecordStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();
    await store.importLegacyRecords(legacyDb.scoreRecords);

    const storeBackedAccess = createScoreRecordAccess(store);
    const storeBackedHistory = createSimulationHistoryAccess({
      usageSessionAccess,
      scoreRecordAccess: storeBackedAccess
    });
    const storeDb = {
      usageSessions: cloneJson(legacyDb.usageSessions)
    };

    const buildAttempt = (
      db: { usageSessions: UsageSessionRecord[]; scoreRecords?: SimulationScoreRecord[] },
      scoreId: string,
      access = scoreRecordAccess,
      history = simulationHistoryAccess
    ) => {
      const score = access.getById(db, scoreId);
      assert.ok(score);
      const relatedSession = history.findRelatedUsageSessionForScore(
        usageSessionAccess.listByUserRange(db, {
          userId: score.userId,
          orgId: score.orgId ?? null
        }),
        score
      );

      return {
        relatedSessionId: relatedSession?.id ?? null,
        attempt: buildDashboardAttemptDetailAttempt({
          score,
          user,
          org,
          scenarioCatalog,
          trainingPackTitles,
          industryLabelById,
          relatedSession,
          assignment
        })
      };
    };

    assert.deepEqual(
      buildAttempt(storeDb, "score_exact", storeBackedAccess, storeBackedHistory),
      buildAttempt(legacyDb, "score_exact")
    );
    assert.deepEqual(
      buildAttempt(storeDb, "score_fuzzy", storeBackedAccess, storeBackedHistory),
      buildAttempt(legacyDb, "score_fuzzy")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
