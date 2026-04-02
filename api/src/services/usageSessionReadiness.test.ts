import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  ApiDatabase,
  AppConfig,
  EnterpriseOrg,
  SimulationScoreRecord,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";
import {
  COMMON_TIMEZONES,
  DEFAULT_TIER_DEFINITIONS,
  USAGE_BILLING_INCREMENT_SECONDS,
  calculateBilledSecondsFromRaw,
  computeMonthlyPeriodBounds,
  computeNextRenewalAt,
  getTierById,
  humanDailyResetLabel,
  sumRawSeconds
} from "@voicepractice/shared";

import { createScoreRecordAccess } from "./scoreRecordAccess.js";
import { createSimulationHistoryAccess } from "./simulationHistory.js";
import { completeRecognizedSimulationUsage, registerRecognizedSimulationSessionStart } from "./simulationSessionLifecycle.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";
import { createSimulationSessionStore } from "../storage/simulationSessionStore.js";
import { createUsageSessionStore } from "../storage/usageSessionStore.js";
import { buildUsageSessionDeterministicId, computeUsageSessionBilledSecondsAdded } from "./usageSessionWriteModel.js";

type UsageSessionReadinessDb = Pick<ApiDatabase, "config" | "orgs" | "users" | "usageSessions"> & {
  scoreRecords: SimulationScoreRecord[];
};

type EntitlementParitySnapshot = {
  userId: string;
  tier: string;
  accountType: UserProfile["accountType"];
  status: UserProfile["status"];
  features: {
    support: boolean;
    customScenarioBuilder: boolean;
  };
  limits: {
    dailySecondsLimit: number | null;
    orgDailySecondsQuota: number | null;
    perUserDailySecondsCap: number | null;
    orgMonthlySecondsAllotted: number | null;
    maxSimulationMinutes: number | null;
    manualBonusSeconds: number;
    billingIncrementSeconds: number;
  };
  usage: {
    rawSecondsToday: number;
    billedSecondsToday: number;
    rawSecondsThisMonth: number;
    billedSecondsThisMonth: number;
    dayKey: string;
    monthKey: string;
    dailySecondsRemaining: number | null;
    orgBillingPeriodStartAt: string | null;
    orgBillingPeriodEndAt: string | null;
    orgUsedSecondsThisPeriod: number | null;
    orgAllottedSecondsThisPeriod: number | null;
    orgRemainingSecondsThisPeriod: number | null;
    orgUsagePercentThisPeriod: number | null;
    userDailyCapSeconds: number | null;
    userDailyOverageAllowed: boolean;
    timezoneUsed: string;
    nextDailyResetLabel: string;
    nextRenewalAt: string;
  };
  canStartSimulation: boolean;
  lockReason: string | null;
};

type UsageWriteParitySnapshot = {
  recorded: boolean;
  storedRawDurationSeconds: number;
  billedSecondsAdded: number;
  beforeOrgUsedSecondsThisPeriod: number;
  afterOrgUsedSecondsThisPeriod: number;
  entitlements: EntitlementParitySnapshot;
};

type EntitlementParityState = {
  simulationAiBudgetGraceByUserId: Map<string, number>;
  simulationOrgMonthlyOverrunGraceByUserId: Map<string, number>;
};

const DEFAULT_MAX_SIMULATION_MINUTES = 20;
const MIN_MAX_SIMULATION_MINUTES = 1;
const MAX_MAX_SIMULATION_MINUTES = 240;
const SIMULATION_ORG_MONTHLY_OVERRUN_GRACE_MINUTES = 20;

const usageSessionAccess = createUsageSessionAccess();
const scoreRecordAccess = createScoreRecordAccess();
const simulationHistoryAccess = createSimulationHistoryAccess({
  usageSessionAccess,
  scoreRecordAccess
});

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createConfig(): AppConfig {
  return {
    activeSegmentId: "segment_1",
    defaultDifficulty: "medium",
    defaultPersonaStyle: "skeptical",
    industries: [
      { id: "industry_a", label: "Industry A", enabled: true },
      { id: "industry_b", label: "Industry B", enabled: true }
    ],
    roleIndustries: [
      { industryId: "industry_a", roleId: "segment_1", active: true },
      { industryId: "industry_b", roleId: "segment_2", active: true }
    ],
    segments: [
      {
        id: "segment_1",
        label: "Segment One",
        summary: "Segment One",
        enabled: true,
        scenarios: [
          { id: "scenario_1", segmentId: "segment_1", title: "Scenario One", description: "Scenario One", aiRole: "Buyer" },
          { id: "scenario_2", segmentId: "segment_1", title: "Scenario Two", description: "Scenario Two", aiRole: "Buyer" }
        ]
      },
      {
        id: "segment_2",
        label: "Segment Two",
        summary: "Segment Two",
        enabled: true,
        scenarios: [{ id: "scenario_4", segmentId: "segment_2", title: "Scenario Four", description: "Scenario Four", aiRole: "Buyer" }]
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
    emailVerifiedAt: overrides.emailVerifiedAt === undefined ? "2026-03-01T00:00:00.000Z" : overrides.emailVerifiedAt,
    isPlatformAdmin: overrides.isPlatformAdmin,
    isSuperUser: overrides.isSuperUser,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "free",
    status: overrides.status ?? "active",
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
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
    createdAt: overrides.createdAt ?? overrides.endedAt ?? "2026-03-31T10:05:00.000Z"
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
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes,
    rubricVersion: overrides.rubricVersion ?? "rubric_v1",
    model: overrides.model ?? "gpt-test",
    promptVersion: overrides.promptVersion ?? "prompt_v1",
    inputTokens: overrides.inputTokens ?? 50,
    outputTokens: overrides.outputTokens ?? 30,
    totalTokens: overrides.totalTokens ?? 80,
    createdAt: overrides.createdAt ?? overrides.endedAt ?? "2026-03-31T10:05:00.000Z"
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

function createRepresentativeDb(): UsageSessionReadinessDb {
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
      }),
      createUser({
        id: "super_1",
        email: "super@example.com",
        accountType: "enterprise",
        isSuperUser: true,
        orgId: null
      })
    ],
    usageSessions: [
      createSession({
        id: "sess_prev_short",
        rawDurationSeconds: 14,
        startedAt: "2026-03-31T09:59:00.000Z",
        endedAt: "2026-03-31T09:59:14.000Z",
        createdAt: "2026-03-31T09:59:14.000Z"
      }),
      createSession({
        id: "sess_exact",
        rawDurationSeconds: 305,
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z",
        createdAt: "2026-03-31T10:05:00.000Z"
      }),
      createSession({
        id: "sess_fuzzy",
        rawDurationSeconds: 470,
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:15.000Z",
        endedAt: "2026-03-31T11:05:08.000Z",
        createdAt: "2026-03-31T11:05:08.000Z"
      }),
      createSession({
        id: "sess_user2",
        userId: "user_2",
        segmentId: "segment_2",
        scenarioId: "scenario_4",
        rawDurationSeconds: 900,
        startedAt: "2026-03-31T08:00:00.000Z",
        endedAt: "2026-03-31T08:15:00.000Z",
        createdAt: "2026-03-31T08:15:00.000Z"
      }),
      createSession({
        id: "sess_other_org",
        userId: "user_3",
        orgId: "org_2",
        rawDurationSeconds: 120,
        startedAt: "2026-03-31T07:00:00.000Z",
        endedAt: "2026-03-31T07:02:00.000Z",
        createdAt: "2026-03-31T07:02:00.000Z"
      })
    ],
    scoreRecords: [
      createScore({
        id: "score_exact",
        trainingPackId: "pack_1",
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z"
      }),
      createScore({
        id: "score_fuzzy",
        trainingPackId: "pack_1",
        scenarioId: "scenario_2",
        startedAt: "2026-03-31T11:00:00.000Z",
        endedAt: "2026-03-31T11:05:00.000Z",
        overallScore: 92
      }),
      createScore({
        id: "score_user2",
        userId: "user_2",
        segmentId: "segment_2",
        scenarioId: "scenario_4",
        startedAt: "2026-03-31T08:00:00.000Z",
        endedAt: "2026-03-31T08:15:00.000Z",
        overallScore: 70
      })
    ]
  };
}

function createUsageSessionCutoverDb(legacyDb: UsageSessionReadinessDb): UsageSessionReadinessDb {
  let extractedUsageSessions = cloneJson(legacyDb.usageSessions).reverse();

  const cutoverDb = {
    config: cloneJson(legacyDb.config),
    orgs: cloneJson(legacyDb.orgs),
    users: cloneJson(legacyDb.users),
    scoreRecords: cloneJson(legacyDb.scoreRecords)
  } as UsageSessionReadinessDb;

  Object.defineProperty(cutoverDb, "usageSessions", {
    configurable: true,
    enumerable: true,
    get() {
      return extractedUsageSessions;
    },
    set(nextValue: UsageSessionRecord[]) {
      extractedUsageSessions = cloneJson(nextValue);
    }
  });

  return cutoverDb;
}

function createStoreBackedUsageSessionDb(
  legacyDb: UsageSessionReadinessDb,
  listRecords: () => UsageSessionRecord[]
): UsageSessionReadinessDb {
  const storeBackedDb = {
    config: cloneJson(legacyDb.config),
    orgs: cloneJson(legacyDb.orgs),
    users: cloneJson(legacyDb.users),
    scoreRecords: cloneJson(legacyDb.scoreRecords)
  } as UsageSessionReadinessDb;

  Object.defineProperty(storeBackedDb, "usageSessions", {
    configurable: true,
    enumerable: true,
    get() {
      return listRecords();
    },
    set(_nextValue: UsageSessionRecord[]) {
      throw new Error("Store-backed usageSessions view is read-only in readiness tests.");
    }
  });

  return storeBackedDb;
}

function clampNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseIsoDateOrNull(value: string | undefined | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

function resolveTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) {
    return "UTC";
  }

  return COMMON_TIMEZONES.includes(timeZone) ? timeZone : "UTC";
}

function materializeUserTimezone(user: UserProfile, now: Date): string {
  const pendingEffectiveAt = parseIsoDateOrNull(user.pendingTimezoneEffectiveAt);
  if (user.pendingTimezone && pendingEffectiveAt && pendingEffectiveAt.getTime() <= now.getTime()) {
    user.timezone = resolveTimeZone(user.pendingTimezone);
    user.pendingTimezone = null;
    user.pendingTimezoneEffectiveAt = null;
    user.updatedAt = now.toISOString();
  }

  user.timezone = resolveTimeZone(user.timezone);
  return user.timezone;
}

function deriveDefaultMonthlyMinutesAllotted(org: Pick<EnterpriseOrg, "dailySecondsQuota">): number {
  const dailyQuota = clampNonNegativeInteger(org.dailySecondsQuota, 8 * 60 * 60);
  return Math.max(0, Math.floor((dailyQuota * 30) / 60));
}

function normalizeMonthlyMinutesAllotted(value: unknown, fallbackMinutes: number): number {
  return clampNonNegativeInteger(value, clampNonNegativeInteger(fallbackMinutes, 0));
}

function normalizeMaxSimulationMinutes(value: unknown, fallbackMinutes = DEFAULT_MAX_SIMULATION_MINUTES): number {
  const fallback = clampNonNegativeInteger(fallbackMinutes, DEFAULT_MAX_SIMULATION_MINUTES);
  const parsed = clampNonNegativeInteger(value, fallback);
  return Math.max(MIN_MAX_SIMULATION_MINUTES, Math.min(MAX_MAX_SIMULATION_MINUTES, parsed));
}

function resolveOrgBillingAnchorAt(org: EnterpriseOrg, now: Date): string {
  if (isValidIsoDate(org.contractSignedAt)) {
    return new Date(org.contractSignedAt).toISOString();
  }
  if (isValidIsoDate(org.createdAt)) {
    return new Date(org.createdAt).toISOString();
  }
  return now.toISOString();
}

function resolveEffectiveOrgPerUserDailySecondsCap(org: EnterpriseOrg, now: Date): number {
  const pendingCap = clampNonNegativeInteger(org.pendingPerUserDailySecondsCap, -1);
  const pendingEffectiveAt = parseIsoDateOrNull(org.pendingPerUserDailySecondsCapEffectiveAt);
  if (pendingCap >= 0 && pendingEffectiveAt && pendingEffectiveAt.getTime() <= now.getTime()) {
    return pendingCap;
  }
  return clampNonNegativeInteger(org.perUserDailySecondsCap, 0);
}

function resolveUserDailyOverageAllowance(user: UserProfile, now: Date): { active: boolean; expiresAt: string | null } {
  if (!user.allowDailyOverageThisCycle) {
    return { active: false, expiresAt: null };
  }

  const expiresAt = parseIsoDateOrNull(user.dailyOverageExpiresAt);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    user.allowDailyOverageThisCycle = false;
    user.dailyOverageExpiresAt = null;
    return { active: false, expiresAt: null };
  }

  return { active: true, expiresAt: expiresAt.toISOString() };
}

function isSuperUser(user: UserProfile): boolean {
  return user.isSuperUser === true;
}

function getOrgById(db: UsageSessionReadinessDb, orgId: string | null | undefined): EnterpriseOrg | undefined {
  if (!orgId) {
    return undefined;
  }
  return db.orgs.find((org) => org.id === orgId);
}

function resolveTierDefinition(db: UsageSessionReadinessDb, tierId: string) {
  return getTierById(db.config.tiers, tierId as never) ?? DEFAULT_TIER_DEFINITIONS.find((tier) => tier.id === "free")!;
}

function createEntitlementParityState(): EntitlementParityState {
  return {
    simulationAiBudgetGraceByUserId: new Map(),
    simulationOrgMonthlyOverrunGraceByUserId: new Map()
  };
}

function cloneEntitlementParityState(state: EntitlementParityState): EntitlementParityState {
  return {
    simulationAiBudgetGraceByUserId: new Map(state.simulationAiBudgetGraceByUserId),
    simulationOrgMonthlyOverrunGraceByUserId: new Map(state.simulationOrgMonthlyOverrunGraceByUserId)
  };
}

function hasActiveSimulationAiBudgetGrace(
  state: EntitlementParityState,
  userId: string,
  nowMs = Date.now()
): boolean {
  const expiresAtMs = state.simulationAiBudgetGraceByUserId.get(userId);
  return typeof expiresAtMs === "number" && expiresAtMs > nowMs;
}

function clearSimulationOrgMonthlyOverrunGrace(state: EntitlementParityState, userId: string): void {
  state.simulationOrgMonthlyOverrunGraceByUserId.delete(userId);
}

function ensureSimulationOrgMonthlyOverrunGrace(
  state: EntitlementParityState,
  userId: string,
  nowMs = Date.now()
): number {
  const existing = state.simulationOrgMonthlyOverrunGraceByUserId.get(userId);
  if (typeof existing === "number") {
    return existing;
  }

  const expiresAtMs = nowMs + SIMULATION_ORG_MONTHLY_OVERRUN_GRACE_MINUTES * 60 * 1000;
  state.simulationOrgMonthlyOverrunGraceByUserId.set(userId, expiresAtMs);
  return expiresAtMs;
}

function buildOrgUsageSnapshotForParity(
  db: UsageSessionReadinessDb,
  org: EnterpriseOrg,
  now: Date
): ReturnType<typeof usageSessionAccess.buildOrgUsageSnapshot> {
  return usageSessionAccess.buildOrgUsageSnapshot(db, {
    orgId: org.id,
    billingAnchorAt: resolveOrgBillingAnchorAt(org, now),
    allottedMinutes: normalizeMonthlyMinutesAllotted(org.monthlyMinutesAllotted, deriveDefaultMonthlyMinutesAllotted(org)),
    now
  });
}

function buildEntitlementsParitySnapshot(params: {
  db: UsageSessionReadinessDb;
  userId: string;
  now: Date;
  actingOrgId?: string | null;
  allowDuringActiveSimulation?: boolean;
  state?: EntitlementParityState;
}): EntitlementParitySnapshot {
  const user = params.db.users.find((entry) => entry.id === params.userId);
  assert.ok(user, `Expected user ${params.userId} to exist.`);

  const state = params.state ?? createEntitlementParityState();
  const timezone = materializeUserTimezone(user, params.now);
  const tierDefinition = resolveTierDefinition(params.db, user.tier);
  const usage = usageSessionAccess.computeUserUsageSnapshot(params.db, {
    userId: user.id,
    now: params.now,
    timeZone: timezone
  });
  const org = getOrgById(params.db, isSuperUser(user) ? params.actingOrgId ?? null : user.orgId);

  let dailySecondsLimit: number | null = tierDefinition.dailySecondsLimit;
  let orgDailySecondsQuota: number | null = null;
  let perUserDailySecondsCap: number | null = null;
  let orgMonthlySecondsAllotted: number | null = null;
  let maxSimulationMinutes: number | null = null;
  let dailySecondsRemaining: number | null = null;
  let orgBillingPeriodStartAt: string | null = null;
  let orgBillingPeriodEndAt: string | null = null;
  let orgUsedSecondsThisPeriod: number | null = null;
  let orgAllottedSecondsThisPeriod: number | null = null;
  let orgRemainingSecondsThisPeriod: number | null = null;
  let orgUsagePercentThisPeriod: number | null = null;
  let userDailyOverageAllowed = false;
  let nextRenewalAt = computeNextRenewalAt(user.planAnchorAt, params.now);
  let lockReason: string | null = null;

  if (isSuperUser(user)) {
    dailySecondsLimit = null;
    if (!org) {
      lockReason = "Select an enterprise account environment.";
      dailySecondsRemaining = 0;
    } else {
      const orgUsage = buildOrgUsageSnapshotForParity(params.db, org, params.now);
      maxSimulationMinutes = normalizeMaxSimulationMinutes(org.maxSimulationMinutes);
      orgMonthlySecondsAllotted = orgUsage.allottedSeconds;
      orgBillingPeriodStartAt = orgUsage.periodStartAt;
      orgBillingPeriodEndAt = orgUsage.periodEndAt;
      orgUsedSecondsThisPeriod = 0;
      orgAllottedSecondsThisPeriod = orgUsage.allottedSeconds;
      orgRemainingSecondsThisPeriod = orgUsage.allottedSeconds;
      orgUsagePercentThisPeriod = 0;
      nextRenewalAt = orgUsage.nextRenewalAt;
      dailySecondsRemaining = null;
    }
  } else if (user.accountType === "enterprise") {
    if (!org || org.status !== "active") {
      dailySecondsLimit = null;
      lockReason = "Enterprise account is not currently active.";
      dailySecondsRemaining = 0;
      clearSimulationOrgMonthlyOverrunGrace(state, user.id);
    } else {
      orgDailySecondsQuota = org.dailySecondsQuota + org.manualBonusSeconds;
      const effectiveOrgPerUserDailySecondsCap = resolveEffectiveOrgPerUserDailySecondsCap(org, params.now);
      const userDailyCapBase =
        user.dailySecondsCapOverride !== null
          ? Math.min(
              clampNonNegativeInteger(user.dailySecondsCapOverride, effectiveOrgPerUserDailySecondsCap),
              effectiveOrgPerUserDailySecondsCap
            )
          : effectiveOrgPerUserDailySecondsCap;
      perUserDailySecondsCap = Math.max(0, userDailyCapBase + user.manualBonusSeconds);
      maxSimulationMinutes = normalizeMaxSimulationMinutes(org.maxSimulationMinutes);
      const orgUsage = buildOrgUsageSnapshotForParity(params.db, org, params.now);
      orgMonthlySecondsAllotted = orgUsage.allottedSeconds;
      orgBillingPeriodStartAt = orgUsage.periodStartAt;
      orgBillingPeriodEndAt = orgUsage.periodEndAt;
      orgUsedSecondsThisPeriod = orgUsage.usedSeconds;
      orgAllottedSecondsThisPeriod = orgUsage.allottedSeconds;
      orgRemainingSecondsThisPeriod = Math.max(0, orgUsage.allottedSeconds - orgUsage.usedSeconds);
      orgUsagePercentThisPeriod = orgUsage.allottedSeconds > 0 ? (orgUsage.usedSeconds / orgUsage.allottedSeconds) * 100 : 0;
      nextRenewalAt = orgUsage.nextRenewalAt;

      const dailyOverageAllowance = resolveUserDailyOverageAllowance(user, params.now);
      userDailyOverageAllowed = dailyOverageAllowance.active;
      const userDailyLockReason = "User daily time allotment reached.";
      const orgMonthlyLockReason = "Organization monthly allotment reached.";
      let userDailyCapExceeded = false;

      if (!userDailyOverageAllowed) {
        const perUserRemaining = Math.max(0, (perUserDailySecondsCap ?? 0) - usage.billedSecondsToday);
        dailySecondsRemaining = perUserRemaining;
        if (perUserRemaining <= 0) {
          userDailyCapExceeded = true;
        }
      } else {
        dailySecondsRemaining = null;
      }

      const orgMonthlyCapExceeded = (orgRemainingSecondsThisPeriod ?? 0) <= 0;
      if (userDailyCapExceeded || orgMonthlyCapExceeded) {
        const quotaLockReason = orgMonthlyCapExceeded ? orgMonthlyLockReason : userDailyLockReason;
        const nowMs = params.now.getTime();
        const allowGrace =
          params.allowDuringActiveSimulation === true && hasActiveSimulationAiBudgetGrace(state, user.id, nowMs);
        if (allowGrace) {
          const graceExpiresAtMs = ensureSimulationOrgMonthlyOverrunGrace(state, user.id, nowMs);
          if (graceExpiresAtMs <= nowMs) {
            lockReason = quotaLockReason;
          }
        } else {
          clearSimulationOrgMonthlyOverrunGrace(state, user.id);
          lockReason = quotaLockReason;
        }
      } else {
        clearSimulationOrgMonthlyOverrunGrace(state, user.id);
      }
    }
  } else if (dailySecondsLimit !== null) {
    dailySecondsLimit += user.manualBonusSeconds;
    dailySecondsRemaining = Math.max(0, dailySecondsLimit - usage.billedSecondsToday);
    if (dailySecondsRemaining <= 0) {
      lockReason = "Daily plan limit reached.";
    }
  }

  if (!user.emailVerifiedAt) {
    lockReason = "Email verification required.";
    dailySecondsRemaining = 0;
    clearSimulationOrgMonthlyOverrunGrace(state, user.id);
  }

  if (user.status !== "active") {
    lockReason = "User account is disabled.";
    dailySecondsRemaining = 0;
    clearSimulationOrgMonthlyOverrunGrace(state, user.id);
  }

  return {
    userId: user.id,
    tier: user.tier,
    accountType: user.accountType,
    status: user.status,
    features: {
      support: isSuperUser(user) || tierDefinition.supportIncluded || user.accountType === "enterprise",
      customScenarioBuilder:
        isSuperUser(user) || (params.db.config.featureFlags.customScenarioBuilder && tierDefinition.canCreateCustomScenarios)
    },
    limits: {
      dailySecondsLimit,
      orgDailySecondsQuota,
      perUserDailySecondsCap,
      orgMonthlySecondsAllotted,
      maxSimulationMinutes,
      manualBonusSeconds: user.manualBonusSeconds,
      billingIncrementSeconds: USAGE_BILLING_INCREMENT_SECONDS
    },
    usage: {
      ...usage,
      dailySecondsRemaining,
      orgBillingPeriodStartAt,
      orgBillingPeriodEndAt,
      orgUsedSecondsThisPeriod,
      orgAllottedSecondsThisPeriod,
      orgRemainingSecondsThisPeriod,
      orgUsagePercentThisPeriod,
      userDailyCapSeconds: perUserDailySecondsCap,
      userDailyOverageAllowed,
      timezoneUsed: timezone,
      nextDailyResetLabel: humanDailyResetLabel(timezone),
      nextRenewalAt
    },
    canStartSimulation: user.status === "active" && !lockReason,
    lockReason
  };
}

function buildUsageSessionWriteRouteParitySnapshot(params: {
  db: UsageSessionReadinessDb;
  userId: string;
  orgId: string | null;
  now: Date;
  session: UsageSessionRecord;
  actingOrgId?: string | null;
  isSuperUser?: boolean;
  state?: EntitlementParityState;
}): UsageWriteParitySnapshot {
  const state = params.state ?? createEntitlementParityState();
  const before = buildEntitlementsParitySnapshot({
    db: params.db,
    userId: params.userId,
    now: params.now,
    actingOrgId: params.actingOrgId,
    state
  });
  const org = params.orgId ? getOrgById(params.db, params.orgId) ?? null : null;
  const beforeOrgUsage = org ? buildOrgUsageSnapshotForParity(params.db, org, params.now) : null;

  let rawDurationSeconds = clampNonNegativeInteger(params.session.rawDurationSeconds, 0);
  const maxSimulationMinutes = before.limits.maxSimulationMinutes;
  if (maxSimulationMinutes !== null) {
    rawDurationSeconds = Math.min(rawDurationSeconds, maxSimulationMinutes * 60);
  }

  const storedSession = {
    ...params.session,
    orgId: params.orgId,
    rawDurationSeconds
  };

  if (!params.isSuperUser) {
    usageSessionAccess.append(params.db, storedSession);
  }
  clearSimulationOrgMonthlyOverrunGrace(state, params.userId);

  const after = buildEntitlementsParitySnapshot({
    db: params.db,
    userId: params.userId,
    now: params.now,
    actingOrgId: params.actingOrgId,
    state
  });
  const afterOrgUsage = org ? buildOrgUsageSnapshotForParity(params.db, org, params.now) : null;

  return {
    recorded: !params.isSuperUser,
    storedRawDurationSeconds: rawDurationSeconds,
    billedSecondsAdded: Math.max(0, after.usage.billedSecondsToday - before.usage.billedSecondsToday),
    beforeOrgUsedSecondsThisPeriod: beforeOrgUsage?.usedSeconds ?? 0,
    afterOrgUsedSecondsThisPeriod: afterOrgUsage?.usedSeconds ?? 0,
    entitlements: after
  };
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > bestMs) {
      bestMs = parsed;
      best = new Date(parsed).toISOString();
    }
  }
  return best;
}

function roundMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

function buildAdminOrgUsageParitySnapshot(db: UsageSessionReadinessDb, orgId: string) {
  const org = getOrgById(db, orgId);
  assert.ok(org, `Expected org ${orgId} to exist.`);
  const now = new Date("2026-03-31T20:00:00.000Z");
  const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(org, now), now);
  const periodStartMs = new Date(billing.periodStartAt).getTime();
  const periodEndMs = new Date(billing.periodEndAt).getTime();
  const usageSnapshot = buildOrgUsageSnapshotForParity(db, org, now);
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
          rawSecondsThisPeriod: sumRawSeconds(sessionsInPeriod),
          billedSecondsThisPeriod: usageSessionAccess.sumBilledSeconds(sessionsInPeriod)
        };
      })
      .sort((left, right) => left.userId.localeCompare(right.userId))
  };
}

function buildMobileOrgDashboardUsageParitySnapshot(db: UsageSessionReadinessDb, orgId: string) {
  const org = getOrgById(db, orgId);
  assert.ok(org, `Expected org ${orgId} to exist.`);
  const now = new Date("2026-03-31T20:00:00.000Z");
  const usage = buildOrgUsageSnapshotForParity(db, org, now);
  const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(org, now), now);
  const daysInPeriod = Math.max(
    1,
    Math.round((new Date(billing.periodEndAt).getTime() - new Date(billing.periodStartAt).getTime()) / (24 * 60 * 60 * 1000))
  );
  const effectivePerUserDailyCapSeconds = resolveEffectiveOrgPerUserDailySecondsCap(org, now);
  const activeUserCount = db.users.filter(
    (user) => user.accountType === "enterprise" && user.orgId === org.id && user.status === "active"
  ).length;
  const projectedAllocatedUserSecondsThisPeriod = activeUserCount * effectivePerUserDailyCapSeconds * daysInPeriod;

  return {
    usage: {
      monthlyAllottedSeconds: usage.allottedSeconds,
      billedSecondsThisPeriod: usage.usedSeconds,
      remainingSecondsThisPeriod: Math.max(0, usage.allottedSeconds - usage.usedSeconds),
      usagePercentThisPeriod: usage.usagePercent,
      perUserDailyCapSeconds: effectivePerUserDailyCapSeconds,
      activeUserCount,
      projectedAllocatedUserSecondsThisPeriod,
      projectedAllocatedUtilizationPercent:
        usage.allottedSeconds > 0 ? (projectedAllocatedUserSecondsThisPeriod / usage.allottedSeconds) * 100 : 0
    }
  };
}

function buildDashboardCustomerSummaryUsageSnapshot(db: UsageSessionReadinessDb, orgId: string) {
  const org = getOrgById(db, orgId);
  assert.ok(org, `Expected org ${orgId} to exist.`);
  const now = new Date("2026-03-31T20:00:00.000Z");
  const last30DaysThreshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const usage = buildOrgUsageSnapshotForParity(db, org, now);
  const sessions = usageSessionAccess.listByOrgRange(db, {
    orgId,
    startedAtFrom: new Date(last30DaysThreshold)
  });
  const scores = scoreRecordAccess.listByOrgRange(db, { orgId });

  return {
    simulationsLast30Days: sessions.length,
    usedMinutesThisPeriod: Math.round(usage.usedSeconds / 60),
    latestActivityAt: maxIsoDate([
      ...usageSessionAccess.listByOrgRange(db, { orgId }).map((session) => session.endedAt),
      ...scores.map((record) => record.endedAt)
    ])
  };
}

function buildDashboardCustomerTrendUsageSnapshot(db: UsageSessionReadinessDb, orgId: string, now: Date) {
  const points: Array<{ label: string; usageMinutes: number; simulations: number }> = [];

  for (let offset = 2; offset >= 0; offset -= 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    const sessions = usageSessionAccess.listByOrgRange(db, {
      orgId,
      startedAtFrom: monthStart,
      startedAtBefore: monthEnd
    });
    const billedSeconds = sessions.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );

    points.push({
      label: monthStart.toLocaleDateString("en-US", { month: "short" }),
      usageMinutes: roundMinutes(billedSeconds),
      simulations: sessions.length
    });
  }

  return points;
}

function buildDashboardCustomerUserRowsUsageSnapshot(db: UsageSessionReadinessDb, orgId: string, now: Date) {
  const last30DaysThreshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const sessions = usageSessionAccess.listByOrgRange(db, {
    orgId,
    startedAtFrom: new Date(last30DaysThreshold),
    startedAtBefore: now
  });
  const scores = scoreRecordAccess.listByOrgRange(db, {
    orgId,
    endedAtFrom: new Date(last30DaysThreshold),
    endedAtBefore: now
  });

  return db.users
    .filter((user) => user.accountType === "enterprise" && user.orgId === orgId)
    .sort((left, right) => left.email.localeCompare(right.email))
    .map((user) => {
      const userSessions = sessions.filter((session) => session.userId === user.id);
      const userScores = scores.filter((record) => record.userId === user.id);
      const billedSeconds = userSessions.reduce(
        (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
        0
      );
      const latestSession = userSessions
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];
      const latestScore = userScores
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];

      return {
        userId: user.id,
        simulationsLast30Days: userSessions.length,
        usedMinutesLast30Days: roundMinutes(billedSeconds),
        latestActivityAt: maxIsoDate([latestSession?.endedAt ?? null, latestScore?.endedAt ?? null])
      };
    });
}

function buildTrainingProgressUsageParitySnapshot(
  db: UsageSessionReadinessDb,
  assignment: TrainingPackAssignmentRecord
) {
  const scenarioCatalog = new Map([
    ["scenario_1", { title: "Scenario One" }],
    ["scenario_2", { title: "Scenario Two" }]
  ]);
  const user = db.users.find((entry) => entry.id === assignment.userId);
  const sessions = usageSessionAccess.listByUserRange(db, {
    userId: assignment.userId,
    trainingPackId: assignment.trainingPackId
  });
  const scores = scoreRecordAccess.listByUserRange(db, {
    userId: assignment.userId,
    trainingPackId: assignment.trainingPackId
  });
  const progress = simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment,
    user: user ? { email: user.email, status: user.status } : null,
    scenarioCatalog,
    allSessions: sessions,
    allScores: scores,
    recentSessions: sessions,
    recentScores: scores
  });

  return {
    status: progress.status,
    startedAt: progress.startedAt,
    attemptsLast30Days: progress.attemptsLast30Days,
    latestActivityAt: progress.latestActivityAt,
    latestScenarioTitle: progress.latestScenarioTitle
  };
}

function buildContentDeleteSafetyParitySnapshot(db: UsageSessionReadinessDb) {
  const cutoff = new Date("2026-03-31T00:00:00.000Z");
  const current = cloneJson(db.config);
  const removedRoleIds = new Set(["segment_1"]);
  const removedScenarioIds = new Set(["scenario_4"]);
  const removedIndustryIds = new Set(["industry_a"]);
  const currentRoleByIndustry = new Map<string, Set<string>>();
  for (const mapping of current.roleIndustries ?? []) {
    const roleIds = currentRoleByIndustry.get(mapping.industryId) ?? new Set<string>();
    roleIds.add(mapping.roleId);
    currentRoleByIndustry.set(mapping.industryId, roleIds);
  }

  const recentUsageHits = new Set<string>();
  const recentScoreHits = new Set<string>();
  const allRecords = [
    ...usageSessionAccess.listRecentActivityReferences(db, { since: cutoff }),
    ...scoreRecordAccess.listRecentActivityReferences(db, { since: cutoff })
  ];

  for (const row of allRecords) {
    const endedAtMs = new Date(row.endedAt).getTime();
    if (!Number.isFinite(endedAtMs) || endedAtMs < cutoff.getTime()) {
      continue;
    }
    if (removedRoleIds.has(row.segmentId)) {
      recentUsageHits.add(row.segmentId);
    }
    if (removedScenarioIds.has(row.scenarioId)) {
      recentScoreHits.add(row.scenarioId);
    }
    for (const industryId of removedIndustryIds) {
      const roleIds = currentRoleByIndustry.get(industryId);
      if (roleIds && roleIds.has(row.segmentId)) {
        recentUsageHits.add(industryId);
      }
    }
  }

  return {
    roles: Array.from(removedRoleIds).filter((id) => recentUsageHits.has(id)).sort(),
    scenarios: Array.from(removedScenarioIds).filter((id) => recentScoreHits.has(id)).sort(),
    industries: Array.from(removedIndustryIds).filter((id) => recentUsageHits.has(id)).sort()
  };
}

function buildUsageOutputsReadinessSnapshot(db: UsageSessionReadinessDb) {
  const now = new Date("2026-03-31T20:00:00.000Z");
  return {
    adminOrgUsage: buildAdminOrgUsageParitySnapshot(db, "org_1"),
    mobileOrgDashboard: buildMobileOrgDashboardUsageParitySnapshot(db, "org_1"),
    dashboardCustomerSummary: buildDashboardCustomerSummaryUsageSnapshot(db, "org_1"),
    dashboardCustomerTrend: buildDashboardCustomerTrendUsageSnapshot(db, "org_1", now),
    dashboardCustomerUsers: buildDashboardCustomerUserRowsUsageSnapshot(db, "org_1", now),
    trainingProgress: buildTrainingProgressUsageParitySnapshot(
      db,
      createAssignment({
        id: "assignment_usage",
        trainingPackId: "pack_1",
        userId: "user_1",
        assignedAt: "2026-03-30T00:00:00.000Z"
      })
    ),
    contentDelete: buildContentDeleteSafetyParitySnapshot(db)
  };
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

test("usageSessions readiness preserves full usage write parity across rounding, clamp, midnight, month, and billing-cycle edge cases", () => {
  const cases: Array<{
    name: string;
    createDb: () => UsageSessionReadinessDb;
    session: UsageSessionRecord;
    now: Date;
    expected: Omit<UsageWriteParitySnapshot, "entitlements"> & {
      entitlements: Pick<
        EntitlementParitySnapshot,
        "canStartSimulation" | "lockReason"
      > & {
        usage: Pick<
          EntitlementParitySnapshot["usage"],
          | "rawSecondsToday"
          | "billedSecondsToday"
          | "rawSecondsThisMonth"
          | "billedSecondsThisMonth"
          | "orgUsedSecondsThisPeriod"
          | "orgRemainingSecondsThisPeriod"
        >;
      };
    };
  }> = [
    {
      name: "aggregate short-session rounding diverges from org period billing exactly as today",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser()],
        usageSessions: [
          createSession({
            id: "sess_existing_short",
            rawDurationSeconds: 14,
            startedAt: "2026-03-31T09:59:00.000Z",
            endedAt: "2026-03-31T09:59:14.000Z",
            createdAt: "2026-03-31T09:59:14.000Z"
          })
        ],
        scoreRecords: []
      }),
      session: createSession({
        id: "sess_new_short",
        rawDurationSeconds: 14,
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:00:14.000Z",
        createdAt: "2026-03-31T10:00:14.000Z"
      }),
      now: new Date("2026-03-31T10:01:00.000Z"),
      expected: {
        recorded: true,
        storedRawDurationSeconds: 14,
        billedSecondsAdded: 15,
        beforeOrgUsedSecondsThisPeriod: 0,
        afterOrgUsedSecondsThisPeriod: 0,
        entitlements: {
          canStartSimulation: true,
          lockReason: null,
          usage: {
            rawSecondsToday: 28,
            billedSecondsToday: 15,
            rawSecondsThisMonth: 28,
            billedSecondsThisMonth: 15,
            orgUsedSecondsThisPeriod: 0,
            orgRemainingSecondsThisPeriod: 7200
          }
        }
      }
    },
    {
      name: "midnight-crossing session is billed into the new day using endedAt semantics",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser()],
        usageSessions: [],
        scoreRecords: []
      }),
      session: createSession({
        id: "sess_midnight",
        rawDurationSeconds: 20,
        startedAt: "2026-03-31T23:59:50.000Z",
        endedAt: "2026-04-01T00:00:10.000Z",
        createdAt: "2026-04-01T00:00:10.000Z"
      }),
      now: new Date("2026-04-01T00:01:00.000Z"),
      expected: {
        recorded: true,
        storedRawDurationSeconds: 20,
        billedSecondsAdded: 15,
        beforeOrgUsedSecondsThisPeriod: 0,
        afterOrgUsedSecondsThisPeriod: 15,
        entitlements: {
          canStartSimulation: true,
          lockReason: null,
          usage: {
            rawSecondsToday: 20,
            billedSecondsToday: 15,
            rawSecondsThisMonth: 20,
            billedSecondsThisMonth: 15,
            orgUsedSecondsThisPeriod: 15,
            orgRemainingSecondsThisPeriod: 7185
          }
        }
      }
    },
    {
      name: "month-boundary session lands in the new user month because month grouping uses endedAt",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser()],
        usageSessions: [
          createSession({
            id: "sess_march",
            rawDurationSeconds: 120,
            startedAt: "2026-03-31T22:00:00.000Z",
            endedAt: "2026-03-31T22:02:00.000Z",
            createdAt: "2026-03-31T22:02:00.000Z"
          })
        ],
        scoreRecords: []
      }),
      session: createSession({
        id: "sess_april_cross",
        rawDurationSeconds: 30,
        startedAt: "2026-03-31T23:59:50.000Z",
        endedAt: "2026-04-01T00:00:20.000Z",
        createdAt: "2026-04-01T00:00:20.000Z"
      }),
      now: new Date("2026-04-01T00:01:00.000Z"),
      expected: {
        recorded: true,
        storedRawDurationSeconds: 30,
        billedSecondsAdded: 30,
        beforeOrgUsedSecondsThisPeriod: 120,
        afterOrgUsedSecondsThisPeriod: 150,
        entitlements: {
          canStartSimulation: true,
          lockReason: null,
          usage: {
            rawSecondsToday: 30,
            billedSecondsToday: 30,
            rawSecondsThisMonth: 30,
            billedSecondsThisMonth: 30,
            orgUsedSecondsThisPeriod: 150,
            orgRemainingSecondsThisPeriod: 7050
          }
        }
      }
    },
    {
      name: "billing-cycle boundary session does not count in the new org cycle when startedAt precedes the anchor",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ contractSignedAt: "2026-03-16T00:00:00.000Z" })],
        users: [createUser()],
        usageSessions: [],
        scoreRecords: []
      }),
      session: createSession({
        id: "sess_cycle_boundary",
        rawDurationSeconds: 30,
        startedAt: "2026-04-15T23:59:50.000Z",
        endedAt: "2026-04-16T00:00:20.000Z",
        createdAt: "2026-04-16T00:00:20.000Z"
      }),
      now: new Date("2026-04-16T00:01:00.000Z"),
      expected: {
        recorded: true,
        storedRawDurationSeconds: 30,
        billedSecondsAdded: 30,
        beforeOrgUsedSecondsThisPeriod: 0,
        afterOrgUsedSecondsThisPeriod: 0,
        entitlements: {
          canStartSimulation: true,
          lockReason: null,
          usage: {
            rawSecondsToday: 30,
            billedSecondsToday: 30,
            rawSecondsThisMonth: 30,
            billedSecondsThisMonth: 30,
            orgUsedSecondsThisPeriod: 0,
            orgRemainingSecondsThisPeriod: 7200
          }
        }
      }
    },
    {
      name: "maxSimulationMinutes clamp is preserved exactly on write",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ maxSimulationMinutes: 1 })],
        users: [createUser()],
        usageSessions: [],
        scoreRecords: []
      }),
      session: createSession({
        id: "sess_clamped",
        rawDurationSeconds: 125,
        startedAt: "2026-03-31T12:00:00.000Z",
        endedAt: "2026-03-31T12:02:05.000Z",
        createdAt: "2026-03-31T12:02:05.000Z"
      }),
      now: new Date("2026-03-31T12:03:00.000Z"),
      expected: {
        recorded: true,
        storedRawDurationSeconds: 60,
        billedSecondsAdded: 60,
        beforeOrgUsedSecondsThisPeriod: 0,
        afterOrgUsedSecondsThisPeriod: 60,
        entitlements: {
          canStartSimulation: true,
          lockReason: null,
          usage: {
            rawSecondsToday: 60,
            billedSecondsToday: 60,
            rawSecondsThisMonth: 60,
            billedSecondsThisMonth: 60,
            orgUsedSecondsThisPeriod: 60,
            orgRemainingSecondsThisPeriod: 7140
          }
        }
      }
    }
  ];

  for (const testCase of cases) {
    const legacyDb = testCase.createDb();
    const cutoverDb = createUsageSessionCutoverDb(testCase.createDb());

    const legacySnapshot = buildUsageSessionWriteRouteParitySnapshot({
      db: legacyDb,
      userId: "user_1",
      orgId: "org_1",
      now: testCase.now,
      session: cloneJson(testCase.session),
      state: createEntitlementParityState()
    });
    const cutoverSnapshot = buildUsageSessionWriteRouteParitySnapshot({
      db: cutoverDb,
      userId: "user_1",
      orgId: "org_1",
      now: testCase.now,
      session: cloneJson(testCase.session),
      state: createEntitlementParityState()
    });

    assert.deepEqual(cutoverSnapshot, legacySnapshot, testCase.name);
    assert.deepEqual(
      {
        recorded: legacySnapshot.recorded,
        storedRawDurationSeconds: legacySnapshot.storedRawDurationSeconds,
        billedSecondsAdded: legacySnapshot.billedSecondsAdded,
        beforeOrgUsedSecondsThisPeriod: legacySnapshot.beforeOrgUsedSecondsThisPeriod,
        afterOrgUsedSecondsThisPeriod: legacySnapshot.afterOrgUsedSecondsThisPeriod,
        entitlements: {
          canStartSimulation: legacySnapshot.entitlements.canStartSimulation,
          lockReason: legacySnapshot.entitlements.lockReason,
          usage: {
            rawSecondsToday: legacySnapshot.entitlements.usage.rawSecondsToday,
            billedSecondsToday: legacySnapshot.entitlements.usage.billedSecondsToday,
            rawSecondsThisMonth: legacySnapshot.entitlements.usage.rawSecondsThisMonth,
            billedSecondsThisMonth: legacySnapshot.entitlements.usage.billedSecondsThisMonth,
            orgUsedSecondsThisPeriod: legacySnapshot.entitlements.usage.orgUsedSecondsThisPeriod,
            orgRemainingSecondsThisPeriod: legacySnapshot.entitlements.usage.orgRemainingSecondsThisPeriod
          }
        }
      },
      testCase.expected,
      testCase.name
    );
  }
});

test("usageSessions readiness preserves full entitlement outcomes across enterprise, super-user, lock, and grace scenarios", () => {
  type EntitlementScenarioExpectation = {
    canStartSimulation: boolean;
    lockReason: string | null;
    usage: Partial<
      Pick<
        EntitlementParitySnapshot["usage"],
        | "billedSecondsToday"
        | "dailySecondsRemaining"
        | "orgUsedSecondsThisPeriod"
        | "orgRemainingSecondsThisPeriod"
        | "userDailyOverageAllowed"
      >
    >;
    limits?: Partial<
      Pick<
        EntitlementParitySnapshot["limits"],
        "dailySecondsLimit" | "orgMonthlySecondsAllotted" | "perUserDailySecondsCap" | "maxSimulationMinutes"
      >
    >;
  };

  const scenarios: Array<{
    name: string;
    createDb: () => UsageSessionReadinessDb;
    userId: string;
    now: Date;
    actingOrgId?: string | null;
    allowDuringActiveSimulation?: boolean;
    seedState?: (state: EntitlementParityState) => void;
    expected: EntitlementScenarioExpectation;
  }> = [
    {
      name: "enterprise active org stays unlocked under current limits",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser()],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: true,
        lockReason: null,
        usage: {
          billedSecondsToday: 300,
          dailySecondsRemaining: 600,
          orgUsedSecondsThisPeriod: 300,
          orgRemainingSecondsThisPeriod: 6900
        },
        limits: {
          maxSimulationMinutes: 60,
          perUserDailySecondsCap: 900
        }
      }
    },
    {
      name: "inactive org locks enterprise user",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ status: "disabled" })],
        users: [createUser()],
        usageSessions: [],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "Enterprise account is not currently active.",
        usage: {
          dailySecondsRemaining: 0,
          orgUsedSecondsThisPeriod: null
        }
      }
    },
    {
      name: "per-user daily cap exhaustion locks the user",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ perUserDailySecondsCap: 300 })],
        users: [createUser()],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "User daily time allotment reached.",
        usage: {
          billedSecondsToday: 300,
          dailySecondsRemaining: 0
        }
      }
    },
    {
      name: "daily overage keeps the user unlocked even when the cap is exhausted",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ perUserDailySecondsCap: 300 })],
        users: [
          createUser({
            allowDailyOverageThisCycle: true,
            dailyOverageExpiresAt: "2026-04-01T00:00:00.000Z"
          })
        ],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: true,
        lockReason: null,
        usage: {
          billedSecondsToday: 300,
          dailySecondsRemaining: null,
          userDailyOverageAllowed: true
        }
      }
    },
    {
      name: "org monthly allotment exhaustion locks the user",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ monthlyMinutesAllotted: 5, perUserDailySecondsCap: 3600 })],
        users: [createUser()],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "Organization monthly allotment reached.",
        usage: {
          orgUsedSecondsThisPeriod: 300,
          orgRemainingSecondsThisPeriod: 0
        }
      }
    },
    {
      name: "org monthly overrun grace preserves access during active simulation when AI grace is active",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg({ monthlyMinutesAllotted: 5, perUserDailySecondsCap: 3600 })],
        users: [createUser()],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      allowDuringActiveSimulation: true,
      seedState: (state) => {
        state.simulationAiBudgetGraceByUserId.set("user_1", new Date("2026-03-31T20:20:00.000Z").getTime());
      },
      expected: {
        canStartSimulation: true,
        lockReason: null,
        usage: {
          orgUsedSecondsThisPeriod: 300,
          orgRemainingSecondsThisPeriod: 0
        }
      }
    },
    {
      name: "email verification requirement overrides quota state",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser({ emailVerifiedAt: null })],
        usageSessions: [],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "Email verification required.",
        usage: {
          dailySecondsRemaining: 0
        }
      }
    },
    {
      name: "disabled user remains locked",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser({ status: "disabled" })],
        usageSessions: [],
        scoreRecords: []
      }),
      userId: "user_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "User account is disabled.",
        usage: {
          dailySecondsRemaining: 0
        }
      }
    },
    {
      name: "super-user without acting org is locked",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser({ id: "super_1", isSuperUser: true, orgId: null })],
        usageSessions: [],
        scoreRecords: []
      }),
      userId: "super_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: false,
        lockReason: "Select an enterprise account environment.",
        usage: {
          dailySecondsRemaining: 0
        },
        limits: {
          dailySecondsLimit: null
        }
      }
    },
    {
      name: "super-user with acting org keeps access and reports zeroed org usage consumption",
      createDb: () => ({
        config: createConfig(),
        orgs: [createOrg()],
        users: [createUser({ id: "super_1", isSuperUser: true, orgId: null })],
        usageSessions: [createSession({ rawDurationSeconds: 305 })],
        scoreRecords: []
      }),
      userId: "super_1",
      actingOrgId: "org_1",
      now: new Date("2026-03-31T20:00:00.000Z"),
      expected: {
        canStartSimulation: true,
        lockReason: null,
        usage: {
          orgUsedSecondsThisPeriod: 0,
          orgRemainingSecondsThisPeriod: 7200
        },
        limits: {
          dailySecondsLimit: null,
          orgMonthlySecondsAllotted: 7200
        }
      }
    }
  ];

  for (const scenario of scenarios) {
    const legacyDb = scenario.createDb();
    const cutoverDb = createUsageSessionCutoverDb(scenario.createDb());
    const baseState = createEntitlementParityState();
    scenario.seedState?.(baseState);

    const legacy = buildEntitlementsParitySnapshot({
      db: legacyDb,
      userId: scenario.userId,
      now: scenario.now,
      actingOrgId: scenario.actingOrgId,
      allowDuringActiveSimulation: scenario.allowDuringActiveSimulation,
      state: cloneEntitlementParityState(baseState)
    });
    const cutover = buildEntitlementsParitySnapshot({
      db: cutoverDb,
      userId: scenario.userId,
      now: scenario.now,
      actingOrgId: scenario.actingOrgId,
      allowDuringActiveSimulation: scenario.allowDuringActiveSimulation,
      state: cloneEntitlementParityState(baseState)
    });

    assert.deepEqual(cutover, legacy, scenario.name);
    const expectedUsage = {
      billedSecondsToday: hasOwn(scenario.expected.usage, "billedSecondsToday")
        ? scenario.expected.usage.billedSecondsToday
        : legacy.usage.billedSecondsToday,
      dailySecondsRemaining: hasOwn(scenario.expected.usage, "dailySecondsRemaining")
        ? scenario.expected.usage.dailySecondsRemaining
        : legacy.usage.dailySecondsRemaining,
      orgUsedSecondsThisPeriod: hasOwn(scenario.expected.usage, "orgUsedSecondsThisPeriod")
        ? scenario.expected.usage.orgUsedSecondsThisPeriod
        : legacy.usage.orgUsedSecondsThisPeriod,
      orgRemainingSecondsThisPeriod: hasOwn(scenario.expected.usage, "orgRemainingSecondsThisPeriod")
        ? scenario.expected.usage.orgRemainingSecondsThisPeriod
        : legacy.usage.orgRemainingSecondsThisPeriod,
      userDailyOverageAllowed: hasOwn(scenario.expected.usage, "userDailyOverageAllowed")
        ? scenario.expected.usage.userDailyOverageAllowed
        : legacy.usage.userDailyOverageAllowed
    };
    const expectedLimits = {
      dailySecondsLimit:
        scenario.expected.limits && hasOwn(scenario.expected.limits, "dailySecondsLimit")
          ? scenario.expected.limits.dailySecondsLimit
          : legacy.limits.dailySecondsLimit,
      orgMonthlySecondsAllotted:
        scenario.expected.limits && hasOwn(scenario.expected.limits, "orgMonthlySecondsAllotted")
          ? scenario.expected.limits.orgMonthlySecondsAllotted
          : legacy.limits.orgMonthlySecondsAllotted,
      perUserDailySecondsCap:
        scenario.expected.limits && hasOwn(scenario.expected.limits, "perUserDailySecondsCap")
          ? scenario.expected.limits.perUserDailySecondsCap
          : legacy.limits.perUserDailySecondsCap,
      maxSimulationMinutes:
        scenario.expected.limits && hasOwn(scenario.expected.limits, "maxSimulationMinutes")
          ? scenario.expected.limits.maxSimulationMinutes
          : legacy.limits.maxSimulationMinutes
    };
    assert.deepEqual(
      {
        canStartSimulation: legacy.canStartSimulation,
        lockReason: legacy.lockReason,
        usage: {
          billedSecondsToday: legacy.usage.billedSecondsToday,
          dailySecondsRemaining: legacy.usage.dailySecondsRemaining,
          orgUsedSecondsThisPeriod: legacy.usage.orgUsedSecondsThisPeriod,
          orgRemainingSecondsThisPeriod: legacy.usage.orgRemainingSecondsThisPeriod,
          userDailyOverageAllowed: legacy.usage.userDailyOverageAllowed
        },
        limits: {
          dailySecondsLimit: legacy.limits.dailySecondsLimit,
          orgMonthlySecondsAllotted: legacy.limits.orgMonthlySecondsAllotted,
          perUserDailySecondsCap: legacy.limits.perUserDailySecondsCap,
          maxSimulationMinutes: legacy.limits.maxSimulationMinutes
        }
      },
      {
        canStartSimulation: scenario.expected.canStartSimulation,
        lockReason: scenario.expected.lockReason,
        usage: expectedUsage,
        limits: expectedLimits
      },
      scenario.name
    );
  }
});

test("usageSessions readiness preserves admin, dashboard, mobile, training-progress, and content-safety outputs through extracted-like cutover", () => {
  const legacyDb = createRepresentativeDb();
  const cutoverDb = createUsageSessionCutoverDb(createRepresentativeDb());

  assert.deepEqual(buildUsageOutputsReadinessSnapshot(cutoverDb), buildUsageOutputsReadinessSnapshot(legacyDb));
});

test("usageSessions extraction preserves billing, entitlement, retry, and downstream output parity through the real store-backed path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-usage-session-store-readiness-"));
  try {
    const legacyDb = createRepresentativeDb();
    const store = createUsageSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();
    await store.importLegacyRecords(legacyDb.usageSessions);

    const storeBackedAccess = createUsageSessionAccess(store);
    const storeBackedDb = createStoreBackedUsageSessionDb(legacyDb, () => store.listRecords());

    assert.deepEqual(buildUsageOutputsReadinessSnapshot(storeBackedDb), buildUsageOutputsReadinessSnapshot(legacyDb));

    const session = createSession({
      id: "ignored_for_store_write",
      userId: "user_1",
      orgId: "org_1",
      trainingPackId: "pack_1",
      scenarioId: "scenario_2",
      startedAt: "2026-03-31T12:00:00.000Z",
      endedAt: "2026-03-31T12:02:29.000Z",
      rawDurationSeconds: 149,
      createdAt: "2026-03-31T12:02:29.000Z"
    });
    const now = new Date("2026-03-31T20:00:00.000Z");
    const legacyWriteDb = createRepresentativeDb();
    const legacyWrite = buildUsageSessionWriteRouteParitySnapshot({
      db: legacyWriteDb,
      userId: "user_1",
      orgId: "org_1",
      now,
      session
    });

    const before = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });
    const beforeOrgUsage = buildOrgUsageSnapshotForParity(storeBackedDb, createOrg(), now);
    const clampedRawDurationSeconds = before.limits.maxSimulationMinutes === null
      ? Math.max(0, Math.floor(session.rawDurationSeconds))
      : Math.min(Math.max(0, Math.floor(session.rawDurationSeconds)), before.limits.maxSimulationMinutes * 60);
    const normalizedStartedAt = new Date(session.startedAt).toISOString();
    const normalizedEndedAt = new Date(session.endedAt).toISOString();
    const deterministicId = buildUsageSessionDeterministicId({
      userId: "user_1",
      orgId: "org_1",
      segmentId: session.segmentId,
      scenarioId: session.scenarioId,
      trainingId: session.trainingId ?? null,
      submittedTrainingPackId: session.trainingPackId ?? null,
      startedAt: normalizedStartedAt,
      endedAt: normalizedEndedAt,
      requestedRawDurationSeconds: session.rawDurationSeconds
    });
    const appended = await storeBackedAccess.append(storeBackedDb, {
      ...session,
      id: deterministicId,
      startedAt: normalizedStartedAt,
      endedAt: normalizedEndedAt,
      rawDurationSeconds: clampedRawDurationSeconds,
      billedSecondsAdded: computeUsageSessionBilledSecondsAdded({
        beforeUsage: before.usage,
        sessionEndedAt: normalizedEndedAt,
        sessionRawDurationSeconds: clampedRawDurationSeconds,
        timeZone: before.usage.timezoneUsed
      })
    });
    const after = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });
    const afterOrgUsage = buildOrgUsageSnapshotForParity(storeBackedDb, createOrg(), now);

    assert.equal(appended.created, true);
    assert.deepEqual(
      {
        recorded: true,
        storedRawDurationSeconds: appended.record.rawDurationSeconds,
        billedSecondsAdded: appended.record.billedSecondsAdded ?? 0,
        beforeOrgUsedSecondsThisPeriod: beforeOrgUsage.usedSeconds,
        afterOrgUsedSecondsThisPeriod: afterOrgUsage.usedSeconds,
        entitlements: after
      },
      legacyWrite
    );

    const recordsAfterFirstWrite = store.listRecords().length;
    const replay = await storeBackedAccess.append(storeBackedDb, {
      ...session,
      id: deterministicId,
      startedAt: normalizedStartedAt,
      endedAt: normalizedEndedAt,
      rawDurationSeconds: clampedRawDurationSeconds,
      billedSecondsAdded: appended.record.billedSecondsAdded
    });
    const afterReplay = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });

    assert.equal(replay.created, false);
    assert.equal(replay.record.id, deterministicId);
    assert.equal(replay.record.billedSecondsAdded, appended.record.billedSecondsAdded);
    assert.equal(store.listRecords().length, recordsAfterFirstWrite);
    assert.deepEqual(afterReplay, after);

    assert.deepEqual(
      buildUsageOutputsReadinessSnapshot(storeBackedDb),
      buildUsageOutputsReadinessSnapshot(legacyWriteDb)
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("simulation session integrity v1 preserves usage write and downstream output parity through recognized start and completion", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-simulation-session-readiness-"));
  try {
    const legacyDb = createRepresentativeDb();
    const usageStore = createUsageSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    const simulationSessionStore = createSimulationSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await usageStore.initialize();
    await simulationSessionStore.initialize();
    await usageStore.importLegacyRecords(legacyDb.usageSessions);

    const storeBackedAccess = createUsageSessionAccess(usageStore);
    const storeBackedDb = createStoreBackedUsageSessionDb(legacyDb, () => usageStore.listRecords());
    const session = createSession({
      id: "ignored_for_lifecycle",
      userId: "user_1",
      orgId: "org_1",
      trainingPackId: "pack_1",
      scenarioId: "scenario_2",
      startedAt: "2026-03-31T12:00:00.000Z",
      endedAt: "2026-03-31T12:02:29.000Z",
      rawDurationSeconds: 149,
      createdAt: "2026-03-31T12:02:29.000Z"
    });
    const now = new Date("2026-03-31T20:00:00.000Z");
    const legacyWriteDb = createRepresentativeDb();
    const legacyWrite = buildUsageSessionWriteRouteParitySnapshot({
      db: legacyWriteDb,
      userId: "user_1",
      orgId: "org_1",
      now,
      session
    });

    const before = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });
    const beforeOrgUsage = buildOrgUsageSnapshotForParity(storeBackedDb, createOrg(), now);
    const clampedRawDurationSeconds = before.limits.maxSimulationMinutes === null
      ? Math.max(0, Math.floor(session.rawDurationSeconds))
      : Math.min(Math.max(0, Math.floor(session.rawDurationSeconds)), before.limits.maxSimulationMinutes * 60);
    const normalizedStartedAt = new Date(session.startedAt).toISOString();
    const normalizedEndedAt = new Date(session.endedAt).toISOString();

    await registerRecognizedSimulationSessionStart(simulationSessionStore, {
      simulationSessionId: "sim_parity",
      userId: "user_1",
      orgId: "org_1",
      segmentId: session.segmentId,
      scenarioId: session.scenarioId,
      trainingId: session.trainingId ?? null,
      trainingPackId: session.trainingPackId ?? null,
      clientStartedAt: normalizedStartedAt,
      now: new Date("2026-03-31T12:00:00.000Z")
    });

    const completed = await completeRecognizedSimulationUsage({
      simulationSessionStore,
      usageSessionAccess: storeBackedAccess,
      db: storeBackedDb,
      simulationSessionId: "sim_parity",
      userId: "user_1",
      orgId: "org_1",
      segmentId: session.segmentId,
      scenarioId: session.scenarioId,
      trainingId: session.trainingId ?? null,
      submittedTrainingPackId: session.trainingPackId ?? null,
      resolvedTrainingPackId: session.trainingPackId ?? null,
      startedAt: normalizedStartedAt,
      endedAt: normalizedEndedAt,
      rawDurationSeconds: clampedRawDurationSeconds,
      beforeUsage: before.usage,
      maxSimulationMinutes: before.limits.maxSimulationMinutes,
      timeZone: before.usage.timezoneUsed,
      now
    });

    const after = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });
    const afterOrgUsage = buildOrgUsageSnapshotForParity(storeBackedDb, createOrg(), now);

    assert.equal(completed.usageResult.created, true);
    assert.deepEqual(
      {
        recorded: true,
        storedRawDurationSeconds: completed.usageResult.record.rawDurationSeconds,
        billedSecondsAdded: completed.usageResult.record.billedSecondsAdded ?? 0,
        beforeOrgUsedSecondsThisPeriod: beforeOrgUsage.usedSeconds,
        afterOrgUsedSecondsThisPeriod: afterOrgUsage.usedSeconds,
        entitlements: after
      },
      legacyWrite
    );

    const replay = await completeRecognizedSimulationUsage({
      simulationSessionStore,
      usageSessionAccess: storeBackedAccess,
      db: storeBackedDb,
      simulationSessionId: "sim_parity",
      userId: "user_1",
      orgId: "org_1",
      segmentId: session.segmentId,
      scenarioId: session.scenarioId,
      trainingId: session.trainingId ?? null,
      submittedTrainingPackId: session.trainingPackId ?? null,
      resolvedTrainingPackId: session.trainingPackId ?? null,
      startedAt: normalizedStartedAt,
      endedAt: normalizedEndedAt,
      rawDurationSeconds: clampedRawDurationSeconds,
      beforeUsage: before.usage,
      maxSimulationMinutes: before.limits.maxSimulationMinutes,
      timeZone: before.usage.timezoneUsed,
      now: new Date("2026-03-31T20:01:00.000Z")
    });
    const afterReplay = buildEntitlementsParitySnapshot({
      db: storeBackedDb,
      userId: "user_1",
      now
    });

    assert.equal(replay.usageResult.created, false);
    assert.equal(replay.usageResult.record.id, completed.usageResult.record.id);
    assert.deepEqual(afterReplay, after);
    assert.deepEqual(
      buildUsageOutputsReadinessSnapshot(storeBackedDb),
      buildUsageOutputsReadinessSnapshot(legacyWriteDb)
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
