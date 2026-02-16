export declare const USAGE_BILLING_INCREMENT_SECONDS = 15;
export declare const TIER_IDS: readonly ["free", "pro", "pro_plus", "enterprise"];
export type TierId = (typeof TIER_IDS)[number];
export declare const ACCOUNT_TYPES: readonly ["individual", "enterprise"];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export declare const USER_STATUSES: readonly ["active", "disabled"];
export type UserStatus = (typeof USER_STATUSES)[number];
export declare const ORG_STATUSES: readonly ["active", "disabled"];
export type OrgStatus = (typeof ORG_STATUSES)[number];
export declare const ORG_USER_ROLES: readonly ["org_admin", "user_admin", "user"];
export type OrgUserRole = (typeof ORG_USER_ROLES)[number];
export declare const ORG_USER_ROLE_LABELS: Record<OrgUserRole, string>;
export declare const INDUSTRY_IDS: readonly ["people_management", "sales", "medical"];
export type IndustryId = (typeof INDUSTRY_IDS)[number];
export declare const INDUSTRY_LABELS: Record<IndustryId, string>;
export declare const INDUSTRY_ROLE_SEGMENT_IDS: Record<IndustryId, string[]>;
export type Difficulty = "easy" | "medium" | "hard";
export type PersonaStyle = "defensive" | "frustrated" | "skeptical";
export interface Scenario {
    id: string;
    segmentId: string;
    title: string;
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
    activeIndustries: IndustryId[];
    dailySecondsQuota: number;
    perUserDailySecondsCap: number;
    manualBonusSeconds: number;
    createdAt: string;
    updatedAt: string;
}
export interface UserProfile {
    id: string;
    email: string;
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
export type AiUsageEventKind = "opening" | "turn" | "score";
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
    transcriptMeta: {
        scenarioTitle: string | null;
        segmentLabel: string | null;
        difficulty: Difficulty | null;
        personaStyle: PersonaStyle | null;
        startedAt: string | null;
        endedAt: string | null;
        model: string | null;
        promptVersion: string | null;
        rubricVersion: string | null;
    } | null;
    createdAt: string;
    updatedAt: string;
}
export interface MobileAuthRecord {
    userId: string;
    tokenHash: string;
    createdAt: string;
    updatedAt: string;
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
}
export interface MobileUpdateSettingsRequest {
    email?: string;
    timezone?: string;
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
    supportCases: SupportCaseRecord[];
    mobileAuthTokens: MobileAuthRecord[];
    admin: {
        passwordHash: string | null;
    };
}
export declare const COMMON_TIMEZONES: string[];
export declare const DEFAULT_TIER_DEFINITIONS: TierDefinition[];
export declare const DEFAULT_SEGMENTS: SegmentDefinition[];
export declare function createDefaultConfig(nowIso: string): AppConfig;
export declare function isTierId(value: string): value is TierId;
export declare function isAccountType(value: string): value is AccountType;
export declare function isUserStatus(value: string): value is UserStatus;
export declare function isIndustryId(value: string): value is IndustryId;
export declare function isOrgUserRole(value: string): value is OrgUserRole;
export declare function getRoleSegmentIdsForIndustries(industryIds: IndustryId[]): string[];
export declare function getTierById(tiers: TierDefinition[], id: TierId): TierDefinition | undefined;
export declare function secondsToWholeMinutes(seconds: number): number;
export declare function formatSecondsAsClock(seconds: number): string;
