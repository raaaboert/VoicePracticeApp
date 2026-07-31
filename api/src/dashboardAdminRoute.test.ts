import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  AuditEvent,
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
import { TrainingContentAssetServiceError } from "./services/trainingContentAssetService.js";
import { TrainingContentManagementServiceError } from "./services/trainingContentManagementService.js";
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
let setSimulationAiBudgetGraceForTest: (userId: string, expiresAtMs: number) => void;
const moduleEntitlementRows = new Map<string, {
  orgId: string;
  moduleKey: "training_content";
  enabled: boolean;
  updatedByActorId: string | null;
  updatedAt: string | null;
}>();
const moduleEntitlementAuditEvents: AuditEvent[] = [];
const trainingContentAssetRouteCalls: Array<{
  method: string;
  params: Record<string, any>;
}> = [];
const trainingContentManagementRouteCalls: Array<{
  method: string;
  params: Record<string, any>;
}> = [];

function buildTrainingContentRouteItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Coaching foundation",
    description: "Practice better coaching.",
    focusTopicId: "training_scope",
    focusTopicName: "Manager Scope Training",
    focusTopicAvailable: true,
    contentType: "native",
    publicationState: "draft",
    displayOrder: 0,
    contentVersion: 1,
    currentAsset: null,
    assignmentSummary: {
      availableToEveryone: false,
      userCount: 0,
      managerCount: 0,
      managerTeamCount: 0,
      label: "Not assigned",
    },
    updatedByActorId: "org_admin",
    updatedByDisplayName: "Org Admin",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: null,
    archivedAt: null,
    nativeBody: "# Coaching",
    externalUrl: null,
    assignments: {
      availableToEveryone: false,
      users: [],
      managers: [],
      managerTeams: [],
    },
    ...overrides,
  };
}

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
    firstName: overrides.firstName === undefined ? "Test" : overrides.firstName,
    lastName: overrides.lastName === undefined ? "User" : overrides.lastName,
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
      buildUser("rejected_ai", "rejected-ai@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("inactive_org_user", "inactive@disabled.example", {
        orgId: "org_disabled",
      }),
      buildUser("disabled_ai_user", "disabled-ai@acme.example", {
        status: "disabled",
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
      buildUser("nameless_free", "nameless.free@gmail.com", {
        firstName: null,
        lastName: null,
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
      }),
      buildOrg({
        id: "org_disabled",
        name: "Disabled Organization",
        status: "disabled",
        contactEmail: "admin@disabled.example",
        emailDomain: "disabled.example",
        joinCode: "DISABLED2026",
      }),
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
      buildMobileToken("nameless_free", "token_nameless_free"),
      buildMobileToken("org_admin", "token_org_admin"),
      buildMobileToken("user_admin", "token_user_admin"),
      buildMobileToken("eligible_user_admin", "token_other_manager"),
      buildMobileToken("mobile_scope_manager", "token_mobile_scope_manager"),
      buildMobileToken("reset_old_token", "token_before_reset"),
      buildMobileToken("reset_rate_limited", "token_reset_rate_limited"),
      buildMobileToken("disabled_resend", "token_disabled_resend"),
      buildMobileToken("reject_user", "token_reject"),
      buildMobileToken("rejected_ai", "token_rejected_ai"),
      buildMobileToken("inactive_org_user", "token_inactive_org"),
      buildMobileToken("disabled_ai_user", "token_disabled_ai"),
      buildMobileToken("super_user", "token_super_mobile"),
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
      {
        ...buildJoinRequest("jr_rejected_ai", "rejected_ai", "rejected-ai@gmail.com"),
        status: "rejected",
        decidedAt: NOW,
        decidedByUserId: "org_admin",
        decisionReason: "Not approved for this organization.",
      },
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
  const hasFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body && !hasFormDataBody ? { "Content-Type": "application/json" } : {}),
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
  process.env.ENABLE_REMOTE_TTS = "true";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.DATABASE_URL;

  await seedStores();

  const imported = await import("./index.js");
  setSimulationAiBudgetGraceForTest = imported.setSimulationAiBudgetGraceForTest;
  imported.setDashboardTrainingPackLoaderForTest(async (orgId: string) =>
    [
      buildTrainingPack("pack_scope", "org_1"),
      buildTrainingPack("pack_other", "org_2"),
    ].filter((pack) => pack.organizationId === orgId)
  );
  imported.setOrgModuleEntitlementStoreForTest({
    async initialize() {
      // The route test injects a deterministic store; PostgreSQL behavior is covered separately.
    },
    async getOrgModuleEntitlement(orgId: string, moduleKey: "training_content") {
      return moduleEntitlementRows.get(`${orgId}:${moduleKey}`) ?? {
        orgId,
        moduleKey,
        enabled: false,
        updatedByActorId: null,
        updatedAt: null,
      };
    },
    async setOrgModuleEntitlement(input) {
      const key = `${input.orgId}:${input.moduleKey}`;
      const previous = moduleEntitlementRows.get(key) ?? {
        orgId: input.orgId,
        moduleKey: input.moduleKey,
        enabled: false,
        updatedByActorId: null,
        updatedAt: null,
      };
      const changed = previous.enabled !== input.enabled;
      const current = {
        orgId: input.orgId,
        moduleKey: input.moduleKey,
        enabled: input.enabled,
        updatedByActorId: input.updatedByActorId,
        updatedAt: (input.updatedAt ?? new Date()).toISOString(),
      };
      moduleEntitlementRows.set(key, current);
      if (changed && input.auditEvent) {
        moduleEntitlementAuditEvents.push({
          ...input.auditEvent,
          metadata: {
            ...(input.auditEvent.metadata ?? {}),
            previousEnabled: previous.enabled,
            newEnabled: current.enabled,
          },
        });
      }
      return { previous, current, changed };
    },
  });
  imported.setTrainingContentAssetServiceForTest({
    async initiateUpload(params) {
      trainingContentAssetRouteCalls.push({ method: "initiate", params });
      if (!params.context.capabilities.manageOrganizationContent) {
        throw new TrainingContentAssetServiceError(
          "Training Content administration is not available for this account.",
          403,
          "dashboard_scope_denied"
        );
      }
      return {
        asset: {
          id: "11111111-1111-4111-8111-111111111111",
          contentId: params.contentId,
          assetRole: "primary",
          version: 1,
          uploadState: "pending",
          originalFilename: "reference.pdf",
          declaredMimeType: "application/pdf",
          detectedMimeType: null,
          fileExtension: "pdf",
          declaredByteSize: 8,
          byteSize: null,
          checksumOrEtag: null,
          uploadExpiresAt: NOW,
          finalizedAt: null,
          supersededAt: null,
          replacementForAssetId: null,
          isCurrent: false,
          cleanupPending: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
        upload: {
          url: "https://upload.invalid/signed",
          expiresAt: NOW,
          method: "PUT",
          requiredHeaders: {
            "content-type": "application/pdf",
            "content-length": "8",
          },
        },
      };
    },
    async finalizeUpload(params) {
      trainingContentAssetRouteCalls.push({ method: "finalize", params });
      return {
        asset: {
          id: params.assetId,
          contentId: params.contentId,
          assetRole: "primary",
          version: 1,
          uploadState: "ready",
          originalFilename: "reference.pdf",
          declaredMimeType: "application/pdf",
          detectedMimeType: "application/pdf",
          fileExtension: "pdf",
          declaredByteSize: 8,
          byteSize: 8,
          checksumOrEtag: "\"etag\"",
          uploadExpiresAt: null,
          finalizedAt: NOW,
          supersededAt: null,
          replacementForAssetId: null,
          isCurrent: true,
          cleanupPending: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
        replacedAssetId: null,
      };
    },
    async getUploadStatus(params) {
      trainingContentAssetRouteCalls.push({ method: "status", params });
      return {
        asset: {
          id: params.assetId,
          contentId: params.contentId,
          assetRole: "primary",
          version: 1,
          uploadState: "ready",
          originalFilename: "reference.pdf",
          declaredMimeType: "application/pdf",
          detectedMimeType: "application/pdf",
          fileExtension: "pdf",
          declaredByteSize: 8,
          byteSize: 8,
          checksumOrEtag: "\"etag\"",
          uploadExpiresAt: null,
          finalizedAt: NOW,
          supersededAt: null,
          replacementForAssetId: null,
          isCurrent: true,
          cleanupPending: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
        replacedAssetId: null,
      };
    },
    async createAdminPreviewAccess(params) {
      trainingContentAssetRouteCalls.push({ method: "access", params });
      return {
        access: {
          url: "https://access.invalid/signed",
          expiresAt: NOW,
          requiredHeaders: {},
        },
      };
    },
  });
  const authorizeTrainingContentManagement = (params: Record<string, any>) => {
    if (!params.context.capabilities.manageOrganizationContent) {
      throw new TrainingContentManagementServiceError(
        "Training Content administration is not available for this account.",
        403,
        "dashboard_scope_denied"
      );
    }
    const entitlement = moduleEntitlementRows.get(
      `${params.context.orgId}:training_content`
    );
    if (!entitlement?.enabled) {
      throw new TrainingContentManagementServiceError(
        "Training Content is not enabled for this organization.",
        403,
        "module_disabled",
        { moduleKey: "training_content" }
      );
    }
  };
  imported.setTrainingContentManagementServiceForTest({
    getFileLimits() {
      return { video: 500, audio: 100, pdf: 50, docx: 25, image: 20 };
    },
    async listContent(params) {
      trainingContentManagementRouteCalls.push({ method: "list", params });
      authorizeTrainingContentManagement(params);
      return {
        items: [buildTrainingContentRouteItem()],
        page: 1,
        pageSize: 25,
        total: 1,
      } as any;
    },
    async getContent(params) {
      trainingContentManagementRouteCalls.push({ method: "get", params });
      authorizeTrainingContentManagement(params);
      if (params.contentId === "99999999-9999-4999-8999-999999999999") {
        throw new TrainingContentManagementServiceError(
          "Training Content item was not found.",
          404,
          "training_content_not_found"
        );
      }
      return buildTrainingContentRouteItem() as any;
    },
    async createContent(params) {
      trainingContentManagementRouteCalls.push({ method: "create", params });
      authorizeTrainingContentManagement(params);
      return buildTrainingContentRouteItem({
        title: params.input.title,
        contentType: params.input.contentType,
      }) as any;
    },
    async updateContent(params) {
      trainingContentManagementRouteCalls.push({ method: "update", params });
      authorizeTrainingContentManagement(params);
      if (params.input.expectedUpdatedAt === "conflict") {
        throw new TrainingContentManagementServiceError(
          "Training Content changed in another session. Reload before saving.",
          409,
          "training_content_conflict",
          { currentUpdatedAt: NOW }
        );
      }
      return buildTrainingContentRouteItem({ title: params.input.title ?? "Coaching foundation" }) as any;
    },
    async updateAssignments(params) {
      trainingContentManagementRouteCalls.push({ method: "assign", params });
      authorizeTrainingContentManagement(params);
      return buildTrainingContentRouteItem({
        assignmentSummary: {
          availableToEveryone: params.input.availableToEveryone,
          userCount: params.input.userIds.length,
          managerCount: params.input.managerIds.length,
          managerTeamCount: params.input.managerTeamIds.length,
          label: "Assigned",
        },
      }) as any;
    },
    async transitionContent(params) {
      trainingContentManagementRouteCalls.push({ method: params.action, params });
      authorizeTrainingContentManagement(params);
      return buildTrainingContentRouteItem({
        publicationState: params.action === "publish"
          ? "published"
          : params.action === "archive"
            ? "archived"
            : "draft",
      }) as any;
    },
    async listUserTargets(params) {
      trainingContentManagementRouteCalls.push({ method: "users", params });
      authorizeTrainingContentManagement(params);
      return [{
        userId: "learner",
        displayName: "Test User",
        email: "learner@acme.example",
        employeeId: "EMP-1",
        orgRole: "user",
        status: "active",
        available: true,
      }] as any;
    },
    async listManagerTargets(params) {
      trainingContentManagementRouteCalls.push({ method: "managers", params });
      authorizeTrainingContentManagement(params);
      return [{
        userId: "user_admin",
        displayName: "Test User",
        email: "manager@acme.example",
        employeeId: null,
        orgRole: "user_admin",
        status: "active",
        available: true,
      }] as any;
    },
    async listFocusTopics(params) {
      trainingContentManagementRouteCalls.push({ method: "topics", params });
      authorizeTrainingContentManagement(params);
      return [{
        id: "training_scope",
        name: "Manager Scope Training",
        status: "active",
      }] as any;
    },
    async listCategories(params) {
      trainingContentManagementRouteCalls.push({ method: "categories", params });
      authorizeTrainingContentManagement(params);
      return {
        categories: [{
          id: "22222222-2222-4222-8222-222222222222",
          name: "General",
          description: "",
          isDefault: true,
          activeItemCount: 1,
          archivedItemCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        }],
        orderRevision: NOW,
      };
    },
    async createCategory(params) {
      trainingContentManagementRouteCalls.push({ method: "create-category", params });
      authorizeTrainingContentManagement(params);
      return {
        category: {
          id: "33333333-3333-4333-8333-333333333333",
          name: params.input.name,
          description: params.input.description ?? "",
          isDefault: false,
          activeItemCount: 0,
          archivedItemCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
        orderRevision: NOW,
      };
    },
    async updateCategory(params) {
      trainingContentManagementRouteCalls.push({ method: "update-category", params });
      authorizeTrainingContentManagement(params);
      return {
        category: {
          id: params.categoryId,
          name: params.input.name ?? "General",
          description: params.input.description ?? "",
          isDefault: false,
          activeItemCount: 1,
          archivedItemCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
        orderRevision: NOW,
      };
    },
    async reorderCategories(params) {
      trainingContentManagementRouteCalls.push({ method: "reorder-categories", params });
      authorizeTrainingContentManagement(params);
      return {
        categories: [],
        orderRevision: NOW,
      };
    },
    async archiveCategory(params) {
      trainingContentManagementRouteCalls.push({ method: "archive-category", params });
      authorizeTrainingContentManagement(params);
      return {
        category: {
          id: params.categoryId,
          name: "Archived",
          description: "",
          isDefault: false,
          activeItemCount: 0,
          archivedItemCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: NOW,
        },
        movedItemCount: 1,
        orderRevision: NOW,
      };
    },
    async getContentOrder(params) {
      trainingContentManagementRouteCalls.push({ method: "content-order", params });
      authorizeTrainingContentManagement(params);
      return {
        groups: [{
          categoryId: "22222222-2222-4222-8222-222222222222",
          categoryName: "General",
          items: [],
        }],
        orderRevision: NOW,
      };
    },
    async reorderContent(params) {
      trainingContentManagementRouteCalls.push({ method: "reorder-content", params });
      authorizeTrainingContentManagement(params);
      return {
        groups: [],
        orderRevision: NOW,
      };
    },
  });
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test("paid mobile AI requires approved organization access before quota grace or provider work", async () => {
  for (const [userId, token] of [
    ["gmail_join", "token_gmail"],
    ["pending_user", "token_pending"],
    ["reject_user", "token_reject"],
    ["rejected_ai", "token_rejected_ai"],
  ] as const) {
    const entitlements = await mobileRequest(`/mobile/users/${userId}/entitlements`, token);
    assert.equal(entitlements.status, 200);
    assert.equal(entitlements.body.canStartSimulation, false);
    assert.equal(entitlements.body.lockCode, "ORG_ACCESS_REQUIRED");
  }

  const inactiveOrg = await mobileRequest(
    "/mobile/users/inactive_org_user/entitlements",
    "token_inactive_org",
  );
  assert.equal(inactiveOrg.status, 403);
  assert.equal(inactiveOrg.body.code, "ORG_ACCESS_REQUIRED");

  const disabledUser = await mobileRequest(
    "/mobile/users/disabled_ai_user/entitlements",
    "token_disabled_ai",
  );
  assert.equal(disabledUser.status, 403);
  assert.match(String(disabledUser.body.error), /disabled/i);

  const approved = await mobileRequest("/mobile/users/org_admin/entitlements", "token_org_admin");
  assert.equal(approved.status, 200);
  assert.equal(approved.body.canStartSimulation, true);
  assert.equal(approved.body.lockCode, null);

  const superWithoutOrg = await mobileRequest("/mobile/users/super_user/entitlements", "token_super_mobile");
  assert.equal(superWithoutOrg.status, 200);
  assert.equal(superWithoutOrg.body.canStartSimulation, false);
  assert.equal(superWithoutOrg.body.lockCode, "ORG_ACCESS_REQUIRED");

  const superWithOrg = await mobileRequest("/mobile/users/super_user/entitlements", "token_super_mobile", {
    headers: { "X-Superuser-Org-Id": "org_1" },
  });
  assert.equal(superWithOrg.status, 200);
  assert.equal(superWithOrg.body.canStartSimulation, true);

  const config = (await readDb()).config;
  const segment = config.segments.find((entry) => entry.scenarios.some((scenario) => scenario.enabled !== false));
  const scenario = segment?.scenarios.find((entry) => entry.enabled !== false);
  assert.ok(segment && scenario);
  const startBody = {
    segmentId: segment.id,
    scenarioId: scenario.id,
    clientStartedAt: new Date().toISOString(),
  };
  const deniedStart = await mobileRequest(
    "/mobile/users/gmail_join/simulation-sessions/start",
    "token_gmail",
    {
      method: "POST",
      body: JSON.stringify({ ...startBody, simulationSessionId: "sim_free_org_lock" }),
    },
  );
  assert.equal(deniedStart.status, 403);
  assert.equal(deniedStart.body.code, "ORG_ACCESS_REQUIRED");

  const approvedStart = await mobileRequest(
    "/mobile/users/org_admin/simulation-sessions/start",
    "token_org_admin",
    {
      method: "POST",
      body: JSON.stringify({ ...startBody, simulationSessionId: "sim_approved_org_access" }),
    },
  );
  assert.equal(approvedStart.status, 201, JSON.stringify(approvedStart.body));
  assert.equal(approvedStart.body.recognized, true);

  const superStart = await mobileRequest(
    "/mobile/users/super_user/simulation-sessions/start",
    "token_super_mobile",
    {
      method: "POST",
      headers: { "X-Superuser-Org-Id": "org_1" },
      body: JSON.stringify({ ...startBody, simulationSessionId: "sim_super_org_access" }),
    },
  );
  assert.equal(superStart.status, 201, JSON.stringify(superStart.body));
  assert.equal(superStart.body.recognized, false);

  setSimulationAiBudgetGraceForTest("gmail_join", Date.now() + 60_000);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.openai.com/")) {
      providerCalls += 1;
      return new Response(JSON.stringify({ error: { message: "Provider should not be invoked." } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  try {
    const assertOrganizationAccessRequired = (
      result: Awaited<ReturnType<typeof mobileRequest>>,
      route: string,
    ) => {
      assert.equal(result.status, 403, `${route}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.code, "ORG_ACCESS_REQUIRED", route);
    };
    const history = [
      { role: "assistant", content: "How would you approach this conversation?" },
      { role: "user", content: "I would begin by clarifying the team's shared priorities." },
    ];

    const transcribeForm = new FormData();
    transcribeForm.append("file", new Blob(["test audio"], { type: "audio/m4a" }), "test.m4a");
    assertOrganizationAccessRequired(
      await mobileRequest("/mobile/users/gmail_join/ai/transcribe", "token_gmail", {
        method: "POST",
        body: transcribeForm,
      }),
      "transcribe",
    );

    const submitTurnForm = new FormData();
    submitTurnForm.append("file", new Blob(["test audio"], { type: "audio/m4a" }), "test.m4a");
    submitTurnForm.append("payload", JSON.stringify({
      scenarioId: scenario.id,
      simulationSessionId: "sim_free_submit_turn_org_lock",
      history,
    }));
    assertOrganizationAccessRequired(
      await mobileRequest("/mobile/users/gmail_join/ai/submit-turn", "token_gmail", {
        method: "POST",
        body: submitTurnForm,
      }),
      "submit-turn",
    );

    for (const [route, body] of [
      ["opening", {
        scenarioId: scenario.id,
        simulationSessionId: "sim_free_opening_org_lock",
      }],
      ["turn", {
        scenarioId: scenario.id,
        simulationSessionId: "sim_free_turn_org_lock",
        history,
      }],
      ["score", {
        scenarioId: scenario.id,
        simulationSessionId: "sim_free_score_org_lock",
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date().toISOString(),
        history,
      }],
    ] as const) {
      assertOrganizationAccessRequired(
        await mobileRequest(`/mobile/users/gmail_join/ai/${route}`, "token_gmail", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        route,
      );
    }

    assertOrganizationAccessRequired(
      await mobileRequest("/mobile/users/gmail_join/ai/tts", "token_gmail", {
        method: "POST",
        body: JSON.stringify({ text: "This request must be denied before synthesis.", preset: "female-balanced" }),
      }),
      "tts",
    );

    assertOrganizationAccessRequired(
      await mobileRequest("/usage/sessions", "token_gmail", {
        method: "POST",
        body: JSON.stringify({
          userId: "gmail_join",
          simulationSessionId: "sim_free_usage_org_lock",
          segmentId: segment.id,
          scenarioId: scenario.id,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          endedAt: new Date().toISOString(),
          rawDurationSeconds: 60,
        }),
      }),
      "usage-sessions",
    );

    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("internal Admin Utility module endpoint is authorized, tenant-scoped, persistent, and auditable", async () => {
  moduleEntitlementRows.clear();
  moduleEntitlementAuditEvents.length = 0;

  const unauthorized = await publicRequest("/orgs/org_1/modules/training-content", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(unauthorized.status, 401);

  const initial = await adminRequest("/orgs/org_1/modules");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, {
    orgId: "org_1",
    modules: {
      training_content: {
        moduleKey: "training_content",
        enabled: false,
        updatedByActorId: null,
        updatedAt: null,
      },
    },
  });

  const before = await readDb();
  const enabled = await adminRequest("/orgs/org_1/modules/training-content", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enabled.status, 200);
  assert.equal((enabled.body.modules as any).training_content.enabled, true);
  assert.equal(enabled.body.changed, true);

  const repeated = await adminRequest("/orgs/org_1/modules/training-content", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.changed, false);

  const otherOrg = await adminRequest("/orgs/org_2/modules");
  assert.equal(otherOrg.status, 200);
  assert.equal((otherOrg.body.modules as any).training_content.enabled, false);

  const disabled = await adminRequest("/orgs/org_1/modules/training-content", {
    method: "PATCH",
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((disabled.body.modules as any).training_content.enabled, false);

  const after = await readDb();
  assert.deepEqual(after.orgTrainings, before.orgTrainings);
  assert.deepEqual(after.orgTrainingPackAttachments, before.orgTrainingPackAttachments);
  assert.deepEqual(after.orgTrainingScenarioAttachments, before.orgTrainingScenarioAttachments);
  assert.deepEqual(after.trainingPackAssignments, before.trainingPackAssignments);
  assert.equal(moduleEntitlementAuditEvents.length, 2);
  assert.deepEqual(
    moduleEntitlementAuditEvents.map((event) => ({
      action: event.action,
      orgId: event.orgId,
      metadata: event.metadata,
    })),
    [
      {
        action: "org_module_entitlement_changed",
        orgId: "org_1",
        metadata: {
          orgId: "org_1",
          moduleKey: "training_content",
          actorId: "platform_admin",
          previousEnabled: false,
          newEnabled: true,
        },
      },
      {
        action: "org_module_entitlement_changed",
        orgId: "org_1",
        metadata: {
          orgId: "org_1",
          moduleKey: "training_content",
          actorId: "platform_admin",
          previousEnabled: true,
          newEnabled: false,
        },
      },
    ]
  );

  const invalid = await adminRequest("/orgs/org_1/modules/training-content", {
    method: "PATCH",
    body: JSON.stringify({ enabled: "yes" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "module_entitlement_invalid");

  const missingOrg = await adminRequest("/orgs/org_missing/modules");
  assert.equal(missingOrg.status, 404);
});

test("Training Content asset routes derive tenant and actor, require explicit super-user scope, and reject server-owned fields", async () => {
  trainingContentAssetRouteCalls.length = 0;
  const contentId = "22222222-2222-4222-8222-222222222222";
  const assetId = "33333333-3333-4333-8333-333333333333";
  const uploadBody = {
    assetRole: "primary",
    originalFilename: "reference.pdf",
    declaredMimeType: "application/pdf",
    declaredByteSize: 8,
  };

  const unauthorized = await publicRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads`,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(unauthorized.status, 401);

  const initiated = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads`,
    orgAdminToken,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(initiated.status, 201);
  const initiateCall = trainingContentAssetRouteCalls.at(-1);
  assert.equal(initiateCall?.method, "initiate");
  assert.equal(initiateCall?.params.context.orgId, "org_1");
  assert.equal(initiateCall?.params.context.actorId, "org_admin");
  assert.equal(initiateCall?.params.context.capabilities.manageOrganizationContent, true);
  assert.equal("orgId" in initiated.body, false);
  assert.equal(JSON.stringify(initiated.body).includes("ObjectKey"), false);

  const userAdminDenied = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads`,
    userAdminToken,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(userAdminDenied.status, 403);
  assert.equal(userAdminDenied.body.code, "dashboard_scope_denied");

  const crossTenant = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads?orgId=org_2`,
    orgAdminToken,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(crossTenant.status, 404);

  const superWithoutContext = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads`,
    superToken,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(superWithoutContext.status, 400);
  assert.equal(superWithoutContext.body.code, "dashboard_scope_denied");

  const superScoped = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads?orgId=org_2`,
    superToken,
    { method: "POST", body: JSON.stringify(uploadBody) }
  );
  assert.equal(superScoped.status, 201);
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.params.context.orgId, "org_2");
  assert.equal(
    trainingContentAssetRouteCalls.at(-1)?.params.context.capabilities.manageOrganizationContent,
    true
  );

  const callsBeforeRejectedBody = trainingContentAssetRouteCalls.length;
  const serverOwnedField = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/uploads`,
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({
        ...uploadBody,
        org_id: "org_2",
        temporary_object_key: "client/chosen",
      }),
    }
  );
  assert.equal(serverOwnedField.status, 400);
  assert.equal(serverOwnedField.body.code, "training_content_server_owned_field");
  assert.equal(trainingContentAssetRouteCalls.length, callsBeforeRejectedBody);

  const finalized = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/${assetId}/finalize`,
    orgAdminToken,
    { method: "POST", body: "{}" }
  );
  assert.equal(finalized.status, 200);
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.method, "finalize");
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.params.context.orgId, "org_1");

  const status = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/${assetId}`,
    orgAdminToken
  );
  assert.equal(status.status, 200);
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.method, "status");
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.params.context.orgId, "org_1");

  const access = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assets/${assetId}/access`,
    orgAdminToken,
    { method: "POST", body: "{}" }
  );
  assert.equal(access.status, 200);
  assert.equal(trainingContentAssetRouteCalls.at(-1)?.method, "access");
});

test("Training Content management routes enforce module, capability, explicit scope, and tenant-derived references", async () => {
  trainingContentManagementRouteCalls.length = 0;
  moduleEntitlementRows.delete("org_1:training_content");
  moduleEntitlementRows.delete("org_2:training_content");

  const unauthorized = await publicRequest("/dashboard/admin/training-content");
  assert.equal(unauthorized.status, 401);

  const disabled = await dashboardRequest("/dashboard/admin/training-content", orgAdminToken);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.code, "module_disabled");
  assert.equal(disabled.body.moduleKey, "training_content");

  moduleEntitlementRows.set("org_1:training_content", {
    orgId: "org_1",
    moduleKey: "training_content",
    enabled: true,
    updatedByActorId: "platform_admin",
    updatedAt: NOW,
  });
  const listed = await dashboardRequest(
    "/dashboard/admin/training-content?q=%25_%5C%27&categoryId=category_1&page=1&pageSize=25",
    orgAdminToken
  );
  assert.equal(listed.status, 200);
  assert.equal((listed.body.items as unknown[]).length, 1);
  assert.equal((listed.body.viewer as any).capabilities.manageOrganizationContent, true);
  const listCall = trainingContentManagementRouteCalls.at(-1);
  assert.equal(listCall?.method, "list");
  assert.equal(listCall?.params.context.orgId, "org_1");
  assert.equal(listCall?.params.context.actorId, "org_admin");
  assert.equal(listCall?.params.filters.query, "%_\\'");
  assert.equal(listCall?.params.filters.categoryId, "category_1");
  assert.equal(
    listCall?.params.references.users.every((entry: UserProfile) => entry.orgId === "org_1"),
    true
  );
  assert.equal(
    listCall?.params.references.focusTopics.every((entry: OrgTrainingRecord) => entry.orgId === "org_1"),
    true
  );

  const userAdminDenied = await dashboardRequest(
    "/dashboard/admin/training-content",
    userAdminToken
  );
  assert.equal(userAdminDenied.status, 403);
  assert.equal(userAdminDenied.body.code, "dashboard_scope_denied");

  const crossTenant = await dashboardRequest(
    "/dashboard/admin/training-content?orgId=org_2",
    orgAdminToken
  );
  assert.equal(crossTenant.status, 404);

  const superWithoutContext = await dashboardRequest(
    "/dashboard/admin/training-content",
    superToken
  );
  assert.equal(superWithoutContext.status, 400);
  assert.equal(superWithoutContext.body.code, "dashboard_scope_denied");

  moduleEntitlementRows.set("org_2:training_content", {
    orgId: "org_2",
    moduleKey: "training_content",
    enabled: true,
    updatedByActorId: "platform_admin",
    updatedAt: NOW,
  });
  const superScoped = await dashboardRequest(
    "/dashboard/admin/training-content?orgId=org_2",
    superToken
  );
  assert.equal(superScoped.status, 200);
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.context.orgId, "org_2");
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.context.actorId, "super_user");

  const callsBeforeServerOwned = trainingContentManagementRouteCalls.length;
  const serverOwned = await dashboardRequest(
    "/dashboard/admin/training-content",
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({
        contentType: "native",
        title: "Unsafe",
        orgId: "org_2",
        actorId: "other",
      }),
    }
  );
  assert.equal(serverOwned.status, 400);
  assert.equal(serverOwned.body.code, "training_content_server_owned_field");
  assert.equal(trainingContentManagementRouteCalls.length, callsBeforeServerOwned);

  const created = await dashboardRequest(
    "/dashboard/admin/training-content",
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({
        contentType: "native",
        title: "Created content",
      }),
    }
  );
  assert.equal(created.status, 201);
  assert.equal((created.body.item as any).title, "Created content");

  const contentId = "22222222-2222-4222-8222-222222222222";
  const updated = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}`,
    orgAdminToken,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: NOW, title: "Updated content" }),
    }
  );
  assert.equal(updated.status, 200);
  assert.equal((updated.body.item as any).title, "Updated content");
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.context.orgId, "org_1");

  const conflict = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}`,
    orgAdminToken,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: "conflict", title: "Stale" }),
    }
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "training_content_conflict");
  assert.equal(conflict.body.currentUpdatedAt, NOW);

  const assignments = await dashboardRequest(
    `/dashboard/admin/training-content/${contentId}/assignments`,
    orgAdminToken,
    {
      method: "PUT",
      body: JSON.stringify({
        expectedUpdatedAt: NOW,
        availableToEveryone: true,
        userIds: ["learner"],
        managerIds: ["user_admin"],
        managerTeamIds: ["user_admin"],
      }),
    }
  );
  assert.equal(assignments.status, 200);
  assert.equal((assignments.body.item as any).assignmentSummary.userCount, 1);

  for (const action of ["publish", "unpublish", "archive"]) {
    const result = await dashboardRequest(
      `/dashboard/admin/training-content/${contentId}/${action}`,
      orgAdminToken,
      {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: NOW }),
      }
    );
    assert.equal(result.status, 200);
  }

  const users = await dashboardRequest(
    "/dashboard/admin/training-content-targets/users?q=EMP",
    orgAdminToken
  );
  assert.equal(users.status, 200);
  assert.equal((users.body.targets as any[])[0]?.employeeId, "EMP-1");
  const managers = await dashboardRequest(
    "/dashboard/admin/training-content-targets/managers",
    orgAdminToken
  );
  assert.equal(managers.status, 200);
  const focusTopics = await dashboardRequest(
    "/dashboard/admin/training-content-targets/focus-topics",
    orgAdminToken
  );
  assert.equal(focusTopics.status, 200);

  const categories = await dashboardRequest(
    "/dashboard/admin/training-content/categories",
    orgAdminToken
  );
  assert.equal(categories.status, 200);
  assert.equal((categories.body.categories as any[])[0]?.name, "General");
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.context.orgId, "org_1");

  const categoryDenied = await dashboardRequest(
    "/dashboard/admin/training-content/categories",
    userAdminToken
  );
  assert.equal(categoryDenied.status, 403);
  assert.equal(categoryDenied.body.code, "dashboard_scope_denied");

  const categoryCreated = await dashboardRequest(
    "/dashboard/admin/training-content/categories",
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({ name: "Leadership", description: "Manager resources" }),
    }
  );
  assert.equal(categoryCreated.status, 201);
  assert.equal((categoryCreated.body.category as any).name, "Leadership");
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.context.actorId, "org_admin");

  const categoryId = "33333333-3333-4333-8333-333333333333";
  const categoryUpdated = await dashboardRequest(
    `/dashboard/admin/training-content/categories/${categoryId}`,
    orgAdminToken,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: NOW, name: "Leadership library" }),
    }
  );
  assert.equal(categoryUpdated.status, 200);
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.params.categoryId, categoryId);

  const categoryReordered = await dashboardRequest(
    "/dashboard/admin/training-content/categories/reorder",
    orgAdminToken,
    {
      method: "PUT",
      body: JSON.stringify({
        expectedOrderRevision: NOW,
        categoryIds: [
          "22222222-2222-4222-8222-222222222222",
          categoryId,
        ],
      }),
    }
  );
  assert.equal(categoryReordered.status, 200);
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.method, "reorder-categories");

  const categoryArchived = await dashboardRequest(
    `/dashboard/admin/training-content/categories/${categoryId}/archive`,
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({
        expectedUpdatedAt: NOW,
        destinationCategoryId: "22222222-2222-4222-8222-222222222222",
      }),
    }
  );
  assert.equal(categoryArchived.status, 200);
  assert.equal(categoryArchived.body.movedItemCount, 1);

  const contentOrder = await dashboardRequest(
    "/dashboard/admin/training-content/reorder",
    orgAdminToken
  );
  assert.equal(contentOrder.status, 200);
  assert.equal((contentOrder.body.groups as any[])[0]?.categoryName, "General");

  const contentReordered = await dashboardRequest(
    "/dashboard/admin/training-content/reorder",
    orgAdminToken,
    {
      method: "PUT",
      body: JSON.stringify({
        expectedOrderRevision: NOW,
        categories: [{
          categoryId: "22222222-2222-4222-8222-222222222222",
          contentIds: [],
        }],
      }),
    }
  );
  assert.equal(contentReordered.status, 200);
  assert.equal(trainingContentManagementRouteCalls.at(-1)?.method, "reorder-content");

  const callsBeforeCategoryOwnedField = trainingContentManagementRouteCalls.length;
  const categoryOwnedField = await dashboardRequest(
    "/dashboard/admin/training-content/categories",
    orgAdminToken,
    {
      method: "POST",
      body: JSON.stringify({ name: "Unsafe", orgId: "org_2", actorId: "other" }),
    }
  );
  assert.equal(categoryOwnedField.status, 400);
  assert.equal(categoryOwnedField.body.code, "training_content_server_owned_field");
  assert.equal(trainingContentManagementRouteCalls.length, callsBeforeCategoryOwnedField);
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

  const { result: freeOnboard, code: freeCode } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "new.free.trial@gmail.com",
        firstName: "  Free  ",
        lastName: "  User  ",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(freeOnboard.status, 201);
  assert.equal(freeOnboard.body.verificationRequired, true);
  const freeUser = freeOnboard.body.user as UserProfile;
  const freeInterimToken = freeOnboard.body.authToken as string;
  assert.equal(freeUser.firstName, null);
  assert.equal(freeUser.lastName, null);
  assert.equal(freeUser.emailVerifiedAt, null);
  assert.equal(freeUser.orgId, null);
  const freeInterimEntitlements = await mobileRequest(`/mobile/users/${freeUser.id}/entitlements`, freeInterimToken);
  assert.equal(freeInterimEntitlements.status, 401);

  const freeVerified = await mobileRequest("/mobile/onboard/verify-email", freeInterimToken, {
    method: "POST",
    body: JSON.stringify({
      userId: freeUser.id,
      code: freeCode,
      firstName: "  Free  ",
      lastName: "  User  ",
    }),
  });
  assert.equal(freeVerified.status, 200);
  const verifiedFreeUser = freeVerified.body.user as UserProfile;
  const freeNormalToken = freeVerified.body.authToken as string;
  assert.equal(verifiedFreeUser.firstName, "Free");
  assert.equal(verifiedFreeUser.lastName, "User");
  assert.equal(verifiedFreeUser.email.includes("Free"), false);
  assert.equal(verifiedFreeUser.orgId, null);
  assert.notEqual(freeNormalToken, freeInterimToken);
  const freeOldTokenDenied = await mobileRequest(`/mobile/users/${freeUser.id}/entitlements`, freeInterimToken);
  assert.equal(freeOldTokenDenied.status, 401);
  const freeNormalTokenAllowed = await mobileRequest(`/mobile/users/${freeUser.id}/entitlements`, freeNormalToken);
  assert.equal(freeNormalTokenAllowed.status, 200);
  const freeRequests = await readDb();
  assert.equal(freeRequests.enterpriseJoinRequests.some((request) => request.userId === freeUser.id), false);

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
  const gmailNormalToken = gmailVerified.body.authToken as string;
  assert.notEqual(gmailNormalToken, gmailAuthToken);
  const gmailOldTokenDenied = await mobileRequest(`/mobile/users/${gmailUser.id}/entitlements`, gmailAuthToken);
  assert.equal(gmailOldTokenDenied.status, 401);
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

  const namelessBootstrap = await mobileRequest("/mobile/users/nameless_free", "token_nameless_free");
  assert.equal(namelessBootstrap.status, 200);
  assert.equal((namelessBootstrap.body as unknown as UserProfile).firstName, null);
  const namelessProtected = await mobileRequest("/mobile/users/nameless_free/entitlements", "token_nameless_free");
  assert.equal(namelessProtected.status, 401);
  const namelessJoinDenied = await mobileRequest("/mobile/users/nameless_free/org-access-requests", "token_nameless_free", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  assert.equal(namelessJoinDenied.status, 401);
  const completedNameless = await publicRequest("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({
      email: "nameless.free@gmail.com",
      firstName: " Legacy ",
      lastName: " Free ",
      timezone: "America/Denver",
    }),
  });
  assert.equal(completedNameless.status, 200);
  assert.equal(completedNameless.body.verificationRequired, false);
  const completedNamelessUser = completedNameless.body.user as UserProfile;
  assert.equal(completedNamelessUser.id, "nameless_free");
  assert.equal(completedNamelessUser.firstName, "Legacy");
  assert.equal(completedNamelessUser.lastName, "Free");
  assert.equal(completedNamelessUser.accountType, "individual");
  assert.equal(completedNamelessUser.tier, "free");

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
  assert.equal(resetUserStatusDenied.status, 200);
  assert.equal((resetUserStatusDenied.body as unknown as UserProfile).mobileProfileReonboardingRequired, true);
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

  const { result: mismatchOnboard, code: mismatchVerificationCode } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "reset.mismatch@gmail.com",
        firstName: "Mismatch",
        lastName: "Member",
        joinCode: "ACME2026",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(mismatchOnboard.status, 200);
  const mismatchLimitedToken = mismatchOnboard.body.authToken as string;
  const verifyMismatch = await mobileRequest("/mobile/onboard/verify-email", mismatchLimitedToken, {
    method: "POST",
    body: JSON.stringify({
      userId: "reset_mismatch",
      code: mismatchVerificationCode,
      firstName: "Mismatch",
      lastName: "Member",
      joinCode: "OTHER2026",
    }),
  });
  assert.equal(verifyMismatch.status, 403);
  assert.match(String(verifyMismatch.body.error), /does not match/);
  const verifyMismatchDb = await readDb();
  assert.equal(verifyMismatchDb.users.find((user) => user.id === "reset_mismatch")?.orgId, "org_1");
  assert.equal(
    verifyMismatchDb.users.find((user) => user.id === "reset_mismatch")?.mobileProfileReonboardingRequired,
    true
  );
  assert.equal(
    verifyMismatchDb.emailVerifications
      .filter((entry) => entry.userId === "reset_mismatch")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.consumedAt,
    null
  );
  assert.equal(verifyMismatchDb.enterpriseJoinRequests.some((request) => request.userId === "reset_mismatch"), false);

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
