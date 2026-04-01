import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ApiDatabase,
  AppConfig,
  EnterpriseOrg,
  SimulationScoreCoachingArtifact,
  SimulationScoreRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";
import { calculateBilledSecondsFromRaw, computeMonthlyPeriodBounds } from "@voicepractice/shared";

import { createScoreRecordAccess } from "./scoreRecordAccess.js";
import { buildDashboardAttemptDetailAttempt } from "./dashboardAttemptDetails.js";
import { createSimulationHistoryAccess } from "./simulationHistory.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";
import { createScoreRecordStore } from "../storage/scoreRecordStore.js";

type SimulationHistoryParityDb = Pick<ApiDatabase, "usageSessions" | "users" | "orgs" | "config"> & {
  scoreRecords: SimulationScoreRecord[];
};

const usageSessionAccess = createUsageSessionAccess();
const scoreRecordAccess = createScoreRecordAccess();
const simulationHistoryAccess = createSimulationHistoryAccess({
  usageSessionAccess,
  scoreRecordAccess
});

function createConfig(): AppConfig {
  return {
    activeSegmentId: "segment_1",
    defaultDifficulty: "medium",
    defaultPersonaStyle: "skeptical",
    industries: [
      { id: "industry_a", label: "Industry A", enabled: true },
      { id: "industry_b", label: "Industry B", enabled: true }
    ],
    roleIndustries: [],
    segments: [
      {
        id: "segment_1",
        label: "Segment One",
        summary: "Segment One",
        enabled: true,
        scenarios: []
      },
      {
        id: "segment_2",
        label: "Segment Two",
        summary: "Segment Two",
        enabled: true,
        scenarios: []
      }
    ],
    tiers: [
      {
        id: "free",
        label: "Free",
        priceUsdMonthly: 0,
        dailySecondsLimit: 900,
        supportIncluded: false,
        canCreateCustomScenarios: false,
        description: "Free"
      }
    ],
    enterprise: {
      visibleInApp: true,
      contactEmail: "support@example.com",
      contactUrl: "https://example.com",
      defaultOrgDailySecondsQuota: 7200,
      defaultPerUserDailySecondsCap: 900,
      allowManualBonusSeconds: true
    },
    featureFlags: {
      scoringEnabled: true,
      customScenarioBuilder: true
    },
    updatedAt: "2026-03-01T00:00:00.000Z"
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
    activeIndustries: overrides.activeIndustries ?? ["industry_a", "industry_b"],
    dailySecondsQuota: overrides.dailySecondsQuota ?? 7200,
    perUserDailySecondsCap: overrides.perUserDailySecondsCap ?? 900,
    pendingPerUserDailySecondsCap: overrides.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    contractSignedAt: overrides.contractSignedAt ?? "2026-03-15T00:00:00.000Z",
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

function createUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user1@example.com",
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-03-01T00:00:00.000Z",
    isPlatformAdmin: overrides.isPlatformAdmin,
    isSuperUser: overrides.isSuperUser,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "free",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "user",
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

function createSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "sess_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 305,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

function createCoachingArtifact(priority: string): SimulationScoreCoachingArtifact {
  return {
    coachingPriority: priority,
    strengths: [`${priority} strength`],
    improvementAreas: [`${priority} improvement`]
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
    trainingPackId: overrides.trainingPackId ?? null,
    industryId: overrides.industryId ?? null,
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
    inputTokens: overrides.inputTokens ?? 50,
    outputTokens: overrides.outputTokens ?? 30,
    totalTokens: overrides.totalTokens ?? 80,
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

function createRepresentativeDb(): SimulationHistoryParityDb {
  return {
    config: createConfig(),
    orgs: [
      createOrg(),
      createOrg({
        id: "org_2",
        name: "Org Two",
        contactEmail: "org2@example.com",
        emailDomain: "org2.example.com",
        joinCode: "JOIN2",
        monthlyMinutesAllotted: 60
      })
    ],
    users: [
      createUser(),
      createUser({
        id: "user_2",
        email: "admin@example.com",
        orgRole: "org_admin"
      }),
      createUser({
        id: "user_3",
        email: "other@example.com",
        orgId: "org_2"
      })
    ],
    usageSessions: [
      createSession({
        id: "sess_exact",
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z",
        rawDurationSeconds: 305
      }),
      createSession({
        id: "sess_fuzzy",
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:10.000Z",
        endedAt: "2026-03-31T11:05:08.000Z",
        rawDurationSeconds: 470
      }),
      createSession({
        id: "sess_usage_only",
        trainingPackId: "pack_1",
        scenarioId: "scenario_3",
        startedAt: "2026-03-30T09:00:00.000Z",
        endedAt: "2026-03-30T09:04:01.000Z",
        rawDurationSeconds: 241
      }),
      createSession({
        id: "sess_user2",
        userId: "user_2",
        orgId: "org_1",
        segmentId: "segment_2",
        scenarioId: "scenario_4",
        startedAt: "2026-03-31T08:00:00.000Z",
        endedAt: "2026-03-31T08:15:00.000Z",
        rawDurationSeconds: 900
      }),
      createSession({
        id: "sess_other_org",
        userId: "user_3",
        orgId: "org_2",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        startedAt: "2026-03-31T07:00:00.000Z",
        endedAt: "2026-03-31T07:10:00.000Z",
        rawDurationSeconds: 600
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_exact",
        trainingPackId: "pack_1",
        industryId: "industry_a",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z",
        overallScore: 88,
        coachingArtifact: createCoachingArtifact("clarity")
      }),
      createScore({
        id: "score_fuzzy",
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        industryId: "industry_b",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z",
        overallScore: 92,
        persuasion: 9,
        clarity: 9,
        empathy: 10,
        assertiveness: 9,
        coachingArtifact: createCoachingArtifact("empathy")
      }),
      createScore({
        id: "score_old",
        trainingPackId: "pack_1",
        scenarioId: "scenario_3",
        industryId: "industry_a",
        startedAt: "2026-03-30T09:00:00.000Z",
        endedAt: "2026-03-30T09:04:01.000Z",
        overallScore: 76,
        coachingArtifact: createCoachingArtifact("assertiveness")
      }),
      createScore({
        id: "score_user2",
        userId: "user_2",
        orgId: "org_1",
        segmentId: "segment_2",
        scenarioId: "scenario_4",
        industryId: "industry_a",
        startedAt: "2026-03-31T08:00:00.000Z",
        endedAt: "2026-03-31T08:15:00.000Z",
        overallScore: 70,
        coachingArtifact: createCoachingArtifact("persuasion")
      }),
      createScore({
        id: "score_other_org",
        userId: "user_3",
        orgId: "org_2",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        industryId: "industry_b",
        startedAt: "2026-03-31T07:00:00.000Z",
        endedAt: "2026-03-31T07:10:00.000Z",
        overallScore: 95,
        coachingArtifact: createCoachingArtifact("clarity")
      })
    ]
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createScoreRecordCutoverDb(legacyDb: SimulationHistoryParityDb): SimulationHistoryParityDb {
  let extractedScoreRecords = cloneJson(legacyDb.scoreRecords).reverse();

  const cutoverDb = {
    config: cloneJson(legacyDb.config),
    orgs: cloneJson(legacyDb.orgs),
    users: cloneJson(legacyDb.users),
    usageSessions: cloneJson(legacyDb.usageSessions)
  } as SimulationHistoryParityDb;

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

function buildAttemptDetailParitySnapshot(
  db: SimulationHistoryParityDb,
  scoreId: string,
  options?: {
    scoreAccess?: typeof scoreRecordAccess;
    historyAccess?: typeof simulationHistoryAccess;
  }
): {
  scoreId: string;
  relatedSessionId: string | null;
  rawDurationSeconds: number | null;
  scoreBreakdown: {
    overallScore: number;
    persuasion: number;
    clarity: number;
    empathy: number;
    assertiveness: number;
  };
  coachingPriority: string | null;
  trainingPackId: string | null;
} {
  const scoreAccess = options?.scoreAccess ?? scoreRecordAccess;
  const historyAccess = options?.historyAccess ?? simulationHistoryAccess;
  const score = scoreAccess.getById(db, scoreId);
  assert.ok(score, `Expected score ${scoreId} to exist.`);
  const user = db.users.find((entry) => entry.id === score.userId);
  const org = score.orgId ? db.orgs.find((entry) => entry.id === score.orgId) ?? null : null;
  assert.ok(user, `Expected user ${score.userId} to exist.`);
  const relatedSession = historyAccess.findRelatedUsageSessionForScore(
    usageSessionAccess.listByUserRange(db, {
      userId: score.userId,
      orgId: score.orgId ?? null
    }),
    score
  );
  const attempt = buildDashboardAttemptDetailAttempt({
    score,
    user,
    org,
    scenarioCatalog: new Map([
      ["scenario_1", { scenarioId: "scenario_1", title: "Scenario One", summary: null, segmentId: "segment_1", segmentLabel: "Segment One", source: "standard" as const }],
      ["scenario_2", { scenarioId: "scenario_2", title: "Scenario Two", summary: null, segmentId: "segment_1", segmentLabel: "Segment One", source: "standard" as const }],
      ["scenario_3", { scenarioId: "scenario_3", title: "Scenario Three", summary: null, segmentId: "segment_1", segmentLabel: "Segment One", source: "standard" as const }],
      ["scenario_4", { scenarioId: "scenario_4", title: "Scenario Four", summary: null, segmentId: "segment_2", segmentLabel: "Segment Two", source: "standard" as const }]
    ]),
    trainingPackTitles: new Map([["pack_1", "Pack One"]]),
    industryLabelById: new Map(db.config.industries.map((industry) => [industry.id, industry.label])),
    relatedSession,
    assignment: createAssignment({
      id: "assignment_attempt",
      trainingPackId: "pack_1",
      userId: score.userId,
      assignedAt: "2026-03-30T00:00:00.000Z"
    })
  });

  return {
    scoreId: attempt.activityId,
    relatedSessionId: relatedSession?.id ?? null,
    rawDurationSeconds: attempt.rawDurationSeconds,
    scoreBreakdown: attempt.scoreBreakdown ?? {
      overallScore: -1,
      persuasion: -1,
      clarity: -1,
      empathy: -1,
      assertiveness: -1
    },
    coachingPriority: attempt.coachingArtifact?.coachingPriority ?? null,
    trainingPackId: attempt.trainingPackId
  };
}

function buildMobileScoreSummaryParitySnapshot(
  db: SimulationHistoryParityDb,
  userId: string,
  scoreAccess: typeof scoreRecordAccess = scoreRecordAccess
): ReturnType<typeof scoreRecordAccess.buildUserScoreSummary> {
  return scoreAccess.buildUserScoreSummary({
    db,
    userId,
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map(db.config.segments.map((segment) => [segment.id, segment.label])),
    industryLabelById: new Map(db.config.industries.map((industry) => [industry.id, industry.label]))
  });
}

function buildMobileOrgAnalyticsParitySnapshot(
  db: SimulationHistoryParityDb,
  orgId: string,
  scoreAccess: typeof scoreRecordAccess = scoreRecordAccess
): ReturnType<typeof scoreRecordAccess.buildOrgScoreAnalytics> {
  return scoreAccess.buildOrgScoreAnalytics({
    db,
    orgId,
    periodStartAt: new Date("2026-03-01T00:00:00.000Z"),
    periodEndAt: new Date("2026-04-01T00:00:00.000Z"),
    segmentLabelById: new Map(db.config.segments.map((segment) => [segment.id, segment.label])),
    industryLabelById: new Map(db.config.industries.map((industry) => [industry.id, industry.label])),
    userEmailById: new Map(db.users.map((user) => [user.id, user.email]))
  });
}

function buildSimulationHistoryStatsParitySnapshot(
  db: SimulationHistoryParityDb,
  params: { orgId?: string; segmentId?: string },
  options?: {
    scoreAccess?: typeof scoreRecordAccess;
    historyAccess?: typeof simulationHistoryAccess;
  }
): {
  totals: { sessions: number; billedSeconds: number; avgOverallScore: number | null };
  byOrg: Array<{ orgId: string; orgName: string; sessions: number; billedSeconds: number; avgOverallScore: number | null }>;
  bySegment: Array<{
    segmentId: string;
    segmentLabel: string;
    sessions: number;
    billedSeconds: number;
    avgOverallScore: number | null;
  }>;
  trendByDay: Array<{ dayKey: string; sessions: number; billedSeconds: number; avgOverallScore: number | null }>;
  topUsers: Array<{ userId: string; email: string; orgId: string | null; orgName: string | null; sessions: number; avgOverallScore: number | null }>;
} {
  const periodStartAt = new Date("2026-03-01T00:00:00.000Z");
  const periodEndAt = new Date("2026-04-01T00:00:00.000Z");
  const scoreAccess = options?.scoreAccess ?? scoreRecordAccess;
  const historyAccess = options?.historyAccess ?? simulationHistoryAccess;
  const activity = historyAccess.listActivityWindow(db, {
    orgId: params.orgId,
    segmentId: params.segmentId,
    periodStartAt,
    periodEndAt
  });
  const sessions = activity.usageSessions.filter((session) => Boolean(session.orgId));
  const scores = activity.scoreRecords.filter((record) => Boolean(record.orgId));
  const orgById = new Map(db.orgs.map((org) => [org.id, org]));
  const userById = new Map(db.users.map((user) => [user.id, user]));
  const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));

  const sessionsByOrgId = new Map<string, { sessions: number; billedSeconds: number }>();
  for (const session of sessions) {
    if (!session.orgId) {
      continue;
    }
    const current = sessionsByOrgId.get(session.orgId) ?? { sessions: 0, billedSeconds: 0 };
    sessionsByOrgId.set(session.orgId, {
      sessions: current.sessions + 1,
      billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
    });
  }

  const scoresByOrgId = new Map<string, { sessions: number; totalScore: number }>();
  for (const record of scores) {
    if (!record.orgId) {
      continue;
    }
    const current = scoresByOrgId.get(record.orgId) ?? { sessions: 0, totalScore: 0 };
    scoresByOrgId.set(record.orgId, {
      sessions: current.sessions + 1,
      totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
    });
  }

  const byOrg = Array.from(new Set([...sessionsByOrgId.keys(), ...scoresByOrgId.keys()]))
    .map((orgId) => {
      const usage = sessionsByOrgId.get(orgId) ?? { sessions: 0, billedSeconds: 0 };
      const scoreTotals = scoresByOrgId.get(orgId) ?? { sessions: 0, totalScore: 0 };
      return {
        orgId,
        orgName: orgById.get(orgId)?.name ?? orgId,
        sessions: usage.sessions,
        billedSeconds: usage.billedSeconds,
        avgOverallScore: scoreTotals.sessions > 0 ? scoreTotals.totalScore / scoreTotals.sessions : null
      };
    })
    .sort((a, b) => b.billedSeconds - a.billedSeconds);

  const sessionsBySegmentId = new Map<string, { sessions: number; billedSeconds: number }>();
  for (const session of sessions) {
    const current = sessionsBySegmentId.get(session.segmentId) ?? { sessions: 0, billedSeconds: 0 };
    sessionsBySegmentId.set(session.segmentId, {
      sessions: current.sessions + 1,
      billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
    });
  }

  const scoresBySegmentId = new Map<string, { sessions: number; totalScore: number }>();
  for (const record of scores) {
    const current = scoresBySegmentId.get(record.segmentId) ?? { sessions: 0, totalScore: 0 };
    scoresBySegmentId.set(record.segmentId, {
      sessions: current.sessions + 1,
      totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
    });
  }

  const bySegment = Array.from(new Set([...sessionsBySegmentId.keys(), ...scoresBySegmentId.keys()]))
    .map((segmentId) => {
      const usage = sessionsBySegmentId.get(segmentId) ?? { sessions: 0, billedSeconds: 0 };
      const scoreTotals = scoresBySegmentId.get(segmentId) ?? { sessions: 0, totalScore: 0 };
      return {
        segmentId,
        segmentLabel: segmentLabelById.get(segmentId) ?? segmentId,
        sessions: usage.sessions,
        billedSeconds: usage.billedSeconds,
        avgOverallScore: scoreTotals.sessions > 0 ? scoreTotals.totalScore / scoreTotals.sessions : null
      };
    })
    .sort((a, b) => b.billedSeconds - a.billedSeconds);

  const trendUsageByDay = new Map<string, { sessions: number; billedSeconds: number }>();
  for (const session of sessions) {
    const dayKey = new Date(session.startedAt).toISOString().slice(0, 10);
    const current = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
    trendUsageByDay.set(dayKey, {
      sessions: current.sessions + 1,
      billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
    });
  }

  const trendScoresByDay = new Map<string, { sessions: number; totalScore: number }>();
  for (const record of scores) {
    const dayKey = new Date(record.endedAt).toISOString().slice(0, 10);
    const current = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
    trendScoresByDay.set(dayKey, {
      sessions: current.sessions + 1,
      totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
    });
  }

  const trendByDay = Array.from(new Set([...trendUsageByDay.keys(), ...trendScoresByDay.keys()]))
    .sort()
    .map((dayKey) => {
      const usage = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
      const scoreTotals = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
      return {
        dayKey,
        sessions: usage.sessions,
        billedSeconds: usage.billedSeconds,
        avgOverallScore: scoreTotals.sessions > 0 ? scoreTotals.totalScore / scoreTotals.sessions : null
      };
    });

  const scoresByUserId = new Map<string, { sessions: number; totalScore: number }>();
  for (const record of scores) {
    const current = scoresByUserId.get(record.userId) ?? { sessions: 0, totalScore: 0 };
    scoresByUserId.set(record.userId, {
      sessions: current.sessions + 1,
      totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
    });
  }

  const topUsers = Array.from(scoresByUserId.entries())
    .map(([userId, totals]) => {
      const user = userById.get(userId);
      const org = user?.orgId ? orgById.get(user.orgId) : null;
      return {
        userId,
        email: user?.email ?? userId,
        orgId: user?.orgId ?? null,
        orgName: org?.name ?? null,
        sessions: totals.sessions,
        avgOverallScore: totals.sessions > 0 ? totals.totalScore / totals.sessions : null
      };
    })
    .sort((a, b) => (b.avgOverallScore ?? 0) - (a.avgOverallScore ?? 0))
    .slice(0, 10);

  return {
    totals: {
      sessions: sessions.length,
      billedSeconds: usageSessionAccess.sumBilledSeconds(sessions),
      avgOverallScore: scoreAccess.computeAverageOverallScore(scores)
    },
    byOrg,
    bySegment,
    trendByDay,
    topUsers
  };
}

function buildAdminOrgUsageParitySnapshot(
  db: SimulationHistoryParityDb,
  orgId: string
): {
  usage: { usedSecondsThisPeriod: number; allottedSecondsThisPeriod: number; remainingSecondsThisPeriod: number; usagePercentThisPeriod: number };
  users: Array<{ userId: string; rawSecondsThisPeriod: number; billedSecondsThisPeriod: number }>;
} {
  const org = db.orgs.find((entry) => entry.id === orgId);
  assert.ok(org, `Expected org ${orgId} to exist.`);
  const now = new Date("2026-03-31T20:00:00.000Z");
  const billing = computeMonthlyPeriodBounds(new Date(org.contractSignedAt).toISOString(), now);
  const periodStartMs = new Date(billing.periodStartAt).getTime();
  const periodEndMs = new Date(billing.periodEndAt).getTime();
  const usageSnapshot = usageSessionAccess.buildOrgUsageSnapshot(db, {
    orgId: org.id,
    billingAnchorAt: new Date(org.contractSignedAt).toISOString(),
    allottedMinutes: org.monthlyMinutesAllotted,
    now
  });
  const sessionsForOrg = usageSessionAccess.listByOrgRange(db, { orgId: org.id });

  return {
    usage: {
      usedSecondsThisPeriod: usageSnapshot.usedSeconds,
      allottedSecondsThisPeriod: usageSnapshot.allottedSeconds,
      remainingSecondsThisPeriod: Math.max(0, usageSnapshot.allottedSeconds - usageSnapshot.usedSeconds),
      usagePercentThisPeriod: usageSnapshot.usagePercent
    },
    users: db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === org.id)
      .map((user) => {
        const sessionsInPeriod = sessionsForOrg.filter((session) => {
          if (session.userId !== user.id) {
            return false;
          }
          const startedAtMs = new Date(session.startedAt).getTime();
          return Number.isFinite(startedAtMs) && startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
        });
        return {
          userId: user.id,
          rawSecondsThisPeriod: sessionsInPeriod.reduce((total, session) => total + session.rawDurationSeconds, 0),
          billedSecondsThisPeriod: usageSessionAccess.sumBilledSeconds(sessionsInPeriod)
        };
      })
      .sort((left, right) => left.userId.localeCompare(right.userId))
  };
}

function buildUsageWriteParitySnapshot(
  db: SimulationHistoryParityDb,
  session: UsageSessionRecord
): {
  beforeBilledSecondsToday: number;
  afterBilledSecondsToday: number;
  billedSecondsAdded: number;
  beforeOrgUsedSeconds: number;
  afterOrgUsedSeconds: number;
} {
  const beforeUsage = usageSessionAccess.computeUserUsageSnapshot(db, {
    userId: session.userId,
    now: new Date("2026-03-31T20:00:00.000Z"),
    timeZone: "UTC"
  });
  const beforeOrgUsage = usageSessionAccess.buildOrgUsageSnapshot(db, {
    orgId: session.orgId ?? "org_1",
    billingAnchorAt: "2026-03-15T00:00:00.000Z",
    allottedMinutes: 120,
    now: new Date("2026-03-31T20:00:00.000Z")
  });

  usageSessionAccess.append(db, session);

  const afterUsage = usageSessionAccess.computeUserUsageSnapshot(db, {
    userId: session.userId,
    now: new Date("2026-03-31T20:00:00.000Z"),
    timeZone: "UTC"
  });
  const afterOrgUsage = usageSessionAccess.buildOrgUsageSnapshot(db, {
    orgId: session.orgId ?? "org_1",
    billingAnchorAt: "2026-03-15T00:00:00.000Z",
    allottedMinutes: 120,
    now: new Date("2026-03-31T20:00:00.000Z")
  });

  return {
    beforeBilledSecondsToday: beforeUsage.billedSecondsToday,
    afterBilledSecondsToday: afterUsage.billedSecondsToday,
    billedSecondsAdded: Math.max(0, afterUsage.billedSecondsToday - beforeUsage.billedSecondsToday),
    beforeOrgUsedSeconds: beforeOrgUsage.usedSeconds,
    afterOrgUsedSeconds: afterOrgUsage.usedSeconds
  };
}

function buildRecentActivitySafetySnapshot(
  db: SimulationHistoryParityDb,
  since: Date,
  scoreAccess: typeof scoreRecordAccess = scoreRecordAccess
): {
  usage: ReturnType<typeof usageSessionAccess.listRecentActivityReferences>;
  scores: ReturnType<typeof scoreRecordAccess.listRecentActivityReferences>;
} {
  const sortRefs = <T extends { endedAt: string; segmentId: string; scenarioId: string }>(entries: T[]): T[] =>
    entries
      .slice()
      .sort((left, right) => {
        const timeDelta = new Date(left.endedAt).getTime() - new Date(right.endedAt).getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        const segmentDelta = left.segmentId.localeCompare(right.segmentId);
        if (segmentDelta !== 0) {
          return segmentDelta;
        }
        return left.scenarioId.localeCompare(right.scenarioId);
      });

  return {
    usage: sortRefs(usageSessionAccess.listRecentActivityReferences(db, { since })),
    scores: sortRefs(scoreAccess.listRecentActivityReferences(db, { since }))
  };
}

function buildReadinessSnapshot(
  db: SimulationHistoryParityDb,
  options?: {
    scoreAccess?: typeof scoreRecordAccess;
    historyAccess?: typeof simulationHistoryAccess;
  }
) {
  const scoreAccess = options?.scoreAccess ?? scoreRecordAccess;
  const historyAccess = options?.historyAccess ?? simulationHistoryAccess;
  return {
    exactAttempt: buildAttemptDetailParitySnapshot(db, "score_exact", { scoreAccess, historyAccess }),
    fuzzyAttempt: buildAttemptDetailParitySnapshot(db, "score_fuzzy", { scoreAccess, historyAccess }),
    summary: buildMobileScoreSummaryParitySnapshot(db, "user_1", scoreAccess),
    analytics: buildMobileOrgAnalyticsParitySnapshot(db, "org_1", scoreAccess),
    stats: buildSimulationHistoryStatsParitySnapshot(db, { orgId: "org_1" }, { scoreAccess, historyAccess }),
    orgUsage: buildAdminOrgUsageParitySnapshot(db, "org_1"),
    recentActivity: buildRecentActivitySafetySnapshot(db, new Date("2026-03-31T00:00:00.000Z"), scoreAccess)
  };
}

test("simulation-history readiness preserves route-shaped score outputs, attempt detail linkage, and combined stats semantics", () => {
  const db = createRepresentativeDb();

  const exactAttempt = buildAttemptDetailParitySnapshot(db, "score_exact");
  const fuzzyAttempt = buildAttemptDetailParitySnapshot(db, "score_fuzzy");
  const summary = buildMobileScoreSummaryParitySnapshot(db, "user_1");
  const analytics = buildMobileOrgAnalyticsParitySnapshot(db, "org_1");
  const stats = buildSimulationHistoryStatsParitySnapshot(db, { orgId: "org_1" });

  assert.deepEqual(exactAttempt, {
    scoreId: "score_exact",
    relatedSessionId: "sess_exact",
    rawDurationSeconds: 305,
    scoreBreakdown: {
      overallScore: 88,
      persuasion: 8,
      clarity: 9,
      empathy: 8,
      assertiveness: 10
    },
    coachingPriority: "clarity",
    trainingPackId: "pack_1"
  });
  assert.equal(fuzzyAttempt.relatedSessionId, "sess_fuzzy");
  assert.equal(fuzzyAttempt.rawDurationSeconds, 470);
  assert.equal(fuzzyAttempt.coachingPriority, "empathy");

  assert.equal(summary.totals.sessions, 3);
  assert.equal(summary.totals.avgOverallScore, 256 / 3);
  assert.deepEqual(
    summary.byDay.map((entry) => [entry.dayKey, entry.sessions, entry.avgOverallScore]),
    [
      ["2026-03-30", 1, 76],
      ["2026-03-31", 2, 90]
    ]
  );
  assert.deepEqual(summary.byIndustry, [
    { industryId: "industry_a", industryLabel: "Industry A", sessions: 2, avgOverallScore: 82 },
    { industryId: "industry_b", industryLabel: "Industry B", sessions: 1, avgOverallScore: 92 }
  ]);
  assert.deepEqual(
    summary.recent.map((entry) => entry.id),
    ["score_fuzzy", "score_exact", "score_old"]
  );

  assert.equal(analytics.orgAvgOverallScore, 81.5);
  assert.deepEqual(analytics.topUsers, [
    { userId: "user_1", email: "user1@example.com", sessions: 3, avgOverallScore: 256 / 3 },
    { userId: "user_2", email: "admin@example.com", sessions: 1, avgOverallScore: 70 }
  ]);
  assert.deepEqual(analytics.bySegment, [
    { segmentId: "segment_1", segmentLabel: "Segment One", sessions: 3, avgOverallScore: 256 / 3 },
    { segmentId: "segment_2", segmentLabel: "Segment Two", sessions: 1, avgOverallScore: 70 }
  ]);

  assert.deepEqual(stats.totals, {
    sessions: 4,
    billedSeconds: 1905,
    avgOverallScore: 81.5
  });
  assert.deepEqual(stats.byOrg, [
    {
      orgId: "org_1",
      orgName: "Org One",
      sessions: 4,
      billedSeconds: 1905,
      avgOverallScore: 81.5
    }
  ]);
  assert.deepEqual(stats.bySegment, [
    {
      segmentId: "segment_1",
      segmentLabel: "Segment One",
      sessions: 3,
      billedSeconds: 1005,
      avgOverallScore: 256 / 3
    },
    {
      segmentId: "segment_2",
      segmentLabel: "Segment Two",
      sessions: 1,
      billedSeconds: 900,
      avgOverallScore: 70
    }
  ]);
  assert.deepEqual(stats.trendByDay, [
    {
      dayKey: "2026-03-30",
      sessions: 1,
      billedSeconds: 240,
      avgOverallScore: 76
    },
    {
      dayKey: "2026-03-31",
      sessions: 3,
      billedSeconds: 1665,
      avgOverallScore: 250 / 3
    }
  ]);
});

test("simulation-history readiness preserves usage-driven billing math, admin-org usage outputs, and recent-activity safety references", () => {
  const db = createRepresentativeDb();

  const usageWrite = buildUsageWriteParitySnapshot(
    db,
    createSession({
      id: "sess_new",
      userId: "user_1",
      orgId: "org_1",
      trainingPackId: "pack_1",
      scenarioId: "scenario_2",
      startedAt: "2026-03-31T12:00:00.000Z",
      endedAt: "2026-03-31T12:02:29.000Z",
      rawDurationSeconds: 149,
      createdAt: "2026-03-31T12:02:29.000Z"
    })
  );
  const orgUsage = buildAdminOrgUsageParitySnapshot(db, "org_1");
  const recentActivity = buildRecentActivitySafetySnapshot(db, new Date("2026-03-31T00:00:00.000Z"));

  assert.deepEqual(usageWrite, {
    beforeBilledSecondsToday: 765,
    afterBilledSecondsToday: 915,
    billedSecondsAdded: 150,
    beforeOrgUsedSeconds: 1905,
    afterOrgUsedSeconds: 2040
  });

  assert.deepEqual(orgUsage.usage, {
    usedSecondsThisPeriod: 2040,
    allottedSecondsThisPeriod: 7200,
    remainingSecondsThisPeriod: 5160,
    usagePercentThisPeriod: 28.333333333333332
  });
  assert.deepEqual(orgUsage.users, [
    {
      userId: "user_1",
      rawSecondsThisPeriod: 1165,
      billedSecondsThisPeriod: 1140
    },
    {
      userId: "user_2",
      rawSecondsThisPeriod: 900,
      billedSecondsThisPeriod: 900
    }
  ]);

  assert.deepEqual(recentActivity.usage, [
    { segmentId: "segment_1", scenarioId: "scenario_1", endedAt: "2026-03-31T07:10:00.000Z" },
    { segmentId: "segment_2", scenarioId: "scenario_4", endedAt: "2026-03-31T08:15:00.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_1", endedAt: "2026-03-31T10:05:00.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_2", endedAt: "2026-03-31T11:05:08.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_2", endedAt: "2026-03-31T12:02:29.000Z" }
  ]);
  assert.deepEqual(recentActivity.scores, [
    { segmentId: "segment_1", scenarioId: "scenario_1", endedAt: "2026-03-31T07:10:00.000Z" },
    { segmentId: "segment_2", scenarioId: "scenario_4", endedAt: "2026-03-31T08:15:00.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_1", endedAt: "2026-03-31T10:05:00.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_2", endedAt: "2026-03-31T11:05:00.000Z" }
  ]);
});

test("simulation-history readiness preserves usage-only, score-only, and full-completion assignment lifecycle semantics", () => {
  const scenarioCatalog = new Map([
    ["scenario_1", { title: "Scenario One" }],
    ["scenario_2", { title: "Scenario Two" }],
    ["scenario_3", { title: "Scenario Three" }]
  ]);
  const user = { email: "user1@example.com", status: "active" as const };

  const usageOnly = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment: createAssignment({ id: "assignment_usage" }),
    user,
    scenarioCatalog,
    allSessions: [
      createSession({
        id: "sess_usage",
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T09:00:00.000Z",
        endedAt: "2026-03-31T09:05:00.000Z"
      })
    ],
    allScores: [],
    recentSessions: [
      createSession({
        id: "sess_usage",
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T09:00:00.000Z",
        endedAt: "2026-03-31T09:05:00.000Z"
      })
    ],
    recentScores: []
  });

  const scoreOnly = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment: createAssignment({ id: "assignment_score" }),
    user,
    scenarioCatalog,
    allSessions: [],
    allScores: [
      createScore({
        id: "score_only",
        trainingPackId: "pack_1",
        endedAt: "2026-03-31T10:05:00.000Z",
        overallScore: 88
      })
    ],
    recentSessions: [],
    recentScores: [
      createScore({
        id: "score_only",
        trainingPackId: "pack_1",
        endedAt: "2026-03-31T10:05:00.000Z",
        overallScore: 88
      })
    ]
  });

  const completionDb = {
    usageSessions: [
      createSession({
        id: "sess_complete_a",
        trainingPackId: "pack_1",
        scenarioId: "scenario_1",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z"
      }),
      createSession({
        id: "sess_complete_b",
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z"
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_complete_a",
        trainingPackId: "pack_1",
        scenarioId: "scenario_1",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z",
        overallScore: 88
      }),
      createScore({
        id: "score_complete_b",
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z",
        overallScore: 92
      })
    ]
  };
  const completionAssignment = createAssignment({ id: "assignment_complete" });
  const completed = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment: completionAssignment,
    user,
    scenarioCatalog,
    allSessions: completionDb.usageSessions,
    allScores: completionDb.scoreRecords,
    recentSessions: completionDb.usageSessions,
    recentScores: completionDb.scoreRecords
  });
  const projected = simulationHistoryAccess.projectTrainingPackAssignmentLifecycle(completionDb, completionAssignment);

  assert.deepEqual(
    {
      status: usageOnly.status,
      startedAt: usageOnly.startedAt,
      completedAt: usageOnly.completedAt,
      attemptsLast30Days: usageOnly.attemptsLast30Days,
      scoredAttemptsLast30Days: usageOnly.scoredAttemptsLast30Days,
      latestScenarioTitle: usageOnly.latestScenarioTitle
    },
    {
      status: "in_progress",
      startedAt: "2026-03-31T09:00:00.000Z",
      completedAt: null,
      attemptsLast30Days: 1,
      scoredAttemptsLast30Days: 0,
      latestScenarioTitle: "Scenario One"
    }
  );

  assert.deepEqual(
    {
      status: scoreOnly.status,
      startedAt: scoreOnly.startedAt,
      completedAt: scoreOnly.completedAt,
      completedScenarioCount: scoreOnly.completedScenarioCount,
      scoredAttemptsLast30Days: scoreOnly.scoredAttemptsLast30Days
    },
    {
      status: "in_progress",
      startedAt: "2026-03-31T10:05:00.000Z",
      completedAt: null,
      completedScenarioCount: 1,
      scoredAttemptsLast30Days: 1
    }
  );

  assert.deepEqual(
    {
      status: completed.status,
      startedAt: completed.startedAt,
      completedAt: completed.completedAt,
      completedScenarioCount: completed.completedScenarioCount,
      averageScoreLast30Days: completed.averageScoreLast30Days
    },
    {
      status: "completed",
      startedAt: "2026-03-31T10:00:00.000Z",
      completedAt: "2026-03-31T11:05:00.000Z",
      completedScenarioCount: 2,
      averageScoreLast30Days: 90
    }
  );

  assert.deepEqual(
    {
      startedAt: projected.startedAt,
      completedAt: projected.completedAt
    },
    {
      startedAt: "2026-03-31T10:00:00.000Z",
      completedAt: "2026-03-31T11:05:00.000Z"
    }
  );
});

test("simulation-history readiness preserves representative snapshots across reordered legacy fixtures and user-deletion cleanup", async () => {
  const db = createRepresentativeDb();
  const reorderedDb = JSON.parse(JSON.stringify(db)) as SimulationHistoryParityDb;
  reorderedDb.usageSessions.reverse();
  reorderedDb.scoreRecords.reverse();
  reorderedDb.users.reverse();
  reorderedDb.orgs.reverse();

  assert.deepEqual(buildReadinessSnapshot(reorderedDb), buildReadinessSnapshot(db));

  usageSessionAccess.deleteForUser(reorderedDb, "user_1");
  await scoreRecordAccess.deleteForUser(reorderedDb, "user_1");

  const summary = buildMobileScoreSummaryParitySnapshot(reorderedDb, "user_1");
  const analytics = buildMobileOrgAnalyticsParitySnapshot(reorderedDb, "org_1");
  const stats = buildSimulationHistoryStatsParitySnapshot(reorderedDb, { orgId: "org_1" });

  assert.deepEqual(summary, {
    totals: { sessions: 0, avgOverallScore: null },
    byDay: [],
    bySegment: [],
    byIndustry: [],
    recent: []
  });
  assert.deepEqual(analytics.topUsers, [
    { userId: "user_2", email: "admin@example.com", sessions: 1, avgOverallScore: 70 }
  ]);
  assert.deepEqual(stats.totals, {
    sessions: 1,
    billedSeconds: 900,
    avgOverallScore: 70
  });
  assert.deepEqual(
    stats.topUsers.map((entry) => entry.userId),
    ["user_2"]
  );
});

test("simulation-history readiness preserves representative outputs across scoreRecords cutover into extracted-like backing storage", () => {
  const legacyDb = createRepresentativeDb();
  const cutoverDb = createScoreRecordCutoverDb(legacyDb);

  assert.deepEqual(buildReadinessSnapshot(cutoverDb), buildReadinessSnapshot(legacyDb));

  const assignment = createAssignment({ id: "assignment_cutover" });
  const scenarioCatalog = new Map([
    ["scenario_1", { title: "Scenario One" }],
    ["scenario_2", { title: "Scenario Two" }]
  ]);
  const legacyProgress = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment,
    user: { email: "user1@example.com", status: "active" },
    scenarioCatalog,
    allSessions: usageSessionAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
    allScores: scoreRecordAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
    recentSessions: usageSessionAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
    recentScores: scoreRecordAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" })
  });
  const cutoverProgress = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment,
    user: { email: "user1@example.com", status: "active" },
    scenarioCatalog,
    allSessions: usageSessionAccess.listByUserRange(cutoverDb, { userId: "user_1", trainingPackId: "pack_1" }),
    allScores: scoreRecordAccess.listByUserRange(cutoverDb, { userId: "user_1", trainingPackId: "pack_1" }),
    recentSessions: usageSessionAccess.listByUserRange(cutoverDb, { userId: "user_1", trainingPackId: "pack_1" }),
    recentScores: scoreRecordAccess.listByUserRange(cutoverDb, { userId: "user_1", trainingPackId: "pack_1" })
  });

  assert.deepEqual(cutoverProgress, legacyProgress);
});

test("simulation-history readiness preserves representative outputs through the real store-backed scoreRecordAccess path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-simulation-history-score-store-"));
  try {
    const legacyDb = createRepresentativeDb();
    const storeBackedDb: SimulationHistoryParityDb = {
      config: cloneJson(legacyDb.config),
      orgs: cloneJson(legacyDb.orgs),
      users: cloneJson(legacyDb.users),
      usageSessions: cloneJson(legacyDb.usageSessions),
      scoreRecords: []
    };
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

    const storeBackedScoreAccess = createScoreRecordAccess(store);
    const storeBackedHistory = createSimulationHistoryAccess({
      usageSessionAccess,
      scoreRecordAccess: storeBackedScoreAccess
    });

    assert.deepEqual(
      buildReadinessSnapshot(storeBackedDb, {
        scoreAccess: storeBackedScoreAccess,
        historyAccess: storeBackedHistory
      }),
      buildReadinessSnapshot(legacyDb)
    );

    const assignment = createAssignment({ id: "assignment_store_backed" });
    const scenarioCatalog = new Map([
      ["scenario_1", { title: "Scenario One" }],
      ["scenario_2", { title: "Scenario Two" }]
    ]);
    const legacyProgress = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
      assignment,
      user: { email: "user1@example.com", status: "active" },
      scenarioCatalog,
      allSessions: usageSessionAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
      allScores: scoreRecordAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
      recentSessions: usageSessionAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" }),
      recentScores: scoreRecordAccess.listByUserRange(legacyDb, { userId: "user_1", trainingPackId: "pack_1" })
    });
    const storeBackedProgress = storeBackedHistory.computeTrainingPackAssignmentProgress({
      assignment,
      user: { email: "user1@example.com", status: "active" },
      scenarioCatalog,
      allSessions: usageSessionAccess.listByUserRange(storeBackedDb, { userId: "user_1", trainingPackId: "pack_1" }),
      allScores: storeBackedScoreAccess.listByUserRange(storeBackedDb, { userId: "user_1", trainingPackId: "pack_1" }),
      recentSessions: usageSessionAccess.listByUserRange(storeBackedDb, { userId: "user_1", trainingPackId: "pack_1" }),
      recentScores: storeBackedScoreAccess.listByUserRange(storeBackedDb, { userId: "user_1", trainingPackId: "pack_1" })
    });

    assert.deepEqual(storeBackedProgress, legacyProgress);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
