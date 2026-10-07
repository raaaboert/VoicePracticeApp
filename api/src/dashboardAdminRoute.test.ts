import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

import {
  AuditEvent,
  ApiDatabase,
  computeMonthlyPeriodBounds,
  createDefaultConfig,
  EnterpriseJoinRequestRecord,
  EnterpriseOrg,
  MobileAuthRecord,
  OrganizationProductSettings,
  OrganizationProductSwitchKey,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  SimulationScoreRecord,
  TrainingPack,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

import { createWebAuthService } from "./services/webAuth.js";
import {
  AuthorizedOrganizationPerformanceInvariantError,
  type AuthorizedOrganizationPerformanceQuery,
  type AuthorizedOrganizationPerformanceResult,
} from "./services/authorizedOrganizationPerformance.js";
import type {
  AuthorizedOrganizationPerformanceIntelligenceQuery,
  AuthorizedOrganizationPerformanceIntelligenceResult,
} from "./services/authorizedOrganizationPerformanceIntelligence.js";
import type {
  AuthorizedTeamPerformanceQuery,
  AuthorizedTeamPerformanceResult,
} from "./services/authorizedTeamPerformance.js";
import type {
  AuthorizedTeamPerformanceIntelligenceQuery,
  AuthorizedTeamPerformanceIntelligenceResult,
} from "./services/authorizedTeamPerformanceIntelligence.js";
import { TrainingContentAssetServiceError } from "./services/trainingContentAssetService.js";
import { TrainingContentManagementServiceError } from "./services/trainingContentManagementService.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";
import {
  getTrainingPackOrderRevision,
  type TrainingPackStore,
  validateTrainingPackOrder,
} from "./storage/trainingPackStore.js";

const NOW = "2026-07-25T15:00:00.000Z";
const RECENT_ACTIVITY_ANCHOR_MS = Date.now();
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const BILLING_USAGE_PERIOD_START_MS = new Date(
  computeMonthlyPeriodBounds(NOW, new Date()).periodStartAt,
).getTime();

function daysAgo(days: number, minuteOffset = 0): string {
  return new Date(RECENT_ACTIVITY_ANCHOR_MS - days * DAY_MS + minuteOffset * MINUTE_MS).toISOString();
}

function billingPeriodUsageWindow(minuteOffset = 0): Pick<UsageSessionRecord, "startedAt" | "endedAt"> {
  const startedAt = new Date(BILLING_USAGE_PERIOD_START_MS + minuteOffset * MINUTE_MS);
  return {
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + 5 * MINUTE_MS).toISOString(),
  };
}

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
let regularTeamToken: string;
let regularOrganizationToken: string;
let orgAdminNoneToken: string;
let userAdminNoneToken: string;
let superToken: string;
let dashboardDisabledToken: string;
let inactiveDashboardToken: string;
let adminToken: string | null = null;
let setSimulationAiBudgetGraceForTest: (userId: string, expiresAtMs: number) => void;
let ensureDatabaseShapeForTest: (raw: unknown) => ApiDatabase;
let ensureDemoEnterpriseDataForTest: (db: ApiDatabase, now: string) => void;
let setDashboardOrganizationPerformanceQueryForTest: (
  query: ((input: AuthorizedOrganizationPerformanceQuery) => AuthorizedOrganizationPerformanceResult) | null,
) => void;
let setDashboardOrganizationPerformanceIntelligenceQueryForTest: (
  query: ((input: AuthorizedOrganizationPerformanceIntelligenceQuery) => AuthorizedOrganizationPerformanceIntelligenceResult) | null,
) => void;
let setDashboardTeamPerformanceQueryForTest: (
  query: ((input: AuthorizedTeamPerformanceQuery) => AuthorizedTeamPerformanceResult) | null,
) => void;
let setDashboardTeamPerformanceIntelligenceQueryForTest: (
  query: ((input: AuthorizedTeamPerformanceIntelligenceQuery) => AuthorizedTeamPerformanceIntelligenceResult) | null,
) => void;
let setDashboardTrainingPackLoaderForTest: (
  loader: ((orgId: string) => Promise<TrainingPack[]>) | null,
) => void;
let setDatabaseSaveBarrierForTest: (barrier: (() => Promise<void>) | null) => void;
let setWebSessionRevocationFailureForTest: (error: Error | null) => void;
let setFocusTopicDeleteResponseObserverForTest: (observer: (() => void) | null) => void;
let setIdentityAdministrationResponseObserverForTest: (
  observer: ((route: string, status: number) => void) | null,
) => void;
let setOrganizationConfigurationResponseObserverForTest: (
  observer: ((route: string, status: number) => void) | null,
) => void;
let setContentManagementResponseObserverForTest: (
  observer: ((route: string, status: number) => void) | null,
) => void;
let setRuntimeDurabilityResponseObserverForTest: (
  observer: ((route: string, status: number) => void) | null,
) => void;
let setContentManagementTrainingPackStoreForTest: (store: TrainingPackStore | null) => void;
let setTrainingPackOrderAuditFailureForTest: (error: Error | null) => void;
const moduleEntitlementRows = new Map<string, {
  orgId: string;
  moduleKey: "training_content";
  enabled: boolean;
  updatedByActorId: string | null;
  updatedAt: string | null;
}>();
const moduleEntitlementAuditEvents: AuditEvent[] = [];
const productSettingsRows = new Map<string, OrganizationProductSettings & {
  orgId: string;
  updatedByAdminSessionId: string | null;
}>();
const productSettingsAuditEvents: AuditEvent[] = [];
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
    relatedScenarios: [],
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
    performanceAccess: overrides.performanceAccess ?? "none",
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
    displayOrder: overrides.displayOrder ?? 0,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function createContentManagementTrainingPackStore(rows: TrainingPack[]): TrainingPackStore {
  return {
    async initialize() {},
    async getActiveTrainingPackForOrg(orgId) {
      return rows.find((pack) => pack.organizationId === orgId && pack.active) ?? null;
    },
    async listTrainingPacksForOrg(orgId) {
      return rows.filter((pack) => pack.organizationId === orgId);
    },
    async listTrainingPacksForOrgInCompanyOrder(orgId) {
      return rows
        .filter((pack) => pack.organizationId === orgId)
        .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0));
    },
    async reorderTrainingPacksForOrg(orgId, trainingPackIds, expectedOrderRevision) {
      const matchingRows = rows.filter((pack) => pack.organizationId === orgId);
      const requestedIds = validateTrainingPackOrder(
        matchingRows,
        trainingPackIds,
        expectedOrderRevision,
      );
      for (const [displayOrder, trainingPackId] of requestedIds.entries()) {
        const pack = matchingRows.find((entry) => entry.id === trainingPackId);
        if (pack) pack.displayOrder = displayOrder;
      }
      const orderedPacks = matchingRows.sort(
        (left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0) || left.id.localeCompare(right.id),
      );
      return {
        trainingPacks: orderedPacks,
        orderRevision: getTrainingPackOrderRevision(orderedPacks),
      };
    },
    async createTrainingPackForOrg(orgId, input) {
      if (!orgId) throw new Error("organization is required");
      const created = buildTrainingPack(`pack_${crypto.randomUUID()}`, orgId, {
        title: input.title,
        trainingTopic: input.trainingTopic,
        requiredBehavioralTriggers: input.requiredBehavioralTriggers,
        active: input.active,
        displayOrder: rows.filter((pack) => pack.organizationId === orgId).length,
      });
      rows.push(created);
      return created;
    },
    async updateTrainingPackForOrg(orgId, trainingPackId, patch) {
      const pack = rows.find((entry) => entry.organizationId === orgId && entry.id === trainingPackId);
      if (!pack) return null;
      Object.assign(pack, patch, { updatedAt: new Date().toISOString() });
      return pack;
    },
    async deleteTrainingPackForOrg(orgId, trainingPackId) {
      const index = rows.findIndex((entry) => entry.organizationId === orgId && entry.id === trainingPackId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
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
    displayOrder: overrides.displayOrder,
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
    startedAt: overrides.startedAt ?? daysAgo(10),
    endedAt: overrides.endedAt ?? daysAgo(10, 5),
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
    startedAt: overrides.startedAt ?? daysAgo(10),
    endedAt: overrides.endedAt ?? daysAgo(10, 5),
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
        performanceAccess: "organization",
        dashboardAccessEnabled: true,
        employeeId: "ADM-1",
      }),
      buildUser("org_admin_peer", "admin-peer@acme.example", {
        orgRole: "org_admin",
        employeeId: "ADM-2",
      }),
      buildUser("user_admin", "manager@acme.example", {
        orgRole: "user_admin",
        performanceAccess: "team",
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
      buildUser("regular_team", "team-viewer@acme.example", {
        orgRole: "user",
        performanceAccess: "team",
        dashboardAccessEnabled: true,
        divisionId: "division_a",
      }),
      buildUser("regular_organization", "organization-viewer@acme.example", {
        orgRole: "user",
        performanceAccess: "organization",
        dashboardAccessEnabled: true,
      }),
      buildUser("org_admin_none", "admin-no-performance@acme.example", {
        orgRole: "org_admin",
        performanceAccess: "none",
        dashboardAccessEnabled: false,
      }),
      buildUser("user_admin_none", "manager-no-performance@acme.example", {
        orgRole: "user_admin",
        performanceAccess: "none",
        dashboardAccessEnabled: true,
        firstName: "Nina",
        lastName: "No Performance",
      }),
      buildUser("unassigned_learner", "unassigned@acme.example", {
        orgRole: "user",
        employeeId: "EMP-U",
        managerUserId: "user_admin_none",
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
        performanceAccess: "team",
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
      buildUser("regular_manager_to_promote", "regular-manager@acme.example", {
        orgRole: "user",
        performanceAccess: "none",
        firstName: "Riley",
        lastName: "Regular Manager",
        employeeId: "MGR-R",
      }),
      buildUser("regular_manager_to_promote_report", "regular-manager-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-RM",
        managerUserId: "regular_manager_to_promote",
      }),
      buildUser("manager_to_org_admin", "org-admin-manager@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        firstName: "Orla",
        lastName: "Manager",
        employeeId: "MGR-OA",
      }),
      buildUser("manager_to_org_admin_report", "org-admin-manager-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-OA",
        managerUserId: "manager_to_org_admin",
      }),
      buildUser("manager_to_individual", "individual-manager@acme.example", {
        orgRole: "user",
        firstName: "Taylor",
        lastName: "Transfer",
        employeeId: "MGR-T",
      }),
      buildUser("manager_to_individual_report", "individual-manager-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-T",
        managerUserId: "manager_to_individual",
      }),
      buildUser("mobile_manager_to_disable", "mobile-disable-manager@acme.example", {
        orgRole: "user_admin",
        firstName: "Morgan",
        lastName: "Mobile Disable",
        employeeId: "MGR-MD",
      }),
      buildUser("mobile_manager_to_disable_report", "mobile-disable-report@acme.example", {
        orgRole: "user",
        employeeId: "EMP-MD",
        managerUserId: "mobile_manager_to_disable",
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
      buildUser("platform_admin_pending", "platform-admin-pending@gmail.com", {
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
      buildOrg({ divisionsEnabled: true }),
      buildOrg({
        id: "org_2",
        name: "Other Trial",
        contactEmail: "admin@other.example",
        emailDomain: "other.example",
        joinCode: "OTHER2026",
        divisionsEnabled: true,
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
    orgDivisions: [
      {
        id: "division_a",
        orgId: "org_1",
        name: "Division A",
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
      {
        id: "division_b",
        orgId: "org_1",
        name: "Division B",
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
      {
        id: "division_other_org",
        orgId: "org_2",
        name: "Other Division",
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
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
        ...billingPeriodUsageWindow(),
      }),
      buildUsageSessionRecord("usage_direct", "learner", {
        divisionId: "division_a",
        ...billingPeriodUsageWindow(10),
      }),
      buildUsageSessionRecord("usage_direct_division_b_old", "learner", {
        divisionId: "division_b",
        trainingPackId: null,
        endedAt: "2025-01-21T12:05:00.000Z",
        startedAt: "2025-01-21T12:00:00.000Z",
      }),
      buildUsageSessionRecord("usage_unassigned", "unassigned_learner", {
        ...billingPeriodUsageWindow(20),
      }),
      buildUsageSessionRecord("usage_other_report", "other_manager_report", {
        ...billingPeriodUsageWindow(30),
      }),
      buildUsageSessionRecord("usage_other_org", "other_org_user", {
        orgId: "org_2",
        trainingPackId: "pack_other",
        endedAt: daysAgo(6, 5),
        startedAt: daysAgo(6),
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
      buildMobileToken("org_admin_none", "token_org_admin_none"),
      buildMobileToken("user_admin", "token_user_admin"),
      buildMobileToken("regular_team", "token_regular_team"),
      buildMobileToken("regular_organization", "token_regular_organization"),
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
        endedAt: daysAgo(10, 5),
        startedAt: daysAgo(10),
        overallScore: 80,
      }),
      buildScoreRecord("score_direct", "learner", {
        divisionId: "division_a",
        endedAt: daysAgo(9, 5),
        startedAt: daysAgo(9),
        overallScore: 90,
      }),
      buildScoreRecord("score_direct_division_b_old", "learner", {
        divisionId: "division_b",
        trainingPackId: null,
        endedAt: "2025-01-21T12:05:00.000Z",
        startedAt: "2025-01-21T12:00:00.000Z",
        overallScore: 55,
      }),
      buildScoreRecord("score_unassigned", "unassigned_learner", {
        endedAt: daysAgo(8, 5),
        startedAt: daysAgo(8),
        overallScore: 10,
      }),
      buildScoreRecord("score_other_report", "other_manager_report", {
        endedAt: daysAgo(7, 5),
        startedAt: daysAgo(7),
        overallScore: 20,
      }),
      buildScoreRecord("score_other_org", "other_org_user", {
        orgId: "org_2",
        trainingPackId: "pack_other",
        endedAt: daysAgo(6, 5),
        startedAt: daysAgo(6),
        overallScore: 70,
      }),
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [
      buildJoinRequest("jr_pending", "pending_user", "pending@gmail.com"),
      buildJoinRequest("jr_reject", "reject_user", "reject@gmail.com"),
      buildJoinRequest("jr_mobile", "gmail_join_2", "gmail.two@gmail.com"),
      buildJoinRequest("jr_platform_admin", "platform_admin_pending", "platform-admin-pending@gmail.com"),
      buildJoinRequest("jr_other", "other_pending", "other-pending@gmail.com", "org_2"),
      {
        ...buildJoinRequest("jr_rejected_ai", "rejected_ai", "rejected-ai@gmail.com"),
        status: "rejected",
        decidedAt: NOW,
        decidedByUserId: "org_admin",
        decisionReason: "Not approved for this organization.",
      },
      {
        ...buildJoinRequest("jr_approved_history", "learner", "learner@acme.example"),
        status: "approved",
        decidedAt: NOW,
        decidedByUserId: "org_admin",
      },
      {
        ...buildJoinRequest("jr_expired_history", "gmail_invalid", "gmail.invalid@gmail.com"),
        createdAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-08T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
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

async function readDurableDbOnce(): Promise<ApiDatabase> {
  return JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
}

async function requestWhileIdentityPersistenceHeld<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let observedStatus: number | null = null;

  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setIdentityAdministrationResponseObserverForTest((observedRoute, status) => {
    if (observedRoute === route) observedStatus = status;
  });

  const pending = runner();
  try {
    await saveStarted;
    assert.equal(observedStatus, null);
    releaseSave();
    const result = await pending;
    assert.ok(observedStatus !== null && observedStatus >= 200 && observedStatus < 300);
    return result;
  } finally {
    releaseSave();
    setDatabaseSaveBarrierForTest(null);
    setIdentityAdministrationResponseObserverForTest(null);
  }
}

async function requestWhileOrganizationPersistenceHeld<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let observedStatus: number | null = null;

  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setOrganizationConfigurationResponseObserverForTest((observedRoute, status) => {
    if (observedRoute === route) observedStatus = status;
  });

  const pending = runner();
  try {
    await saveStarted;
    assert.equal(observedStatus, null);
    releaseSave();
    const result = await pending;
    assert.ok(observedStatus !== null && observedStatus >= 200 && observedStatus < 300);
    return result;
  } finally {
    releaseSave();
    setDatabaseSaveBarrierForTest(null);
    setOrganizationConfigurationResponseObserverForTest(null);
  }
}

async function requestWhileContentPersistenceHeld<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let observedStatus: number | null = null;

  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setContentManagementResponseObserverForTest((observedRoute, status) => {
    if (observedRoute === route) observedStatus = status;
  });

  const pending = runner();
  try {
    await saveStarted;
    assert.equal(observedStatus, null);
    releaseSave();
    const result = await pending;
    assert.ok(
      observedStatus !== null && observedStatus >= 200 && observedStatus < 300,
      `content response observer was not reached: ${JSON.stringify(result)}`,
    );
    return result;
  } finally {
    releaseSave();
    setDatabaseSaveBarrierForTest(null);
    setContentManagementResponseObserverForTest(null);
  }
}

async function requestWhileRuntimePersistenceHeld<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let observedStatus: number | null = null;

  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setRuntimeDurabilityResponseObserverForTest((observedRoute, status) => {
    if (observedRoute === route) observedStatus = status;
  });

  const pending = runner();
  try {
    await saveStarted;
    assert.equal(observedStatus, null);
    releaseSave();
    const result = await pending;
    assert.ok(
      observedStatus !== null && observedStatus >= 200 && observedStatus < 300,
      `runtime response observer was not reached: ${JSON.stringify(result)}`,
    );
    return result;
  } finally {
    releaseSave();
    setDatabaseSaveBarrierForTest(null);
    setRuntimeDurabilityResponseObserverForTest(null);
  }
}

async function requestWithRuntimePersistenceFailure<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let successObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    throw new Error(`controlled runtime persistence failure for ${route}`);
  });
  setRuntimeDurabilityResponseObserverForTest((observedRoute, status) => {
    if (observedRoute === route && status >= 200 && status < 300) successObserved = true;
  });
  try {
    const result = await runner();
    assert.equal(successObserved, false);
    return result;
  } finally {
    setDatabaseSaveBarrierForTest(null);
    setRuntimeDurabilityResponseObserverForTest(null);
  }
}

function extractedStorePath(domain: "score-records" | "simulation-sessions" | "usage-sessions"): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.${domain}${extension}`);
}

async function readExtractedStoreRecords<T>(
  domain: "score-records" | "simulation-sessions" | "usage-sessions",
): Promise<T[]> {
  const payload = JSON.parse(await readFile(extractedStorePath(domain), "utf8")) as { records?: T[] };
  return Array.isArray(payload.records) ? payload.records : [];
}

function usageRecordIdForSimulationSession(simulationSessionId: string): string {
  const digest = crypto.createHash("sha256").update(simulationSessionId.trim()).digest("hex").slice(0, 24);
  return `usagesim_${digest}`;
}

async function loadTrainingPacksForRouteTest(orgId: string): Promise<TrainingPack[]> {
  return [
    buildTrainingPack("pack_scope", "org_1", {
      successBehaviors: ["Confirm the customer objective"],
      failurePatterns: ["Skip discovery"],
      requiredBehavioralTriggers: ["scenario:scenario_scope"],
      scoringWeightOverrides: { persuasion: 0.4, clarity: 0.3 },
      complianceConstraints: "Do not reveal internal evaluation guidance.",
      audienceLevel: "Internal manager cohort",
      displayOrder: 0,
    }),
    buildTrainingPack("pack_other", "org_2"),
  ].filter((pack) => pack.organizationId === orgId);
}

async function readPlatformAuditEvents(): Promise<AuditEvent[]> {
  const payload = JSON.parse(await readFile(auditEventsPath(), "utf8")) as {
    events?: AuditEvent[];
  };
  return Array.isArray(payload.events) ? payload.events : [];
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

  await refreshWebAuthTokens(db);
}

async function refreshWebAuthTokens(db: ApiDatabase): Promise<void> {
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
  const sessionIssuedAt = new Date();

  const issue = async (userId: string, accessType: "customer_dashboard_user" | "super_user", orgId: string | null) => {
    const user = db.users.find((entry) => entry.id === userId);
    assert.ok(user);
    const issued = webAuthService.issueSession(user, 14 * 24 * 60, sessionIssuedAt, { accessType, orgId });
    await webAuthStore.saveSession(issued.record);
    return issued.token;
  };

  orgAdminToken = await issue("org_admin", "customer_dashboard_user", "org_1");
  userAdminToken = await issue("user_admin", "customer_dashboard_user", "org_1");
  regularDashboardToken = await issue("regular_dashboard", "customer_dashboard_user", "org_1");
  regularTeamToken = await issue("regular_team", "customer_dashboard_user", "org_1");
  regularOrganizationToken = await issue("regular_organization", "customer_dashboard_user", "org_1");
  orgAdminNoneToken = await issue("org_admin_none", "customer_dashboard_user", "org_1");
  userAdminNoneToken = await issue("user_admin_none", "customer_dashboard_user", "org_1");
  superToken = await issue("super_user", "super_user", null);
  dashboardDisabledToken = await issue("eligible_user_admin", "customer_dashboard_user", "org_1");
  inactiveDashboardToken = await issue("disabled_user_admin", "customer_dashboard_user", "org_1");
}

beforeEach(async () => {
  // These stateful route tests deliberately mutate roles and permissions. Each
  // test starts with newly authenticated fixture sessions; a mutation within a
  // test must still invalidate that test's original token.
  if (dbPath) {
    await refreshWebAuthTokens(await readDb());
  }
});

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
  process.env.ENABLE_INTERNAL_DEBUG_ENDPOINTS = "true";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.DATABASE_URL;

  await seedStores();

  const imported = await import("./index.js");
  setSimulationAiBudgetGraceForTest = imported.setSimulationAiBudgetGraceForTest;
  ensureDatabaseShapeForTest = imported.ensureDatabaseShape;
  ensureDemoEnterpriseDataForTest = imported.ensureDemoEnterpriseData;
  setDashboardOrganizationPerformanceQueryForTest = imported.setDashboardOrganizationPerformanceQueryForTest;
  setDashboardOrganizationPerformanceIntelligenceQueryForTest =
    imported.setDashboardOrganizationPerformanceIntelligenceQueryForTest;
  setDashboardTeamPerformanceQueryForTest = imported.setDashboardTeamPerformanceQueryForTest;
  setDashboardTeamPerformanceIntelligenceQueryForTest =
    imported.setDashboardTeamPerformanceIntelligenceQueryForTest;
  setDashboardTrainingPackLoaderForTest = imported.setDashboardTrainingPackLoaderForTest;
  setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
  setDatabaseSaveBarrierForTest = imported.setDatabaseSaveBarrierForTest;
  setWebSessionRevocationFailureForTest = imported.setWebSessionRevocationFailureForTest;
  setFocusTopicDeleteResponseObserverForTest = imported.setFocusTopicDeleteResponseObserverForTest;
  setIdentityAdministrationResponseObserverForTest = imported.setIdentityAdministrationResponseObserverForTest;
  setOrganizationConfigurationResponseObserverForTest = imported.setOrganizationConfigurationResponseObserverForTest;
  setContentManagementResponseObserverForTest = imported.setContentManagementResponseObserverForTest;
  setRuntimeDurabilityResponseObserverForTest = imported.setRuntimeDurabilityResponseObserverForTest;
  setContentManagementTrainingPackStoreForTest = imported.setContentManagementTrainingPackStoreForTest;
  setTrainingPackOrderAuditFailureForTest = imported.setTrainingPackOrderAuditFailureForTest;
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
    async deidentifyActor() {
      return 0;
    },
  });
  imported.setOrganizationProductSettingsStoreForTest({
    async initialize() {},
    async get(orgId: string) {
      return productSettingsRows.get(orgId) ?? {
        orgId,
        allowCustomerScenarioCreation: false,
        requireOrgAdminScenarioApproval: true,
        allowUserAdminFocusTopicManagement: false,
        allowManagerFocusTopicManagement: false,
        updatedByAdminSessionId: null,
        updatedAt: null,
      };
    },
    async setSwitch(input) {
      const previous = productSettingsRows.get(input.orgId) ?? {
        orgId: input.orgId,
        allowCustomerScenarioCreation: false,
        requireOrgAdminScenarioApproval: true,
        allowUserAdminFocusTopicManagement: false,
        allowManagerFocusTopicManagement: false,
        updatedByAdminSessionId: null,
        updatedAt: null,
      };
      const current = {
        ...previous,
        [input.switchKey]: input.enabled,
        updatedByAdminSessionId: input.adminSessionId,
        updatedAt: (input.updatedAt ?? new Date()).toISOString(),
      };
      const changed = previous[input.switchKey] !== input.enabled;
      productSettingsRows.set(input.orgId, current);
      if (changed) productSettingsAuditEvents.push(input.auditEvent);
      return { previous, current, switchKey: input.switchKey, changed };
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
    async listScenarioOptions(params) {
      trainingContentManagementRouteCalls.push({ method: "scenarios", params });
      authorizeTrainingContentManagement(params);
      return [{
        id: "scenario_scope",
        title: "Scoped scenario",
        source: "standard",
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

async function verifyOrganizationDomainsAreRetired() {
  const first = await adminRequest("/orgs", {
    method: "POST",
    body: JSON.stringify({
      name: "Domainless One",
      contactEmail: "owner@shared.example",
      emailDomain: "legacy-input.example",
    }),
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.emailDomain, null);

  const second = await adminRequest("/orgs", {
    method: "POST",
    body: JSON.stringify({
      name: "Domainless Two",
      contactEmail: "other@shared.example",
      emailDomain: "legacy-input.example",
    }),
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.emailDomain, null);

  const withoutContactEmail = await adminRequest("/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Domainless Without Contact" }),
  });
  assert.equal(withoutContactEmail.status, 201);
  assert.equal(withoutContactEmail.body.emailDomain, null);
  assert.equal(
    new Set([first.body.joinCode, second.body.joinCode, withoutContactEmail.body.joinCode]).size,
    3,
  );

  const firstId = String(first.body.id);
  const contactUpdate = await adminRequest(`/orgs/${firstId}`, {
    method: "PATCH",
    body: JSON.stringify({ contactEmail: "changed@shared.example" }),
  });
  assert.equal(contactUpdate.status, 200);
  assert.equal(contactUpdate.body.emailDomain, null);

  const ignoredLegacyPatch = await adminRequest("/orgs/org_1", {
    method: "PATCH",
    body: JSON.stringify({ emailDomain: "replacement.example" }),
  });
  assert.equal(ignoredLegacyPatch.status, 200);
  assert.equal(ignoredLegacyPatch.body.emailDomain, "acme.example");

  const raw = await readDb();
  raw.orgs[0] = { ...raw.orgs[0], emailDomain: " Shared.EXAMPLE " };
  raw.orgs[1] = { ...raw.orgs[1], emailDomain: " Shared.EXAMPLE " };
  const normalized = ensureDatabaseShapeForTest(raw);
  assert.equal(normalized.orgs[0]?.emailDomain, " Shared.EXAMPLE ");
  assert.equal(normalized.orgs[1]?.emailDomain, " Shared.EXAMPLE ");
}

async function verifySameDomainUsersCanJoinDifferentOrganizations() {
  const onboardAndVerify = async (email: string, joinCode: string) => {
    const { result: onboarded, code } = await captureVerificationCode(() =>
      publicRequest("/mobile/onboard", {
        method: "POST",
        body: JSON.stringify({
          email,
          firstName: "Same",
          lastName: "Domain",
          joinCode,
          timezone: "America/Denver",
        }),
      }),
    );
    assert.equal(onboarded.status, 201);
    assert.equal(onboarded.body.domainMatch, null);
    const interimUser = onboarded.body.user as UserProfile;
    const interimToken = String(onboarded.body.authToken);
    const verified = await mobileRequest("/mobile/onboard/verify-email", interimToken, {
      method: "POST",
      body: JSON.stringify({
        userId: interimUser.id,
        code,
        firstName: "Same",
        lastName: "Domain",
        joinCode,
      }),
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.domainMatch, null);
    return {
      user: verified.body.user as UserProfile,
      token: String(verified.body.authToken),
    };
  };

  const first = await onboardAndVerify("same-domain-a@peritio.ai", "ACME2026");
  const second = await onboardAndVerify("same-domain-b@peritio.ai", "OTHER2026");
  const persistedRequests = await waitForPersistedJoinRequests(
    (requests) => requests.some((row) => row.userId === first.user.id) && requests.some((row) => row.userId === second.user.id),
  );
  const firstRequest = persistedRequests.find((row) => row.userId === first.user.id);
  const secondRequest = persistedRequests.find((row) => row.userId === second.user.id);
  assert.equal(firstRequest?.orgId, "org_1");
  assert.equal(secondRequest?.orgId, "org_2");
  assert.equal(firstRequest?.status, "pending");
  assert.equal(secondRequest?.status, "pending");

  for (const request of [firstRequest, secondRequest]) {
    assert.ok(request);
    const approved = await adminRequest(`/org-join-requests/${request.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(approved.status, 200);
  }

  const firstApproved = await mobileRequest(`/mobile/users/${first.user.id}`, first.token);
  const secondApproved = await mobileRequest(`/mobile/users/${second.user.id}`, second.token);
  assert.equal(firstApproved.status, 200);
  assert.equal(secondApproved.status, 200);
  assert.equal(firstApproved.body.orgId, "org_1");
  assert.equal(secondApproved.body.orgId, "org_2");
  assert.equal(firstApproved.body.accountType, "enterprise");
  assert.equal(secondApproved.body.accountType, "enterprise");
  assert.equal((await mobileRequest(`/mobile/users/${first.user.id}/entitlements`, first.token)).status, 200);
  assert.equal((await mobileRequest(`/mobile/users/${second.user.id}/entitlements`, second.token)).status, 200);
}

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
  assert.equal(disabledUser.status, 401);

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

test("organization product settings expose conservative defaults and master-only audited controls", async () => {
  productSettingsRows.clear();
  productSettingsAuditEvents.length = 0;

  const defaults = await adminRequest("/orgs/org_1/product-settings");
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.body.settings, {
    allowCustomerScenarioCreation: false,
    requireOrgAdminScenarioApproval: true,
    allowUserAdminFocusTopicManagement: false,
    allowManagerFocusTopicManagement: false,
    updatedAt: null,
  });

  const orgAdminRead = await dashboardRequest("/dashboard/admin/product-settings", orgAdminToken);
  assert.equal(orgAdminRead.status, 200);
  const userAdminRead = await dashboardRequest("/dashboard/admin/product-settings", userAdminToken);
  assert.equal(userAdminRead.status, 403);
  const unauthenticatedWrite = await publicRequest(
    "/orgs/org_1/product-settings/allowCustomerScenarioCreation",
    { method: "PATCH", body: JSON.stringify({ enabled: true }) },
  );
  assert.equal(unauthenticatedWrite.status, 401);
  for (const [label, token] of [
    ["Org Admin", orgAdminToken],
    ["User Admin and current manager", userAdminToken],
    ["regular dashboard user", regularDashboardToken],
  ] as const) {
    const customerWrite = await dashboardRequest(
      "/orgs/org_1/product-settings/allowCustomerScenarioCreation",
      token,
      { method: "PATCH", body: JSON.stringify({ enabled: true }) },
    );
    assert.equal(customerWrite.status, 401, label);
  }

  for (const switchKey of [
    "allowCustomerScenarioCreation",
    "requireOrgAdminScenarioApproval",
    "allowUserAdminFocusTopicManagement",
    "allowManagerFocusTopicManagement",
  ] as const) {
    const enabled = switchKey !== "requireOrgAdminScenarioApproval";
    const updated = await adminRequest(`/orgs/org_1/product-settings/${switchKey}`, {
      method: "PATCH",
      headers: { "user-agent": "route-test-agent" },
      body: JSON.stringify({ enabled }),
    });
    assert.equal(updated.status, 200, switchKey);
    assert.equal((updated.body.settings as Record<string, unknown>)[switchKey], enabled);
  }
  assert.equal(productSettingsAuditEvents.length, 4);
  assert.equal(productSettingsAuditEvents.every((event) => event.actorType === "platform_admin" && event.orgId === "org_1"), true);
  assert.equal(productSettingsAuditEvents.every((event) => typeof event.metadata?.adminSessionId === "string"), true);
  assert.equal(productSettingsAuditEvents.every((event) => event.metadata?.userAgent === "route-test-agent"), true);

  const repeated = await adminRequest("/orgs/org_1/product-settings/allowCustomerScenarioCreation", {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.changed, false);
  assert.equal(productSettingsAuditEvents.length, 4);

  assert.equal((await adminRequest("/orgs/org_missing/product-settings")).status, 404);
  assert.equal((await adminRequest("/orgs/org_1/product-settings/notASwitch", {
    method: "PATCH", body: JSON.stringify({ enabled: true }),
  })).status, 400);
});

test("organization contact updates remain admin-only, narrow, persistent, and auditable", async () => {
  const unauthorized = await publicRequest("/orgs/org_1", {
    method: "PATCH",
    body: JSON.stringify({
      contactName: "Updated Contact",
      contactEmail: "updated.contact@acme.example",
    }),
  });
  assert.equal(unauthorized.status, 401);

  const before = (await readDb()).orgs.find((org) => org.id === "org_1");
  assert.ok(before);

  const updated = await adminRequest("/orgs/org_1", {
    method: "PATCH",
    body: JSON.stringify({
      contactName: "Updated Contact",
      contactEmail: "updated.contact@acme.example",
    }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.contactName, "Updated Contact");
  assert.equal(updated.body.contactEmail, "updated.contact@acme.example");
  assert.equal(updated.body.name, before.name);
  assert.equal(updated.body.joinCode, before.joinCode);

  await waitForWriteToSettle();
  const persisted = (await readDb()).orgs.find((org) => org.id === "org_1");
  assert.equal(persisted?.contactName, "Updated Contact");
  assert.equal(persisted?.contactEmail, "updated.contact@acme.example");

  const audit = (await readPlatformAuditEvents())
    .filter((event) => event.action === "org.updated" && event.orgId === "org_1")
    .at(-1);
  assert.ok(audit);
  assert.deepEqual((audit.metadata as { fields?: unknown }).fields, ["contactName", "contactEmail"]);
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
        relatedScenarioIds: ["scenario_scope"],
      }),
    }
  );
  assert.equal(created.status, 201);
  assert.equal((created.body.item as any).title, "Created content");
  assert.deepEqual(
    trainingContentManagementRouteCalls.at(-1)?.params.input.relatedScenarioIds,
    ["scenario_scope"]
  );

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
  const scenarioOptions = await dashboardRequest(
    "/dashboard/admin/training-content-targets/scenarios",
    orgAdminToken
  );
  assert.equal(scenarioOptions.status, 200);
  assert.deepEqual(
    (scenarioOptions.body.scenarios as any[]).map((scenario) => scenario.id),
    ["scenario_scope"]
  );

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

function organizationPerformancePath(params: {
  orgId?: string;
  evidenceAt?: string;
  extra?: string;
} = {}): string {
  const evidenceDate = new Date(params.evidenceAt ?? daysAgo(10));
  const query = new URLSearchParams({
    orgId: params.orgId ?? "org_1",
    year: String(evidenceDate.getUTCFullYear()),
    month: String(evidenceDate.getUTCMonth() + 1),
  });
  return `/dashboard/performance/organization?${query.toString()}${params.extra ?? ""}`;
}

test("organization performance route returns the facade result without identity or exact-share fields", async () => {
  const response = await dashboardRequest(organizationPerformancePath(), orgAdminToken);

  assert.equal(response.status, 200);
  assert.equal(response.body.historicalScope, "organization_history");
  assert.equal((response.body.calendarMonth as { timeZone?: string }).timeZone, "UTC");
  assert.ok(response.body.activity);

  const serialized = JSON.stringify(response.body);
  for (const forbiddenField of [
    "subjectKey",
    "userId",
    "evidenceId",
    "sessionId",
    "largestContributionShare",
  ]) {
    assert.equal(serialized.includes(`\"${forbiddenField}\"`), false);
  }
});

test("organization performance route maps facade authorization denials without conflating valid empty data", async () => {
  const validEmpty = await dashboardRequest(
    "/dashboard/performance/organization?orgId=org_1&year=2024&month=1",
    orgAdminToken,
  );
  assert.equal(validEmpty.status, 200);
  assert.equal((validEmpty.body.activity as { attemptCount?: number }).attemptCount, 0);
  assert.deepEqual(validEmpty.body.metricGroups, []);

  for (const [label, token] of [["regular team", regularTeamToken], ["org admin none", orgAdminNoneToken]] as const) {
    const denied = await dashboardRequest(organizationPerformancePath(), token);
    assert.equal(denied.status, 403, `${label}: ${JSON.stringify(denied.body)}`);
    assert.equal(denied.body.error, "Organization performance access required.");
    assert.equal(denied.body.code, "dashboard_scope_denied");
  }

  const crossOrganization = await dashboardRequest(
    organizationPerformancePath({ orgId: "org_2", evidenceAt: daysAgo(6) }),
    orgAdminToken,
  );
  assert.equal(crossOrganization.status, 404);
  assert.equal(crossOrganization.body.error, "Performance workspace not found.");

  const missingCustomerOrganization = await dashboardRequest(
    organizationPerformancePath({ orgId: "org_missing" }),
    orgAdminToken,
  );
  assert.equal(missingCustomerOrganization.status, 404);
  assert.equal(missingCustomerOrganization.body.error, "Performance workspace not found.");

  const dashboardDisabled = await dashboardRequest(organizationPerformancePath(), dashboardDisabledToken);
  assert.equal(dashboardDisabled.status, 403);

  const inactive = await dashboardRequest(organizationPerformancePath(), inactiveDashboardToken);
  assert.ok(inactive.status === 401 || inactive.status === 403);

  const superUser = await dashboardRequest(organizationPerformancePath({
    orgId: "org_2",
    evidenceAt: daysAgo(6),
  }), superToken);
  assert.equal(superUser.status, 200);
  assert.ok(superUser.body.activity);

  const missingSuperUserOrganization = await dashboardRequest(
    organizationPerformancePath({ orgId: "org_missing" }),
    superToken,
  );
  assert.equal(missingSuperUserOrganization.status, 404);
  assert.equal(missingSuperUserOrganization.body.error, "Performance workspace not found.");
});

test("organization performance route validates month and single-dimension query input", async () => {
  const invalidMonth = await dashboardRequest(
    "/dashboard/performance/organization?orgId=org_1&year=2026&month=13",
    orgAdminToken,
  );
  assert.equal(invalidMonth.status, 400);

  const invalidDimension = await dashboardRequest(
    organizationPerformancePath({ extra: "&dimension=person&dimensionId=user_1" }),
    orgAdminToken,
  );
  assert.equal(invalidDimension.status, 400);

  const repeatedDimension = await dashboardRequest(
    organizationPerformancePath({ extra: "&dimension=division&dimension=scenario&dimensionId=division_a" }),
    orgAdminToken,
  );
  assert.equal(repeatedDimension.status, 400);

  const unsupportedRange = await dashboardRequest(
    organizationPerformancePath({ extra: "&from=2026-09-01&to=2026-10-01" }),
    orgAdminToken,
  );
  assert.equal(unsupportedRange.status, 400);

  const filtered = await dashboardRequest(
    organizationPerformancePath({
      evidenceAt: daysAgo(9),
      extra: "&dimension=division&dimensionId=division_a",
    }),
    orgAdminToken,
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.historicalScope, "current_population");
  assert.deepEqual(filtered.body.dimensionFilter, { dimension: "division", id: "division_a" });
});

test("organization performance route keeps mixed-organization invariants on the internal-error path", async () => {
  setDashboardOrganizationPerformanceQueryForTest(() => {
    throw new AuthorizedOrganizationPerformanceInvariantError();
  });
  try {
    const response = await dashboardRequest(organizationPerformancePath(), orgAdminToken);
    assert.equal(response.status, 500);
    assert.equal(response.body.error, "Organization performance query failed.");
  } finally {
    setDashboardOrganizationPerformanceQueryForTest(null);
  }
});

test("organization intelligence HTTP route returns current-members facts and signals without identity or history metadata", async () => {
  const emptyRoute = "/dashboard/performance/organization/intelligence?orgId=org_1&year=2024&month=1";
  const response = await dashboardRequest(emptyRoute, orgAdminToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.scope, "organization");
  assert.equal(response.body.populationBasis, "current_members");
  assert.equal(typeof response.body.asOf, "string");
  assert.equal((response.body.population as { currentMemberCount?: number }).currentMemberCount! > 0, true);
  assert.equal((response.body.facts as { activity?: { current?: { attemptCount?: number } } }).activity?.current?.attemptCount, 0);
  assert.ok(response.body.signals);

  const serialized = JSON.stringify(response.body);
  for (const forbidden of [
    "userId", "subjectKey", "name", "email", "memberIds", "managerUserId",
    "evidenceId", "sessionId", "scenarioId", "trainingId", "trainingPackId",
    "profileKey", "largestContributionShare", "organization_history",
    "historicalPrivacyAdjustmentApplied", "protectedContributor",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }

  const superUser = await dashboardRequest(
    "/dashboard/performance/organization/intelligence?orgId=org_2&year=2024&month=1",
    superToken,
  );
  assert.equal(superUser.status, 200);
  assert.equal(superUser.body.populationBasis, "current_members");
});

test("organization intelligence HTTP route enforces inputs, scope, existence hiding, safe 500, and transient 503", async () => {
  const route = "/dashboard/performance/organization/intelligence?orgId=org_1&year=2026&month=9";
  for (const extra of [
    "&month=10",
    "&orgId=org_1",
    "&asOf=2026-10-01T00:00:00Z",
    "&userId=user",
    "&managerId=manager",
    "&memberId=member",
    "&dimension=division",
    "&dimensionId=division_a",
    "&trainingId=training_a",
    "&scenarioId=scenario_a",
    "&trainingPackId=pack_a",
    "&from=2026-09-01",
    "&to=2026-10-01",
    "&unexpected=value",
  ]) {
    assert.equal((await dashboardRequest(route + extra, orgAdminToken)).status, 400, extra);
  }

  for (const [label, token] of [["regular team", regularTeamToken], ["org admin none", orgAdminNoneToken], ["user admin none", userAdminNoneToken]] as const) {
    const denied = await dashboardRequest(route, token);
    assert.equal(denied.status, 403, label);
    assert.equal(denied.body.code, "dashboard_scope_denied");
  }

  const crossOrg = await dashboardRequest(route.replace("orgId=org_1", "orgId=org_2"), orgAdminToken);
  const missing = await dashboardRequest(route.replace("orgId=org_1", "orgId=org_missing"), orgAdminToken);
  assert.equal(crossOrg.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(crossOrg.body, missing.body);

  setDashboardOrganizationPerformanceIntelligenceQueryForTest(() => {
    throw new Error("internal organization intelligence secret");
  });
  try {
    const failure = await dashboardRequest(route, orgAdminToken);
    assert.equal(failure.status, 500);
    assert.equal(failure.body.error, "Organization performance intelligence query failed.");
    assert.equal(JSON.stringify(failure.body).includes("internal organization intelligence secret"), false);
  } finally {
    setDashboardOrganizationPerformanceIntelligenceQueryForTest(null);
  }

  setDashboardOrganizationPerformanceIntelligenceQueryForTest(() => {
    const transient = new Error("connection terminated unexpectedly") as Error & { code: string };
    transient.code = "57P01";
    throw transient;
  });
  try {
    const unavailable = await dashboardRequest(route, orgAdminToken);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error, "Database temporarily unavailable. Please retry.");
  } finally {
    setDashboardOrganizationPerformanceIntelligenceQueryForTest(null);
  }
});

test("team performance HTTP route returns a current-population, identity-free aggregate", async () => {
  const route = organizationPerformancePath().replace("/organization?", "/team?");
  const team = await dashboardRequest(route, regularTeamToken);
  assert.equal(team.status, 200);
  assert.equal(team.body.historicalScope, "current_population");
  assert.equal(team.body.dimensionFilter, null);
  assert.equal(team.body.historicalPrivacyAdjustmentApplied, false);
  assert.equal((team.body.calendarMonth as { timeZone?: string }).timeZone, "UTC");
  assert.equal((team.body.activity as { attemptCount?: number }).attemptCount, 0);
  for (const forbidden of ["userId", "subjectKey", "managerUserId", "evidenceId", "largestContributionShare"]) {
    assert.equal(JSON.stringify(team.body).includes(`"${forbidden}"`), false);
  }
  const broader = await dashboardRequest(route, regularOrganizationToken);
  assert.equal(broader.status, 200);
  assert.equal(broader.body.historicalScope, "current_population");

  const managerRoute = organizationPerformancePath({ evidenceAt: daysAgo(9) })
    .replace("/organization?", "/team?");
  const manager = await dashboardRequest(managerRoute, userAdminToken);
  assert.equal(manager.status, 200);
  assert.equal(manager.body.historicalScope, "current_population");
});

test("team performance HTTP route keeps 400, 403, 404, and generic 500 distinct", async () => {
  const route = organizationPerformancePath().replace("/organization?", "/team?");
  for (const extra of ["&month=10", "&dimension=division&dimensionId=division_a", "&from=2026-09-01"]) {
    assert.equal((await dashboardRequest(route + extra, regularTeamToken)).status, 400);
  }
  for (const [label, token] of [["org admin none", orgAdminNoneToken], ["user admin none", userAdminNoneToken]] as const) {
    const denied = await dashboardRequest(route, token);
    assert.equal(denied.status, 403, label);
    assert.equal(denied.body.code, "dashboard_scope_denied");
  }
  const crossOrg = await dashboardRequest(route.replace("orgId=org_1", "orgId=org_2"), regularTeamToken);
  assert.equal(crossOrg.status, 404);
  const nonexistent = await dashboardRequest(route.replace("orgId=org_1", "orgId=org_missing"), regularTeamToken);
  assert.equal(nonexistent.status, 404);

  setDashboardTeamPerformanceQueryForTest(() => { throw new Error("internal hierarchy secret"); });
  try {
    const failure = await dashboardRequest(route, regularTeamToken);
    assert.equal(failure.status, 500);
    assert.equal(JSON.stringify(failure.body).includes("internal hierarchy secret"), false);
  } finally {
    setDashboardTeamPerformanceQueryForTest(null);
  }
});

test("team intelligence HTTP route returns route-safe facts and signals for authorized Team scopes", async () => {
  const emptyRoute = "/dashboard/performance/team/intelligence?orgId=org_1&year=2024&month=1";
  const team = await dashboardRequest(emptyRoute, regularTeamToken);
  assert.equal(team.status, 200);
  assert.equal(team.body.scope, "team");
  assert.equal(typeof team.body.asOf, "string");
  assert.deepEqual(team.body.population, { currentReportCount: 0, hasCurrentReports: false });
  assert.ok(team.body.facts);
  assert.ok(team.body.signals);

  const organization = await dashboardRequest(emptyRoute, regularOrganizationToken);
  assert.equal(organization.status, 200);
  assert.deepEqual(organization.body.population, { currentReportCount: 0, hasCurrentReports: false });

  const populatedRoute = organizationPerformancePath({ evidenceAt: daysAgo(9) })
    .replace("/organization?", "/team/intelligence?");
  const populated = await dashboardRequest(populatedRoute, userAdminToken);
  assert.equal(populated.status, 200);
  assert.equal((populated.body.population as { currentReportCount?: number }).currentReportCount, 4);
  assert.ok((populated.body.facts as { activity?: unknown }).activity);

  const serialized = JSON.stringify(populated.body);
  for (const forbidden of [
    "userId", "subjectKey", "managerUserId", "evidenceId", "simulationSessionId",
    "scenarioId", "trainingId", "profileKey", "largestContributionShare",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
});

test("team intelligence HTTP route enforces input, access, existence hiding, safe 500, and transient 503", async () => {
  const route = "/dashboard/performance/team/intelligence?orgId=org_1&year=2026&month=9";
  for (const extra of [
    "&month=10",
    "&orgId=org_1",
    "&asOf=2026-10-01T00:00:00Z",
    "&managerId=manager",
    "&userId=report",
    "&dimension=division",
    "&trainingId=training_a",
    "&scenarioId=scenario_a",
    "&from=2026-09-01",
  ]) {
    assert.equal((await dashboardRequest(route + extra, regularTeamToken)).status, 400);
  }

  for (const [label, token] of [["org admin none", orgAdminNoneToken], ["user admin none", userAdminNoneToken]] as const) {
    const denied = await dashboardRequest(route, token);
    assert.equal(denied.status, 403, label);
    assert.equal(denied.body.code, "dashboard_scope_denied");
  }
  assert.equal(
    (await dashboardRequest(route.replace("orgId=org_1", "orgId=org_2"), regularTeamToken)).status,
    404,
  );
  assert.equal(
    (await dashboardRequest(route.replace("orgId=org_1", "orgId=org_missing"), regularTeamToken)).status,
    404,
  );

  setDashboardTeamPerformanceIntelligenceQueryForTest(() => {
    throw new Error("internal intelligence secret");
  });
  try {
    const failure = await dashboardRequest(route, regularTeamToken);
    assert.equal(failure.status, 500);
    assert.equal(failure.body.error, "Team performance intelligence query failed.");
    assert.equal(JSON.stringify(failure.body).includes("internal intelligence secret"), false);
  } finally {
    setDashboardTeamPerformanceIntelligenceQueryForTest(null);
  }

  setDashboardTeamPerformanceIntelligenceQueryForTest(() => {
    const transient = new Error("connection terminated unexpectedly") as Error & { code: string };
    transient.code = "57P01";
    throw transient;
  });
  try {
    const unavailable = await dashboardRequest(route, regularTeamToken);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error, "Database temporarily unavailable. Please retry.");
  } finally {
    setDashboardTeamPerformanceIntelligenceQueryForTest(null);
  }
});

test("dashboard admin users are tenant-scoped and regular users cannot access Admin", async () => {
  const denied = await dashboardRequest("/dashboard/admin/users", regularDashboardToken);
  assert.equal(denied.status, 403);

  const result = await dashboardRequest("/dashboard/admin/users");
  assert.equal(result.status, 200);
  const users = result.body.users as Array<{
    userId: string;
    employeeId: string | null;
    performanceAccess: "none" | "team" | "organization";
  }>;
  assert.equal(users.some((user) => user.userId === "learner"), true);
  assert.equal(users.some((user) => user.userId === "other_org_user"), false);
  assert.equal(users.find((user) => user.userId === "learner")?.employeeId, "EMP-1");
  assert.equal(users.find((user) => user.userId === "org_admin")?.performanceAccess, "organization");
  assert.equal(users.find((user) => user.userId === "user_admin")?.performanceAccess, "team");
  assert.equal(users.find((user) => user.userId === "learner")?.performanceAccess, "none");
  assert.equal((result.body.viewer as { performanceAccess?: string }).performanceAccess, "organization");
  assert.equal(
    (result.body.viewer as { capabilities?: { managePerformanceAccess?: boolean } }).capabilities?.managePerformanceAccess,
    true
  );
});

test("user-admin users see all same-organization users with regular-user administration capabilities", async () => {
  const result = await dashboardRequest("/dashboard/admin/users", userAdminToken);
  assert.equal(result.status, 200);

  const users = result.body.users as Array<{
    userId: string;
    canEditEmployeeId: boolean;
    canEditNames: boolean;
    canAssignManager: boolean;
    canDeactivate: boolean;
  }>;
  const userIds = users.map((user) => user.userId);
  for (const expected of ["learner", "unassigned_learner", "other_manager_report", "eligible_user_admin", "org_admin"]) {
    assert.equal(userIds.includes(expected), true, expected);
  }
  assert.equal(userIds.includes("other_org_user"), false);
  const regularRow = users.find((user) => user.userId === "unassigned_learner");
  assert.deepEqual(
    { editId: regularRow?.canEditEmployeeId, editNames: regularRow?.canEditNames, manager: regularRow?.canAssignManager },
    { editId: true, editNames: true, manager: true },
  );
  const privilegedRow = users.find((user) => user.userId === "org_admin");
  assert.deepEqual(
    { editId: privilegedRow?.canEditEmployeeId, editNames: privilegedRow?.canEditNames, manager: privilegedRow?.canAssignManager, deactivate: privilegedRow?.canDeactivate },
    { editId: false, editNames: false, manager: false, deactivate: false },
  );
  assert.equal((result.body.managerOptions as Array<{ userId: string }>).some((row) => row.userId === "org_admin_peer"), true);

  const viewer = result.body.viewer as {
    performanceAccess?: string;
    capabilities?: {
      approveRejectAccessRequests?: boolean;
      assignUserManagers?: boolean;
      managePerformanceAccess?: boolean;
    };
  };
  assert.equal(viewer.performanceAccess, "team");
  assert.equal(viewer.capabilities?.approveRejectAccessRequests, true);
  assert.equal(viewer.capabilities?.assignUserManagers, true);
  assert.equal(viewer.capabilities?.managePerformanceAccess, false);
});

test("mobile and self-service mutation routes cannot write performance access", async () => {
  const mobileAdminOnlyField = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/unassigned_learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ performanceAccess: "organization" }),
    }
  );
  assert.equal(mobileAdminOnlyField.status, 400);

  const mobileSelfPatch = await mobileRequest("/mobile/users/org_admin/settings", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "none" }),
  });
  assert.equal(mobileSelfPatch.status, 200);
  assert.equal("performanceAccess" in mobileSelfPatch.body, false);

  const mobileProfile = await mobileRequest("/mobile/users/org_admin", "token_org_admin");
  assert.equal(mobileProfile.status, 200);
  assert.equal("performanceAccess" in mobileProfile.body, false);

  assert.equal((await readUser("unassigned_learner"))?.performanceAccess, "none");
  assert.equal((await readUser("org_admin"))?.performanceAccess, "organization");
});

test("dashboard performance-access mutation is authorized, audited, isolated, and effective next request", async () => {
  const selfDenied = await dashboardRequest("/dashboard/admin/users/org_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "none" }),
  });
  assert.equal(selfDenied.status, 403);
  assert.equal(selfDenied.body.code, "dashboard_scope_denied");

  const userAdminElevated = await adminRequest("/users/user_admin", {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "organization" }),
  });
  assert.equal(userAdminElevated.status, 200);
  await refreshWebAuthTokens(await readDb());
  const userAdminDenied = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(userAdminDenied.status, 403);
  assert.equal((await readUser("learner"))?.performanceAccess, "none");
  await adminRequest("/users/user_admin", {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });

  const regularDenied = await dashboardRequest("/dashboard/admin/users/regular_dashboard", regularDashboardToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(regularDenied.status === 403 || regularDenied.status === 404, true);

  const crossOrgDenied = await dashboardRequest("/dashboard/admin/users/other_org_user", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(crossOrgDenied.status, 404);

  for (const invalidValue of ["", "admin", "manager", "all", "org", null, [], {}, "TEAM"]) {
    const invalid = await dashboardRequest("/dashboard/admin/users/regular_manager_to_promote", orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ performanceAccess: invalidValue }),
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalidValue));
  }
  assert.equal((await readUser("regular_manager_to_promote"))?.performanceAccess, "none");

  const targetBefore = await readUser("user_admin_none");
  const reportBefore = await readUser("unassigned_learner");
  assert.ok(targetBefore);
  assert.ok(reportBefore);
  const changedToTeam = await dashboardRequest("/dashboard/admin/users/user_admin_none", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(changedToTeam.status, 200);
  const changedRow = changedToTeam.body.user as {
    performanceAccess?: string;
    orgRole?: string;
    managerUserId?: string | null;
    dashboardAccessEnabled?: boolean;
    status?: string;
  };
  assert.equal(changedRow.performanceAccess, "team");
  assert.equal(changedRow.orgRole, targetBefore.orgRole);
  assert.equal(changedRow.managerUserId, targetBefore.managerUserId ?? null);
  assert.equal(changedRow.dashboardAccessEnabled, targetBefore.dashboardAccessEnabled);
  assert.equal(changedRow.status, targetBefore.status);
  assert.equal((await readUser("unassigned_learner"))?.managerUserId, reportBefore.managerUserId);

  await refreshWebAuthTokens(await readDb());
  const nextRequestTeamScope = await dashboardRequest("/dashboard/users", userAdminNoneToken);
  assert.equal(nextRequestTeamScope.status, 200);
  assert.deepEqual(
    (nextRequestTeamScope.body.users as Array<{ userId: string }>).map((user) => user.userId).sort(),
    ["unassigned_learner", "user_admin_none"]
  );

  await waitForWriteToSettle();
  const changeEventsBeforeNoOp = (await readPlatformAuditEvents()).filter(
    (event) => event.action === "org_user.performance_access.changed" && event.userId === "user_admin_none"
  );
  const audit = changeEventsBeforeNoOp.at(-1);
  assert.ok(audit);
  assert.equal(audit.actorType, "web_user");
  assert.equal(audit.actorId, "org_admin");
  assert.deepEqual(audit.metadata, {
    previousPerformanceAccess: "none",
    nextPerformanceAccess: "team",
  });

  const noOp = await dashboardRequest("/dashboard/admin/users/user_admin_none", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(noOp.status, 200);
  await waitForWriteToSettle();
  const changeEventsAfterNoOp = (await readPlatformAuditEvents()).filter(
    (event) => event.action === "org_user.performance_access.changed" && event.userId === "user_admin_none"
  );
  assert.equal(changeEventsAfterNoOp.length, changeEventsBeforeNoOp.length);

  const changedToOrganization = await dashboardRequest("/dashboard/admin/users/user_admin_none", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "organization" }),
  });
  assert.equal(changedToOrganization.status, 200);
  assert.equal((changedToOrganization.body.user as { performanceAccess?: string }).performanceAccess, "organization");

  const changedBackToNone = await dashboardRequest("/dashboard/admin/users/user_admin_none", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "none" }),
  });
  assert.equal(changedBackToNone.status, 200);
  await refreshWebAuthTokens(await readDb());
  const nextRequestNoneScope = await dashboardRequest("/dashboard/users", userAdminNoneToken);
  assert.equal(nextRequestNoneScope.status, 200);
  assert.deepEqual(nextRequestNoneScope.body.users, []);
  assert.equal((await readUser("unassigned_learner"))?.managerUserId, reportBefore.managerUserId);

  const dashboardDisabledTarget = await dashboardRequest(
    "/dashboard/admin/users/regular_manager_to_promote",
    orgAdminToken,
    { method: "PATCH", body: JSON.stringify({ performanceAccess: "team" }) }
  );
  assert.equal(dashboardDisabledTarget.status, 200);
  assert.equal((dashboardDisabledTarget.body.user as { dashboardAccessEnabled?: boolean }).dashboardAccessEnabled, false);
  assert.equal((await readUser("regular_manager_to_promote_report"))?.managerUserId, "regular_manager_to_promote");
  const removedLastReport = await dashboardRequest(
    "/dashboard/admin/users/regular_manager_to_promote_report",
    orgAdminToken,
    { method: "PATCH", body: JSON.stringify({ managerUserId: "eligible_user_admin" }) }
  );
  assert.equal(removedLastReport.status, 200);
  assert.equal((await readUser("regular_manager_to_promote"))?.performanceAccess, "team");
  const restoredReport = await dashboardRequest(
    "/dashboard/admin/users/regular_manager_to_promote_report",
    orgAdminToken,
    { method: "PATCH", body: JSON.stringify({ managerUserId: "regular_manager_to_promote" }) }
  );
  assert.equal(restoredReport.status, 200);
  const restoredManagerAccess = await dashboardRequest(
    "/dashboard/admin/users/regular_manager_to_promote",
    orgAdminToken,
    { method: "PATCH", body: JSON.stringify({ performanceAccess: "none" }) }
  );
  assert.equal(restoredManagerAccess.status, 200);

  const superUserChange = await dashboardRequest(
    "/dashboard/admin/users/other_org_user?orgId=org_2",
    superToken,
    { method: "PATCH", body: JSON.stringify({ performanceAccess: "team" }) }
  );
  assert.equal(superUserChange.status, 200);
  assert.equal((superUserChange.body.user as { performanceAccess?: string }).performanceAccess, "team");
  const superUserRestore = await dashboardRequest(
    "/dashboard/admin/users/other_org_user?orgId=org_2",
    superToken,
    { method: "PATCH", body: JSON.stringify({ performanceAccess: "none" }) }
  );
  assert.equal(superUserRestore.status, 200);
});

test("dashboard performance routes enforce independent team, organization, and none scope", async () => {
  const teamUsers = await dashboardRequest("/dashboard/users", regularTeamToken);
  assert.equal(teamUsers.status, 200);
  assert.deepEqual(
    (teamUsers.body.users as Array<{ userId: string }>).map((user) => user.userId).sort(),
    ["regular_team"]
  );

  const directAttempt = await dashboardRequest("/dashboard/attempts/score_direct", userAdminToken);
  assert.equal(directAttempt.status, 200);
  const unrelatedAttempt = await dashboardRequest("/dashboard/attempts/score_unassigned", userAdminToken);
  assert.equal(unrelatedAttempt.status, 404);
  assert.equal(unrelatedAttempt.body.error, "Attempt detail not found.");
  const crossOrgAttempt = await dashboardRequest("/dashboard/attempts/score_other_org", userAdminToken);
  assert.equal(crossOrgAttempt.status, 404);

  const otherDivision = await dashboardRequest("/dashboard/users?divisionId=division_b", userAdminToken);
  assert.equal(otherDivision.status, 200);
  assert.equal(
    (otherDivision.body.users as Array<{ userId: string }>).some((user) => user.userId === "unassigned_learner"),
    false
  );

  const organizationAttempt = await dashboardRequest("/dashboard/attempts/score_unassigned", regularOrganizationToken);
  assert.equal(organizationAttempt.status, 200);
  const organizationCrossOrg = await dashboardRequest("/dashboard/attempts/score_other_org", regularOrganizationToken);
  assert.equal(organizationCrossOrg.status, 404);
  const organizationAdminDenied = await dashboardRequest("/dashboard/admin/users", regularOrganizationToken);
  assert.equal(organizationAdminDenied.status, 403);

  const noneAttempt = await dashboardRequest("/dashboard/attempts/score_direct", orgAdminNoneToken);
  assert.equal(noneAttempt.status, 404);
  const noneUsers = await dashboardRequest("/dashboard/users", orgAdminNoneToken);
  assert.equal(noneUsers.status, 200);
  assert.deepEqual(noneUsers.body.users, []);
  const noneAdminDirectory = await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken);
  assert.equal(noneAdminDirectory.status, 200);
});

test("org admins without performance scope receive organization billing usage without performance rows", async () => {
  const overview = await dashboardRequest("/dashboard/overview", orgAdminNoneToken);
  assert.equal(overview.status, 200);
  const summary = overview.body.summary as {
    monthlyUsageMinutes: number;
    simulationsLast30Days: number;
    averageScoreThisPeriod: number | null;
  };
  assert.equal(summary.monthlyUsageMinutes, 20);
  assert.equal(summary.simulationsLast30Days, 0);
  assert.equal(summary.averageScoreThisPeriod, null);

  const customers = overview.body.customers as Array<{
    orgId: string;
    usedMinutesThisPeriod: number;
    simulationsLast30Days: number;
    averageScoreThisPeriod: number | null;
    customerUserEmails: string[];
  }>;
  const customer = customers.find((row) => row.orgId === "org_1");
  assert.ok(customer);
  assert.equal(customer.usedMinutesThisPeriod, 20);
  assert.equal(customer.simulationsLast30Days, 0);
  assert.equal(customer.averageScoreThisPeriod, null);
  assert.deepEqual(customer.customerUserEmails, []);
  assert.deepEqual(overview.body.topScenarios, []);
});

test("user admin with no performance access gets empty reporting scope without losing admin scope", async () => {
  const overview = await dashboardRequest("/dashboard/overview", userAdminNoneToken);
  assert.equal(overview.status, 200);
  const summary = overview.body.summary as {
    activeUsers: number;
    simulationsLast30Days: number;
    averageScoreThisPeriod: number | null;
  };
  assert.equal(summary.activeUsers, 0);
  assert.equal(summary.simulationsLast30Days, 0);
  assert.equal(summary.averageScoreThisPeriod, null);

  const users = await dashboardRequest("/dashboard/users", userAdminNoneToken);
  assert.equal(users.status, 200);
  assert.deepEqual(users.body.users, []);

  const directReportAttempt = await dashboardRequest("/dashboard/attempts/score_unassigned", userAdminNoneToken);
  assert.equal(directReportAttempt.status, 404);
  assert.equal(directReportAttempt.body.error, "Attempt detail not found.");

  const adminDirectory = await dashboardRequest("/dashboard/admin/users", userAdminNoneToken);
  assert.equal(adminDirectory.status, 200);
  const adminUserIds = (adminDirectory.body.users as Array<{ userId: string }>).map((user) => user.userId);
  assert.equal(adminUserIds.includes("user_admin_none"), true);
  assert.equal(adminUserIds.includes("unassigned_learner"), true);
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

test("dashboard division route filtering stays tenant-bound and fails closed on mismatched attempts", async () => {
  const userDetail = await dashboardRequest(
    "/dashboard/users/learner?divisionId=division_a",
    orgAdminToken,
  );
  assert.equal(userDetail.status, 200, JSON.stringify(userDetail.body));
  assert.deepEqual(
    (userDetail.body.attempts as Array<{ activityId: string }>).map((attempt) => attempt.activityId),
    ["score_direct"],
  );
  assert.deepEqual(
    (userDetail.body.assignments as Array<{ assignmentId: string }>).map((assignment) => assignment.assignmentId),
    ["assign_direct"],
  );
  assert.equal(
    (userDetail.body.divisionScope as { appliedDivisionId?: string }).appliedDivisionId,
    "division_a",
  );

  const mismatchedAttempt = await dashboardRequest(
    "/dashboard/attempts/score_direct?divisionId=division_b",
    orgAdminToken,
  );
  assert.equal(mismatchedAttempt.status, 404);
  assert.equal(mismatchedAttempt.body.error, "Attempt detail not found.");

  const crossOrgDivision = await dashboardRequest(
    "/dashboard/users?divisionId=division_other_org",
    orgAdminToken,
  );
  assert.equal(crossOrgDivision.status, 400);
  assert.equal(crossOrgDivision.body.error, "divisionId must reference a division in this company.");

  const inaccessibleAttemptWithMismatchedDivision = await dashboardRequest(
    "/dashboard/attempts/score_other_org?divisionId=division_a",
    orgAdminToken,
  );
  assert.equal(inaccessibleAttemptWithMismatchedDivision.status, 404);
  assert.equal(inaccessibleAttemptWithMismatchedDivision.body.error, "Attempt detail not found.");
});

test("mobile user-admin routes use organization-wide regular-user administration scope", async () => {
  const orgAdminList = await mobileRequest("/mobile/users/org_admin/admin/org/users", "token_org_admin");
  assert.equal(orgAdminList.status, 200);
  const orgAdminUserIds = (orgAdminList.body.users as Array<{ userId: string }>).map((row) => row.userId);
  assert.equal(orgAdminUserIds.includes("unassigned_learner"), true);
  assert.equal(orgAdminUserIds.includes("eligible_user_admin"), true);
  assert.equal(orgAdminUserIds.includes("other_org_user"), false);

  const scopedList = await mobileRequest("/mobile/users/user_admin/admin/org/users", "token_user_admin");
  assert.equal(scopedList.status, 200);
  const scopedUserIds = (scopedList.body.users as Array<{ userId: string }>).map((row) => row.userId);
  assert.equal(scopedUserIds.includes("unassigned_learner"), true);
  assert.equal(scopedUserIds.includes("other_manager_report"), true);
  assert.equal(scopedUserIds.includes("eligible_user_admin"), true);
  assert.equal(scopedUserIds.includes("other_org_user"), false);

  const selfDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/user_admin", "token_user_admin");
  assert.equal(selfDetail.status, 200);
  const directReportDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/learner", "token_user_admin");
  assert.equal(directReportDetail.status, 200);
  const unassignedDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/unassigned_learner", "token_user_admin");
  assert.equal(unassignedDetail.status, 200);
  const otherManagerReportDetail = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(otherManagerReportDetail.status, 200);

  const otherUserAdminPatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/eligible_user_admin", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(otherUserAdminPatch.status, 403);
  const orgAdminPatch = await mobileRequest("/mobile/users/user_admin/admin/org/users/org_admin", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(orgAdminPatch.status, 403);
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
  const mobileNameAndManager = await mobileRequest(
    "/mobile/users/user_admin/admin/org/users/unassigned_learner",
    "token_user_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Updated", lastName: "Learner", managerUserId: "regular_dashboard" }),
    },
  );
  assert.equal(mobileNameAndManager.status, 200);
  const mobileUpdatedUser = await readUser("unassigned_learner");
  assert.equal(mobileUpdatedUser?.firstName, "Updated");
  assert.equal(mobileUpdatedUser?.lastName, "Learner");
  assert.equal(mobileUpdatedUser?.managerUserId, "regular_dashboard");
  const clearMobileManager = await mobileRequest(
    "/mobile/users/user_admin/admin/org/users/unassigned_learner",
    "token_user_admin",
    { method: "PATCH", body: JSON.stringify({ managerUserId: null }) },
  );
  assert.equal(clearMobileManager.status, 200);
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

  const crossTenantDecision = await mobileRequest(
    "/mobile/users/user_admin/admin/org/access-requests/jr_other",
    "token_user_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" })
    }
  );
  assert.equal(crossTenantDecision.status, 404);

  const crossTenantRead = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin");
  assert.equal(crossTenantRead.status, 404);
  const crossTenantWrite = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(crossTenantWrite.status, 404);
});

test("mobile organization score analytics requires organization performance access", async () => {
  const migratedOrgAdmin = await mobileRequest("/mobile/users/org_admin/admin/org/analytics", "token_org_admin");
  assert.equal(migratedOrgAdmin.status, 200);

  const regularOrganization = await mobileRequest(
    "/mobile/users/regular_organization/admin/org/analytics",
    "token_regular_organization"
  );
  assert.equal(regularOrganization.status, 200);
  assert.equal((regularOrganization.body.org as { id?: string }).id, "org_1");

  const teamDenied = await mobileRequest("/mobile/users/regular_team/admin/org/analytics", "token_regular_team");
  assert.equal(teamDenied.status, 403);
  assert.equal(teamDenied.body.error, "Organization performance access required.");

  const orgAdminNoneDenied = await mobileRequest(
    "/mobile/users/org_admin_none/admin/org/analytics",
    "token_org_admin_none"
  );
  assert.equal(orgAdminNoneDenied.status, 403);
  assert.equal(orgAdminNoneDenied.body.error, "Organization performance access required.");

  const migratedAdminDetail = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin"
  );
  assert.equal(migratedAdminDetail.status, 200);
  assert.equal(Number((migratedAdminDetail.body.scores as { sessions?: number }).sessions) > 0, true);

  const redactedAdminDetail = await mobileRequest(
    "/mobile/users/org_admin_none/admin/org/users/learner",
    "token_org_admin_none"
  );
  assert.equal(redactedAdminDetail.status, 200);
  assert.equal((redactedAdminDetail.body.usage as { sessions?: number }).sessions, 1);
  assert.equal((redactedAdminDetail.body.usage as { billedSeconds?: number }).billedSeconds, 300);
  assert.equal((redactedAdminDetail.body.scores as { sessions?: number }).sessions, 0);
  assert.equal((redactedAdminDetail.body.scores as { avgOverallScore?: number | null }).avgOverallScore, null);
  assert.deepEqual((redactedAdminDetail.body.scores as { recent?: unknown[] }).recent, []);
  assert.equal(
    "dailyOverageExtraSecondsConsumed" in (redactedAdminDetail.body.user as Record<string, unknown>),
    true
  );

  const performanceOnlyAdminDirectoryDenied = await mobileRequest(
    "/mobile/users/regular_organization/admin/org/users/learner",
    "token_regular_organization"
  );
  assert.equal(performanceOnlyAdminDirectoryDenied.status, 403);
  const performanceOnlyAdminDashboardDenied = await mobileRequest(
    "/mobile/users/regular_organization/admin/org/dashboard",
    "token_regular_organization"
  );
  assert.equal(performanceOnlyAdminDashboardDenied.status, 403);

  const administrativeDashboardRetained = await mobileRequest(
    "/mobile/users/org_admin_none/admin/org/dashboard",
    "token_org_admin_none"
  );
  assert.equal(administrativeDashboardRetained.status, 200);
  assert.equal(
    typeof (administrativeDashboardRetained.body.usage as { monthlyAllottedSeconds?: unknown }).monthlyAllottedSeconds,
    "number"
  );
});

test("org admins manage tenant-bound daily defaults and temporary overage without contract authority", async () => {
  const initialDashboard = await mobileRequest("/mobile/users/org_admin/admin/org/dashboard", "token_org_admin");
  assert.equal(initialDashboard.status, 200);
  const initialDashboardBody = initialDashboard.body as {
    org: { monthlyMinutesAllotted: number; perUserDailySecondsCap: number };
    billingPeriod: { nextRenewalAt: string };
  };
  const originalMonthlyMinutes = Number(initialDashboardBody.org.monthlyMinutesAllotted);
  const originalDefaultSeconds = Number(initialDashboardBody.org.perUserDailySecondsCap);
  const renewalAtMs = new Date(initialDashboardBody.billingPeriod.nextRenewalAt).getTime();

  const forbiddenContractChange = await mobileRequest(
    "/mobile/users/org_admin/admin/org/settings",
    "token_org_admin",
    { method: "PATCH", body: JSON.stringify({ monthlyMinutesAllotted: 1 }) },
  );
  assert.equal(forbiddenContractChange.status, 403);
  const afterForbidden = await mobileRequest("/mobile/users/org_admin/admin/org/dashboard", "token_org_admin");
  assert.equal(
    Number((afterForbidden.body.org as { monthlyMinutesAllotted: number }).monthlyMinutesAllotted),
    originalMonthlyMinutes,
  );

  const dailyDefault = await mobileRequest("/mobile/users/org_admin/admin/org/settings", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ perUserDailySecondsCap: 2_400 }),
  });
  assert.equal(dailyDefault.status, 200, JSON.stringify(dailyDefault.body));
  assert.equal((dailyDefault.body.org as { perUserDailySecondsCap: number }).perUserDailySecondsCap, 2_400);

  const malformedGrant = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({
        allowDailyOverageThisCycle: true,
        dailyOverageDurationDays: 0,
        dailyOverageMode: "finite",
        dailyOverageExtraMinutes: 20,
      }),
    },
  );
  assert.equal(malformedGrant.status, 400);

  const finiteGrant = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({
        dailySecondsCapOverride: 600,
        allowDailyOverageThisCycle: true,
        dailyOverageDurationDays: 3650,
        dailyOverageMode: "finite",
        dailyOverageExtraMinutes: 120,
      }),
    },
  );
  assert.equal(finiteGrant.status, 200, JSON.stringify(finiteGrant.body));
  assert.equal(finiteGrant.body.dailySecondsCapOverride, 600);
  assert.equal(finiteGrant.body.dailyOverageMode, "finite");
  assert.equal(finiteGrant.body.dailyOverageExtraSecondsGranted, 7_200);
  assert.equal(new Date(String(finiteGrant.body.dailyOverageExpiresAt)).getTime(), renewalAtMs);
  const persistedFiniteGrant = await waitForPersistedUserState(
    "learner",
    (candidate) => Boolean(candidate?.dailyOverageStartedAt),
  );
  assert.ok(persistedFiniteGrant?.dailyOverageStartedAt);
  assert.equal(persistedFiniteGrant?.dailyOverageBaseSecondsCap, 600);
  const finiteGrantStartedAt = persistedFiniteGrant.dailyOverageStartedAt;
  const finiteGrantBaseSecondsCap = persistedFiniteGrant.dailyOverageBaseSecondsCap;

  const editedFiniteGrant = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({
        allowDailyOverageThisCycle: true,
        dailyOverageDurationDays: 1,
        dailyOverageMode: "finite",
        dailyOverageExtraMinutes: 180,
      }),
    },
  );
  assert.equal(editedFiniteGrant.status, 200, JSON.stringify(editedFiniteGrant.body));
  const editedFiniteUser = await waitForPersistedUserState(
    "learner",
    (candidate) => candidate?.dailyOverageExtraSecondsGranted === 10_800,
  );
  assert.equal(editedFiniteUser?.dailyOverageStartedAt, finiteGrantStartedAt);
  assert.equal(editedFiniteUser?.dailyOverageBaseSecondsCap, finiteGrantBaseSecondsCap);
  assert.equal(editedFiniteUser?.dailyOverageExtraSecondsGranted, 10_800);

  const finiteDetail = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
  );
  assert.equal(finiteDetail.status, 200);
  const finiteDetailUser = finiteDetail.body.user as {
    dailyOverageMode: string;
    dailyOverageExtraSecondsRemaining: number;
  };
  assert.equal(finiteDetailUser.dailyOverageMode, "finite");
  assert.equal(finiteDetailUser.dailyOverageExtraSecondsRemaining, 10_800);

  const platformGrant = await adminRequest("/users/learner", {
    method: "PATCH",
    body: JSON.stringify({
      allowDailyOverageThisCycle: true,
      dailyOverageDurationDays: 3650,
      dailyOverageMode: "unlimited",
    }),
  });
  assert.equal(platformGrant.status, 200);
  assert.equal(platformGrant.body.dailyOverageMode, "unlimited");
  assert.equal(new Date(String(platformGrant.body.dailyOverageExpiresAt)).getTime(), renewalAtMs);
  assert.equal(platformGrant.body.dailyOverageBaseSecondsCap, null);
  assert.equal(platformGrant.body.dailyOverageExtraSecondsGranted, null);

  const useOrgDefaultAndDisable = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ dailySecondsCapOverride: null, allowDailyOverageThisCycle: false }),
    },
  );
  assert.equal(useOrgDefaultAndDisable.status, 200);
  assert.equal(useOrgDefaultAndDisable.body.dailySecondsCapOverride, null);
  assert.equal(useOrgDefaultAndDisable.body.allowDailyOverageThisCycle, false);

  const restoreDefault = await mobileRequest("/mobile/users/org_admin/admin/org/settings", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ perUserDailySecondsCap: originalDefaultSeconds }),
  });
  assert.equal(restoreDefault.status, 200);
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
  assert.equal(unauthorizedAdmin.status, 403);
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

  const organizationWide = await mobileRequest("/mobile/users/user_admin/admin/org/users/unassigned_learner", "token_user_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-SCOPE-BYPASS" })
  });
  assert.equal(organizationWide.status, 200);
  const afterOrganizationWide = await readUser("unassigned_learner");
  assert.equal(afterOrganizationWide?.status, "disabled");
  assert.equal(afterOrganizationWide?.employeeId, "EMP-SCOPE-BYPASS");
  const restoreOrganizationWide = await mobileRequest("/mobile/users/org_admin/admin/org/users/unassigned_learner", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "active", employeeId: "EMP-U" })
  });
  assert.equal(restoreOrganizationWide.status, 200);

  const crossTenant = await mobileRequest("/mobile/users/org_admin/admin/org/users/other_org_user", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled", employeeId: "EMP-CROSS-TENANT" })
  });
  assert.equal(crossTenant.status, 404);
  const afterCrossTenant = await readUser("other_org_user");
  assert.equal(afterCrossTenant?.status, "active");
  assert.equal(afterCrossTenant?.employeeId, "EMP-1");
});

test("mobile User Admin visibility remains organization-wide across manager reassignment", async () => {
  const initiallyDenied = await mobileRequest("/mobile/users/user_admin/admin/org/users/other_manager_report", "token_user_admin");
  assert.equal(initiallyDenied.status, 200);

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
  assert.equal(noLongerVisible.status, 200);

  const managerList = await mobileRequest("/mobile/users/mobile_scope_manager/admin/org/users", "token_mobile_scope_manager");
  assert.equal(managerList.status, 200);
  assert.equal((managerList.body.users as Array<{ userId: string }>).some((row) => row.userId === "unassigned_learner"), true);

  const demoted = await dashboardRequest("/dashboard/admin/users/mobile_scope_manager", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" })
  });
  assert.equal(demoted.status, 200);
  const retainedReport = await waitForPersistedUserState(
    "mobile_scope_report",
    (user) => user?.managerUserId === "mobile_scope_manager"
  );
  assert.equal(retainedReport?.managerUserId, "mobile_scope_manager");
  const demotedList = await mobileRequest("/mobile/users/mobile_scope_manager/admin/org/users", "token_mobile_scope_manager");
  assert.equal(demotedList.status, 403);
});

test("manager options and assignment validation share role-independent eligibility", async () => {
  const userAdminNameAllowed = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ firstName: "No", lastName: "Access" }),
  });
  assert.equal(userAdminNameAllowed.status, 200);

  const userAdminRoleDenied = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(userAdminRoleDenied.status, 403);

  const userAdminManagerAllowed = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "eligible_user_admin" }),
  });
  assert.equal(userAdminManagerAllowed.status, 200);

  for (const managerUserId of [
    "other_org_user",
    "other_org_admin",
    "disabled_ai_user",
    "disabled_user_admin",
    "gmail_join",
    "missing_manager",
  ]) {
    const invalid = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ managerUserId }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "manager_invalid");
    assert.equal(invalid.body.error, "Manager must be an active member of the same organization.");
  }

  const selfAssignment = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ managerUserId: "unassigned_learner" }),
  });
  assert.equal(selfAssignment.status, 400);
  assert.equal(selfAssignment.body.code, "manager_invalid");

  for (const managerUserId of ["regular_dashboard", "eligible_user_admin", "org_admin_peer"]) {
    const valid = await dashboardRequest("/dashboard/admin/users/unassigned_learner", orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ managerUserId }),
    });
    assert.equal(valid.status, 200, managerUserId);
    assert.equal((valid.body.user as { managerUserId?: string }).managerUserId, managerUserId);
  }
  assert.equal((await readUser("regular_dashboard"))?.performanceAccess, "none");
  assert.equal((await readUser("regular_team"))?.managerUserId, null);
  assert.equal((await readUser("regular_organization"))?.managerUserId, null);

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
  const managerOptions = usersResult.body.managerOptions as Array<{
    userId: string;
    email: string;
    displayName: string;
  }>;
  const managerOptionIds = new Set(managerOptions.map((manager) => manager.userId));
  for (const eligibleId of [
    "regular_dashboard",
    "regular_team",
    "regular_organization",
    "user_admin_none",
    "eligible_user_admin",
    "org_admin",
    "org_admin_peer",
  ]) {
    assert.equal(managerOptionIds.has(eligibleId), true, eligibleId);
  }
  for (const ineligibleId of [
    "disabled_ai_user",
    "disabled_user_admin",
    "other_org_user",
    "other_org_admin",
    "gmail_join",
  ]) {
    assert.equal(managerOptionIds.has(ineligibleId), false, ineligibleId);
  }
  assert.deepEqual(
    managerOptions,
    [...managerOptions].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
        left.email.localeCompare(right.email, undefined, { sensitivity: "base" }) ||
        left.userId.localeCompare(right.userId)
    )
  );
  assert.equal(managerOptions.some((manager) => manager.userId === "user_admin_none"), true);
  assert.equal(managerOptions.some((manager) => manager.userId === "other_org_admin"), false);
  assert.equal(managerOptions.some((manager) => manager.userId === "disabled_user_admin"), false);
});

test("role changes preserve reports while eligibility loss clears manager assignments", async () => {
  const promoted = await dashboardRequest("/dashboard/admin/users/role_target", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(promoted.status, 200);
  const promotedRow = promoted.body.user as {
    orgRole?: string;
    performanceAccess?: string;
    dashboardAccessEnabled?: boolean;
    managerUserId?: string | null;
  };
  assert.equal(promotedRow.orgRole, "user_admin");
  assert.equal(promotedRow.performanceAccess, "none");
  assert.equal(promotedRow.dashboardAccessEnabled, true);
  assert.equal(promotedRow.managerUserId, null);

  const demoted = await dashboardRequest("/dashboard/admin/users/manager_to_demote", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" }),
  });
  assert.equal(demoted.status, 200);
  const demotedRow = demoted.body.user as {
    orgRole?: string;
    performanceAccess?: string;
    dashboardAccessEnabled?: boolean;
    assignedReportCount?: number;
  };
  assert.equal(demotedRow.orgRole, "user");
  assert.equal(demotedRow.performanceAccess, "team");
  assert.equal(demotedRow.dashboardAccessEnabled, false);
  assert.equal(demotedRow.assignedReportCount, 1);
  const demoteReport = await waitForPersistedUserState(
    "manager_to_demote_report",
    (user) => user?.managerUserId === "manager_to_demote"
  );
  assert.equal(demoteReport?.managerUserId, "manager_to_demote");

  const promotedRegularManager = await dashboardRequest("/dashboard/admin/users/regular_manager_to_promote", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(promotedRegularManager.status, 200);
  assert.equal((promotedRegularManager.body.user as { orgRole?: string; assignedReportCount?: number }).orgRole, "user_admin");
  assert.equal((promotedRegularManager.body.user as { assignedReportCount?: number }).assignedReportCount, 1);
  assert.equal((await readUser("regular_manager_to_promote_report"))?.managerUserId, "regular_manager_to_promote");

  const promotedOrgAdminManager = await adminRequest("/users/manager_to_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "org_admin" }),
  });
  assert.equal(promotedOrgAdminManager.status, 200);
  assert.equal((promotedOrgAdminManager.body as { orgRole?: string }).orgRole, "org_admin");
  assert.equal((await readUser("manager_to_org_admin_report"))?.managerUserId, "manager_to_org_admin");

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

  const mobileDisabled = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/mobile_manager_to_disable",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ status: "disabled" }),
    }
  );
  assert.equal(mobileDisabled.status, 200);
  assert.equal((mobileDisabled.body as { status?: string }).status, "disabled");
  const mobileDisabledReport = await waitForPersistedUserState(
    "mobile_manager_to_disable_report",
    (user) => user?.managerUserId === null
  );
  assert.equal(mobileDisabledReport?.managerUserId, null);

  const removedFromEnterprise = await adminRequest("/users/manager_to_individual", {
    method: "PATCH",
    body: JSON.stringify({ accountType: "individual", employeeId: null }),
  });
  assert.equal(removedFromEnterprise.status, 200);
  assert.equal((removedFromEnterprise.body as { accountType?: string }).accountType, "individual");
  assert.equal((removedFromEnterprise.body as { orgId?: string | null }).orgId, null);
  const removedManagerReport = await waitForPersistedUserState(
    "manager_to_individual_report",
    (user) => user?.managerUserId === null
  );
  assert.equal(removedManagerReport?.managerUserId, null);
});

test("dashboard admin role boundaries block user-admin access to administrators", async () => {
  const userAdminDeactivateOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateOrgAdmin.status, 403);
  assert.equal((await readUser("org_admin_peer"))?.status, "active");

  const userAdminEditOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "UA-NOPE" }),
  });
  assert.equal(userAdminEditOrgAdmin.status, 403);
  assert.equal((await readUser("org_admin_peer"))?.employeeId, "ADM-2");

  const userAdminDeactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateUserAdmin.status, 403);
  assert.equal((await readUser("eligible_user_admin"))?.status, "active");

  const userAdminReactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/disabled_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(userAdminReactivateUserAdmin.status, 403);
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

  const userAdminExport = await dashboardRequest("/dashboard/admin/users/export", userAdminToken);
  assert.equal(userAdminExport.status, 200);
  const userAdminRows = userAdminExport.body.rows as Array<{ email: string }>;
  assert.equal(userAdminRows.some((row) => row.email === "unassigned@acme.example"), true);
  assert.equal(userAdminRows.some((row) => row.email === "learner@other.example"), false);

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
  const dashboardMoveAttempt = await dashboardRequest("/dashboard/admin/users/learner", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ orgId: "org_2" }),
  });
  assert.equal(dashboardMoveAttempt.status, 400);
  assert.equal((await readUser("learner"))?.orgId, "org_1");

  const mobileMoveAttempt = await mobileRequest(
    "/mobile/users/org_admin/admin/org/users/learner",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ orgId: "org_2" }),
    }
  );
  assert.equal(mobileMoveAttempt.status, 400);
  assert.equal((await readUser("learner"))?.orgId, "org_1");

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

test("platform user creation and mutation persist explicit independent performance access", async () => {
  const createEnterpriseUser = async (
    suffix: string,
    orgRole: "user" | "user_admin" | "org_admin",
    performanceAccess?: "none" | "team" | "organization"
  ) => adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email: `performance-${suffix}@acme.example`,
      tier: "enterprise",
      accountType: "enterprise",
      orgId: "org_1",
      orgRole,
      ...(performanceAccess ? { performanceAccess } : {}),
    }),
  });

  const regularDefault = await createEnterpriseUser("regular-default", "user");
  const userAdminDefault = await createEnterpriseUser("user-admin-default", "user_admin");
  const orgAdminDefault = await createEnterpriseUser("org-admin-default", "org_admin");
  const regularTeam = await createEnterpriseUser("regular-team", "user", "team");
  const regularOrganization = await createEnterpriseUser("regular-organization", "user", "organization");

  for (const [result, expectedRole, expectedAccess] of [
    [regularDefault, "user", "none"],
    [userAdminDefault, "user_admin", "none"],
    [orgAdminDefault, "org_admin", "none"],
    [regularTeam, "user", "team"],
    [regularOrganization, "user", "organization"],
  ] as const) {
    assert.equal(result.status, 201);
    assert.equal(result.body.orgRole, expectedRole);
    assert.equal(result.body.performanceAccess, expectedAccess);
  }

  const orgAdminNoneRoleCheckId = orgAdminDefault.body.id as string;
  const demotedOrgAdminNone = await adminRequest(`/users/${orgAdminNoneRoleCheckId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" }),
  });
  assert.equal(demotedOrgAdminNone.status, 200);
  assert.equal(demotedOrgAdminNone.body.performanceAccess, "none");
  const restoredOrgAdminNone = await adminRequest(`/users/${orgAdminNoneRoleCheckId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "org_admin" }),
  });
  assert.equal(restoredOrgAdminNone.status, 200);
  assert.equal(restoredOrgAdminNone.body.performanceAccess, "none");

  for (const invalidValue of ["", "admin", "manager", "all", "org", null, [], {}, "TEAM"]) {
    const invalid = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email: "invalid-performance-create@acme.example",
        tier: "enterprise",
        accountType: "enterprise",
        orgId: "org_1",
        orgRole: "user",
        performanceAccess: invalidValue,
      }),
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalidValue));
  }

  const regularDefaultId = regularDefault.body.id as string;
  const promotedNone = await adminRequest(`/users/${regularDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "org_admin" }),
  });
  assert.equal(promotedNone.status, 200);
  assert.equal(promotedNone.body.performanceAccess, "none");

  const movedToUserAdminNone = await adminRequest(`/users/${regularDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(movedToUserAdminNone.status, 200);
  assert.equal(movedToUserAdminNone.body.performanceAccess, "none");

  const grantedTeam = await adminRequest(`/users/${regularDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "team" }),
  });
  assert.equal(grantedTeam.status, 200);
  assert.equal(grantedTeam.body.orgRole, "user_admin");
  assert.equal(grantedTeam.body.performanceAccess, "team");
  assert.equal(grantedTeam.body.managerUserId, null);

  const demotedTeam = await adminRequest(`/users/${regularDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" }),
  });
  assert.equal(demotedTeam.status, 200);
  assert.equal(demotedTeam.body.performanceAccess, "team");

  const regularOrganizationId = regularOrganization.body.id as string;
  const promotedOrganizationToUserAdmin = await adminRequest(`/users/${regularOrganizationId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user_admin" }),
  });
  assert.equal(promotedOrganizationToUserAdmin.status, 200);
  assert.equal(promotedOrganizationToUserAdmin.body.performanceAccess, "organization");
  const promotedOrganization = await adminRequest(`/users/${regularOrganizationId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "org_admin" }),
  });
  assert.equal(promotedOrganization.status, 200);
  assert.equal(promotedOrganization.body.performanceAccess, "organization");
  const demotedOrganization = await adminRequest(`/users/${regularOrganizationId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgRole: "user" }),
  });
  assert.equal(demotedOrganization.status, 200);
  assert.equal(demotedOrganization.body.performanceAccess, "organization");

  for (const invalidValue of ["", "admin", "manager", "all", "org", null, [], {}, "TEAM"]) {
    const invalid = await adminRequest(`/users/${regularDefaultId}`, {
      method: "PATCH",
      body: JSON.stringify({ performanceAccess: invalidValue }),
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalidValue));
  }
  assert.equal((await readUser(regularDefaultId))?.performanceAccess, "team");

  const individual = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email: "performance-individual-transition@example.com",
      tier: "free",
      accountType: "individual",
      orgRole: "user",
    }),
  });
  assert.equal(individual.status, 201);
  assert.equal(individual.body.performanceAccess, "none");
  const transitionedToEnterprise = await adminRequest(`/users/${individual.body.id as string}`, {
    method: "PATCH",
    body: JSON.stringify({
      accountType: "enterprise",
      tier: "enterprise",
      orgId: "org_1",
      orgRole: "org_admin",
    }),
  });
  assert.equal(transitionedToEnterprise.status, 200);
  assert.equal(transitionedToEnterprise.body.orgRole, "org_admin");
  assert.equal(transitionedToEnterprise.body.performanceAccess, "none");

  const orgAdminDefaultId = orgAdminDefault.body.id as string;
  const orgAdminGrantedOrganization = await adminRequest(`/users/${orgAdminDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ performanceAccess: "organization" }),
  });
  assert.equal(orgAdminGrantedOrganization.status, 200);
  const orgAdminMovedWithoutAccess = await adminRequest(`/users/${orgAdminDefaultId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgId: "org_2" }),
  });
  assert.equal(orgAdminMovedWithoutAccess.status, 200);
  assert.equal(orgAdminMovedWithoutAccess.body.orgId, "org_2");
  assert.equal(orgAdminMovedWithoutAccess.body.orgRole, "org_admin");
  assert.equal(orgAdminMovedWithoutAccess.body.performanceAccess, "none");

  const regularTeamId = regularTeam.body.id as string;
  const movedWithExplicitAccess = await adminRequest(`/users/${regularTeamId}`, {
    method: "PATCH",
    body: JSON.stringify({ orgId: "org_2", performanceAccess: "organization" }),
  });
  assert.equal(movedWithExplicitAccess.status, 200);
  assert.equal(movedWithExplicitAccess.body.orgId, "org_2");
  assert.equal(movedWithExplicitAccess.body.orgRole, "user");
  assert.equal(movedWithExplicitAccess.body.performanceAccess, "organization");

  const managerMovedAcrossOrgs = await adminRequest("/users/manager_to_demote", {
    method: "PATCH",
    body: JSON.stringify({ orgId: "org_2" }),
  });
  assert.equal(managerMovedAcrossOrgs.status, 200);
  assert.equal(managerMovedAcrossOrgs.body.orgId, "org_2");
  assert.equal(managerMovedAcrossOrgs.body.performanceAccess, "none");
  assert.equal(managerMovedAcrossOrgs.body.divisionId, null);
  assert.equal(managerMovedAcrossOrgs.body.managerUserId, null);
  const clearedCrossOrgReport = await waitForPersistedUserState(
    "manager_to_demote_report",
    (user) => user?.managerUserId === null
  );
  assert.equal(clearedCrossOrgReport?.managerUserId, null);

  const orgMoveAudit = (await readPlatformAuditEvents())
    .slice()
    .reverse()
    .find((event) => event.action === "user.updated" && event.userId === orgAdminDefaultId);
  assert.ok(orgMoveAudit);
  const orgMoveMetadata = orgMoveAudit.metadata as {
    before?: { orgId?: string | null; performanceAccess?: string };
    after?: { orgId?: string | null; performanceAccess?: string };
  };
  assert.equal(orgMoveMetadata.before?.orgId, "org_1");
  assert.equal(orgMoveMetadata.before?.performanceAccess, "organization");
  assert.equal(orgMoveMetadata.after?.orgId, "org_2");
  assert.equal(orgMoveMetadata.after?.performanceAccess, "none");

  for (const movedUserId of [orgAdminDefaultId, regularTeamId, "manager_to_demote"]) {
    const restored = await adminRequest(`/users/${movedUserId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgId: "org_1" }),
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.orgId, "org_1");
    assert.equal(restored.body.performanceAccess, "none");
  }

  const unauthenticated = await publicRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email: "unauthenticated-performance@acme.example",
      tier: "enterprise",
      accountType: "enterprise",
      orgId: "org_1",
      orgRole: "user",
      performanceAccess: "team",
    }),
  });
  assert.equal(unauthenticated.status, 401);
});

test("demo enterprise transitions reset access across organizations and preserve same-org explicit access", () => {
  const db = buildDatabase();
  db.users.push(buildUser("usr_demo_people_admin", "demo-move@acme.example", {
    orgId: "org_1",
    orgRole: "org_admin",
    performanceAccess: "organization",
  }));

  ensureDemoEnterpriseDataForTest(db, NOW);
  const moved = db.users.find((user) => user.id === "usr_demo_people_admin");
  assert.ok(moved);
  assert.equal(moved.orgId, "org_demo_people");
  assert.equal(moved.performanceAccess, "none");

  moved.performanceAccess = "team";
  ensureDemoEnterpriseDataForTest(db, NOW);
  assert.equal(moved.orgId, "org_demo_people");
  assert.equal(moved.performanceAccess, "team");
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
  assert.equal(auditMetadata.includes("performanceAccess"), true);
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

  const { result: pending, code: pendingCode } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "pending@gmail.com",
        firstName: " Pending ",
        lastName: " Person ",
        joinCode: "ACME2026",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(pending.status, 200);
  assert.equal(pending.body.verificationRequired, true);
  const pendingLimitedToken = pending.body.authToken as string;
  const pendingVerified = await mobileRequest("/mobile/onboard/verify-email", pendingLimitedToken, {
    method: "POST",
    body: JSON.stringify({ userId: "pending_user", code: pendingCode }),
  });
  assert.equal(pendingVerified.status, 200);
  const pendingUser = pendingVerified.body.user as UserProfile;
  const pendingAuthToken = pendingVerified.body.authToken as string;
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
  const { result: namelessOnboard, code: namelessCode } = await captureVerificationCode(() =>
    publicRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "nameless.free@gmail.com",
        firstName: " Legacy ",
        lastName: " Free ",
        timezone: "America/Denver",
      }),
    })
  );
  assert.equal(namelessOnboard.status, 200);
  assert.equal(namelessOnboard.body.verificationRequired, true);
  const completedNameless = await mobileRequest(
    "/mobile/onboard/verify-email",
    namelessOnboard.body.authToken as string,
    {
      method: "POST",
      body: JSON.stringify({ userId: "nameless_free", code: namelessCode }),
    }
  );
  assert.equal(completedNameless.status, 200);
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
  assert.equal(resetUserStatusDenied.status, 401);
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
  assert.equal(disabledResend.status, 401);
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
  assert.equal(verifyMismatch.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const verifyMismatchDb = await readDb();
  assert.equal(verifyMismatchDb.users.find((user) => user.id === "reset_mismatch")?.orgId, "org_1");
  assert.equal(
    verifyMismatchDb.users.find((user) => user.id === "reset_mismatch")?.mobileProfileReonboardingRequired,
    false
  );
  assert.equal(
    typeof verifyMismatchDb.emailVerifications
      .filter((entry) => entry.userId === "reset_mismatch")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.consumedAt,
    "string"
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

test("failed web-session deletion leaves dashboard disable uncommitted and the old session active", async () => {
  const oldToken = orgAdminNoneToken;
  assert.equal((await readUser("org_admin_none"))?.status, "active");
  assert.equal((await dashboardRequest("/dashboard/admin/users", oldToken)).status, 200);
  const readAudit = async (): Promise<{ events?: AuditEvent[] }> =>
    JSON.parse(await readFile(auditEventsPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    })) as { events?: AuditEvent[] };
  const beforeAudit = await readAudit();
  setWebSessionRevocationFailureForTest(new Error("injected session delete failure"));
  try {
    const failed = await mobileRequest("/mobile/users/org_admin/admin/org/users/org_admin_none", "token_org_admin", {
      method: "PATCH",
      body: JSON.stringify({ status: "disabled" }),
    });
    assert.equal(failed.status, 500);
  } finally {
    setWebSessionRevocationFailureForTest(null);
  }
  assert.equal((await readUser("org_admin_none"))?.status, "active");
  assert.equal((await dashboardRequest("/dashboard/admin/users", oldToken)).status, 200);
  const afterAudit = await readAudit();
  assert.deepEqual(afterAudit.events, beforeAudit.events);
});

test("mobile admin deactivation invalidates existing mobile and dashboard credentials", async () => {
  const active = await mobileRequest("/mobile/users/org_admin_none/admin/org/dashboard", "token_org_admin_none");
  assert.equal(active.status, 200);

  setDatabaseSaveBarrierForTest(async () => { throw new Error("injected mobile disable save failure"); });
  try {
    const failed = await mobileRequest("/mobile/users/org_admin/admin/org/users/org_admin_none", "token_org_admin", {
      method: "PATCH",
      body: JSON.stringify({ status: "disabled" }),
    });
    assert.equal(failed.status, 500);
  } finally {
    setDatabaseSaveBarrierForTest(null);
  }
  assert.equal((await readUser("org_admin_none"))?.status, "active");
  assert.equal((await mobileRequest("/mobile/users/org_admin_none/admin/org/dashboard", "token_org_admin_none")).status, 200);
  // File-backed development storage has no cross-file rollback: the safe
  // session purge may finish before an injected app-state save failure.
  assert.equal((await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken)).status, 401);
  await refreshWebAuthTokens(await readDb());
  assert.equal((await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken)).status, 200);

  const disabled = await mobileRequest("/mobile/users/org_admin/admin/org/users/org_admin_none", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((await readUser("org_admin_none"))?.status, "disabled");
  assert.equal((await readDb()).mobileAuthTokens.some((record) => record.userId === "org_admin_none"), false);
  assert.equal((await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken)).status, 401);

  for (const pathname of [
    "/mobile/users/org_admin_none/entitlements",
    "/mobile/users/org_admin_none/admin/org/dashboard",
    "/mobile/users/org_admin_none/admin/org/users",
  ]) {
    assert.equal((await mobileRequest(pathname, "token_org_admin_none")).status, 401);
  }
  assert.equal((await mobileRequest("/mobile/users/org_admin_none/admin/org/settings", "token_org_admin_none", {
    method: "PATCH",
    body: JSON.stringify({ perUserDailySecondsCap: 600 }),
  })).status, 401);
  assert.equal((await mobileRequest(
    "/mobile/users/org_admin_none/admin/org/access-requests/jr_pending",
    "token_org_admin_none",
    { method: "PATCH", body: JSON.stringify({ action: "approve" }) },
  )).status, 401);
  assert.equal((await readDb()).enterpriseJoinRequests.find((record) => record.id === "jr_pending")?.status, "pending");

  const restored = await mobileRequest("/mobile/users/org_admin/admin/org/users/org_admin_none", "token_org_admin", {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(restored.status, 200);
  assert.equal((await readUser("org_admin_none"))?.status, "active");
  assert.equal((await mobileRequest("/mobile/users/org_admin_none/admin/org/dashboard", "token_org_admin_none")).status, 401);
  assert.equal((await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken)).status, 401);
  await refreshWebAuthTokens(await readDb());
  assert.equal((await dashboardRequest("/dashboard/admin/users", orgAdminNoneToken)).status, 200);
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

  const dashboardList = await dashboardRequest("/dashboard/admin/access-requests", orgAdminToken);
  assert.equal(dashboardList.status, 200);
  const dashboardRows = dashboardList.body.requests as Array<{
    id: string;
    status: string;
    userId: string;
    orgId: string;
  }>;
  assert.equal(dashboardRows.some((request) => request.userId === "gmail_join" && request.status === "pending"), true);
  assert.equal(dashboardRows.every((request) => request.orgId === "org_1"), true);
  assert.equal(dashboardRows.some((request) => request.id === "jr_other"), false);
  assert.equal(dashboardRows.some((request) => request.id === "jr_approved_history" && request.status === "approved"), true);
  assert.equal(dashboardRows.some((request) => request.id === "jr_rejected_ai" && request.status === "rejected"), true);
  assert.equal(dashboardRows.some((request) => request.id === "jr_expired_history" && request.status === "expired"), true);

  const unauthenticated = await publicRequest("/dashboard/admin/access-requests");
  assert.equal(unauthenticated.status, 401);
  const unauthorizedRole = await dashboardRequest("/dashboard/admin/access-requests", userAdminToken);
  assert.equal(unauthorizedRole.status, 200);
  assert.equal((unauthorizedRole.body.requests as Array<{ orgId: string }>).every((row) => row.orgId === "org_1"), true);
  const crossTenant = await dashboardRequest("/dashboard/admin/access-requests?orgId=org_2", orgAdminToken);
  assert.equal(crossTenant.status, 404);
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

test("file-backed failed join approval never publishes membership or request state", async () => {
  const before = await readDurableDbOnce();
  const targetBefore = before.users.find((user) => user.id === "pending_user");
  const requestBefore = before.enterpriseJoinRequests.find((entry) => entry.id === "jr_pending");
  const auditBefore = JSON.parse(await readFile(auditEventsPath(), "utf8")) as { events?: AuditEvent[] };
  setDatabaseSaveBarrierForTest(async () => { throw new Error("injected join approval save failure"); });
  try {
    const failed = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(failed.status, 500);
  } finally {
    setDatabaseSaveBarrierForTest(null);
  }
  const after = await readDurableDbOnce();
  assert.deepEqual(after.users.find((user) => user.id === "pending_user"), targetBefore);
  assert.deepEqual(after.enterpriseJoinRequests.find((entry) => entry.id === "jr_pending"), requestBefore);
  const auditAfter = JSON.parse(await readFile(auditEventsPath(), "utf8")) as { events?: AuditEvent[] };
  const approvalsForRequest = (events: AuditEvent[] | undefined) => (events ?? []).filter((event) =>
    event.action === "org_join.approved_by_dashboard_admin" && event.metadata?.requestId === "jr_pending"
  ).length;
  // Separate development files cannot roll back a completed audit write when
  // a later app-state file save fails. The real PostgreSQL coverage in
  // appStateTransaction.integration.test.ts proves the production rollback.
  assert.equal(approvalsForRequest(auditAfter.events), approvalsForRequest(auditBefore.events) + 1);
});

test("dashboard and mobile approvals use the same pending-request transition", async () => {
  const userAdminApproved = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(userAdminApproved.status, 200);

  const approved = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(approved.status, 409);
  assert.equal((userAdminApproved.body.request as { status?: string }).status, "approved");
  assert.equal((await waitForPersistedUserState("pending_user", (user) => user?.orgId === "org_1"))?.performanceAccess, "none");

  const repeatedApproval = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(repeatedApproval.status, 409);
  assert.equal((await readDb()).enterpriseJoinRequests.find((request) => request.id === "jr_pending")?.status, "approved");

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

  const rejected = await dashboardRequest("/dashboard/admin/access-requests/jr_reject", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "reject", reason: "Not a trial user." }),
  });
  assert.equal(rejected.status, 200);
  assert.equal((rejected.body.request as { status?: string }).status, "rejected");
  assert.equal((await readUser("reject_user"))?.orgId, null);
  const repeatedRejection = await dashboardRequest("/dashboard/admin/access-requests/jr_reject", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "reject" }),
  });
  assert.equal(repeatedRejection.status, 409);
  assert.equal((await readDb()).enterpriseJoinRequests.find((request) => request.id === "jr_reject")?.status, "rejected");

  const mobileApproved = await mobileRequest(
    "/mobile/users/user_admin/admin/org/access-requests/jr_mobile",
    "token_user_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    }
  );
  assert.equal(mobileApproved.status, 200);
  assert.equal((mobileApproved.body.request as { status?: string }).status, "approved");
  assert.equal((await waitForPersistedUserState("gmail_join_2", (user) => user?.orgId === "org_1"))?.performanceAccess, "none");

  const platformAdminApproved = await adminRequest("/org-join-requests/jr_platform_admin", {
    method: "PATCH",
    body: JSON.stringify({ action: "approve", assignOrgAdmin: true }),
  });
  assert.equal(platformAdminApproved.status, 200);
  const approvedOrgAdmin = await waitForPersistedUserState(
    "platform_admin_pending",
    (user) => user?.orgRole === "org_admin"
  );
  assert.equal(approvedOrgAdmin?.orgRole, "org_admin");
  assert.equal(approvedOrgAdmin?.performanceAccess, "none");

  await waitForPersistedUserOrg("pending_user", "org_1");
  await waitForPersistedUserOrg("gmail_join_2", "org_1");
});

test("stale pending requests cannot transfer a current member through any approval route", async () => {
  const request = (await readDb()).enterpriseJoinRequests.find((entry) =>
    entry.userId === "gmail_join" && entry.orgId === "org_1" && entry.status === "pending"
  );
  assert.ok(request);
  const moved = await adminRequest("/users/gmail_join", {
    method: "PATCH",
    body: JSON.stringify({ accountType: "enterprise", tier: "enterprise", orgId: "org_2", orgRole: "user", performanceAccess: "team", dashboardAccessEnabled: true }),
  });
  assert.equal(moved.status, 200);
  const before = await readUser("gmail_join");
  assert.equal(before?.orgId, "org_2");

  const attempts = [
    () => dashboardRequest(`/dashboard/admin/access-requests/${request.id}`, orgAdminToken, {
      method: "PATCH", body: JSON.stringify({ action: "approve" }),
    }),
    () => mobileRequest(`/mobile/users/org_admin/admin/org/access-requests/${request.id}`, "token_org_admin", {
      method: "PATCH", body: JSON.stringify({ action: "approve" }),
    }),
    () => adminRequest(`/org-join-requests/${request.id}`, {
      method: "PATCH", body: JSON.stringify({ action: "approve", assignOrgAdmin: true }),
    }),
  ];
  for (const attempt of attempts) {
    assert.equal((await attempt()).status, 409);
    assert.deepEqual(await readUser("gmail_join"), before);
    assert.equal((await readDb()).enterpriseJoinRequests.find((entry) => entry.id === request.id)?.status, "pending");
  }
  assert.equal((await dashboardRequest(`/dashboard/admin/access-requests/${request.id}?orgId=org_2`, orgAdminToken, {
    method: "PATCH", body: JSON.stringify({ action: "approve" }),
  })).status, 404);

  const restored = await adminRequest("/users/gmail_join", {
    method: "PATCH", body: JSON.stringify({ accountType: "individual" }),
  });
  assert.equal(restored.status, 200);
  assert.equal((await readUser("gmail_join"))?.orgId, null);
});

test("successful approval terminalizes the same user's other pending organization requests", async () => {
  const first = await mobileRequest("/mobile/users/rejected_ai/org-access-requests", "token_rejected_ai", {
    method: "POST", body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  const second = await mobileRequest("/mobile/users/rejected_ai/org-access-requests", "token_rejected_ai", {
    method: "POST", body: JSON.stringify({ joinCode: "OTHER2026" }),
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const requests = (await readDb()).enterpriseJoinRequests.filter((entry) =>
    entry.userId === "rejected_ai" && entry.status === "pending"
  );
  const orgOne = requests.find((entry) => entry.orgId === "org_1");
  const orgTwo = requests.find((entry) => entry.orgId === "org_2");
  assert.ok(orgOne);
  assert.ok(orgTwo);

  const crossOrgDenied = await dashboardRequest(`/dashboard/admin/access-requests/${orgTwo.id}`, orgAdminToken, {
    method: "PATCH", body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(crossOrgDenied.status, 404);
  const approved = await adminRequest(`/org-join-requests/${orgOne.id}`, {
    method: "PATCH", body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await readUser("rejected_ai"))?.orgId, "org_1");
  const after = await readDb();
  assert.equal(after.enterpriseJoinRequests.find((entry) => entry.id === orgOne.id)?.status, "approved");
  const superseded = after.enterpriseJoinRequests.find((entry) => entry.id === orgTwo.id);
  assert.equal(superseded?.status, "rejected");
  assert.equal(superseded?.decidedByUserId, null);
  assert.match(superseded?.decisionReason ?? "", /superseded/i);
  assert.equal((await adminRequest(`/org-join-requests/${orgTwo.id}`, {
    method: "PATCH", body: JSON.stringify({ action: "approve" }),
  })).status, 409);
  assert.equal((await adminRequest(`/org-join-requests/${orgOne.id}`, {
    method: "PATCH", body: JSON.stringify({ action: "approve" }),
  })).status, 409);
  assert.equal((await readUser("rejected_ai"))?.orgId, "org_1");
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

test(
  "organization domains are retired from creation, updates, and database normalization",
  verifyOrganizationDomainsAreRetired,
);

test(
  "same-domain users request and receive the organizations represented by different company codes",
  verifySameDomainUsersCanJoinDifferentOrganizations,
);

test("platform admin Focus Topic reorder is atomic, revision-guarded, and organization-scoped", async () => {
  const createdAlpha = await adminRequest("/orgs/org_2/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Alpha Order Topic", status: "active" }),
  });
  const createdZulu = await adminRequest("/orgs/org_2/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Zulu Order Topic", status: "active" }),
  });
  const createdDraft = await adminRequest("/orgs/org_2/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Draft Order Topic", status: "draft" }),
  });
  assert.equal(createdAlpha.status, 201);
  assert.equal(createdZulu.status, 201);
  assert.equal(createdDraft.status, 201);

  const before = await adminRequest("/orgs/org_2/trainings");
  assert.equal(before.status, 200);
  const beforeTrainings = before.body.trainings as OrgTrainingRecord[];
  const activeIds = beforeTrainings.filter((topic) => topic.status === "active").map((topic) => topic.id);
  const draftId = (createdDraft.body as unknown as OrgTrainingRecord).id;
  const revision = before.body.orderRevision as string;
  assert.equal(typeof revision, "string");
  assert.equal(new Set(activeIds).size, activeIds.length);
  assert.equal(activeIds.at(-2), (createdAlpha.body as unknown as OrgTrainingRecord).id);
  assert.equal(activeIds.at(-1), (createdZulu.body as unknown as OrgTrainingRecord).id);

  const persistedBeforeFailures = (await readDb()).orgTrainings
    .filter((topic) => topic.orgId === "org_2")
    .map((topic) => ({ id: topic.id, displayOrder: topic.displayOrder }));
  const invalidLists = [
    [...activeIds.slice(0, -1), activeIds[0]!],
    activeIds.slice(0, -1),
    [...activeIds.slice(0, -1), draftId],
    [...activeIds.slice(0, -1), "training_scope"],
    [...activeIds.slice(0, -1), "deleted_topic"],
  ];
  for (const trainingIds of invalidLists) {
    const invalid = await adminRequest("/orgs/org_2/trainings/order", {
      method: "PUT",
      body: JSON.stringify({ expectedOrderRevision: revision, trainingIds }),
    });
    assert.equal(invalid.status, 400);
  }
  assert.deepEqual(
    (await readDb()).orgTrainings
      .filter((topic) => topic.orgId === "org_2")
      .map((topic) => ({ id: topic.id, displayOrder: topic.displayOrder })),
    persistedBeforeFailures,
  );

  const desired = [...activeIds].reverse();
  const stale = await adminRequest("/orgs/org_2/trainings/order", {
    method: "PUT",
    body: JSON.stringify({ expectedOrderRevision: "stale", trainingIds: desired }),
  });
  assert.equal(stale.status, 409);

  const auditCountBefore = (await readPlatformAuditEvents())
    .filter((event) => event.action === "org.training.order_updated").length;
  const reordered = await adminRequest("/orgs/org_2/trainings/order", {
    method: "PUT",
    body: JSON.stringify({ expectedOrderRevision: revision, trainingIds: desired }),
  });
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    (reordered.body.trainings as OrgTrainingRecord[])
      .filter((topic) => topic.status === "active")
      .map((topic) => [topic.id, topic.displayOrder]),
    desired.map((id, displayOrder) => [id, displayOrder]),
  );
  assert.notEqual(reordered.body.orderRevision, revision);
  const persisted = (await readDb()).orgTrainings;
  assert.equal(persisted.find((topic) => topic.id === "training_scope")?.displayOrder, undefined);
  assert.deepEqual(
    desired.map((id) => persisted.find((topic) => topic.id === id)?.displayOrder),
    desired.map((_, index) => index),
  );
  const auditEvents = await readPlatformAuditEvents();
  const orderAudits = auditEvents.filter((event) => event.action === "org.training.order_updated");
  assert.equal(orderAudits.length, auditCountBefore + 1);
  assert.deepEqual(orderAudits.at(-1)?.metadata?.orderedTrainingIds, desired);

  const revisionBeforeMembershipChange = reordered.body.orderRevision as string;
  const concurrentCreate = await adminRequest("/orgs/org_2/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Concurrent Active Topic", status: "active" }),
  });
  assert.equal(concurrentCreate.status, 201);
  await waitForWriteToSettle();
  const stateAfterMembershipChange = (await readDb()).orgTrainings
    .filter((topic) => topic.orgId === "org_2")
    .map((topic) => ({ id: topic.id, displayOrder: topic.displayOrder }));
  const staleMembership = await adminRequest("/orgs/org_2/trainings/order", {
    method: "PUT",
    body: JSON.stringify({ expectedOrderRevision: revisionBeforeMembershipChange, trainingIds: desired }),
  });
  assert.equal(staleMembership.status, 409);
  assert.deepEqual(
    (await readDb()).orgTrainings
      .filter((topic) => topic.orgId === "org_2")
      .map((topic) => ({ id: topic.id, displayOrder: topic.displayOrder })),
    stateAfterMembershipChange,
  );
  assert.equal(
    (await readPlatformAuditEvents()).filter((event) => event.action === "org.training.order_updated").length,
    orderAudits.length,
  );
});

test("customer org admin reuses authoritative Focus Topic company order while lesser roles and other orgs are denied", async () => {
  let before = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken);
  assert.equal(before.status, 200);
  let activeTopics = (before.body.trainings as OrgTrainingRecord[])
    .filter((topic) => topic.status === "active")
  let createdTopicId: string | null = null;
  if (activeTopics.length < 2) {
    const created = await adminRequest("/orgs/org_1/trainings", {
      method: "POST",
      body: JSON.stringify({ name: "Customer Order Test Topic", status: "active" }),
    });
    assert.equal(created.status, 201);
    createdTopicId = (created.body as unknown as OrgTrainingRecord).id;
    before = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken);
    activeTopics = (before.body.trainings as OrgTrainingRecord[]).filter((topic) => topic.status === "active");
  }
  const originalIds = activeTopics.map((topic) => topic.id);
  const requestedIds = originalIds.slice().reverse();
  const body = JSON.stringify({
    expectedOrderRevision: before.body.orderRevision,
    trainingIds: requestedIds,
  });

  assert.equal((await dashboardRequest("/orgs/org_1/trainings/order", userAdminToken, { method: "PUT", body })).status, 403);
  assert.equal((await dashboardRequest("/orgs/org_2/trainings/order", orgAdminToken, { method: "PUT", body })).status, 404);

  const reordered = await dashboardRequest("/orgs/org_1/trainings/order", orgAdminToken, { method: "PUT", body });
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    (reordered.body.trainings as OrgTrainingRecord[])
      .filter((topic) => topic.status === "active")
      .map((topic) => topic.id),
    requestedIds,
  );
  const audit = (await readPlatformAuditEvents())
    .filter((event) => event.action === "dashboard.training.order_updated")
    .at(-1);
  assert.equal(audit?.actorType, "web_user");
  assert.equal(audit?.orgId, "org_1");

  const restored = await dashboardRequest("/orgs/org_1/trainings/order", orgAdminToken, {
    method: "PUT",
    body: JSON.stringify({
      expectedOrderRevision: reordered.body.orderRevision,
      trainingIds: originalIds,
    }),
  });
  assert.equal(restored.status, 200);
  if (createdTopicId) {
    assert.equal((await adminRequest(`/orgs/org_1/trainings/${createdTopicId}`, { method: "DELETE" })).status, 200);
  }
});

test("customer Content Organization Training Pack reads serialize ordering-safe fields only", async () => {
  const response = await dashboardRequest("/orgs/org_1/training-packs", orgAdminToken);
  assert.equal(response.status, 200);
  const packs = response.body.packs as Array<Record<string, unknown>>;
  assert.equal(packs.length, 1);
  assert.deepEqual(packs[0], {
    id: "pack_scope",
    title: "Manager Scope Pack",
    active: true,
    displayOrder: 0,
  });
  assert.deepEqual(Object.keys(packs[0]!).sort(), ["active", "displayOrder", "id", "title"]);
  for (const internalField of [
    "organizationId",
    "trainingTopic",
    "learningObjectives",
    "successBehaviors",
    "failurePatterns",
    "requiredBehavioralTriggers",
    "scoringWeightOverrides",
    "complianceConstraints",
    "audienceLevel",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(internalField in packs[0]!, false, `${internalField} crossed the customer boundary`);
  }

  assert.equal((await dashboardRequest("/orgs/org_1/training-packs", userAdminToken)).status, 403);
  assert.equal((await dashboardRequest("/orgs/org_2/training-packs", orgAdminToken)).status, 404);

  const platformResponse = await adminRequest("/orgs/org_1/training-packs");
  assert.equal(platformResponse.status, 200);
  const platformPack = (platformResponse.body.packs as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(platformPack.scoringWeightOverrides, { persuasion: 0.4, clarity: 0.3 });
  assert.deepEqual(platformPack.successBehaviors, ["Confirm the customer objective"]);
  assert.deepEqual(platformPack.failurePatterns, ["Skip discovery"]);
  assert.deepEqual(platformPack.requiredBehavioralTriggers, ["scenario:scenario_scope"]);
  assert.equal(platformPack.complianceConstraints, "Do not reveal internal evaluation guidance.");
});

test("Focus Topic GET leaves an empty organization empty and performs no persistence or pack query", async () => {
  const originalRaw = await readFile(dbPath, "utf8");
  const state = JSON.parse(originalRaw) as ApiDatabase;
  state.orgTrainings = state.orgTrainings.filter((topic) => topic.orgId !== "org_1");
  state.orgTrainingPackAttachments = state.orgTrainingPackAttachments.filter((entry) => entry.orgId !== "org_1");
  state.orgTrainingScenarioAttachments = state.orgTrainingScenarioAttachments.filter((entry) => entry.orgId !== "org_1");
  const emptyRaw = JSON.stringify(state, null, 2);
  await writeFile(dbPath, emptyRaw, "utf8");
  const auditsBefore = JSON.stringify(await readPlatformAuditEvents());
  let trainingPackQueries = 0;
  setDashboardTrainingPackLoaderForTest(async () => {
    trainingPackQueries += 1;
    throw new Error("Focus Topic GET must not query Training Packs.");
  });

  try {
    const first = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken);
    const second = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body.trainings, []);
    assert.deepEqual(second.body.trainings, []);
    const emptyRevision = crypto.createHash("sha256").update("[]").digest("hex");
    assert.equal(first.body.orderRevision, emptyRevision);
    assert.equal(second.body.orderRevision, emptyRevision);
    assert.equal(trainingPackQueries, 0);
    assert.equal(await readFile(dbPath, "utf8"), emptyRaw);
    assert.equal(JSON.stringify(await readPlatformAuditEvents()), auditsBefore);
    assert.equal((await readDb()).orgTrainings.some((topic) => topic.name === "Test Training"), false);

    assert.equal((await dashboardRequest("/orgs/org_1/trainings", userAdminToken)).status, 403);
    assert.equal((await dashboardRequest("/orgs/org_1/trainings", regularDashboardToken)).status, 403);
    assert.equal((await dashboardRequest("/orgs/org_2/trainings", orgAdminToken)).status, 404);
    assert.equal((await dashboardRequest("/orgs/org_2/trainings", superToken)).status, 200);
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
    assert.equal(trainingPackQueries, 0);
    assert.equal(await readFile(dbPath, "utf8"), emptyRaw);
  } finally {
    setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
    await writeFile(dbPath, originalRaw, "utf8");
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
  }
});

test("high-frequency mobile config, performance scope, and reporting reads leave an empty organization unchanged", async () => {
  const originalRaw = await readFile(dbPath, "utf8");
  const state = JSON.parse(originalRaw) as ApiDatabase;
  state.orgTrainings = state.orgTrainings.filter((topic) => topic.orgId !== "org_1");
  state.orgTrainingPackAttachments = state.orgTrainingPackAttachments.filter((entry) => entry.orgId !== "org_1");
  state.orgTrainingScenarioAttachments = state.orgTrainingScenarioAttachments.filter((entry) => entry.orgId !== "org_1");
  const emptyRaw = JSON.stringify(state, null, 2);
  await writeFile(dbPath, emptyRaw, "utf8");
  const auditsBefore = JSON.stringify(await readPlatformAuditEvents());
  let trainingPackQueries = 0;
  setDashboardTrainingPackLoaderForTest(async (orgId) => {
    trainingPackQueries += 1;
    return loadTrainingPacksForRouteTest(orgId);
  });

  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const config = await mobileRequest("/mobile/users/org_admin/config", "token_org_admin");
      assert.equal(config.status, 200);
      assert.deepEqual(config.body.orgTrainings, []);
      assert.equal(trainingPackQueries, pass * 2, "mobile config must not query Training Packs");

      const performance = await mobileRequest(
        "/mobile/users/org_admin/performance/options",
        "token_org_admin",
      );
      assert.equal(performance.status, 200);

      const reporting = await dashboardRequest("/dashboard/reporting/trainings", orgAdminToken);
      assert.equal(reporting.status, 200);
      assert.deepEqual(reporting.body.trainings, []);
      assert.equal(trainingPackQueries, (pass + 1) * 2);

      assert.equal(await readFile(dbPath, "utf8"), emptyRaw);
      assert.equal(JSON.stringify(await readPlatformAuditEvents()), auditsBefore);
      assert.equal((await readDb()).orgTrainings.some((topic) => topic.name === "Test Training"), false);
    }
  } finally {
    setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
    await writeFile(dbPath, originalRaw, "utf8");
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
  }
});

test("performance and reporting Training Pack reads release the app-state lock before awaiting the store", async () => {
  async function proveLockReleasedWhilePackReadIsBlocked(
    runRead: () => Promise<{ status: number }>,
  ): Promise<void> {
    let markPackReadStarted!: () => void;
    const packReadStarted = new Promise<void>((resolve) => { markPackReadStarted = resolve; });
    let releasePackRead!: () => void;
    const packReadRelease = new Promise<void>((resolve) => { releasePackRead = resolve; });
    let markSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    let releaseSave!: () => void;
    const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });

    setDashboardTrainingPackLoaderForTest(async (orgId) => {
      markPackReadStarted();
      await packReadRelease;
      return loadTrainingPacksForRouteTest(orgId);
    });
    setDatabaseSaveBarrierForTest(async () => {
      markSaveStarted();
      await saveRelease;
    });

    const pendingRead = runRead();
    let createdTrainingId: string | null = null;
    try {
      await packReadStarted;
      const pendingWrite = adminRequest("/orgs/org_1/trainings", {
        method: "POST",
        body: JSON.stringify({ name: "Read Lock Probe", status: "draft" }),
      });
      await saveStarted;
      releaseSave();
      const write = await pendingWrite;
      assert.equal(write.status, 201);
      createdTrainingId = (write.body as unknown as OrgTrainingRecord).id;
    } finally {
      setDatabaseSaveBarrierForTest(null);
      releasePackRead();
    }

    try {
      assert.equal((await pendingRead).status, 200);
    } finally {
      setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
      if (createdTrainingId) {
        assert.equal((await adminRequest(`/orgs/org_1/trainings/${createdTrainingId}`, { method: "DELETE" })).status, 200);
      }
    }
  }

  await proveLockReleasedWhilePackReadIsBlocked(() =>
    mobileRequest("/mobile/users/org_admin/performance/options", "token_org_admin")
  );
  await proveLockReleasedWhilePackReadIsBlocked(() =>
    dashboardRequest("/dashboard/reporting/trainings", orgAdminToken)
  );
  await proveLockReleasedWhilePackReadIsBlocked(() =>
    dashboardRequest("/orgs/org_1/training-packs", orgAdminToken)
  );
});

test("Focus Topic GET preserves active, draft, and archived records without mutation", async () => {
  const originalRaw = await readFile(dbPath, "utf8");
  const state = JSON.parse(originalRaw) as ApiDatabase;
  state.orgTrainings = [
    ...state.orgTrainings.filter((topic) => topic.orgId !== "org_1"),
    buildOrgTrainingRecord("topic_active_second", "org_1", {
      name: "Active Second",
      status: "active",
      displayOrder: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    }),
    buildOrgTrainingRecord("topic_draft", "org_1", {
      name: "Draft Topic",
      status: "draft",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    }),
    buildOrgTrainingRecord("topic_active_first", "org_1", {
      name: "Active First",
      status: "active",
      displayOrder: 0,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-02-03T00:00:00.000Z",
    }),
    buildOrgTrainingRecord("topic_archived", "org_1", {
      name: "Archived Topic",
      status: "archived",
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-02-04T00:00:00.000Z",
    }),
  ];
  state.orgTrainingPackAttachments = state.orgTrainingPackAttachments.filter((entry) => entry.orgId !== "org_1");
  state.orgTrainingScenarioAttachments = state.orgTrainingScenarioAttachments.filter((entry) => entry.orgId !== "org_1");
  const mixedRaw = JSON.stringify(state, null, 2);
  await writeFile(dbPath, mixedRaw, "utf8");

  try {
    const customer = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken);
    const platform = await adminRequest("/orgs/org_1/trainings");
    assert.equal(customer.status, 200);
    assert.equal(platform.status, 200);
    const expected = [
      ["topic_active_first", "active", 0, "2026-02-03T00:00:00.000Z"],
      ["topic_active_second", "active", 1, "2026-02-01T00:00:00.000Z"],
      ["topic_draft", "draft", undefined, "2026-02-02T00:00:00.000Z"],
      ["topic_archived", "archived", undefined, "2026-02-04T00:00:00.000Z"],
    ];
    const project = (payload: Record<string, unknown>) =>
      (payload.trainings as OrgTrainingRecord[]).map((topic) => [
        topic.id,
        topic.status,
        topic.displayOrder,
        topic.updatedAt,
      ]);
    assert.deepEqual(project(customer.body), expected);
    assert.deepEqual(project(platform.body), expected);
    assert.equal(await readFile(dbPath, "utf8"), mixedRaw);
  } finally {
    await writeFile(dbPath, originalRaw, "utf8");
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
  }
});

test("Focus Topic DELETE does not complete its HTTP response before required persistence", async () => {
  const created = await adminRequest("/orgs/org_1/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Persistence Barrier Topic", status: "draft" }),
  });
  assert.equal(created.status, 201);
  const trainingId = (created.body as unknown as OrgTrainingRecord).id;
  // A fresh read also proves the preceding create has drained through persistence.
  assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);

  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let responseObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setFocusTopicDeleteResponseObserverForTest(() => {
    responseObserved = true;
  });

  const deletion = adminRequest(`/orgs/org_1/trainings/${trainingId}`, { method: "DELETE" });
  let result: Awaited<typeof deletion> | null = null;
  try {
    await saveStarted;
    assert.equal(responseObserved, false);
  } finally {
    releaseSave();
    result = await deletion;
    setDatabaseSaveBarrierForTest(null);
    setFocusTopicDeleteResponseObserverForTest(null);
  }
  assert.equal(responseObserved, true);
  assert.equal(result?.status, 200);
  assert.equal((await readDb()).orgTrainings.some((topic) => topic.id === trainingId), false);

  const failureCreated = await adminRequest("/orgs/org_1/trainings", {
    method: "POST",
    body: JSON.stringify({ name: "Persistence Failure Topic", status: "draft" }),
  });
  assert.equal(failureCreated.status, 201);
  const failureTrainingId = (failureCreated.body as unknown as OrgTrainingRecord).id;
  assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
  responseObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    throw new Error("controlled app-state persistence failure");
  });
  setFocusTopicDeleteResponseObserverForTest(() => {
    responseObserved = true;
  });
  try {
    const failedDeletion = await adminRequest(`/orgs/org_1/trainings/${failureTrainingId}`, { method: "DELETE" });
    assert.equal(failedDeletion.status, 500);
    assert.equal(responseObserved, false);
    assert.equal((await readDb()).orgTrainings.some((topic) => topic.id === failureTrainingId), true);
  } finally {
    setDatabaseSaveBarrierForTest(null);
    setFocusTopicDeleteResponseObserverForTest(null);
  }
  // Refresh the in-memory cache from the unchanged durable state, then clean up normally.
  assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
  assert.equal((await adminRequest(`/orgs/org_1/trainings/${failureTrainingId}`, { method: "DELETE" })).status, 200);
});

test("identity administration successes wait for durable persistence and save failure never reports success", async () => {
  const email = "durability-batch-2@acme.example";
  const created = await requestWhileIdentityPersistenceHeld("POST /users", () =>
    adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        tier: "enterprise",
        accountType: "enterprise",
        orgId: "org_1",
        orgRole: "user",
        performanceAccess: "none",
      }),
    })
  );
  assert.equal(created.status, 201);
  const createdUserId = created.body.id as string;
  assert.ok(createdUserId);
  assert.equal((await readDurableDbOnce()).users.some((user) => user.id === createdUserId), true);

  const updated = await requestWhileIdentityPersistenceHeld("PATCH /users/:userId", () =>
    adminRequest(`/users/${createdUserId}`, {
      method: "PATCH",
      body: JSON.stringify({ performanceAccess: "team" }),
    })
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.performanceAccess, "team");
  assert.equal(
    (await readDurableDbOnce()).users.find((user) => user.id === createdUserId)?.performanceAccess,
    "team",
  );

  const submitted = await requestWhileIdentityPersistenceHeld(
    "POST /mobile/users/:userId/org-access-requests",
    () => mobileRequest("/mobile/users/gmail_invalid/org-access-requests", "token_gmail_invalid", {
      method: "POST",
      body: JSON.stringify({ joinCode: "ACME2026" }),
    }),
  );
  assert.equal(submitted.status, 201);
  const submittedRequestId = (submitted.body.request as { id: string }).id;
  assert.ok(submittedRequestId);

  const approved = await requestWhileIdentityPersistenceHeld(
    "PATCH /dashboard/admin/access-requests/:requestId",
    () => dashboardRequest(`/dashboard/admin/access-requests/${submittedRequestId}`, orgAdminToken, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    }),
  );
  assert.equal(approved.status, 200);
  let durableDb = await readDurableDbOnce();
  assert.equal(durableDb.enterpriseJoinRequests.find((entry) => entry.id === submittedRequestId)?.status, "approved");
  assert.equal(durableDb.users.find((user) => user.id === "gmail_invalid")?.orgId, "org_1");

  const platformApproved = await requestWhileIdentityPersistenceHeld(
    "PATCH /org-join-requests/:requestId",
    () => adminRequest("/org-join-requests/jr_other", {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    }),
  );
  assert.equal(platformApproved.status, 200);
  durableDb = await readDurableDbOnce();
  assert.equal(durableDb.enterpriseJoinRequests.find((entry) => entry.id === "jr_other")?.status, "approved");
  assert.equal(durableDb.users.find((user) => user.id === "other_pending")?.orgId, "org_2");

  const deleted = await requestWhileIdentityPersistenceHeld("DELETE /users/:userId", () =>
    adminRequest(`/users/${createdUserId}`, { method: "DELETE" })
  );
  assert.equal(deleted.status, 200);
  assert.equal((await readDurableDbOnce()).users.some((user) => user.id === createdUserId), false);

  let successObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    throw new Error("controlled identity administration persistence failure");
  });
  setIdentityAdministrationResponseObserverForTest((route, status) => {
    if (route === "POST /users" && status === 201) successObserved = true;
  });
  try {
    const failed = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email: "durability-batch-2-failure@example.test",
        tier: "free",
        accountType: "individual",
      }),
    });
    assert.equal(failed.status, 500);
    assert.equal(successObserved, false);
    assert.equal(
      (await readDurableDbOnce()).users.some((user) => user.email === "durability-batch-2-failure@example.test"),
      false,
    );
  } finally {
    setDatabaseSaveBarrierForTest(null);
    setIdentityAdministrationResponseObserverForTest(null);
  }
});

test("organization and division configuration success waits for durable persistence", async () => {
  const initialConfig = await adminRequest("/config");
  assert.equal(initialConfig.status, 200);
  const originalDifficulty = String(initialConfig.body.defaultDifficulty);
  const nextDifficulty = originalDifficulty === "hard" ? "easy" : "hard";

  const configUpdated = await requestWhileOrganizationPersistenceHeld("PATCH /config", () =>
    adminRequest("/config", {
      method: "PATCH",
      body: JSON.stringify({ defaultDifficulty: nextDifficulty }),
    })
  );
  assert.equal(configUpdated.status, 200);
  assert.equal((await readDurableDbOnce()).config.defaultDifficulty, nextDifficulty);

  const created = await requestWhileOrganizationPersistenceHeld("POST /orgs", () =>
    adminRequest("/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Durability Batch 3 Organization" }),
    })
  );
  assert.equal(created.status, 201);
  const orgId = String(created.body.id);
  assert.ok(orgId);
  assert.equal((await readDurableDbOnce()).orgs.find((org) => org.id === orgId)?.name, "Durability Batch 3 Organization");

  const orgUpdated = await requestWhileOrganizationPersistenceHeld("PATCH /orgs/:orgId", () =>
    adminRequest(`/orgs/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ contactName: "Durability Contact" }),
    })
  );
  assert.equal(orgUpdated.status, 200);
  assert.equal((await readDurableDbOnce()).orgs.find((org) => org.id === orgId)?.contactName, "Durability Contact");

  const divisionCreated = await requestWhileOrganizationPersistenceHeld("POST /orgs/:orgId/divisions", () =>
    adminRequest(`/orgs/${orgId}/divisions`, {
      method: "POST",
      body: JSON.stringify({ name: "Durability Division" }),
    })
  );
  assert.equal(divisionCreated.status, 201);
  const createdDivisions = divisionCreated.body.divisions as Array<{ id: string; name: string; active: boolean }>;
  const divisionId = createdDivisions.find((division) => division.name === "Durability Division")?.id;
  assert.ok(divisionId);
  assert.equal((await readDurableDbOnce()).orgDivisions.find((division) => division.id === divisionId)?.active, true);

  const divisionUpdated = await requestWhileOrganizationPersistenceHeld(
    "PATCH /orgs/:orgId/divisions/:divisionId",
    () => adminRequest(`/orgs/${orgId}/divisions/${divisionId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Durability Division Updated" }),
    }),
  );
  assert.equal(divisionUpdated.status, 200);
  assert.equal(
    (await readDurableDbOnce()).orgDivisions.find((division) => division.id === divisionId)?.name,
    "Durability Division Updated",
  );

  const wrongOrgDivisionUpdate = await adminRequest(`/orgs/org_2/divisions/${divisionId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Wrong Organization Rename" }),
  });
  assert.equal(wrongOrgDivisionUpdate.status, 404);
  const afterWrongOrgDivisionUpdate = await adminRequest(`/orgs/${orgId}/divisions`);
  assert.equal(afterWrongOrgDivisionUpdate.status, 200);
  assert.equal(
    (afterWrongOrgDivisionUpdate.body.divisions as Array<{ id: string; name: string }>).find(
      (division) => division.id === divisionId,
    )?.name,
    "Durability Division Updated",
  );

  const divisionsEnabled = await requestWhileOrganizationPersistenceHeld(
    "PATCH /orgs/:orgId/divisions/settings",
    () => adminRequest(`/orgs/${orgId}/divisions/settings`, {
      method: "PATCH",
      body: JSON.stringify({ divisionsEnabled: true }),
    }),
  );
  assert.equal(divisionsEnabled.status, 200);
  assert.equal((await readDurableDbOnce()).orgs.find((org) => org.id === orgId)?.divisionsEnabled, true);

  const protectedLastDivision = await adminRequest(`/orgs/${orgId}/divisions/${divisionId}`, { method: "DELETE" });
  assert.equal(protectedLastDivision.status, 409);
  const afterProtectedDelete = await adminRequest(`/orgs/${orgId}/divisions`);
  assert.equal(afterProtectedDelete.status, 200);
  assert.equal(
    (afterProtectedDelete.body.divisions as Array<{ id: string; active: boolean }>).find(
      (division) => division.id === divisionId,
    )?.active,
    true,
  );

  const scenarioList = await adminRequest("/orgs/org_1/standard-scenarios/divisions");
  assert.equal(scenarioList.status, 200);
  const scenarioRows = scenarioList.body.rows as Array<{ scenarioId: string; divisionId: string | null }>;
  const scenario = scenarioRows[0];
  assert.ok(scenario);
  const wrongOrgScenarioDivision = await adminRequest(
    `/orgs/org_1/standard-scenarios/${scenario.scenarioId}/division`,
    {
      method: "PUT",
      body: JSON.stringify({ divisionId: "division_other_org" }),
    },
  );
  assert.equal(wrongOrgScenarioDivision.status, 400);
  const routedScenario = await requestWhileOrganizationPersistenceHeld(
    "PUT /orgs/:orgId/standard-scenarios/:scenarioId/division",
    () => adminRequest(`/orgs/org_1/standard-scenarios/${scenario.scenarioId}/division`, {
      method: "PUT",
      body: JSON.stringify({ divisionId: "division_a" }),
    }),
  );
  assert.equal(routedScenario.status, 200);
  assert.equal(
    (await readDurableDbOnce()).orgStandardScenarioDivisionAssignments.find(
      (assignment) => assignment.orgId === "org_1" && assignment.scenarioId === scenario.scenarioId,
    )?.divisionId,
    "division_a",
  );

  const durableBeforeMobileSettings = await readDurableDbOnce();
  const originalDailyCap = durableBeforeMobileSettings.orgs.find((org) => org.id === "org_1")?.perUserDailySecondsCap;
  assert.ok(originalDailyCap !== undefined);
  const nextDailyCap = originalDailyCap + 1;
  const unauthorizedMobileSettings = await mobileRequest(
    "/mobile/users/user_admin/admin/org/settings",
    "token_user_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ perUserDailySecondsCap: nextDailyCap }),
    },
  );
  assert.equal(unauthorizedMobileSettings.status, 403);
  const mobileSettingsUpdated = await requestWhileOrganizationPersistenceHeld(
    "PATCH /mobile/users/:userId/admin/org/settings",
    () => mobileRequest("/mobile/users/org_admin/admin/org/settings", "token_org_admin", {
      method: "PATCH",
      body: JSON.stringify({ perUserDailySecondsCap: nextDailyCap }),
    }),
  );
  assert.equal(mobileSettingsUpdated.status, 200);
  assert.equal((await readDurableDbOnce()).orgs.find((org) => org.id === "org_1")?.perUserDailySecondsCap, nextDailyCap);

  const divisionsDisabled = await requestWhileOrganizationPersistenceHeld(
    "PATCH /orgs/:orgId/divisions/settings",
    () => adminRequest(`/orgs/${orgId}/divisions/settings`, {
      method: "PATCH",
      body: JSON.stringify({ divisionsEnabled: false }),
    }),
  );
  assert.equal(divisionsDisabled.status, 200);

  const divisionDeleted = await requestWhileOrganizationPersistenceHeld(
    "DELETE /orgs/:orgId/divisions/:divisionId",
    () => adminRequest(`/orgs/${orgId}/divisions/${divisionId}`, { method: "DELETE" }),
  );
  assert.equal(divisionDeleted.status, 200);
  const durableDeletedDivision = (await readDurableDbOnce()).orgDivisions.find((division) => division.id === divisionId);
  assert.equal(durableDeletedDivision?.active, false);
  assert.ok(durableDeletedDivision?.deletedAt);

  const restoredScenario = await adminRequest(`/orgs/org_1/standard-scenarios/${scenario.scenarioId}/division`, {
    method: "PUT",
    body: JSON.stringify({ divisionId: scenario.divisionId }),
  });
  assert.equal(restoredScenario.status, 200);
  const restoredMobileSettings = await mobileRequest(
    "/mobile/users/org_admin/admin/org/settings",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ perUserDailySecondsCap: originalDailyCap }),
    },
  );
  assert.equal(restoredMobileSettings.status, 200);
  const restoredConfig = await adminRequest("/config", {
    method: "PATCH",
    body: JSON.stringify({ defaultDifficulty: originalDifficulty }),
  });
  assert.equal(restoredConfig.status, 200);
  const unauthorizedConfig = await publicRequest("/config", {
    method: "PATCH",
    body: JSON.stringify({ defaultDifficulty: nextDifficulty }),
  });
  assert.equal(unauthorizedConfig.status, 401);
  assert.equal((await readDurableDbOnce()).config.defaultDifficulty, originalDifficulty);

  const auditEvents = await readPlatformAuditEvents();
  const orgActions = new Set(
    auditEvents.filter((event) => event.orgId === orgId).map((event) => event.action),
  );
  for (const action of [
    "org.created",
    "org.updated",
    "org.divisions.created",
    "org.divisions.updated",
    "org.divisions.settings.updated",
    "org.divisions.deleted",
  ]) {
    assert.equal(orgActions.has(action), true, `missing audit action ${action}`);
  }
  assert.equal(
    auditEvents.some((event) =>
      event.action === "org.standard_scenario_division.updated" && event.orgId === "org_1"
    ),
    true,
  );
  assert.equal(
    auditEvents.some((event) =>
      event.action === "org.settings_updated" && event.orgId === "org_1" && event.actorId === "org_admin"
    ),
    true,
  );

  let successObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    throw new Error("controlled organization configuration persistence failure");
  });
  setOrganizationConfigurationResponseObserverForTest((route, status) => {
    if (route === "POST /orgs" && status === 201) successObserved = true;
  });
  try {
    const failed = await adminRequest("/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Durability Batch 3 Failed Organization" }),
    });
    assert.equal(failed.status, 500);
    assert.equal(successObserved, false);
    assert.equal(
      (await readDurableDbOnce()).orgs.some((org) => org.name === "Durability Batch 3 Failed Organization"),
      false,
    );
  } finally {
    setDatabaseSaveBarrierForTest(null);
    setOrganizationConfigurationResponseObserverForTest(null);
  }
});

test("failed app-state writes stay out of cache and cannot leak into a later commit", async () => {
  const failedName = "Failed Cache Isolation Organization";
  const failedJoinCode = "CACHEFAIL";
  const unrelatedName = "Cache Isolation Unrelated Organization";
  const durableBefore = await readDurableDbOnce();
  const durableBeforeIds = new Set(durableBefore.orgs.map((org) => org.id));

  setDatabaseSaveBarrierForTest(async () => {
    throw new Error("controlled cache-isolation persistence failure");
  });
  try {
    const failed = await adminRequest("/orgs", {
      method: "POST",
      body: JSON.stringify({ name: failedName, joinCode: failedJoinCode }),
    });
    assert.equal(failed.status, 500);
  } finally {
    setDatabaseSaveBarrierForTest(null);
  }

  const immediateRead = await adminRequest("/orgs");
  assert.equal(immediateRead.status, 200);
  const inMemoryOrganizations = immediateRead.body as unknown as EnterpriseOrg[];
  assert.equal(inMemoryOrganizations.some((org) => org.name === failedName), false);
  assert.equal(inMemoryOrganizations.some((org) => org.joinCode === failedJoinCode), false);

  const unrelated = await adminRequest("/orgs", {
    method: "POST",
    body: JSON.stringify({ name: unrelatedName }),
  });
  assert.equal(unrelated.status, 201);
  const unrelatedId = String(unrelated.body.id);

  const durableAfterUnrelatedWrite = await readDurableDbOnce();
  assert.equal(durableAfterUnrelatedWrite.orgs.every((org) => (
    durableBeforeIds.has(org.id) || org.id === unrelatedId
  )), true);
  assert.equal(durableAfterUnrelatedWrite.orgs.some((org) => org.id === unrelatedId), true);
  assert.equal(durableAfterUnrelatedWrite.orgs.some((org) => org.name === failedName), false);
  assert.equal(durableAfterUnrelatedWrite.orgs.some((org) => org.joinCode === failedJoinCode), false);

  const retry = await adminRequest("/orgs", {
    method: "POST",
    body: JSON.stringify({ name: failedName, joinCode: failedJoinCode }),
  });
  assert.equal(retry.status, 201);

  const durableAfterRetry = await readDurableDbOnce();
  assert.equal(durableAfterRetry.orgs.filter((org) => org.name === failedName).length, 1);
  assert.equal(durableAfterRetry.orgs.filter((org) => org.joinCode === failedJoinCode).length, 1);
});

test("Training Pack ordering reports committed SQL state when post-commit audit delivery fails", async () => {
  const orderRows = [
    buildTrainingPack("pack_order_a", "org_1", { title: "Order A", displayOrder: 0 }),
    buildTrainingPack("pack_order_b", "org_1", { title: "Order B", displayOrder: 1 }),
  ];
  setContentManagementTrainingPackStoreForTest(createContentManagementTrainingPackStore(orderRows));
  setDashboardTrainingPackLoaderForTest(null);

  try {
    const initial = await adminRequest("/orgs/org_1/training-packs");
    assert.equal(initial.status, 200);
    const initialRevision = String(initial.body.orderRevision);

    setTrainingPackOrderAuditFailureForTest(new Error("controlled post-commit audit failure"));
    const committed = await adminRequest("/orgs/org_1/training-packs/order", {
      method: "PUT",
      body: JSON.stringify({
        trainingPackIds: ["pack_order_b", "pack_order_a"],
        expectedOrderRevision: initialRevision,
      }),
    });
    assert.equal(committed.status, 200);
    const committedRevision = String(committed.body.orderRevision);
    assert.notEqual(committedRevision, initialRevision);
    assert.deepEqual(
      (committed.body.packs as TrainingPack[]).map((pack) => pack.id),
      ["pack_order_b", "pack_order_a"],
    );

    const durable = await adminRequest("/orgs/org_1/training-packs");
    assert.equal(durable.status, 200);
    assert.equal(durable.body.orderRevision, committedRevision);
    assert.deepEqual(
      (durable.body.packs as TrainingPack[]).map((pack) => pack.id),
      ["pack_order_b", "pack_order_a"],
    );

    const staleRetry = await adminRequest("/orgs/org_1/training-packs/order", {
      method: "PUT",
      body: JSON.stringify({
        trainingPackIds: ["pack_order_b", "pack_order_a"],
        expectedOrderRevision: initialRevision,
      }),
    });
    assert.equal(staleRetry.status, 409);

    setTrainingPackOrderAuditFailureForTest(null);
    const currentRetry = await adminRequest("/orgs/org_1/training-packs/order", {
      method: "PUT",
      body: JSON.stringify({
        trainingPackIds: ["pack_order_b", "pack_order_a"],
        expectedOrderRevision: committedRevision,
      }),
    });
    assert.equal(currentRetry.status, 200);
    assert.equal(currentRetry.body.orderRevision, committedRevision);

    const customerReorder = await dashboardRequest("/orgs/org_1/training-packs/order", orgAdminToken, {
      method: "PUT",
      body: JSON.stringify({
        trainingPackIds: ["pack_order_a", "pack_order_b"],
        expectedOrderRevision: committedRevision,
      }),
    });
    assert.equal(customerReorder.status, 200);
    const customerRevision = String(customerReorder.body.orderRevision);
    assert.notEqual(customerRevision, committedRevision);
    assert.deepEqual(
      (customerReorder.body.packs as Array<{ id: string }>).map((pack) => pack.id),
      ["pack_order_a", "pack_order_b"],
    );

    const platformRead = await adminRequest("/orgs/org_1/training-packs");
    assert.equal(platformRead.status, 200);
    assert.equal(platformRead.body.orderRevision, customerRevision);
    assert.deepEqual(
      (platformRead.body.packs as TrainingPack[]).map((pack) => pack.id),
      ["pack_order_a", "pack_order_b"],
    );
  } finally {
    setTrainingPackOrderAuditFailureForTest(null);
    setContentManagementTrainingPackStoreForTest(null);
    setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
  }
});

test("Training Pack create and update return committed rows when post-commit audit delivery fails", async () => {
  setContentManagementTrainingPackStoreForTest(createContentManagementTrainingPackStore([]));
  setDashboardTrainingPackLoaderForTest(null);
  setTrainingPackOrderAuditFailureForTest(new Error("controlled post-commit audit failure"));

  try {
    const created = await adminRequest("/orgs/org_1/training-packs", {
      method: "POST",
      body: JSON.stringify({
        title: "Committed Training Pack",
        trainingPackBrief: "Primary SQL create remains authoritative.",
        requiredBehavioralTriggers: ["confirm next step"],
        active: true,
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, "Committed Training Pack");
    const trainingPackId = String(created.body.id);

    const afterCreate = await adminRequest("/orgs/org_1/training-packs");
    assert.equal(afterCreate.status, 200);
    const durableCreated = (afterCreate.body.packs as TrainingPack[]).find((pack) => pack.id === trainingPackId);
    assert.deepEqual(durableCreated, created.body);

    const updated = await adminRequest(`/orgs/org_1/training-packs/${trainingPackId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Committed Training Pack Updated",
        active: false,
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, "Committed Training Pack Updated");
    assert.equal(updated.body.active, false);

    const afterUpdate = await adminRequest("/orgs/org_1/training-packs");
    assert.equal(afterUpdate.status, 200);
    const durableUpdated = (afterUpdate.body.packs as TrainingPack[]).find((pack) => pack.id === trainingPackId);
    assert.deepEqual(durableUpdated, updated.body);
  } finally {
    setTrainingPackOrderAuditFailureForTest(null);
    setContentManagementTrainingPackStoreForTest(null);
    setDashboardTrainingPackLoaderForTest(loadTrainingPacksForRouteTest);
  }
});

test("content management successes wait for durable persistence and preserve cross-store behavior", async () => {
  const packAssignmentId = "pack_batch4_assignment";
  const packAttachId = "pack_batch4_attach";
  const packDeleteId = "pack_batch4_delete";
  const packPartialFailureId = "pack_batch4_partial_failure";
  const packConcurrentDeleteId = "pack_batch4_concurrent_delete";
  const fakePacks = [
    buildTrainingPack(packAssignmentId, "org_1", {
      title: "Batch 4 Assignment Pack",
      requiredBehavioralTriggers: ["scenario:scenario_scope"],
    }),
    buildTrainingPack(packAttachId, "org_1", { title: "Batch 4 Attachment Pack" }),
    buildTrainingPack(packDeleteId, "org_1", { title: "Batch 4 Delete Pack" }),
    buildTrainingPack(packPartialFailureId, "org_1", { title: "Batch 4 Partial Failure Pack" }),
    buildTrainingPack(packConcurrentDeleteId, "org_1", { title: "Batch 4 Concurrent Delete Pack" }),
    buildTrainingPack("pack_other", "org_2", { title: "Batch 4 Other Organization Pack" }),
  ];
  setContentManagementTrainingPackStoreForTest(createContentManagementTrainingPackStore(fakePacks));

  try {
    const config = await adminRequest("/config");
    assert.equal(config.status, 200);
    const startingDb = await readDurableDbOnce();
    const org = startingDb.orgs.find((entry) => entry.id === "org_1");
    assert.ok(org);
    const assignmentUserIds = startingDb.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === "org_1" && user.status === "active")
      .map((user) => user.id)
      .slice(0, 2);
    assert.equal(assignmentUserIds.length, 2);
    const roleIndustries = config.body.roleIndustries as Array<{
      roleId: string;
      industryId: string;
      active: boolean;
    }>;
    const actionableMapping = roleIndustries.find(
      (mapping) => mapping.active && org.activeIndustries.includes(mapping.industryId as never),
    );
    assert.ok(actionableMapping);

    const assignments = await requestWhileContentPersistenceHeld(
      "PUT /orgs/:orgId/training-packs/:trainingPackId/assignments",
      () => adminRequest(`/orgs/org_1/training-packs/${packAssignmentId}/assignments`, {
        method: "PUT",
        body: JSON.stringify({ userIds: [...assignmentUserIds, assignmentUserIds[0]] }),
      }),
    );
    assert.equal(assignments.status, 200);
    const durableAssignments = (await readDurableDbOnce()).trainingPackAssignments
      .filter((assignment) => assignment.trainingPackId === packAssignmentId && assignment.active);
    assert.deepEqual(durableAssignments.map((assignment) => assignment.userId).sort(), assignmentUserIds.slice().sort());
    assert.deepEqual(
      durableAssignments.map((assignment) => assignment.requiredScenarioIds),
      [["scenario_scope"], ["scenario_scope"]],
    );

    const invalidAssignment = await adminRequest(`/orgs/org_1/training-packs/${packAssignmentId}/assignments`, {
      method: "PUT",
      body: JSON.stringify({ userIds: ["other_org_user"] }),
    });
    assert.equal(invalidAssignment.status, 400);
    const wrongOrgAssignment = await adminRequest("/orgs/org_1/training-packs/pack_other/assignments", {
      method: "PUT",
      body: JSON.stringify({ userIds: ["learner"] }),
    });
    assert.equal(wrongOrgAssignment.status, 404);

    const beforeTopicCreate = await adminRequest("/orgs/org_1/trainings");
    assert.equal(beforeTopicCreate.status, 200);
    const createdTopic = await requestWhileContentPersistenceHeld("POST /orgs/:orgId/trainings", () =>
      adminRequest("/orgs/org_1/trainings", {
        method: "POST",
        body: JSON.stringify({
          name: "Batch 4 Durable Focus Topic",
          description: "Durability and actionability coverage.",
          status: "draft",
        }),
      })
    );
    assert.equal(createdTopic.status, 201);
    const trainingId = String(createdTopic.body.id);
    assert.ok(trainingId);
    assert.equal(createdTopic.body.status, "draft");
    const persistedTopicCreatedAt = String(createdTopic.body.createdAt);
    assert.equal(new Date(persistedTopicCreatedAt).toISOString(), persistedTopicCreatedAt);
    const activatedTopic = await requestWhileContentPersistenceHeld(
      "PATCH /orgs/:orgId/trainings/:trainingId",
      () => adminRequest(`/orgs/org_1/trainings/${trainingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      }),
    );
    assert.equal(activatedTopic.status, 200);
    assert.equal(activatedTopic.body.createdAt, persistedTopicCreatedAt);
    const afterTopicCreate = await adminRequest("/orgs/org_1/trainings");
    const activeAfterCreate = (afterTopicCreate.body.trainings as OrgTrainingRecord[])
      .filter((topic) => topic.status === "active");
    assert.equal(activeAfterCreate.at(-1)?.id, trainingId);
    const createdDisplayOrder = activeAfterCreate.at(-1)?.displayOrder;
    assert.equal(typeof createdDisplayOrder, "number");
    assert.notEqual(afterTopicCreate.body.orderRevision, beforeTopicCreate.body.orderRevision);

    const createdScenario = await requestWhileContentPersistenceHeld(
      "POST /orgs/:orgId/custom-scenarios",
      () => adminRequest("/orgs/org_1/custom-scenarios", {
        method: "POST",
        body: JSON.stringify({
          title: "Batch 4 Durable Scenario",
          description: "A manager must resolve a realistic team concern.",
          desiredOutcome: "Reach a clear shared next step.",
          aiRole: "A concerned team member",
          scoringGuidance: "Assess clarity and empathy.",
          segmentId: actionableMapping.roleId,
          applicableIndustryIds: [actionableMapping.industryId],
          enabled: false,
        }),
      }),
    );
    assert.equal(createdScenario.status, 201);
    const scenarioId = String(createdScenario.body.id);
    assert.ok(scenarioId);
    assert.equal((await readDurableDbOnce()).orgs.find((entry) => entry.id === "org_1")
      ?.customScenarios?.some((scenario) => scenario.id === scenarioId && scenario.enabled === false), true);

    const scenarioAttached = await requestWhileContentPersistenceHeld(
      "PUT /orgs/:orgId/trainings/:trainingId/custom-scenarios",
      () => adminRequest(`/orgs/org_1/trainings/${trainingId}/custom-scenarios`, {
        method: "PUT",
        body: JSON.stringify({ scenarioIds: [scenarioId] }),
      }),
    );
    assert.equal(scenarioAttached.status, 200);
    assert.equal((await readDurableDbOnce()).orgTrainingScenarioAttachments.some((attachment) =>
      attachment.orgId === "org_1" && attachment.trainingId === trainingId && attachment.scenarioId === scenarioId
    ), true);

    const disabledCatalog = await mobileRequest(
      "/mobile/users/user_admin/focus-topics",
      "token_user_admin",
    );
    assert.equal(disabledCatalog.status, 200);
    assert.equal(
      (disabledCatalog.body.topics as Array<{ id: string }>).some((topic) => topic.id === trainingId),
      false,
    );

    const scenarioUpdated = await requestWhileContentPersistenceHeld(
      "PATCH /orgs/:orgId/custom-scenarios/:scenarioId",
      () => adminRequest(`/orgs/org_1/custom-scenarios/${scenarioId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true, title: "Batch 4 Actionable Scenario" }),
      }),
    );
    assert.equal(scenarioUpdated.status, 200);
    assert.equal(scenarioUpdated.body.enabled, true);

    const enabledCatalog = await mobileRequest(
      "/mobile/users/user_admin/focus-topics",
      "token_user_admin",
    );
    assert.equal(enabledCatalog.status, 200);
    const catalogTopic = (enabledCatalog.body.topics as Array<{ id: string; scenarioCount: number }>)
      .find((topic) => topic.id === trainingId);
    assert.equal(catalogTopic?.scenarioCount, 1);
    const topicDetail = await mobileRequest(
      `/mobile/users/user_admin/focus-topics/${trainingId}`,
      "token_user_admin",
    );
    assert.equal(topicDetail.status, 200);
    assert.equal(
      (topicDetail.body.scenarios as Array<{ id: string; trainingId: string | null }>).find(
        (scenario) => scenario.id === scenarioId,
      )?.trainingId,
      trainingId,
    );

    const packsAttached = await requestWhileContentPersistenceHeld(
      "PUT /orgs/:orgId/trainings/:trainingId/training-packs",
      () => adminRequest(`/orgs/org_1/trainings/${trainingId}/training-packs`, {
        method: "PUT",
        body: JSON.stringify({
          trainingPackIds: [packAttachId, packDeleteId, packPartialFailureId, packConcurrentDeleteId],
        }),
      }),
    );
    assert.equal(packsAttached.status, 200);
    assert.deepEqual(
      ((packsAttached.body.attachedTrainingPackIds as string[]) ?? []).slice().sort(),
      [packAttachId, packDeleteId, packPartialFailureId, packConcurrentDeleteId].sort(),
    );

    const assignedDeletePack = await adminRequest(`/orgs/org_1/training-packs/${packDeleteId}/assignments`, {
      method: "PUT",
      body: JSON.stringify({ userIds: [assignmentUserIds[0]] }),
    });
    assert.equal(assignedDeletePack.status, 200);
    const assignedPartialFailurePack = await adminRequest(
      `/orgs/org_1/training-packs/${packPartialFailureId}/assignments`,
      {
        method: "PUT",
        body: JSON.stringify({ userIds: [assignmentUserIds[0]] }),
      },
    );
    assert.equal(assignedPartialFailurePack.status, 200);
    const assignedConcurrentDeletePack = await adminRequest(
      `/orgs/org_1/training-packs/${packConcurrentDeleteId}/assignments`,
      {
        method: "PUT",
        body: JSON.stringify({ userIds: [assignmentUserIds[1]] }),
      },
    );
    assert.equal(assignedConcurrentDeletePack.status, 200);

    const archivedTopic = await requestWhileContentPersistenceHeld(
      "PATCH /orgs/:orgId/trainings/:trainingId",
      () => adminRequest(`/orgs/org_1/trainings/${trainingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived", name: "Batch 4 Renamed Focus Topic" }),
      }),
    );
    assert.equal(archivedTopic.status, 200);
    assert.equal(archivedTopic.body.status, "archived");
    assert.equal(archivedTopic.body.createdAt, persistedTopicCreatedAt);
    const afterArchive = await adminRequest("/orgs/org_1/trainings");
    const archivedRecord = (afterArchive.body.trainings as OrgTrainingRecord[])
      .find((topic) => topic.id === trainingId);
    assert.equal(archivedRecord?.status, "archived");
    assert.equal(archivedRecord?.name, "Batch 4 Renamed Focus Topic");
    assert.equal(archivedRecord?.createdAt, persistedTopicCreatedAt);
    assert.equal(
      archivedRecord?.displayOrder,
      createdDisplayOrder,
    );
    assert.equal(
      (afterArchive.body.trainings as OrgTrainingRecord[])
        .filter((topic) => topic.status === "active")
        .some((topic) => topic.id === trainingId),
      false,
    );

    const reactivatedTopic = await requestWhileContentPersistenceHeld(
      "PATCH /orgs/:orgId/trainings/:trainingId",
      () => adminRequest(`/orgs/org_1/trainings/${trainingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      }),
    );
    assert.equal(reactivatedTopic.status, 200);
    assert.equal(reactivatedTopic.body.createdAt, persistedTopicCreatedAt);
    const afterReactivate = await adminRequest("/orgs/org_1/trainings");
    const activeAfterReactivate = (afterReactivate.body.trainings as OrgTrainingRecord[])
      .filter((topic) => topic.status === "active");
    assert.equal(activeAfterReactivate.at(-1)?.id, trainingId);
    assert.equal(activeAfterReactivate.at(-1)?.displayOrder, activeAfterReactivate.length - 1);
    assert.equal(activeAfterReactivate.at(-1)?.createdAt, persistedTopicCreatedAt);
    assert.notEqual(afterReactivate.body.orderRevision, afterArchive.body.orderRevision);

    const wrongOrgPackAttachment = await adminRequest(
      "/orgs/org_2/trainings/training_other_org/training-packs",
      {
        method: "PUT",
        body: JSON.stringify({ trainingPackIds: [packAttachId] }),
      },
    );
    assert.equal(wrongOrgPackAttachment.status, 400);
    const staleScenarioAttachment = await adminRequest(
      `/orgs/org_1/trainings/${trainingId}/custom-scenarios`,
      {
        method: "PUT",
        body: JSON.stringify({ scenarioIds: ["scenario_missing_batch4"] }),
      },
    );
    assert.equal(staleScenarioAttachment.status, 400);
    const wrongOrgScenarioUpdate = await adminRequest(`/orgs/org_2/custom-scenarios/${scenarioId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(wrongOrgScenarioUpdate.status, 404);
    const unauthorizedCreate = await dashboardRequest("/orgs/org_1/trainings", orgAdminToken, {
      method: "POST",
      body: JSON.stringify({ name: "Unauthorized Topic", status: "active" }),
    });
    assert.equal(unauthorizedCreate.status, 401);

    const scenarioDeleted = await requestWhileContentPersistenceHeld(
      "DELETE /orgs/:orgId/custom-scenarios/:scenarioId",
      () => adminRequest(`/orgs/org_1/custom-scenarios/${scenarioId}`, { method: "DELETE" }),
    );
    assert.equal(scenarioDeleted.status, 200);
    let durableDb = await readDurableDbOnce();
    assert.equal(durableDb.orgs.find((entry) => entry.id === "org_1")
      ?.customScenarios?.some((scenario) => scenario.id === scenarioId), false);
    assert.equal(durableDb.orgTrainingScenarioAttachments.some((attachment) =>
      attachment.orgId === "org_1" && attachment.scenarioId === scenarioId
    ), false);

    const packDeleted = await requestWhileContentPersistenceHeld(
      "DELETE /orgs/:orgId/training-packs/:trainingPackId",
      () => adminRequest(`/orgs/org_1/training-packs/${packDeleteId}`, { method: "DELETE" }),
    );
    assert.equal(packDeleted.status, 200);
    durableDb = await readDurableDbOnce();
    assert.equal(durableDb.orgTrainingPackAttachments.some((attachment) =>
      attachment.orgId === "org_1" && attachment.trainingPackId === packDeleteId
    ), false);
    assert.equal(durableDb.trainingPackAssignments.some((assignment) =>
      assignment.orgId === "org_1" && assignment.trainingPackId === packDeleteId && assignment.active
    ), false);
    assert.equal(fakePacks.some((pack) => pack.id === packDeleteId), false);

    const auditEvents = await readPlatformAuditEvents();
    for (const action of [
      "org.training_pack.assignments.updated",
      "org.training_pack.deleted",
      "org.custom_scenario.created",
      "org.custom_scenario.updated",
      "org.custom_scenario.deleted",
      "org.training.created",
      "org.training.updated",
      "org.training.pack_attachments.updated",
      "org.training.scenario_attachments.updated",
    ]) {
      assert.equal(auditEvents.some((event) => event.action === action && event.orgId === "org_1"), true, action);
    }

    let successObserved = false;
    setDatabaseSaveBarrierForTest(async () => {
      throw new Error("controlled content management app-state persistence failure");
    });
    setContentManagementResponseObserverForTest((route, status) => {
      if (route === "DELETE /orgs/:orgId/training-packs/:trainingPackId" && status === 200) {
        successObserved = true;
      }
    });
    try {
      const failedDelete = await adminRequest(`/orgs/org_1/training-packs/${packPartialFailureId}`, {
        method: "DELETE",
      });
      assert.equal(failedDelete.status, 500);
      assert.equal(successObserved, false);
      assert.equal(fakePacks.some((pack) => pack.id === packPartialFailureId), false);
      const durableAfterPartialFailure = await readDurableDbOnce();
      assert.equal(durableAfterPartialFailure.orgTrainingPackAttachments.some((attachment) =>
        attachment.orgId === "org_1" && attachment.trainingPackId === packPartialFailureId
      ), true);
      assert.equal(durableAfterPartialFailure.trainingPackAssignments.some((assignment) =>
        assignment.orgId === "org_1"
        && assignment.trainingPackId === packPartialFailureId
        && assignment.active
      ), true);

      const failedRecovery = await adminRequest(`/orgs/org_1/training-packs/${packPartialFailureId}`, {
        method: "DELETE",
      });
      assert.equal(failedRecovery.status, 500);
      assert.equal(successObserved, false);
      const durableAfterFailedRecovery = await readDurableDbOnce();
      assert.equal(durableAfterFailedRecovery.orgTrainingPackAttachments.some((attachment) =>
        attachment.orgId === "org_1" && attachment.trainingPackId === packPartialFailureId
      ), true);
      assert.equal(durableAfterFailedRecovery.trainingPackAssignments.some((assignment) =>
        assignment.orgId === "org_1"
        && assignment.trainingPackId === packPartialFailureId
        && assignment.active
      ), true);
    } finally {
      setDatabaseSaveBarrierForTest(null);
      setContentManagementResponseObserverForTest(null);
    }

    const recoveredDelete = await adminRequest(`/orgs/org_1/training-packs/${packPartialFailureId}`, {
      method: "DELETE",
    });
    assert.equal(recoveredDelete.status, 200);
    const durableAfterRecovery = await readDurableDbOnce();
    assert.equal(durableAfterRecovery.orgTrainingPackAttachments.some((attachment) =>
      attachment.orgId === "org_1" && attachment.trainingPackId === packPartialFailureId
    ), false);
    assert.equal(durableAfterRecovery.trainingPackAssignments.some((assignment) =>
      assignment.orgId === "org_1"
      && assignment.trainingPackId === packPartialFailureId
      && assignment.active
    ), false);
    assert.equal(fakePacks.some((pack) => pack.id === packPartialFailureId), false);

    const fullyDeletedRetry = await adminRequest(`/orgs/org_1/training-packs/${packPartialFailureId}`, {
      method: "DELETE",
    });
    assert.equal(fullyDeletedRetry.status, 404);

    const wrongOrgRecovery = await adminRequest("/orgs/org_1/training-packs/pack_other", {
      method: "DELETE",
    });
    assert.equal(wrongOrgRecovery.status, 404);
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
    const durableAfterWrongOrgAttempt = await readDurableDbOnce();
    assert.equal(fakePacks.some((pack) => pack.id === "pack_other" && pack.organizationId === "org_2"), true);
    assert.equal(durableAfterWrongOrgAttempt.orgTrainingPackAttachments.some((attachment) =>
      attachment.orgId === "org_2" && attachment.trainingPackId === "pack_other"
    ), true);
    assert.equal(durableAfterWrongOrgAttempt.trainingPackAssignments.some((assignment) =>
      assignment.orgId === "org_2" && assignment.trainingPackId === "pack_other" && assignment.active
    ), true);

    const concurrentDeletes = await Promise.all([
      adminRequest(`/orgs/org_1/training-packs/${packConcurrentDeleteId}`, { method: "DELETE" }),
      adminRequest(`/orgs/org_1/training-packs/${packConcurrentDeleteId}`, { method: "DELETE" }),
    ]);
    assert.deepEqual(concurrentDeletes.map((result) => result.status).sort(), [200, 404]);
    assert.equal((await adminRequest("/orgs/org_1/trainings")).status, 200);
    const durableAfterConcurrentDeletes = await readDurableDbOnce();
    assert.equal(fakePacks.some((pack) => pack.id === packConcurrentDeleteId), false);
    assert.equal(durableAfterConcurrentDeletes.orgTrainingPackAttachments.some((attachment) =>
      attachment.orgId === "org_1" && attachment.trainingPackId === packConcurrentDeleteId
    ), false);
    assert.equal(durableAfterConcurrentDeletes.trainingPackAssignments.some((assignment) =>
      assignment.orgId === "org_1"
      && assignment.trainingPackId === packConcurrentDeleteId
      && assignment.active
    ), false);

    const recoveryAuditEvents = await readPlatformAuditEvents();
    assert.equal(recoveryAuditEvents.some((event) =>
      event.action === "org.training_pack.delete_recovered"
      && event.orgId === "org_1"
      && event.metadata?.trainingPackId === packPartialFailureId
    ), true);
  } finally {
    setContentManagementTrainingPackStoreForTest(null);
  }
});

test("score, simulation-start, and usage successes wait for app-state persistence", async () => {
  const config = await adminRequest("/config");
  assert.equal(config.status, 200);
  const segment = (config.body.segments as Array<{
    id: string;
    scenarios: Array<{ id: string; enabled?: boolean }>;
  }>).find((entry) => entry.scenarios.some((scenario) => scenario.enabled !== false));
  const scenario = segment?.scenarios.find((entry) => entry.enabled !== false);
  assert.ok(segment && scenario);

  const completedAt = new Date();
  const startedAt = new Date(completedAt.getTime() - 60_000);
  const simulationSessionId = "sim_batch5_runtime_success";
  const startBody = {
    simulationSessionId,
    segmentId: segment.id,
    scenarioId: scenario.id,
    clientStartedAt: startedAt.toISOString(),
  };

  const started = await requestWhileRuntimePersistenceHeld(
    "POST /mobile/users/:userId/simulation-sessions/start",
    () => mobileRequest("/mobile/users/org_admin/simulation-sessions/start", "token_org_admin", {
      method: "POST",
      body: JSON.stringify(startBody),
    }),
  );
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.recognized, true);
  assert.equal(started.body.simulationSessionId, simulationSessionId);
  assert.equal(started.body.status, "started");

  const duplicateStart = await mobileRequest(
    "/mobile/users/org_admin/simulation-sessions/start",
    "token_org_admin",
    { method: "POST", body: JSON.stringify(startBody) },
  );
  assert.equal(duplicateStart.status, 201, JSON.stringify(duplicateStart.body));
  assert.equal(
    (await readExtractedStoreRecords<{ simulationSessionId: string }>("simulation-sessions"))
      .filter((record) => record.simulationSessionId === simulationSessionId).length,
    1,
  );

  const invalidStart = await mobileRequest(
    "/mobile/users/org_admin/simulation-sessions/start",
    "token_org_admin",
    {
      method: "POST",
      body: JSON.stringify({ ...startBody, simulationSessionId: "sim_batch5_invalid", scenarioId: "missing" }),
    },
  );
  assert.equal(invalidStart.status, 400);

  const scoreBody = {
    userId: "org_admin",
    segmentId: segment.id,
    scenarioId: scenario.id,
    simulationSessionId,
    startedAt: startedAt.toISOString(),
    endedAt: completedAt.toISOString(),
    communicationScore: 80,
    outcomeScore: 75,
    overallScore: 78,
    completionLevel: "complete",
    objectiveAchieved: true,
    persuasion: 8,
    clarity: 7,
    empathy: 9,
    assertiveness: 8,
    summary: "Durability lifecycle score.",
  };
  const scored = await requestWhileRuntimePersistenceHeld(
    "POST /mobile/users/:userId/scores",
    () => mobileRequest("/mobile/users/org_admin/scores", "token_org_admin", {
      method: "POST",
      body: JSON.stringify(scoreBody),
    }),
  );
  assert.equal(scored.status, 201, JSON.stringify(scored.body));
  assert.equal(scored.body.simulationSessionId, simulationSessionId);
  assert.equal(scored.body.objectiveAchieved, true);
  assert.equal(scored.body.completionLevel, "complete");
  assert.deepEqual(scored.body.scoringWeightsApplied, {
    persuasion: 0.25,
    clarity: 0.25,
    empathy: 0.25,
    assertiveness: 0.25,
  });
  const durableScore = (await readExtractedStoreRecords<SimulationScoreRecord>("score-records"))
    .find((record) => record.simulationSessionId === simulationSessionId);
  assert.ok(durableScore);
  assert.deepEqual(
    [durableScore.persuasion, durableScore.clarity, durableScore.empathy, durableScore.assertiveness],
    [8, 7, 9, 8],
  );

  const usageBody = {
    simulationSessionId,
    userId: "org_admin",
    segmentId: segment.id,
    scenarioId: scenario.id,
    startedAt: startedAt.toISOString(),
    endedAt: completedAt.toISOString(),
    rawDurationSeconds: 60,
  };
  const usage = await requestWhileRuntimePersistenceHeld(
    "POST /usage/sessions",
    () => mobileRequest("/usage/sessions", "token_org_admin", {
      method: "POST",
      body: JSON.stringify(usageBody),
    }),
  );
  assert.equal(usage.status, 201, JSON.stringify(usage.body));
  assert.equal(usage.body.recorded, true);
  assert.equal(typeof usage.body.billedSecondsAdded, "number");

  const replay = await mobileRequest("/usage/sessions", "token_org_admin", {
    method: "POST",
    body: JSON.stringify(usageBody),
  });
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  const usageRecords = await readExtractedStoreRecords<UsageSessionRecord>("usage-sessions");
  assert.equal(
    usageRecords.filter((record) => record.id === usageRecordIdForSimulationSession(simulationSessionId)).length,
    1,
  );
  assert.equal(
    (await readExtractedStoreRecords<{ simulationSessionId: string; status: string }>("simulation-sessions"))
      .find((record) => record.simulationSessionId === simulationSessionId)?.status,
    "usage_recorded",
  );
  assert.equal(
    (await readExtractedStoreRecords<{ simulationSessionId: string; trainingId?: string | null }>("simulation-sessions"))
      .find((record) => record.simulationSessionId === simulationSessionId)?.trainingId ?? null,
    null,
  );
  assert.equal(durableScore.trainingId ?? null, null);
  assert.equal(
    usageRecords.find((record) => record.id === usageRecordIdForSimulationSession(simulationSessionId))?.trainingId ?? null,
    null,
  );

  const sameOrgTrainingId = (await readDurableDbOnce()).orgTrainings
    .find((training) => training.orgId === "org_1" && training.status === "active")?.id;
  assert.ok(sameOrgTrainingId);

  for (const [forgedSessionId, forgedTrainingId] of [
    ["sim_standard_same_org_training", sameOrgTrainingId],
    ["sim_standard_arbitrary_training", "training_crafted_arbitrary"],
  ] as const) {
    const forgedStart = await mobileRequest(
      "/mobile/users/org_admin/simulation-sessions/start",
      "token_org_admin",
      {
        method: "POST",
        body: JSON.stringify({ ...startBody, simulationSessionId: forgedSessionId, trainingId: forgedTrainingId }),
      },
    );
    assert.equal(forgedStart.status, 201, JSON.stringify(forgedStart.body));

    const forgedScore = await mobileRequest("/mobile/users/org_admin/scores", "token_org_admin", {
      method: "POST",
      body: JSON.stringify({ ...scoreBody, simulationSessionId: forgedSessionId, trainingId: forgedTrainingId }),
    });
    assert.equal(forgedScore.status, 201, JSON.stringify(forgedScore.body));

    const forgedUsage = await mobileRequest("/usage/sessions", "token_org_admin", {
      method: "POST",
      body: JSON.stringify({ ...usageBody, simulationSessionId: forgedSessionId, trainingId: forgedTrainingId }),
    });
    assert.equal(forgedUsage.status, 201, JSON.stringify(forgedUsage.body));

    const storedSession = (await readExtractedStoreRecords<{
      simulationSessionId: string;
      trainingId?: string | null;
    }>("simulation-sessions")).find((record) => record.simulationSessionId === forgedSessionId);
    const storedScore = (await readExtractedStoreRecords<SimulationScoreRecord>("score-records"))
      .find((record) => record.simulationSessionId === forgedSessionId);
    const storedUsage = (await readExtractedStoreRecords<UsageSessionRecord>("usage-sessions"))
      .find((record) => record.id === usageRecordIdForSimulationSession(forgedSessionId));
    assert.ok(storedSession);
    assert.ok(storedScore);
    assert.ok(storedUsage);
    assert.equal(storedSession.trainingId ?? null, null);
    assert.equal(storedScore.trainingId ?? null, null);
    assert.equal(storedUsage.trainingId ?? null, null);
  }

  const failedScoreSessionId = "sim_batch5_score_save_failure";
  const failedScore = await requestWithRuntimePersistenceFailure(
    "POST /mobile/users/:userId/scores",
    () => mobileRequest("/mobile/users/org_admin/scores", "token_org_admin", {
      method: "POST",
      body: JSON.stringify({ ...scoreBody, simulationSessionId: failedScoreSessionId }),
    }),
  );
  assert.equal(failedScore.status, 500);
  assert.equal(
    (await readExtractedStoreRecords<SimulationScoreRecord>("score-records"))
      .some((record) => record.simulationSessionId === failedScoreSessionId),
    true,
  );

  const failedStartSessionId = "sim_batch5_start_save_failure";
  const failedStart = await requestWithRuntimePersistenceFailure(
    "POST /mobile/users/:userId/simulation-sessions/start",
    () => mobileRequest("/mobile/users/org_admin/simulation-sessions/start", "token_org_admin", {
      method: "POST",
      body: JSON.stringify({ ...startBody, simulationSessionId: failedStartSessionId }),
    }),
  );
  assert.equal(failedStart.status, 500);
  assert.equal(
    (await readExtractedStoreRecords<{ simulationSessionId: string }>("simulation-sessions"))
      .some((record) => record.simulationSessionId === failedStartSessionId),
    true,
  );

  const failedUsageSessionId = "sim_batch5_usage_save_failure";
  const usageFailureStart = await mobileRequest(
    "/mobile/users/org_admin/simulation-sessions/start",
    "token_org_admin",
    {
      method: "POST",
      body: JSON.stringify({ ...startBody, simulationSessionId: failedUsageSessionId }),
    },
  );
  assert.equal(usageFailureStart.status, 201, JSON.stringify(usageFailureStart.body));
  const failedUsage = await requestWithRuntimePersistenceFailure(
    "POST /usage/sessions",
    () => mobileRequest("/usage/sessions", "token_org_admin", {
      method: "POST",
      body: JSON.stringify({ ...usageBody, simulationSessionId: failedUsageSessionId }),
    }),
  );
  assert.equal(failedUsage.status, 500);
  assert.equal(
    (await readExtractedStoreRecords<UsageSessionRecord>("usage-sessions"))
      .some((record) => record.id === usageRecordIdForSimulationSession(failedUsageSessionId)),
    true,
  );
  assert.equal(
    (await readExtractedStoreRecords<{ simulationSessionId: string; status: string }>("simulation-sessions"))
      .find((record) => record.simulationSessionId === failedUsageSessionId)?.status,
    "usage_recorded",
  );
});
