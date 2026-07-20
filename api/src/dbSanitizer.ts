import {
  ApiDatabase,
  EnterpriseOrg,
  TrainingPackAssignmentRecord,
  UserProfile
} from "@voicepractice/shared";

export const SANITIZER_PROFILES = ["prod-bootstrap", "staging-refresh"] as const;
export type SanitizerProfile = (typeof SANITIZER_PROFILES)[number];

export const OPERATIONAL_TABLES = [
  "web_auth_sessions",
  "usage_sessions",
  "simulation_sessions",
  "score_records",
  "ai_usage_events",
  "support_cases",
  "audit_events",
  "performance_plan_scope_items",
  "performance_plan_audit_events",
  "performance_plans"
] as const;

export type OperationalTableName = (typeof OPERATIONAL_TABLES)[number];

export interface AppStateCounts {
  users: number;
  orgs: number;
  orgDivisions: number;
  orgTrainings: number;
  orgTrainingPackAttachments: number;
  orgTrainingScenarioAttachments: number;
  orgStandardScenarioDivisionAssignments: number;
  trainingPackAssignments: number;
  mobileAuthTokens: number;
  emailVerifications: number;
  webAuthChallenges: number;
  enterpriseJoinRequests: number;
  adminActiveSessions: number;
  legacyUsageSessions: number;
  legacyScoreRecords: number;
  legacyAiUsageEvents: number;
  legacyAuditEvents: number;
  legacySupportCases: number;
  legacyWebAuthSessions: number;
  industries: number;
  segments: number;
  standardScenarios: number;
  orgCustomScenarios: number;
}

export interface AppStateSanitizeReport {
  profile: SanitizerProfile;
  appStateKeysFound: string[];
  before: AppStateCounts;
  after: AppStateCounts;
  deleted: {
    orgs: number;
    users: number;
    orgDivisions: number;
    orgTrainings: number;
    orgTrainingPackAttachments: number;
    orgTrainingScenarioAttachments: number;
    orgStandardScenarioDivisionAssignments: number;
    trainingPackAssignments: number;
    mobileAuthTokens: number;
    emailVerifications: number;
    webAuthChallenges: number;
    enterpriseJoinRequests: number;
    adminActiveSessions: number;
    legacyUsageSessions: number;
    legacyScoreRecords: number;
    legacyAiUsageEvents: number;
    legacyAuditEvents: number;
    legacySupportCases: number;
    legacyWebAuthSessions: number;
  };
  preserved: {
    orgs: number;
    users: number;
    orgDivisions: number;
    orgTrainings: number;
    orgTrainingPackAttachments: number;
    orgTrainingScenarioAttachments: number;
    orgStandardScenarioDivisionAssignments: number;
    trainingPackAssignments: number;
    industries: number;
    segments: number;
    standardScenarios: number;
    orgCustomScenarios: number;
    adminPasswordHash: boolean;
  };
  changed: {
    trainingPackAssignmentsProgressReset: number;
    assignedByUserIdsCleared: number;
  };
  removedOrgIds: string[];
  removedUserIds: string[];
  warnings: string[];
}

export interface SanitizedAppStateResult {
  sanitized: ApiDatabase;
  report: AppStateSanitizeReport;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countStandardScenarios(db: Partial<ApiDatabase>): number {
  const segments = Array.isArray(db.config?.segments) ? db.config.segments : [];
  return segments.reduce((total, segment) => total + countArray(segment.scenarios), 0);
}

function countOrgCustomScenarios(db: Partial<ApiDatabase>): number {
  return (Array.isArray(db.orgs) ? db.orgs : []).reduce(
    (total, org) => total + countArray((org as EnterpriseOrg & { customScenarios?: unknown[] }).customScenarios),
    0
  );
}

export function collectAppStateCounts(db: Partial<ApiDatabase>): AppStateCounts {
  return {
    users: countArray(db.users),
    orgs: countArray(db.orgs),
    orgDivisions: countArray(db.orgDivisions),
    orgTrainings: countArray(db.orgTrainings),
    orgTrainingPackAttachments: countArray(db.orgTrainingPackAttachments),
    orgTrainingScenarioAttachments: countArray(db.orgTrainingScenarioAttachments),
    orgStandardScenarioDivisionAssignments: countArray(db.orgStandardScenarioDivisionAssignments),
    trainingPackAssignments: countArray(db.trainingPackAssignments),
    mobileAuthTokens: countArray(db.mobileAuthTokens),
    emailVerifications: countArray(db.emailVerifications),
    webAuthChallenges: countArray(db.webAuthChallenges),
    enterpriseJoinRequests: countArray(db.enterpriseJoinRequests),
    adminActiveSessions: countArray(db.admin?.activeSessionIds),
    legacyUsageSessions: countArray(db.usageSessions),
    legacyScoreRecords: countArray(db.scoreRecords),
    legacyAiUsageEvents: countArray(db.aiUsageEvents),
    legacyAuditEvents: countArray(db.auditEvents),
    legacySupportCases: countArray(db.supportCases),
    legacyWebAuthSessions: countArray(db.webAuthSessions),
    industries: countArray(db.config?.industries),
    segments: countArray(db.config?.segments),
    standardScenarios: countStandardScenarios(db),
    orgCustomScenarios: countOrgCustomScenarios(db)
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasPrefixedId(value: unknown, prefix: string): boolean {
  return normalizeText(value).startsWith(prefix);
}

function isSafeTestEmail(value: unknown): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.endsWith(".local") ||
    normalized.endsWith(".example") ||
    normalized.includes("@peritio.local") ||
    normalized.includes("@primary.local") ||
    normalized.includes("@secondary.local") ||
    normalized.includes("@criticalflow.example")
  );
}

function isSafeTestOrg(org: EnterpriseOrg): boolean {
  return (
    hasPrefixedId(org.id, "org_demo_") ||
    normalizeText(org.id) === "org_starter" ||
    isSafeTestEmail(org.contactEmail) ||
    isSafeTestEmail(org.emailDomain)
  );
}

function isSafeTestUser(user: UserProfile): boolean {
  return hasPrefixedId(user.id, "usr_demo_") || isSafeTestEmail(user.email);
}

function isAmbiguousEnvironmentText(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  if (isSafeTestEmail(normalized)) {
    return false;
  }

  return /(^|[^a-z0-9])(test|demo|staging|stage|dev|local|pretester|smoke|critical)([^a-z0-9]|$)/.test(normalized);
}

function appendLimitedWarning(warnings: string[], message: string): void {
  if (warnings.length < 50) {
    warnings.push(message);
  }
}

function buildWarnings(db: ApiDatabase, removedOrgIds: Set<string>, removedUserIds: Set<string>): string[] {
  const warnings: string[] = [];
  for (const org of db.orgs ?? []) {
    if (removedOrgIds.has(org.id)) {
      continue;
    }
    if (
      isAmbiguousEnvironmentText(org.id) ||
      isAmbiguousEnvironmentText(org.name) ||
      isAmbiguousEnvironmentText(org.contactEmail) ||
      isAmbiguousEnvironmentText(org.emailDomain)
    ) {
      appendLimitedWarning(
        warnings,
        `Ambiguous org preserved for manual review: ${org.id} (${org.name || org.contactEmail || "unnamed"})`
      );
    }
  }

  for (const user of db.users ?? []) {
    if (removedUserIds.has(user.id)) {
      continue;
    }
    if (isAmbiguousEnvironmentText(user.id) || isAmbiguousEnvironmentText(user.email)) {
      appendLimitedWarning(
        warnings,
        `Ambiguous user preserved for manual review: ${user.id} (${user.email || "unknown email"})`
      );
    }
  }

  return warnings;
}

function filterOrgScopedRecords<T extends { orgId: string }>(records: T[], validOrgIds: Set<string>): T[] {
  return records.filter((entry) => validOrgIds.has(entry.orgId));
}

function filterTrainingScopedRecords<T extends { orgId: string; trainingId: string }>(
  records: T[],
  validOrgIds: Set<string>,
  validTrainingIds: Set<string>
): T[] {
  return records.filter((entry) => validOrgIds.has(entry.orgId) && validTrainingIds.has(entry.trainingId));
}

function sanitizeTrainingPackAssignments(params: {
  assignments: TrainingPackAssignmentRecord[];
  validOrgIds: Set<string>;
  validUserIds: Set<string>;
}): {
  assignments: TrainingPackAssignmentRecord[];
  removedCount: number;
  progressResetCount: number;
  assignedByClearedCount: number;
} {
  let progressResetCount = 0;
  let assignedByClearedCount = 0;
  const assignments: TrainingPackAssignmentRecord[] = [];

  for (const assignment of params.assignments) {
    if (!params.validOrgIds.has(assignment.orgId) || !params.validUserIds.has(assignment.userId)) {
      continue;
    }

    const next: TrainingPackAssignmentRecord = {
      ...assignment,
      active: assignment.active !== false,
      assignedByUserId:
        assignment.assignedByUserId && params.validUserIds.has(assignment.assignedByUserId)
          ? assignment.assignedByUserId
          : null,
      requiredScenarioIds: Array.isArray(assignment.requiredScenarioIds)
        ? assignment.requiredScenarioIds.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        : [],
      completionRule: assignment.completionRule ?? "scored_required_scenarios_v1",
      startedAt: null,
      completedAt: null
    };

    if (assignment.startedAt !== null || assignment.completedAt !== null) {
      progressResetCount += 1;
    }
    if (assignment.assignedByUserId && next.assignedByUserId === null) {
      assignedByClearedCount += 1;
    }

    assignments.push(next);
  }

  return {
    assignments,
    removedCount: params.assignments.length - assignments.length,
    progressResetCount,
    assignedByClearedCount
  };
}

export function sanitizeAppState(input: ApiDatabase, profile: SanitizerProfile): SanitizedAppStateResult {
  const sanitized = cloneJson(input);
  const appStateKeysFound = Object.keys(input as unknown as Record<string, unknown>).sort();
  const before = collectAppStateCounts(sanitized);

  const removedOrgIds = new Set<string>();
  sanitized.orgs = (sanitized.orgs ?? []).filter((org) => {
    const remove = isSafeTestOrg(org);
    if (remove) {
      removedOrgIds.add(org.id);
    }
    return !remove;
  });
  const validOrgIds = new Set(sanitized.orgs.map((org) => org.id));

  const removedUserIds = new Set<string>();
  sanitized.users = (sanitized.users ?? []).filter((user) => {
    const remove = isSafeTestUser(user) || (typeof user.orgId === "string" && removedOrgIds.has(user.orgId));
    if (remove) {
      removedUserIds.add(user.id);
    }
    return !remove;
  });
  const validUserIds = new Set(sanitized.users.map((user) => user.id));

  sanitized.orgDivisions = filterOrgScopedRecords(sanitized.orgDivisions ?? [], validOrgIds);
  const validDivisionIds = new Set(sanitized.orgDivisions.map((division) => division.id));

  sanitized.orgTrainings = filterOrgScopedRecords(sanitized.orgTrainings ?? [], validOrgIds);
  const validTrainingIds = new Set(sanitized.orgTrainings.map((training) => training.id));

  sanitized.orgTrainingPackAttachments = filterTrainingScopedRecords(
    sanitized.orgTrainingPackAttachments ?? [],
    validOrgIds,
    validTrainingIds
  );
  sanitized.orgTrainingScenarioAttachments = filterTrainingScopedRecords(
    sanitized.orgTrainingScenarioAttachments ?? [],
    validOrgIds,
    validTrainingIds
  );
  sanitized.orgStandardScenarioDivisionAssignments = (sanitized.orgStandardScenarioDivisionAssignments ?? []).filter(
    (assignment) => validOrgIds.has(assignment.orgId) && validDivisionIds.has(assignment.divisionId)
  );

  const assignmentSanitization = sanitizeTrainingPackAssignments({
    assignments: sanitized.trainingPackAssignments ?? [],
    validOrgIds,
    validUserIds
  });
  sanitized.trainingPackAssignments = assignmentSanitization.assignments;

  sanitized.mobileAuthTokens = [];
  sanitized.emailVerifications = [];
  sanitized.webAuthChallenges = [];
  sanitized.enterpriseJoinRequests = [];
  sanitized.usageSessions = [];
  sanitized.admin = {
    passwordHash: sanitized.admin?.passwordHash ?? null,
    activeSessionIds: []
  };

  delete (sanitized as Partial<ApiDatabase>).scoreRecords;
  delete (sanitized as Partial<ApiDatabase>).aiUsageEvents;
  delete (sanitized as Partial<ApiDatabase>).auditEvents;
  delete (sanitized as Partial<ApiDatabase>).supportCases;
  delete (sanitized as Partial<ApiDatabase>).webAuthSessions;

  const after = collectAppStateCounts(sanitized);
  const warnings = buildWarnings(sanitized, removedOrgIds, removedUserIds);

  return {
    sanitized,
    report: {
      profile,
      appStateKeysFound,
      before,
      after,
      deleted: {
        orgs: before.orgs - after.orgs,
        users: before.users - after.users,
        orgDivisions: before.orgDivisions - after.orgDivisions,
        orgTrainings: before.orgTrainings - after.orgTrainings,
        orgTrainingPackAttachments: before.orgTrainingPackAttachments - after.orgTrainingPackAttachments,
        orgTrainingScenarioAttachments: before.orgTrainingScenarioAttachments - after.orgTrainingScenarioAttachments,
        orgStandardScenarioDivisionAssignments:
          before.orgStandardScenarioDivisionAssignments - after.orgStandardScenarioDivisionAssignments,
        trainingPackAssignments: assignmentSanitization.removedCount,
        mobileAuthTokens: before.mobileAuthTokens,
        emailVerifications: before.emailVerifications,
        webAuthChallenges: before.webAuthChallenges,
        enterpriseJoinRequests: before.enterpriseJoinRequests,
        adminActiveSessions: before.adminActiveSessions,
        legacyUsageSessions: before.legacyUsageSessions,
        legacyScoreRecords: before.legacyScoreRecords,
        legacyAiUsageEvents: before.legacyAiUsageEvents,
        legacyAuditEvents: before.legacyAuditEvents,
        legacySupportCases: before.legacySupportCases,
        legacyWebAuthSessions: before.legacyWebAuthSessions
      },
      preserved: {
        orgs: after.orgs,
        users: after.users,
        orgDivisions: after.orgDivisions,
        orgTrainings: after.orgTrainings,
        orgTrainingPackAttachments: after.orgTrainingPackAttachments,
        orgTrainingScenarioAttachments: after.orgTrainingScenarioAttachments,
        orgStandardScenarioDivisionAssignments: after.orgStandardScenarioDivisionAssignments,
        trainingPackAssignments: after.trainingPackAssignments,
        industries: after.industries,
        segments: after.segments,
        standardScenarios: after.standardScenarios,
        orgCustomScenarios: after.orgCustomScenarios,
        adminPasswordHash: Boolean(sanitized.admin.passwordHash)
      },
      changed: {
        trainingPackAssignmentsProgressReset: assignmentSanitization.progressResetCount,
        assignedByUserIdsCleared: assignmentSanitization.assignedByClearedCount
      },
      removedOrgIds: Array.from(removedOrgIds).sort(),
      removedUserIds: Array.from(removedUserIds).sort(),
      warnings
    }
  };
}

export function parseSanitizerProfile(value: string | undefined): SanitizerProfile {
  const candidate = value?.trim();
  if (candidate === "prod-bootstrap" || candidate === "staging-refresh") {
    return candidate;
  }

  throw new Error('profile must be either "prod-bootstrap" or "staging-refresh".');
}

export function describeDatabaseUrl(databaseUrl: string): { host: string; port: string; database: string } {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname || "(unknown-host)",
      port: parsed.port || "(default-port)",
      database: parsed.pathname.replace(/^\//, "") || "(unknown-database)"
    };
  } catch {
    return {
      host: "(unparseable-host)",
      port: "(unparseable-port)",
      database: "(unparseable-database)"
    };
  }
}

export function databaseUrlLooksProduction(databaseUrl: string): boolean {
  const normalized = databaseUrl.trim().toLowerCase();
  return normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod");
}

export function databaseUrlLooksStaging(databaseUrl: string): boolean {
  const normalized = databaseUrl.trim().toLowerCase();
  return normalized.includes("voicepractice_db") || normalized.includes("voicepractice-db");
}
