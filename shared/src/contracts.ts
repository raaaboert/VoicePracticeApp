export const USAGE_BILLING_INCREMENT_SECONDS = 15;

export const TIER_IDS = ["free", "pro", "pro_plus", "enterprise"] as const;
export type TierId = (typeof TIER_IDS)[number];

export const ACCOUNT_TYPES = ["individual", "enterprise"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORG_STATUSES = ["active", "disabled"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const ORG_USER_ROLES = ["org_admin", "user_admin", "user"] as const;
export type OrgUserRole = (typeof ORG_USER_ROLES)[number];

export const ORG_JOIN_REQUEST_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type OrgJoinRequestStatus = (typeof ORG_JOIN_REQUEST_STATUSES)[number];

export const ORG_USER_ROLE_LABELS: Record<OrgUserRole, string> = {
  org_admin: "Org Admin",
  user_admin: "User Admin",
  user: "User"
};

export const INDUSTRY_IDS = ["people_management", "sales", "medical"] as const;
export type IndustryId = string;

export const INDUSTRY_LABELS: Record<string, string> = {
  people_management: "People Management",
  sales: "Sales",
  medical: "Medical"
};

export const INDUSTRY_ROLE_SEGMENT_IDS: Record<string, string[]> = {
  people_management: ["solution_manager", "project_manager"],
  sales: ["sales_representative", "sales_engineer"],
  medical: ["nurse", "doctor"]
};

export interface IndustryDefinition {
  id: string;
  label: string;
  enabled: boolean;
}

export interface RoleIndustryDefinition {
  roleId: string;
  industryId: string;
  active: boolean;
}

export type Difficulty = "easy" | "medium" | "hard";
export type PersonaStyle = "defensive" | "frustrated" | "skeptical";

export interface Scenario {
  id: string;
  segmentId: string;
  title: string;
  summary?: string;
  description: string;
  aiRole: string;
  enabled?: boolean;
}

export interface SegmentDefinition {
  id: string;
  label: string;
  summary: string;
  enabled: boolean;
  scenarios: Scenario[];
}

export interface TierDefinition {
  id: TierId;
  label: string;
  priceUsdMonthly: number;
  dailySecondsLimit: number | null;
  supportIncluded: boolean;
  canCreateCustomScenarios: boolean;
  description: string;
}

export interface EnterpriseConfig {
  visibleInApp: boolean;
  contactEmail: string;
  contactUrl: string;
  defaultOrgDailySecondsQuota: number;
  defaultPerUserDailySecondsCap: number;
  allowManualBonusSeconds: boolean;
}

export interface AppFeatureFlags {
  scoringEnabled: boolean;
  customScenarioBuilder: boolean;
}

export interface AppConfig {
  activeSegmentId: string;
  defaultDifficulty: Difficulty;
  defaultPersonaStyle: PersonaStyle;
  industries: IndustryDefinition[];
  roleIndustries: RoleIndustryDefinition[];
  segments: SegmentDefinition[];
  tiers: TierDefinition[];
  enterprise: EnterpriseConfig;
  featureFlags: AppFeatureFlags;
  updatedAt: string;
}

export interface EnterpriseOrg {
  id: string;
  name: string;
  status: OrgStatus;
  contactName: string;
  contactEmail: string;
  emailDomain: string | null;
  joinCode: string;
  activeIndustries: IndustryId[];
  dailySecondsQuota: number;
  perUserDailySecondsCap: number;
  manualBonusSeconds: number;
  contractSignedAt: string;
  monthlyMinutesAllotted: number;
  renewalTotalUsd: number;
  softLimitPercentTriggers: number[];
  maxSimulationMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  accountType: AccountType;
  tier: TierId;
  status: UserStatus;
  orgId: string | null;
  orgRole: OrgUserRole;
  timezone: string;
  pendingTimezone: string | null;
  pendingTimezoneEffectiveAt: string | null;
  planAnchorAt: string;
  manualBonusSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUsageBillingResponse {
  generatedAt: string;
  org: EnterpriseOrg;
  orgAdmins: Array<{
    id: string;
    email: string;
    status: UserStatus;
  }>;
  billingPeriod: {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
  };
  usage: {
    usedSeconds: number;
    usedMinutes: number;
    allottedMinutes: number;
    allottedSeconds: number;
    remainingMinutes: number;
    usagePercent: number;
  };
  softLimits: Array<{
    thresholdPercent: number;
    reached: boolean;
    notifiedAt: string | null;
  }>;
  requestPolicy: {
    maxTriggersAllowed: number;
    selectedTriggers: number;
  };
}

export interface OrgAccountsExportRow {
  orgId: string;
  companyName: string;
  dateEstablished: string;
  contractSignedAt: string;
  nextRenewalAt: string;
  companyContact: string;
  contactEmail: string;
  orgAdmins: string;
  activeSegments: string;
  currentUsageMinutes: number;
  monthlyAllotmentMinutes: number;
  renewalTotalUsd: number;
}

export interface OrgAccountsExportResponse {
  generatedAt: string;
  rows: OrgAccountsExportRow[];
}

export interface UsageSessionRecord {
  id: string;
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
  createdAt: string;
}

export interface SimulationScoreRecord {
  id: string;
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  startedAt: string;
  endedAt: string;
  overallScore: number;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  summary?: string;
  rubricVersion?: string;
  model?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  createdAt: string;
}

export type AiUsageEventKind = "opening" | "turn" | "score" | "transcribe";

export interface AiUsageEvent {
  id: string;
  kind: AiUsageEventKind;
  userId: string;
  orgId: string | null;
  segmentId: string | null;
  scenarioId: string | null;
  model: string;
  promptVersion: string;
  rubricVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
}

export type AuditActorType = "platform_admin" | "mobile_user" | "system";

export interface AuditEvent {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  orgId: string | null;
  userId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type SupportCaseStatus = "open" | "closed";

export interface SupportCaseRecord {
  id: string;
  status: SupportCaseStatus;
  userId: string;
  orgId: string | null;
  segmentId: string | null;
  scenarioId: string | null;
  message: string;
  transcriptEncrypted: string | null;
  transcriptExpiresAt: string | null;
  transcriptFileName: string | null;
  transcriptMeta:
    | {
        scenarioTitle: string | null;
        segmentLabel: string | null;
        difficulty: Difficulty | null;
        personaStyle: PersonaStyle | null;
        startedAt: string | null;
        endedAt: string | null;
        model: string | null;
        promptVersion: string | null;
        rubricVersion: string | null;
      }
    | null;
  createdAt: string;
  updatedAt: string;
}

export interface MobileAuthRecord {
  userId: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailVerificationRecord {
  id: string;
  userId: string;
  email: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface EnterpriseJoinRequestRecord {
  id: string;
  userId: string;
  email: string;
  emailDomain: string;
  orgId: string;
  orgNameSnapshot: string;
  joinCodeSnapshot: string;
  status: OrgJoinRequestStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionReason: string | null;
}

export interface EnterpriseDomainMatch {
  orgId: string;
  orgName: string;
  emailDomain: string;
}

export interface UsageSummary {
  rawSecondsToday: number;
  billedSecondsToday: number;
  rawSecondsThisMonth: number;
  billedSecondsThisMonth: number;
  dailySecondsRemaining: number | null;
  dayKey: string;
  monthKey: string;
  timezoneUsed: string;
  nextDailyResetLabel: string;
  nextRenewalAt: string;
}

export interface UserEntitlementsResponse {
  userId: string;
  tier: TierId;
  accountType: AccountType;
  status: UserStatus;
  features: {
    support: boolean;
    customScenarioBuilder: boolean;
  };
  limits: {
    dailySecondsLimit: number | null;
    orgDailySecondsQuota: number | null;
    perUserDailySecondsCap: number | null;
    maxSimulationMinutes: number | null;
    manualBonusSeconds: number;
    billingIncrementSeconds: number;
  };
  usage: UsageSummary;
  canStartSimulation: boolean;
  lockReason: string | null;
}

export interface AdminLoginRequest {
  password: string;
}

export interface AdminLoginResponse {
  token: string;
  expiresAt: string;
}

export interface ChangeAdminPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserRequest {
  email: string;
  tier: TierId;
  accountType: AccountType;
  timezone: string;
  orgId?: string | null;
  orgRole?: OrgUserRole;
}

export interface UpdateUserRequest {
  email?: string;
  tier?: TierId;
  status?: UserStatus;
  accountType?: AccountType;
  timezone?: string;
  orgId?: string | null;
  orgRole?: OrgUserRole;
  manualBonusSeconds?: number;
}

export interface UpdateConfigRequest {
  activeSegmentId?: string;
  defaultDifficulty?: Difficulty;
  industries?: IndustryDefinition[];
  roleIndustries?: RoleIndustryDefinition[];
  segments?: SegmentDefinition[];
  tiers?: TierDefinition[];
  enterprise?: Partial<EnterpriseConfig>;
}

export interface MobileOnboardRequest {
  email: string;
  timezone: string;
}

export interface MobileOnboardResponse {
  user: UserProfile;
  authToken: string;
  verificationRequired: boolean;
  verificationExpiresAt: string | null;
  domainMatch: EnterpriseDomainMatch | null;
}

export interface MobileUpdateSettingsRequest {
  email?: string;
  timezone?: string;
}

export interface MobileVerifyEmailRequest {
  userId: string;
  code: string;
}

export interface MobileResendVerificationRequest {
  userId: string;
}

export interface MobileSubmitOrgJoinRequest {
  joinCode: string;
}

export interface RecordUsageSessionRequest {
  userId: string;
  segmentId: string;
  scenarioId: string;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
}

export interface RecordSimulationScoreRequest {
  userId: string;
  segmentId: string;
  scenarioId: string;
  startedAt: string;
  endedAt: string;
  overallScore: number;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
}

export interface ApiDatabase {
  config: AppConfig;
  users: UserProfile[];
  orgs: EnterpriseOrg[];
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
  aiUsageEvents: AiUsageEvent[];
  auditEvents: AuditEvent[];
  supportCases: SupportCaseRecord[];
  mobileAuthTokens: MobileAuthRecord[];
  emailVerifications: EmailVerificationRecord[];
  enterpriseJoinRequests: EnterpriseJoinRequestRecord[];
  admin: {
    passwordHash: string | null;
    activeSessionIds: string[];
  };
}

export const COMMON_TIMEZONES: string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC"
];

export const DEFAULT_TIER_DEFINITIONS: TierDefinition[] = [
  {
    id: "free",
    label: "Free",
    priceUsdMonthly: 0,
    dailySecondsLimit: 10 * 60,
    supportIncluded: false,
    canCreateCustomScenarios: false,
    description: "10 minutes of simulation time per day."
  },
  {
    id: "pro",
    label: "Pro",
    priceUsdMonthly: 11.99,
    dailySecondsLimit: 30 * 60,
    supportIncluded: true,
    canCreateCustomScenarios: false,
    description: "30 minutes daily plus support."
  },
  {
    id: "pro_plus",
    label: "Pro+",
    priceUsdMonthly: 22.99,
    dailySecondsLimit: 60 * 60,
    supportIncluded: true,
    canCreateCustomScenarios: false,
    description: "60 minutes daily plus support. Custom scenarios reserved for later."
  },
  {
    id: "enterprise",
    label: "Enterprise",
    priceUsdMonthly: 0,
    dailySecondsLimit: null,
    supportIncluded: true,
    canCreateCustomScenarios: false,
    description: "Enterprise licensing is available by request."
  }
];

export const DEFAULT_INDUSTRIES: IndustryDefinition[] = INDUSTRY_IDS.map((id) => ({
  id,
  label: INDUSTRY_LABELS[id] ?? id,
  enabled: true
}));

export const DEFAULT_ROLE_INDUSTRIES: RoleIndustryDefinition[] = INDUSTRY_IDS.flatMap((industryId) =>
  (INDUSTRY_ROLE_SEGMENT_IDS[industryId] ?? []).map((roleId) => ({
    roleId,
    industryId,
    active: true
  }))
);

export const DEFAULT_SEGMENTS: SegmentDefinition[] = [
  {
    id: "solution_manager",
    label: "Solution Manager",
    summary: "People management conversations for client leadership and direct reports.",
    enabled: true,
    scenarios: [
      {
        id: "sm_undermining_report",
        segmentId: "solution_manager",
        title: "Direct Report Undermining Decisions",
        description: "A direct report keeps undermining your decisions in front of the team.",
        aiRole: "a direct report who keeps undermining your decisions",
        enabled: true
      },
      {
        id: "sm_scope_creep_client",
        segmentId: "solution_manager",
        title: "Frustrated Client With Scope Changes",
        description: "A client is frustrated after repeated scope changes and wants accountability.",
        aiRole: "a frustrated client upset about delays",
        enabled: true
      }
    ]
  },
  {
    id: "project_manager",
    label: "Project Manager",
    summary: "People management conversations focused on team execution and alignment.",
    enabled: true,
    scenarios: [
      {
        id: "pm_unmotivated_member",
        segmentId: "project_manager",
        title: "Unmotivated Team Member",
        description: "A team member is unmotivated, disengaged, and missing deadlines.",
        aiRole: "an unmotivated project team member",
        enabled: true
      },
      {
        id: "pm_team_conflict",
        segmentId: "project_manager",
        title: "Conflict Between Team Members",
        description: "Two team members are in conflict and expect you to resolve it.",
        aiRole: "a project team member in conflict with a colleague",
        enabled: true
      }
    ]
  },
  {
    id: "sales_representative",
    label: "Sales Representative",
    summary: "Sales conversations that require objection handling and trust building.",
    enabled: true,
    scenarios: [
      {
        id: "sales_discount_pushback",
        segmentId: "sales_representative",
        title: "Discount Pushback",
        description: "A prospect is unhappy with the discount and keeps pushing for more.",
        aiRole: "a potential customer unhappy with your discount offer",
        enabled: true
      },
      {
        id: "sales_false_rumors",
        segmentId: "sales_representative",
        title: "False Rumors About Your Company",
        description: "A prospect heard damaging rumors and questions your credibility.",
        aiRole: "a skeptical customer influenced by false negative rumors",
        enabled: true
      }
    ]
  },
  {
    id: "sales_engineer",
    label: "Sales Engineer",
    summary: "Technical sales conversations that demand clear explanations and boundaries.",
    enabled: true,
    scenarios: [
      {
        id: "se_repeating_questions",
        segmentId: "sales_engineer",
        title: "Client Keeps Asking Same Questions and Doesn't Get it",
        description: "A client keeps asking the same technical questions and still seems unconvinced.",
        aiRole: "a client who repeatedly asks the same technical questions",
        enabled: true
      },
      {
        id: "se_unfixable_issue",
        segmentId: "sales_engineer",
        title: "Customer brings up issue that can't be fixed but for good reason",
        description: "A customer raises a limitation that cannot be changed due to valid constraints.",
        aiRole: "a customer frustrated by a product limitation that has to remain",
        enabled: true
      }
    ]
  },
  {
    id: "nurse",
    label: "Nurse",
    summary: "Medical conversations requiring de-escalation, clarity, and professional authority.",
    enabled: true,
    scenarios: [
      {
        id: "nurse_young_doctor",
        segmentId: "nurse",
        title: "New, Young Doctor Thinks They Know Better Than you",
        description: "A new doctor dismisses your experience and ignores your guidance.",
        aiRole: "a new doctor who dismisses your clinical judgment",
        enabled: true
      },
      {
        id: "nurse_vaccine_conspiracy",
        segmentId: "nurse",
        title: "Patient Is Angry About Vaccines And Spews Conspiracy Theories",
        description: "An angry patient challenges vaccine guidance with conspiracy claims.",
        aiRole: "an upset patient repeating vaccine conspiracy claims",
        enabled: true
      }
    ]
  },
  {
    id: "doctor",
    label: "Doctor",
    summary: "Medical leadership conversations involving difficult family and patient communication.",
    enabled: true,
    scenarios: [
      {
        id: "doctor_erratic_family_member",
        segmentId: "doctor",
        title: "Family Member Is Erratic And Afraid About Low Risk Procedure",
        description: "A family member becomes erratic and fearful about a low-risk procedure.",
        aiRole: "an anxious family member acting erratically before a low-risk procedure",
        enabled: true
      },
      {
        id: "doctor_unsuccessful_surgery",
        segmentId: "doctor",
        title: "Tell Somone A Surgery Was Unsuccessful",
        description: "You need to communicate that a surgery was unsuccessful with empathy and clarity.",
        aiRole: "a family member receiving difficult post-surgery news",
        enabled: true
      }
    ]
  }
];

export function createDefaultConfig(nowIso: string): AppConfig {
  return {
    activeSegmentId: "project_manager",
    defaultDifficulty: "medium",
    defaultPersonaStyle: "skeptical",
    industries: DEFAULT_INDUSTRIES,
    roleIndustries: DEFAULT_ROLE_INDUSTRIES,
    segments: DEFAULT_SEGMENTS,
    tiers: DEFAULT_TIER_DEFINITIONS,
    enterprise: {
      visibleInApp: true,
      contactEmail: "enterprise@example.com",
      contactUrl: "https://example.com/enterprise",
      defaultOrgDailySecondsQuota: 8 * 60 * 60,
      defaultPerUserDailySecondsCap: 60 * 60,
      allowManualBonusSeconds: true
    },
    featureFlags: {
      scoringEnabled: true,
      customScenarioBuilder: false
    },
    updatedAt: nowIso
  };
}

export function isTierId(value: string): value is TierId {
  return TIER_IDS.includes(value as TierId);
}

export function isAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPES.includes(value as AccountType);
}

export function isUserStatus(value: string): value is UserStatus {
  return USER_STATUSES.includes(value as UserStatus);
}

export function isIndustryId(value: string): value is IndustryId {
  return typeof value === "string" && value.trim().length > 0;
}

export function isOrgUserRole(value: string): value is OrgUserRole {
  return ORG_USER_ROLES.includes(value as OrgUserRole);
}

export function isOrgJoinRequestStatus(value: string): value is OrgJoinRequestStatus {
  return ORG_JOIN_REQUEST_STATUSES.includes(value as OrgJoinRequestStatus);
}

export function getRoleSegmentIdsForIndustries(
  industryIds: IndustryId[],
  roleIndustries?: RoleIndustryDefinition[]
): string[] {
  if (Array.isArray(roleIndustries) && roleIndustries.length > 0) {
    const allowedIndustries = new Set(industryIds);
    const ids = new Set<string>();
    for (const entry of roleIndustries) {
      if (!entry.active || !allowedIndustries.has(entry.industryId)) {
        continue;
      }
      if (entry.roleId.trim()) {
        ids.add(entry.roleId.trim());
      }
    }

    return Array.from(ids);
  }

  const ids = new Set<string>();
  for (const industryId of industryIds) {
    const roleSegmentIds = INDUSTRY_ROLE_SEGMENT_IDS[industryId] ?? [];
    for (const roleSegmentId of roleSegmentIds) {
      ids.add(roleSegmentId);
    }
  }

  return Array.from(ids);
}

export function getTierById(tiers: TierDefinition[], id: TierId): TierDefinition | undefined {
  return tiers.find((tier) => tier.id === id);
}

export function buildScenarioSummary(description: string, maxLength = 110): string {
  const normalized = description
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const trimmed = normalized.slice(0, Math.max(20, maxLength - 1)).trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  const clipped = lastSpace >= 20 ? trimmed.slice(0, lastSpace) : trimmed;
  return `${clipped}...`;
}

export function secondsToWholeMinutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

export function formatSecondsAsClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }

  return `${secs}s`;
}
