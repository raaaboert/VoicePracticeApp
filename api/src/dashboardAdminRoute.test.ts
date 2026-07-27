import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  EnterpriseJoinRequestRecord,
  EnterpriseOrg,
  MobileAuthRecord,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  SimulationScoreRecord,
  TrainingPack,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

import { createWebAuthService } from "./services/webAuth.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";

const NOW = "2026-07-25T15:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_dashboard_admin_route_tests";
const WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_dashboard_admin_route_tests";
const WEB_AUTH_CODE_SECRET = "web_auth_code_secret_for_dashboard_admin_route_tests";
const ADMIN_BOOTSTRAP_PASSWORD = "dashboard_admin_route_admin_password";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let orgAdminToken: string;
let userAdminToken: string;
let regularDashboardToken: string;
let superToken: string;
let adminToken: string | null = null;

function hashMobileToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function buildMobileToken(userId: string, token: string): MobileAuthRecord {
  return {
    userId,
    tokenHash: hashMobileToken(token),
    createdAt: NOW,
    updatedAt: NOW
  };
}

function buildOrg(overrides: Partial<EnterpriseOrg> = {}): EnterpriseOrg {
  return {
    id: overrides.id ?? "org_1",
    name: overrides.name ?? "Acme Trial",
    status: overrides.status ?? "active",
    contactName: overrides.contactName ?? "Alex Admin",
    contactEmail: overrides.contactEmail ?? "alex@acme.example",
    emailDomain: overrides.emailDomain ?? "acme.example",
    joinCode: overrides.joinCode ?? "ACME2026",
    activeIndustries: overrides.activeIndustries ?? ["people_management"],
    dailySecondsQuota: overrides.dailySecondsQuota ?? 3600,
    perUserDailySecondsCap: overrides.perUserDailySecondsCap ?? 1800,
    pendingPerUserDailySecondsCap: overrides.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    contractSignedAt: overrides.contractSignedAt ?? NOW,
    monthlyMinutesAllotted: overrides.monthlyMinutesAllotted ?? 10_000,
    renewalTotalUsd: overrides.renewalTotalUsd ?? 1000,
    softLimitPercentTriggers: overrides.softLimitPercentTriggers ?? [80, 100],
    maxSimulationMinutes: overrides.maxSimulationMinutes ?? 20,
    divisionsEnabled: overrides.divisionsEnabled ?? false,
    customScenarios: overrides.customScenarios ?? [],
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    ...overrides
  };
}

function buildUser(id: string, email: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email,
    firstName: overrides.firstName ?? null,
    lastName: overrides.lastName ?? null,
    employeeId: overrides.employeeId ?? null,
    managerUserId: overrides.managerUserId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt === undefined ? NOW : overrides.emailVerifiedAt,
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    mobileProfileReonboardingRequired: overrides.mobileProfileReonboardingRequired ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "America/Denver",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? NOW,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW
  };
}

function buildJoinRequest(id: string, userId: string, email: string, orgId = "org_1"): EnterpriseJoinRequestRecord {
  return {
    id,
    userId,
    email,
    emailDomain: email.split("@")[1] ?? "",
    orgId,
    orgNameSnapshot: orgId === "org_1" ? "Acme Trial" : "Other Trial",
    joinCodeSnapshot: orgId === "org_1" ? "ACME2026" : "OTHER2026",
    status: "pending",
    createdAt: NOW,
    expiresAt: "2099-07-25T15:00:00.000Z",
    updatedAt: NOW,
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null
  };
}

function buildTrainingPack(id: string, orgId = "org_1", overrides: Partial<TrainingPack> = {}): TrainingPack {
  return {
    id,
    organizationId: orgId,
    title: overrides.title ?? (orgId === "org_1" ? "Manager Scope Pack" : "Other Org Pack"),
    trainingTopic: overrides.trainingTopic ?? "Scope-sensitive coaching",
    learningObjectives: overrides.learningObjectives ?? ["Practice active listening"],
    successBehaviors: overrides.successBehaviors ?? [],
    failurePatterns: overrides.failurePatterns ?? [],
    requiredBehavioralTriggers: overrides.requiredBehavioralTriggers ?? ["scenario:scenario_scope"],
    scoringWeightOverrides: overrides.scoringWeightOverrides ?? {},
    complianceConstraints: overrides.complianceConstraints ?? "",
    audienceLevel: overrides.audienceLevel ?? "trial",
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function buildOrgTrainingRecord(
  id: string,
  orgId: string,
  overrides: Partial<OrgTrainingRecord> = {}
): OrgTrainingRecord {
  return {
    id,
    orgId,
    name: overrides.name ?? "Manager Scope Training",
    status: overrides.status ?? "active",
    description: overrides.description ?? "Training workspace row for scope tests.",
    divisionId: overrides.divisionId ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function buildTrainingPackAttachment(
  trainingId: string,
  trainingPackId: string,
  orgId = "org_1"
): OrgTrainingPackAttachmentRecord {
  return {
    id: `att_${trainingId}_${trainingPackId}`,
    orgId,
    trainingId,
    trainingPackId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildTrainingPackAssignment(
  id: string,
  userId: string,
  overrides: Partial<TrainingPackAssignmentRecord> = {}
): TrainingPackAssignmentRecord {
  return {
    id,
    trainingPackId: overrides.trainingPackId ?? "pack_scope",
    orgId: overrides.orgId ?? "org_1",
    userId,
    active: overrides.active ?? true,
    assignedAt: overrides.assignedAt ?? "2026-07-01T12:00:00.000Z",
    assignedByUserId: overrides.assignedByUserId ?? "org_admin",
    requiredScenarioIds: overrides.requiredScenarioIds ?? ["scenario_scope"],
    completionRule: overrides.completionRule ?? "scored_required_scenarios_v1",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function buildUsageSessionRecord(
  id: string,
  userId: string,
  overrides: Partial<UsageSessionRecord> = {}
): UsageSessionRecord {
  return {
    id,
    userId,
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_scope",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId === undefined ? "pack_scope" : overrides.trainingPackId,
    startedAt: overrides.startedAt ?? "2026-07-20T12:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-20T12:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 300,
    billedSecondsAdded: overrides.billedSecondsAdded ?? 300,
    createdAt: overrides.createdAt ?? NOW,
  };
}

function buildScoreRecord(
  id: string,
  userId: string,
  overrides: Partial<SimulationScoreRecord> = {}
): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: overrides.simulationSessionId ?? `sim_${id}`,
    userId,
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "manager",
    scenarioId: overrides.scenarioId ?? "scenario_scope",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId === undefined ? "pack_scope" : overrides.trainingPackId,
    industryId: overrides.industryId ?? "people_management",
    startedAt: overrides.startedAt ?? "2026-07-20T12:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-20T12:05:00.000Z",
    communicationScore: overrides.communicationScore ?? 82,
    outcomeScore: overrides.outcomeScore ?? 80,
    overallScore: overrides.overallScore ?? 81,
    completionLevel: overrides.completionLevel ?? "complete",
    objectiveAchieved: overrides.objectiveAchieved ?? true,
    persuasion: overrides.persuasion ?? 80,
    clarity: overrides.clarity ?? 82,
    empathy: overrides.empathy ?? 84,
    assertiveness: overrides.assertiveness ?? 78,
    summary: overrides.summary ?? "Scope test score.",
    coachingArtifact: overrides.coachingArtifact ?? null,
    normalizedCoachingThemes: overrides.normalizedCoachingThemes ?? null,
    rubricVersion: overrides.rubricVersion ?? "test",
    model: overrides.model ?? "test",
    promptVersion: overrides.promptVersion ?? "test",
    inputTokens: overrides.inputTokens ?? 1,
    outputTokens: overrides.outputTokens ?? 1,
    totalTokens: overrides.totalTokens ?? 2,
    createdAt: overrides.createdAt ?? NOW,
  };
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser("org_admin", "admin@acme.example", {
        orgRole: "org_admin",
        dashboardAccessEnabled: true,
        employeeId: "ADM-1",
      }),
      buildUser("org_admin_peer", "admin-peer@acme.example", {
        orgRole: "org_admin",
        employeeId: "ADM-2",
      }),
      buildUser("user_admin", "manager@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        firstName: "Maya",
        lastName: "Manager",
        employeeId: "MGR-1",
      }),
      buildUser("eligible_user_admin", "eligible-manager@acme.example", {
        orgRole: "user_admin",
        firstName: "Zoe",
        lastName: "Eligible",
        employeeId: "MGR-2",
      }),
      buildUser("disabled_user_admin", "disabled-manager@acme.example", {
        orgRole: "user_admin",
        status: "disabled",
        firstName: "Disabled",
        lastName: "Manager",
        employeeId: "MGR-D",
      }),
      buildUser("learner", "learner@acme.example", {
        orgRole: "user",
        employeeId: "EMP-1",
        managerUserId: "user_admin",
      }),
      buildUser("learner_status", "learner-status@acme.example", {
        orgRole: "user",
        employeeId: "EMP-S",
        managerUserId: "user_admin",
      }),
      buildUser("learner_atomic", "learner-atomic@acme.example", {
        orgRole: "user",
        employeeId: null,
        managerUserId: "user_admin",
      }),
      buildUser("regular_dashboard", "viewer@acme.example", {
        orgRole: "user",
        dashboardAccessEnabled: true,
      }),
      buildUser("unassigned_learner", "unassigned@acme.example", {
        orgRole: "user",
        employeeId: "EMP-U",
      }),
      buildUser("other_manager_report", "other-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-O",
        managerUserId: "eligible_user_admin",
      }),
      buildUser("role_target", "role-target@acme.example", {
        orgRole: "user",
        employeeId: "EMP-R",
        managerUserId: "user_admin",
      }),
      buildUser("manager_to_demote", "aaron.lead@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        firstName: "Aaron",
        lastName: "Lead",
        employeeId: "MGR-3",
      }),
      buildUser("manager_to_demote_report", "demote-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-DM",
        managerUserId: "manager_to_demote",
      }),
      buildUser("manager_to_disable", "brie.lead@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        firstName: "Brie",
        lastName: "Lead",
        employeeId: "MGR-4",
      }),
      buildUser("manager_to_disable_report", "disable-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-DD",
        managerUserId: "manager_to_disable",
      }),
      buildUser("mobile_scope_manager", "mobile-scope-manager@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        firstName: "Mobile",
        lastName: "Manager",
        employeeId: "MGR-M",
      }),
      buildUser("mobile_scope_report", "mobile-scope-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-M",
        managerUserId: "mobile_scope_manager",
      }),
      buildUser("other_org_admin", "admin@other.example", {
        orgId: "org_2",
        orgRole: "org_admin",
        dashboardAccessEnabled: true,
      }),
      buildUser("other_org_user", "learner@other.example", {
        orgId: "org_2",
        orgRole: "user",
        employeeId: "EMP-1",
      }),
      buildUser("gmail_join", "gmail.user@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("gmail_join_2", "gmail.two@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("pending_user", "pending@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("reject_user", "reject@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("gmail_invalid", "invalid.gmail@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("rate_limited", "rate.limit@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("other_pending", "other-pending@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("reset_member", "reset.member@gmail.com", {
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("reset_mismatch", "reset.mismatch@gmail.com", {
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("reset_wrong_code", "reset.wrong-code@gmail.com", {
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("reset_old_token", "reset.old-token@gmail.com", {
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("reset_rate_limited", "reset.rate-limit@gmail.com", {
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("disabled_resend", "disabled.resend@gmail.com", {
        status: "disabled",
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("disabled_member", "disabled.member@gmail.com", {
        status: "disabled",
        mobileProfileReonboardingRequired: true,
      }),
      buildUser("super_user", "super@peritio.test", {
        accountType: "individual",
        tier: "pro_plus",
        orgId: null,
        orgRole: "user",
        dashboardAccessEnabled: false,
        isPlatformAdmin: true,
        isSuperUser: true,
      }),
    ],
    orgs: [
      buildOrg(),
      buildOrg({
        id: "org_2",
        name: "Other Trial",
        contactEmail: "admin@other.example",
        emailDomain: "other.example",
        joinCode: "OTHER2026",
      })
    ],
    orgDivisions: [],
    orgTrainings: [
      buildOrgTrainingRecord("training_scope", "org_1"),
      buildOrgTrainingRecord("training_other_org", "org_2", { name: "Other Org Training" }),
    ],
    orgTrainingPackAttachments: [
      buildTrainingPackAttachment("training_scope", "pack_scope", "org_1"),
      buildTrainingPackAttachment("training_other_org", "pack_other", "org_2"),
    ],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [
      buildTrainingPackAssignment("assign_self", "user_admin"),
      buildTrainingPackAssignment("assign_direct", "learner"),
      buildTrainingPackAssignment("assign_unassigned", "unassigned_learner"),
      buildTrainingPackAssignment("assign_other_report", "other_manager_report"),
      buildTrainingPackAssignment("assign_other_org", "other_org_user", {
        trainingPackId: "pack_other",
        orgId: "org_2",
        assignedByUserId: "other_org_admin",
      }),
    ],
    usageSessions: [
      buildUsageSessionRecord("usage_self", "user_admin", {
        endedAt: "2026-07-20T12:05:00.000Z",
        startedAt: "2026-07-20T12:00:00.000Z",
      }),
      buildUsageSessionRecord("usage_direct", "learner", {
        endedAt: "2026-07-21T12:05:00.000Z",
        startedAt: "2026-07-21T12:00:00.000Z",
      }),
      buildUsageSessionRecord("usage_unassigned", "unassigned_learner", {
        endedAt: "2026-07-22T12:05:00.000Z",
        startedAt: "2026-07-22T12:00:00.000Z",
      }),
      buildUsageSessionRecord("usage_other_report", "other_manager_report", {
        endedAt: "2026-07-23T12:05:00.000Z",
        startedAt: "2026-07-23T12:00:00.000Z",
      }),
      buildUsageSessionRecord("usage_other_org", "other_org_user", {
        orgId: "org_2",
        trainingPackId: "pack_other",
        endedAt: "2026-07-24T12:05:00.000Z",
        startedAt: "2026-07-24T12:00:00.000Z",
      }),
    ],
    mobileAuthTokens: [
      buildMobileToken("gmail_join", "token_gmail"),
      buildMobileToken("gmail_join_2", "token_gmail_2"),
      buildMobileToken("pending_user", "token_pending"),
      buildMobileToken("gmail_invalid", "token_gmail_invalid"),
      buildMobileToken("rate_limited", "token_rate_limited"),
      buildMobileToken("org_admin", "token_org_admin"),
      buildMobileToken("user_admin", "token_user_admin"),
      buildMobileToken("eligible_user_admin", "token_other_manager"),
      buildMobileToken("mobile_scope_manager", "token_mobile_scope_manager"),
      buildMobileToken("reset_old_token", "token_before_reset"),
      buildMobileToken("reset_rate_limited", "token_reset_rate_limited"),
      buildMobileToken("disabled_resend", "token_disabled_resend"),
    ],
    scoreRecords: [
      buildScoreRecord("score_self", "user_admin", {
        endedAt: "2026-07-20T12:05:00.000Z",
        startedAt: "2026-07-20T12:00:00.000Z",
        overallScore: 80,
      }),
      buildScoreRecord("score_direct", "learner", {
        endedAt: "2026-07-21T12:05:00.000Z",
        startedAt: "2026-07-21T12:00:00.000Z",
        overallScore: 90,
      }),
      buildScoreRecord("score_unassigned", "unassigned_learner", {
        endedAt: "2026-07-22T12:05:00.000Z",
        startedAt: "2026-07-22T12:00:00.000Z",
        overallScore: 10,
      }),
      buildScoreRecord("score_other_report", "other_manager_report", {
        endedAt: "2026-07-23T12:05:00.000Z",
        startedAt: "2026-07-23T12:00:00.000Z",
        overallScore: 20,
      }),
      buildScoreRecord("score_other_org", "other_org_user", {
        orgId: "org_2",
        trainingPackId: "pack_other",
        endedAt: "2026-07-24T12:05:00.000Z",
        startedAt: "2026-07-24T12:00:00.000Z",
        overallScore: 70,
      }),
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [
      buildJoinRequest("jr_pending", "pending_user", "pending@gmail.com"),
      buildJoinRequest("jr_reject", "reject_user", "reject@gmail.com"),
      buildJoinRequest("jr_mobile", "gmail_join_2", "gmail.two@gmail.com"),
      buildJoinRequest("jr_other", "other_pending", "other-pending@gmail.com", "org_2"),
    ],
    admin: {
      passwordHash: null,
      activeSessionIds: []
    }
  };
}

async function readDb(): Promise<ApiDatabase> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const payload = await readFile(dbPath, "utf8");
      return JSON.parse(payload) as ApiDatabase;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

function auditEventsPath(): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.audit-events${extension}`);
}

async function readAuditMetadataJson(): Promise<string> {
  const payload = JSON.parse(await readFile(auditEventsPath(), "utf8")) as {
    events?: Array<{ metadata?: unknown }>;
  };
  return JSON.stringify((payload.events ?? []).map((event) => event.metadata ?? null));
}

async function readUser(userId: string): Promise<UserProfile | undefined> {
  const db = await readDb();
  return db.users.find((user) => user.id === userId);
}

async function waitForWriteToSettle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function waitForPersistedUserState(
  userId: string,
  predicate: (user: UserProfile | undefined) => boolean
): Promise<UserProfile | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const user = await readUser(userId);
    if (predicate(user)) {
      return user;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return await readUser(userId);
}

async function waitForPersistedUserOrg(userId: string, orgId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const db = await readDb();
    if (db.users.find((user) => user.id === userId)?.orgId === orgId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const db = await readDb();
  assert.equal(db.users.find((user) => user.id === userId)?.orgId, orgId);
}

async function waitForPersistedJoinRequests(
  predicate: (requests: EnterpriseJoinRequestRecord[]) => boolean
): Promise<EnterpriseJoinRequestRecord[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const db = await readDb();
    if (predicate(db.enterpriseJoinRequests)) {
      return db.enterpriseJoinRequests;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return (await readDb()).enterpriseJoinRequests;
}

async function seedStores(): Promise<void> {
  const db = buildDatabase();
  await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  await writeFile(
    path.join(parsed.dir, `${parsed.name}.usage-sessions${extension}`),
    JSON.stringify({ records: db.usageSessions }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(parsed.dir, `${parsed.name}.score-records${extension}`),
    JSON.stringify({ records: db.scoreRecords }, null, 2),
    "utf8"
  );

  const webAuthService = createWebAuthService({
    tokenSecret: WEB_AUTH_TOKEN_SECRET,
    codeSecret: WEB_AUTH_CODE_SECRET,
  });
  const webAuthStore = createWebAuthSessionStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
  });
  await webAuthStore.initialize();

  const issue = async (userId: string, accessType: "customer_dashboard_user" | "super_user", orgId: string | null) => {
    const user = db.users.find((entry) => entry.id === userId);
    assert.ok(user);
    const issued = webAuthService.issueSession(user, 14 * 24 * 60, new Date(NOW), { accessType, orgId });
    await webAuthStore.saveSession(issued.record);
    return issued.token;
  };

  orgAdminToken = await issue("org_admin", "customer_dashboard_user", "org_1");
  userAdminToken = await issue("user_admin", "customer_dashboard_user", "org_1");
  regularDashboardToken = await issue("regular_dashboard", "customer_dashboard_user", "org_1");
  superToken = await issue("super_user", "super_user", null);
}

async function dashboardRequest(pathname: string, token = orgAdminToken, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function mobileRequest(pathname: string, token: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function publicRequest(pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function captureVerificationCode<T>(runner: () => Promise<T>): Promise<{ result: T; code: string }> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const result = await runner();
    const code = logs.join("\n").match(/code=(\d{6})/)?.[1] ?? null;
    assert.ok(code);
    return { result, code };
  } finally {
    console.log = originalLog;
  }
}

async function getAdminToken(): Promise<string> {
  if (adminToken) {
    return adminToken;
  }
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_BOOTSTRAP_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { token: string };
  adminToken = payload.token;
  return adminToken;
}

async function adminRequest(pathname: string, init?: RequestInit) {
  const token = await getAdminToken();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "dashboard-admin-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.PORT = "4102";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_dashboard_admin_route_tests";
  process.env.ADMIN_BOOTSTRAP_PASSWORD = ADMIN_BOOTSTRAP_PASSWORD;
  process.env.WEB_AUTH_TOKEN_SECRET = WEB_AUTH_TOKEN_SECRET;
  process.env.WEB_AUTH_CODE_SECRET = WEB_AUTH_CODE_SECRET;
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_transcript_secret_for_dashboard_admin_route_tests";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  delete process.env.DATABASE_URL;

  await seedStores();

  const imported = await import("./index.js");
  imported.setDashboardTrainingPackLoaderForTest(async (orgId: string) =>
    [
      buildTrainingPack("pack_scope", "org_1"),
      buildTrainingPack("pack_other", "org_2"),
    ].filter((pack) => pack.organizationId === orgId)
  );
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dashboard admin users are tenant-scoped and regular users cannot access Admin", async () => {
  const denied = await dashboardRequest("/dashboard/admin/users", regularDashboardToken);
  assert.equal(denied.status, 403);

  const result = await dashboardRequest("/dashboard/admin/users");
  assert.equal(result.status, 200);
  const users = result.body.users as Array<{ userId: string; employeeId: string | null }>;
  assert.equal(users.some((user) => user.userId === "learner"), true);
  assert.equal(users.some((user) => user.userId === "other_org_user"), false);
  assert.equal(users.find((user) => user.userId === "learner")?.employeeId, "EMP-1");
});

test("user-admin users are scoped to themselves and directly assigned reports", async () => {
  const result = await dashboardRequest("/dashboard/admin/users", userAdminToken);
  assert.equal(result.status, 200);

  const users = result.body.users as Array<{ userId: string }>;
  const userIds = users.map((user) => user.userId).sort();
  assert.deepEqual(userIds, ["learner", "learner_atomic", "learner_status", "role_target", "user_admin"]);
  assert.deepEqual(result.body.managerOptions, []);

  const viewer = result.body.viewer as { capabilities?: { approveRejectAccessRequests?: boolean; assignUserManagers?: boolean } };
  assert.equal(viewer.capabilities?.approveRejectAccessRequests, false);
  assert.equal(viewer.capabilities?.assignUserManagers, false);
});

test("dashboard training drilldowns enforce manager scope", async () => {
  const workspace = await dashboardRequest("/dashboard/reporting/trainings", userAdminToken);
  assert.equal(workspace.status, 200);
  const trainings = workspace.body.trainings as Array<{
    id: string;
    summary: { totalAttemptsLast30Days: number; activeLearnerCountLast30Days: number; averageScoreLast30Days: number | null };
    users: Array<{ userId: string }>;
  }>;
  const scopedTraining = trainings.find((row) => row.id === "training_scope");
  assert.ok(scopedTraining);
  assert.deepEqual(scopedTraining.users.map((user) => user.userId).sort(), ["learner", "user_admin"]);
  assert.equal(scopedTraining.summary.totalAttemptsLast30Days, 2);
  assert.equal(scopedTraining.summary.activeLearnerCountLast30Days, 2);
  assert.equal(scopedTraining.summary.averageScoreLast30Days, 85);

  const scopedPack = await dashboardRequest("/dashboard/training/pack_scope", userAdminToken);
  assert.equal(scopedPack.status, 200);
  const scopedPackRow = scopedPack.body.pack as {
    assignedLearnerCount: number;
    attemptsLast30Days: number;
    averageScoreLast30Days: number | null;
    assignments: Array<{ assignmentId: string; userId: string }>;
    scenarios: Array<{ assignedLearnerCount: number; attemptsLast30Days: number; averageScoreLast30Days: number | null }>;
  };
  assert.deepEqual(scopedPackRow.assignments.map((assignment) => assignment.userId).sort(), ["learner", "user_admin"]);
  assert.equal(scopedPackRow.assignedLearnerCount, 2);
  assert.equal(scopedPackRow.attemptsLast30Days, 2);
  assert.equal(scopedPackRow.averageScoreLast30Days, 85);
  assert.equal(scopedPackRow.scenarios[0]?.assignedLearnerCount, 2);
  assert.equal(scopedPackRow.scenarios[0]?.attemptsLast30Days, 2);
  assert.equal(scopedPackRow.scenarios[0]?.averageScoreLast30Days, 85);

  const directReportAssignment = await dashboardRequest(
    "/dashboard/training/pack_scope/assignments/assign_direct",
    userAdminToken
  );
  assert.equal(directReportAssignment.status, 200);
  assert.equal((directReportAssignment.body.assignment as { userId?: string }).userId, "learner");

  const unassignedAssignment = await dashboardRequest(
    "/dashboard/training/pack_scope/assignments/assign_unassigned",
    userAdminToken
  );
  assert.equal(unassignedAssignment.status, 404);
  const otherManagerAssignment = await dashboardRequest(
    "/dashboard/training/pack_scope/assignments/assign_other_report",
    userAdminToken
  );
  assert.equal(otherManagerAssignment.status, 404);
  const crossTenantPack = await dashboardRequest("/dashboard/training/pack_other?orgId=org_2", userAdminToken);
  assert.equal(crossTenantPack.status, 404);

  const orgAdminPack = await dashboardRequest("/dashboard/training/pack_scope", orgAdminToken);
  assert.equal(orgAdminPack.status, 200);
  const orgAdminPackRow = orgAdminPack.body.pack as { assignedLearnerCount: number; assignments: Array<{ userId: string }> };
  assert.equal(orgAdminPackRow.assignedLearnerCount, 4);
  assert.deepEqual(
    orgAdminPackRow.assignments.map((assignment) => assignment.userId).sort(),
    ["learner", "other_manager_report", "unassigned_learner", "user_admin"]
  );

  const superMissingOrg = await dashboardRequest("/dashboard/training/pack_scope", superToken);
  assert.equal(superMissingOrg.status, 400);
  const superScoped = await dashboardRequest("/dashboard/training/pack_other?orgId=org_2", superToken);
  assert.equal(superScoped.status, 200);
  assert.deepEqual(
    (superScoped.body.pack as { assignments: Array<{ userId: string }> }).assignments.map((assignment) => assignment.userId),
    ["other_org_user"]
  );

  const assigned = await dashboardRequest("/dashboard/admin/users/other_manager_report", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "user_admin" })
  });
  assert.equal(assigned.status, 200);
  const visibleAfterReassignment = await dashboardRequest(
    "/dashboard/training/pack_scope/assignments/assign_other_report",
    userAdminToken
  );
  assert.equal(visibleAfterReassignment.status, 200);

  const restored = await dashboardRequest("/dashboard/admin/users/other_manager_report", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "eligible_user_admin" })
  });
  assert.equal(restored.status, 200);
  const hiddenAfterRestore = await dashboardRequest(
    "/dashboard/training/pack_scope/assignments/assign_other_report",
    userAdminToken
  );
  assert.equal(hiddenAfterRestore.status, 404);
});

test("mobile user-admin routes are scoped to self and direct reports", async () => {
  const orgAdminList = await mobileRequest("/mobile/users/org_admin/admin/org/users", "token_org_admin");
  assert.equal(orgAdminList.status, 200);
  const orgAdminUserIds = (orgAdminList.body.users as Array<{ userId: string }>).map((row) => row.userId);
  assert.equal(orgAdminUserIds.includes("unassigned_learner"), true);
  assert.equal(orgAdminUserIds.includes("eligible_user_admin"), true);
  assert.equal(orgAdminUserIds.includes("other_org_user"), false);

  const scopedList = await mobileRequest("/mobile/users/user_admin/admin/org/users", "token_user_admin");
  assert.equal(scopedList.status, 200);
  const scopedUserIds = (scopedList.body.users as Array<{ userId: string }>).map((row) => row.userId).sort();
  assert.deepEqual(scopedUserIds, ["learner", "learner_atomic", "learner_status", "role_target", "user_admin"]);

  const selfDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/user_admin", "token_user_admin");
  assert.equal(selfDetail.status, 200);
  const directReportDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin");
  assert.equal(directReportDetail.status, 200);
  const unassignedDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/unassigned_learner", "token_user_admin");
  assert.equal(unassignedDetail.status, 404);
  const otherManagerReportDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(otherManagerReportDetail.status, 404);

  const otherUserAdminPatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/eligible_user_admin", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(otherUserAdminPatch.status, 404);
  const orgAdminPatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/org_admin", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(orgAdminPatch.status, 404);
  const usageControlPatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ dailySecondsCapOverride: 60 })
  });
  assert.equal(usageControlPatch.status, 403);

  const employeePatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ employeeId: " EMP-MOBILE-1 " })
  });
  assert.equal(employeePatch.status, 200);
  assert.equal((employeePatch.body as { employeeId?: string }).employeeId, "EMP-MOBILE-1");
  const deactivate = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(deactivate.status, 200);
  const reactivate = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "active" })
  });
  assert.equal(reactivate.status, 200);

  const accessRequestDenied = await mobileRequest(
    "/mobile/users/user_admin/admin/org/access-requests/jr_pending",
    "token_user_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" })
    }
  );
  assert.equal(accessRequestDenied.status, 403);

  const crossTenantRead = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin");
  assert.equal(crossTenantRead.status, 404);
  const crossTenantWrite = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(crossTenantWrite.status, 404);
});

test("mobile admin user patching is atomic across combined status and Employee ID updates", async () => {
  const conflict = await mobileRequest("/mobile/users/org_admin/admin/org/users/learner_atomic", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-S" })
  });
  assert.equal(conflict.status, 409);
  const afterConflict = await readUser("learner_atomic");
  assert.equal(afterConflict?.status, "active");
  assert.equal(afterConflict?.employeeId, null);

  const unauthorizedAdmin = await mobileRequest("/mobile/users/user_admin/admin/org/users/eligible_user_admin", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-NEW-MGR" })
  });
  assert.equal(unauthorizedAdmin.status, 404);
  const afterUnauthorizedAdmin = await readUser("eligible_user_admin");
  assert.equal(afterUnauthorizedAdmin?.status, "active");
  assert.equal(afterUnauthorizedAdmin?.employeeId, "MGR-2");

  const success = await mobileRequest("/mobile/users/org_admin/admin/org/users/learner_atomic", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-ATOMIC-MOBILE" })
  });
  assert.equal(success.status, 200);
  assert.equal((success.body as { status?: string; employeeId?: string }).status, "disabled");
  assert.equal((success.body as { status?: string; employeeId?: string }).employeeId, "EMP-ATOMIC-MOBILE");
  const afterSuccess = await waitForPersistedUserState(
    "learner_atomic",
    (user) => user?.status === "disabled" && user.employeeId === "EMP-ATOMIC-MOBILE"
  );
  assert.equal(afterSuccess?.status, "disabled");
  assert.equal(afterSuccess?.employeeId, "EMP-ATOMIC-MOBILE");

  const restored = await mobileRequest("/mobile/users/org_admin/admin/org/users/learner_atomic", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "active", employeeId: null })
  });
  assert.equal(restored.status, 200);
  const afterRestore = await waitForPersistedUserState(
    "learner_atomic",
    (user) => user?.status === "active" && user.employeeId === null
  );
  assert.equal(afterRestore?.status, "active");
  assert.equal(afterRestore?.employeeId, null);

  const scopedBypass = await mobileRequest("/mobile/users/user_admin/admin/org/users/unassigned_learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-SCOPE-BYPASS" })
  });
  assert.equal(scopedBypass.status, 404);
  const afterScopedBypass = await readUser("unassigned_learner");
  assert.equal(afterScopedBypass?.status, "active");
  assert.equal(afterScopedBypass?.employeeId, "EMP-U");

  const crossTenant = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-CROSS-TENANT" })
  });
  assert.equal(crossTenant.status, 404);
  const afterCrossTenant = await readUser("other_org_user");
  assert.equal(afterCrossTenant?.status, "active");
  assert.equal(afterCrossTenant?.employeeId, "EMP-1");
});

test("mobile manager scope updates immediately after reassignment and demotion", async () => {
  const initiallyDenied = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(initiallyDenied.status, 404);

  const assigned = await dashboardRequest("/dashboard/admin/users/other_manager_report", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "user_admin" })
  });
  assert.equal(assigned.status, 200);
  const nowVisible = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(nowVisible.status, 200);

  const reassignedAway = await dashboardRequest("/dashboard/admin/users/other_manager_report", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "eligible_user_admin" })
  });
  assert.equal(reassignedAway.status, 200);
  const noLongerVisible = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(noLongerVisible.status, 404);

  const managerList = await mobileRequest("/mobile/users/mobile_scope_manager/admin/org/users", "token_mobile_scope_manager");
  assert.equal(managerList.status, 200);
  assert.deepEqual(
    (managerList.body.users as Array<{ userId: string }>).map((row) => row.userId).sort(),
    ["mobile_scope_manager", "mobile_scope_report"]
  );

  const demoted = await dashboardRequest("/dashboard/admin/users/mobile_scope_manager", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" })
  });
  assert.equal(demoted.status, 200);
  const demotedList = await mobileRequest("/mobile/users/mobile_scope_manager/admin/org/users", "token_mobile_scope_manager");
  assert.equal(demotedList.status, 403);
});

test("org admins edit names and managers while user-admin managers cannot", async () => {
  const userAdminNameDenied = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ firstName: "No", lastName: "Access" }),
  });
  assert.equal(userAdminNameDenied.status, 403);

  const userAdminRoleDenied = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(userAdminRoleDenied.status, 403);

  const userAdminManagerDenied = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "eligible_user_admin" }),
  });
  assert.equal(userAdminManagerDenied.status, 403);

  for (const managerUserId of ["other_org_admin", "disabled_user_admin", "regular_dashboard", "unassigned_learner"]) {
    const invalid = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ managerUserId }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "manager_invalid");
  }

  const selfAssignment = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "unassigned_learner" }),
  });
  assert.equal(selfAssignment.status, 400);
  assert.equal(selfAssignment.body.code, "manager_invalid");

  const assigned = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({
      firstName: "  Uma  ",
      lastName: "  Learner  ",
      managerUserId: "user_admin",
    }),
  });
  assert.equal(assigned.status, 200);
  const row = assigned.body.user as {
    firstName?: string;
    lastName?: string;
    managerUserId?: string | null;
    managerDisplayName?: string | null;
  };
  assert.equal(row.firstName, "Uma");
  assert.equal(row.lastName, "Learner");
  assert.equal(row.managerUserId, "user_admin");
  assert.equal(row.managerDisplayName, "Maya Manager");

  const usersResult = await dashboardRequest("/dashboard/admin/users", orgAdminToken);
  assert.equal(usersResult.status, 200);
  const managerOptions = usersResult.body.managerOptions as Array<{ userId: string; displayName: string }>;
  assert.deepEqual(
    managerOptions.map((manager) => manager.displayName),
    ["Aaron Lead", "Brie Lead", "Maya Manager", "Zoe Eligible"]
  );
  assert.equal(managerOptions.some((manager) => manager.userId === "other_org_admin"), false);
  assert.equal(managerOptions.some((manager) => manager.userId === "disabled_user_admin"), false);
});

test("org admin role and status changes update access and clear manager assignments", async () => {
  const promoted = await dashboardRequest("/dashboard/admin/users/role_target", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(promoted.status, 200);
  const promotedRow = promoted.body.user as {
    orgRole?: string;
    dashboardAccessEnabled?: boolean;
    managerUserId?: string | null;
  };
  assert.equal(promotedRow.orgRole, "user_admin");
  assert.equal(promotedRow.dashboardAccessEnabled, true);
  assert.equal(promotedRow.managerUserId, null);

  const demoted = await dashboardRequest("/dashboard/admin/users/manager_to_demote", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" }),
  });
  assert.equal(demoted.status, 200);
  const demotedRow = demoted.body.user as {
    orgRole?: string;
    dashboardAccessEnabled?: boolean;
    assignedReportCount?: number;
  };
  assert.equal(demotedRow.orgRole, "user");
  assert.equal(demotedRow.dashboardAccessEnabled, false);
  assert.equal(demotedRow.assignedReportCount, 0);
  const demoteReport = await waitForPersistedUserState(
    "manager_to_demote_report",
    (user) => user?.managerUserId === null
  );
  assert.equal(demoteReport?.managerUserId, null);

  const deactivated = await dashboardRequest("/dashboard/admin/users/manager_to_disable", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(deactivated.status, 200);
  const deactivatedRow = deactivated.body.user as { status?: string; assignedReportCount?: number };
  assert.equal(deactivatedRow.status, "disabled");
  assert.equal(deactivatedRow.assignedReportCount, 0);
  const disabledReport = await waitForPersistedUserState(
    "manager_to_disable_report",
    (user) => user?.managerUserId === null
  );
  assert.equal(disabledReport?.managerUserId, null);
});

test("dashboard admin role boundaries block user-admin access to administrators", async () => {
  const userAdminDeactivateOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateOrgAdmin.status, 404);
  assert.equal((await readUser("org_admin_peer"))?.status, "active");

  const userAdminEditOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "UA-NOPE" }),
  });
  assert.equal(userAdminEditOrgAdmin.status, 404);
  assert.equal((await readUser("org_admin_peer"))?.employeeId, "ADM-2");

  const userAdminDeactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateUserAdmin.status, 404);
  assert.equal((await readUser("eligible_user_admin"))?.status, "active");

  const userAdminReactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/disabled_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(userAdminReactivateUserAdmin.status, 404);
  assert.equal((await readUser("disabled_user_admin"))?.status, "disabled");

  const orgAdminDeactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(orgAdminDeactivateUserAdmin.status, 200);
  assert.equal((orgAdminDeactivateUserAdmin.body.user as { status?: string }).status, "disabled");

  const orgAdminReactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(orgAdminReactivateUserAdmin.status, 200);
  assert.equal((orgAdminReactivateUserAdmin.body.user as { status?: string }).status, "active");

  const orgAdminDeactivateUser = await dashboardRequest("/dashboard/admin/users/learner_status", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(orgAdminDeactivateUser.status, 200);
  assert.equal((orgAdminDeactivateUser.body.user as { status?: string }).status, "disabled");

  const orgAdminReactivateUser = await dashboardRequest("/dashboard/admin/users/learner_status", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(orgAdminReactivateUser.status, 200);
  assert.equal((orgAdminReactivateUser.body.user as { status?: string }).status, "active");

  const selfDeactivation = await dashboardRequest("/dashboard/admin/users/org_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(selfDeactivation.status, 403);
  assert.equal((await readUser("org_admin"))?.status, "active");
});

test("Employee ID edits support clear, conflict, CSV export, and user-admin role limits", async () => {
  const updated = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "  EMP-2  " }),
  });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.user as { employeeId?: string }).employeeId, "EMP-2");

  const conflict = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "MGR-1" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "employee_id_conflict");

  const forbidden = await dashboardRequest("/dashboard/admin/users/user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(forbidden.status, 403);

  const disabled = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((disabled.body.user as { status?: string }).status, "disabled");

  const exported = await dashboardRequest("/dashboard/admin/users/export");
  assert.equal(exported.status, 200);
  const rows = exported.body.rows as Array<{ employeeId: string; email: string; role: string; status: string }>;
  assert.equal(rows.some((row) => row.email === "learner@acme.example" && row.employeeId === "EMP-2"), true);
  assert.equal(rows.some((row) => row.email === "learner@other.example"), false);

  const auditMetadata = await readAuditMetadataJson();
  assert.equal(auditMetadata.includes("EMP-2"), false);
  assert.equal(auditMetadata.includes("employeeIdChanged"), true);
});

test("dashboard admin user patching is atomic across Employee ID and status", async () => {
  const selfStatusDenied = await dashboardRequest("/dashboard/admin/users/org_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "ADM-SELF-NEW", status: "disabled" }),
  });
  assert.equal(selfStatusDenied.status, 403);
  await waitForWriteToSettle();
  const orgAdmin = await readUser("org_admin");
  assert.equal(orgAdmin?.employeeId, "ADM-1");
  assert.equal(orgAdmin?.status, "active");

  const conflictWithValidStatus = await dashboardRequest("/dashboard/admin/users/learner_atomic", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "MGR-1", status: "disabled" }),
  });
  assert.equal(conflictWithValidStatus.status, 409);
  await waitForWriteToSettle();
  const afterConflict = await readUser("learner_atomic");
  assert.equal(afterConflict?.employeeId, null);
  assert.equal(afterConflict?.status, "active");

  const successfulCombined = await dashboardRequest("/dashboard/admin/users/learner_atomic", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "AT-1", status: "disabled" }),
  });
  assert.equal(successfulCombined.status, 200);
  const afterSuccess = await waitForPersistedUserState(
    "learner_atomic",
    (user) => user?.employeeId === "AT-1" && user.status === "disabled"
  );
  assert.equal(afterSuccess?.employeeId, "AT-1");
  assert.equal(afterSuccess?.status, "disabled");
});

test("dashboard admin write routes reject cross-tenant manipulation attempts", async () => {
  const crossTenantUserPatch = await dashboardRequest("/dashboard/admin/users/other_org_user?orgId=org_2", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(crossTenantUserPatch.status, 404);
  assert.equal((await readUser("other_org_user"))?.status, "active");

  const crossTenantApproval = await dashboardRequest("/dashboard/admin/access-requests/jr_other?orgId=org_2", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(crossTenantApproval.status, 404);
  const db = await readDb();
  assert.equal(db.enterpriseJoinRequests.find((request) => request.id === "jr_other")?.status, "pending");
});

test("platform user audit metadata does not serialize raw Employee IDs", async () => {
  const created = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email: "platform-created@acme.example",
      tier: "enterprise",
      accountType: "enterprise",
      orgId: "org_1",
      orgRole: "user",
      employeeId: "PLAT-RAW-1",
    }),
  });
  assert.equal(created.status, 201);
  const createdUserId = (created.body as { id?: string }).id;
  assert.ok(createdUserId);

  const updated = await adminRequest(`/users/${createdUserId}`, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "PLAT-RAW-2" }),
  });
  assert.equal(updated.status, 200);

  const auditMetadata = await readAuditMetadataJson();
  assert.equal(auditMetadata.includes("PLAT-RAW-1"), false);
  assert.equal(auditMetadata.includes("PLAT-RAW-2"), false);
  assert.equal(auditMetadata.includes("employeeIdPresent"), true);
  assert.equal(auditMetadata.includes("employeeIdChanged"), true);
});

test("mobile onboarding collects names and company code without granting immediate access", async () => {
  const missingName = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "missing.name@gmail.com",
      joinCode: "ACME2026",
      timezone: "America/Denver",
    }),
  });
  assert.equal(missingName.status, 400);
  assert.equal(missingName.body.code, "user_name_invalid");

  const { result: gmailOnboard, code: gmailCode } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "new.gmail.trial@gmail.com",
        firstName: "  Gmail  ",
        lastName: "  User  ",
        joinCode: "  ACME2026  ",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(gmailOnboard.status, 201);
  assert.equal(gmailOnboard.body.verificationRequired, true);
  const gmailUser = gmailOnboard.body.user as UserProfile;
  const gmailAuthToken = gmailOnboard.body.authToken as string;
  assert.equal(gmailUser.orgId, null);
  assert.equal(gmailUser.firstName, null);
  assert.equal(gmailUser.lastName, null);
  assert.equal(typeof gmailAuthToken, "string");

  const gmailVerified = await mobileRequest("/mobile/onboard/verify-email", gmailAuthToken, {
    method: "POST",
    body: JSON.stringify({
      userId: gmailUser.id,
      code: gmailCode,
      firstName: "  Gmail  ",
      lastName: "  User  ",
      joinCode: "ACME2026",
    }),
  });
  assert.equal(gmailVerified.status, 200);
  const verifiedGmailUser = gmailVerified.body.user as UserProfile;
  assert.equal(verifiedGmailUser.firstName, "Gmail");
  assert.equal(verifiedGmailUser.lastName, "User");
  assert.equal(verifiedGmailUser.orgId, null);
  const gmailRequests = await waitForPersistedJoinRequests(
    (requests) => requests.some((request) => request.userId === gmailUser.id)
  );
  const gmailJoinRequests = gmailRequests.filter((request) => request.userId === gmailUser.id);
  assert.equal(gmailJoinRequests.length, 1);
  assert.equal(gmailJoinRequests[0].status, "pending");
  assert.equal(gmailJoinRequests[0].orgId, "org_1");

  const pending = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "pending@gmail.com",
      firstName: " Pending ",
      lastName: " Person ",
      joinCode: "ACME2026",
      timezone: "America/Denver",
    }),
  });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.verificationRequired, false);
  const pendingUser = pending.body.user as UserProfile;
  const pendingAuthToken = pending.body.authToken as string;
  assert.equal(pendingUser.firstName, "Pending");
  assert.equal(pendingUser.lastName, "Person");
  assert.equal(pendingUser.orgId, null);
  const pendingRequests = await waitForPersistedJoinRequests(
    (requests) => requests.filter((request) => request.userId === "pending_user").length === 1
  );
  assert.equal(pendingRequests.filter((request) => request.userId === "pending_user").length, 1);
  assert.equal(pendingRequests.find((request) => request.id === "jr_pending")?.status, "pending");

  const { result: resetOnboard } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "reset.member@gmail.com",
        firstName: " Reset ",
        lastName: " Member ",
        joinCode: "ACME2026",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(resetOnboard.status, 200);
  assert.equal(resetOnboard.body.verificationRequired, true);
  const limitedResetToken = resetOnboard.body.authToken as string;
  const resetUserStatusDenied = await mobileRequest("/mobile/users/reset_member", limitedResetToken);
  assert.equal(resetUserStatusDenied.status, 403);
  const resetEntitlementsDenied = await mobileRequest("/mobile/users/reset_member/entitlements", limitedResetToken);
  assert.equal(resetEntitlementsDenied.status, 401);
  const resetSimulationDenied = await mobileRequest("/mobile/users/reset_member/simulation-sessions/start", limitedResetToken, {
    method: "POST",
    body: JSON.stringify({
      simulationSessionId: "sim_reset_denied",
      segmentId: "manager",
      scenarioId: "scenario_denied"
    })
  });
  assert.equal(resetSimulationDenied.status, 401);
  const resetPerformanceDenied = await mobileRequest("/mobile/users/reset_member/performance/current", limitedResetToken);
  assert.equal(resetPerformanceDenied.status, 401);
  const resetHistoryDenied = await mobileRequest("/mobile/users/reset_member/scores/summary", limitedResetToken);
  assert.equal(resetHistoryDenied.status, 401);
  const resetUpdatesDenied = await mobileRequest("/mobile/users/reset_member/updates", limitedResetToken);
  assert.equal(resetUpdatesDenied.status, 401);
  const resetAdminDenied = await mobileRequest("/mobile/users/reset_member/admin/org/users", limitedResetToken);
  assert.equal(resetAdminDenied.status, 401);

  const { result: resend, code: resentCode } = await captureVerificationCode(() =>
    mobileRequest("/mobile/onboard/resend-verification", limitedResetToken, {
      method: "POST",
      body: JSON.stringify({ userId: "reset_member" }),
    })
  );
  assert.equal(resend.status, 200);
  assert.equal(resend.body.ok, true);
  assert.equal(typeof resend.body.verificationExpiresAt, "string");

  const resetVerified = await mobileRequest("/mobile/onboard/verify-email", limitedResetToken, {
    method: "POST",
    body: JSON.stringify({
      userId: "reset_member",
      code: resentCode,
      firstName: " Reset ",
      lastName: " Member ",
      joinCode: "ACME2026",
    }),
  });
  assert.equal(resetVerified.status, 200);
  const resetUser = resetVerified.body.user as UserProfile;
  assert.equal(resetUser.firstName, "Reset");
  assert.equal(resetUser.lastName, "Member");
  assert.equal(resetUser.orgId, "org_1");
  assert.equal(resetUser.mobileProfileReonboardingRequired, false);
  const normalResetToken = resetVerified.body.authToken as string;
  assert.notEqual(normalResetToken, limitedResetToken);
  const limitedTokenAfterCompletion = await mobileRequest("/mobile/users/reset_member/entitlements", limitedResetToken);
  assert.equal(limitedTokenAfterCompletion.status, 401);
  const normalTokenAfterCompletion = await mobileRequest("/mobile/users/reset_member/entitlements", normalResetToken);
  assert.equal(normalTokenAfterCompletion.status, 200);
  const resetRequests = await waitForPersistedJoinRequests(
    (requests) => requests.every((request) => request.userId !== "reset_member")
  );
  assert.equal(resetRequests.some((request) => request.userId === "reset_member"), false);

  const oldTokenDenied = await mobileRequest("/mobile/users/reset_old_token/entitlements", "token_before_reset");
  assert.equal(oldTokenDenied.status, 401);

  const pendingResend = await mobileRequest("/mobile/onboard/resend-verification", pendingAuthToken, {
    method: "POST",
    body: JSON.stringify({ userId: "pending_user" }),
  });
  assert.equal(pendingResend.status, 409);
  assert.equal((await readUser("pending_user"))?.orgId, null);

  const disabledResend = await mobileRequest("/mobile/onboard/resend-verification", "token_disabled_resend", {
    method: "POST",
    body: JSON.stringify({ userId: "disabled_resend" }),
  });
  assert.equal(disabledResend.status, 403);
  const disabledResendEntitlements = await mobileRequest("/mobile/users/disabled_resend/entitlements", "token_disabled_resend");
  assert.equal(disabledResendEntitlements.status, 401);

  const legacyMissingNames = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "reset.wrong-code@gmail.com",
      joinCode: "ACME2026",
      timezone: "America/Denver",
    }),
  });
  assert.equal(legacyMissingNames.status, 400);
  assert.equal(legacyMissingNames.body.code, "user_name_invalid");
  assert.equal((await readUser("reset_wrong_code"))?.mobileProfileReonboardingRequired, true);

  const wrongCode = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "reset.wrong-code@gmail.com",
      firstName: "Wrong",
      lastName: "Code",
      joinCode: "NO-SUCH-CODE",
      timezone: "America/Denver",
    }),
  });
  assert.equal(wrongCode.status, 404);
  assert.equal((await readUser("reset_wrong_code"))?.mobileProfileReonboardingRequired, true);

  const mismatch = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "reset.mismatch@gmail.com",
      firstName: "Mismatch",
      lastName: "Member",
      joinCode: "OTHER2026",
      timezone: "America/Denver",
    }),
  });
  assert.equal(mismatch.status, 403);
  assert.match(String(mismatch.body.error), /does not match/);
  assert.equal((await readUser("reset_mismatch"))?.orgId, "org_1");
  assert.equal((await readUser("reset_mismatch"))?.mobileProfileReonboardingRequired, true);
  const mismatchRequests = await readDb();
  assert.equal(mismatchRequests.enterpriseJoinRequests.some((request) => request.userId === "reset_mismatch"), false);

  const disabled = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "disabled.member@gmail.com",
      firstName: "Disabled",
      lastName: "Member",
      joinCode: "ACME2026",
      timezone: "America/Denver",
    }),
  });
  assert.equal(disabled.status, 403);
  assert.match(String(disabled.body.error), /deactivated/i);
  const disabledDb = await readDb();
  assert.equal(disabledDb.mobileAuthTokens.some((token) => token.userId === "disabled_member"), false);
});

test("re-onboarding resend remains rate-limited", async () => {
  let latestStatus = 0;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const result = await mobileRequest("/mobile/onboard/resend-verification", "token_reset_rate_limited", {
      method: "POST",
      body: JSON.stringify({ userId: "reset_rate_limited" }),
    });
    latestStatus = result.status;
  }
  assert.equal(latestStatus, 429);
});

test("company-code join requests accept Gmail, are duplicate-safe, and still require approval", async () => {
  const created = await mobileRequest("/mobile/users/gmail_join/org-access-requests", "token_gmail", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  assert.equal(created.status, 201);

  const duplicate = await mobileRequest("/mobile/users/gmail_join/org-access-requests", "token_gmail", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);

  const db = await readDb();
  const gmailUser = db.users.find((user) => user.id === "gmail_join");
  assert.equal(gmailUser?.accountType, "individual");
  assert.equal(gmailUser?.orgId, null);
});

test("company-code join requests reject invalid codes and rate-limit repeated attempts", async () => {
  const invalid = await mobileRequest("/mobile/users/gmail_invalid/org-access-requests", "token_gmail_invalid", {
    method: "POST",
    body: JSON.stringify({ joinCode: "NO-SUCH-CODE" }),
  });
  assert.equal(invalid.status, 404);
  assert.equal((await readUser("gmail_invalid"))?.orgId, null);

  let latestStatus = 0;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const result = await mobileRequest("/mobile/users/rate_limited/org-access-requests", "token_rate_limited", {
      method: "POST",
      body: JSON.stringify({ joinCode: `NOPE-${attempt}` }),
    });
    latestStatus = result.status;
    if (attempt < 20) {
      assert.equal(result.status, 404);
    }
  }
  assert.equal(latestStatus, 429);
  assert.equal((await readUser("rate_limited"))?.orgId, null);
});

test("dashboard and mobile approvals use the same pending-request transition", async () => {
  const userAdminDenied = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(userAdminDenied.status, 403);

  const approved = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(approved.status, 200);
  assert.equal((approved.body.request as { status?: string }).status, "approved");

  const usersAfterApproval = await dashboardRequest("/dashboard/admin/users", orgAdminToken);
  assert.equal(usersAfterApproval.status, 200);
  const users = usersAfterApproval.body.users as Array<{ userId: string; email: string; status: string; orgRole: string }>;
  assert.equal(
    users.some((user) =>
      user.userId === "pending_user" &&
      user.email === "pending@gmail.com" &&
      user.status === "active" &&
      user.orgRole === "user"
    ),
    true
  );

  const rejected = await dashboardRequest("/dashboard/admin/access-requests/jr_reject", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "reject", reason: "Not a trial user." }),
  });
  assert.equal(rejected.status, 200);
  assert.equal((rejected.body.request as { status?: string }).status, "rejected");
  assert.equal((await readUser("reject_user"))?.orgId, null);

  const mobileApproved = await mobileRequest(
    "/mobile/users/org_admin/admin/org/access-requests/jr_mobile",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    }
  );
  assert.equal(mobileApproved.status, 200);
  assert.equal((mobileApproved.body.request as { status?: string }).status, "approved");

  await waitForPersistedUserOrg("pending_user", "org_1");
  await waitForPersistedUserOrg("gmail_join_2", "org_1");
});

test("super users need explicit organization context and final active org-admin deactivation is blocked", async () => {
  const aggregateDenied = await dashboardRequest("/dashboard/admin/users", superToken);
  assert.equal(aggregateDenied.status, 400);

  const scoped = await dashboardRequest("/dashboard/admin/users?orgId=org_2", superToken);
  assert.equal(scoped.status, 200);
  const scopedUsers = scoped.body.users as Array<{ userId: string }>;
  assert.deepEqual(scopedUsers.map((user) => user.userId).sort(), ["other_org_admin", "other_org_user"]);

  const finalAdminDenied = await dashboardRequest("/dashboard/admin/users/other_org_admin?orgId=org_2", superToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(finalAdminDenied.status, 403);
});
