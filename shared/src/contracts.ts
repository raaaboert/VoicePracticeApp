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

export const DASHBOARD_ACCESS_TYPES = ["super_user", "customer_dashboard_user"] as const;
export type DashboardAccessType = (typeof DASHBOARD_ACCESS_TYPES)[number];

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
  aiBaseline?: string;
  standardScoringGuidance?: string;
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
  desiredOutcome?: string;
  aiRole: string;
  enabled?: boolean;
}

export const ORG_CUSTOM_SCENARIO_SOURCE_MODES = ["scratch", "standard_base"] as const;
export type OrgCustomScenarioSourceMode = (typeof ORG_CUSTOM_SCENARIO_SOURCE_MODES)[number];

export const ORG_CUSTOM_SCENARIO_CREATION_METHODS = ["manual", "ai"] as const;
export type OrgCustomScenarioCreationMethod = (typeof ORG_CUSTOM_SCENARIO_CREATION_METHODS)[number];

export interface OrgCustomScenarioGenerationInputs {
  companyName?: string;
  productOrService?: string;
  targetPersona?: string;
  keyObjections?: string[];
  tone?: string;
  difficulty?: string;
  mustInclude?: string;
  mustAvoid?: string;
  complianceConstraints?: string;
  specialInstructions?: string;
}

export interface OrgCustomScenarioProvenance {
  sourceMode: OrgCustomScenarioSourceMode;
  creationMethod: OrgCustomScenarioCreationMethod;
  baseScenarioId?: string | null;
  baseScenarioTitle?: string | null;
  baseScenarioSegmentId?: string | null;
  baseScenarioVersion?: string | null;
  customizationParams?: OrgCustomScenarioGenerationInputs | null;
  generatedPrompt?: string | null;
  modelUsed?: string | null;
  generatedAt?: string | null;
}

export interface OrgCustomScenario {
  id: string;
  orgId: string;
  segmentId: string;
  title: string;
  summary?: string;
  description: string;
  desiredOutcome?: string;
  aiRole: string;
  scoringGuidance: string;
  applicableIndustryIds: IndustryId[];
  enabled?: boolean;
  provenance: OrgCustomScenarioProvenance;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  // Mobile-scoped config responses may include active org-specific custom scenarios.
  orgCustomScenarios?: OrgCustomScenario[];
  // Mobile-scoped config responses may include active org trainings with attached custom scenarios.
  orgTrainings?: OrgTrainingSummary[];
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
  pendingPerUserDailySecondsCap: number | null;
  pendingPerUserDailySecondsCapEffectiveAt: string | null;
  manualBonusSeconds: number;
  contractSignedAt: string;
  monthlyMinutesAllotted: number;
  renewalTotalUsd: number;
  softLimitPercentTriggers: number[];
  maxSimulationMinutes: number;
  enableModularPromptArchitecture?: boolean;
  divisionsEnabled?: boolean;
  customScenarios?: OrgCustomScenario[];
  createdAt: string;
  updatedAt: string;
}

export const TRAINING_PACK_SCORING_KEYS = ["persuasion", "clarity", "empathy", "assertiveness"] as const;
export type TrainingPackScoringKey = (typeof TRAINING_PACK_SCORING_KEYS)[number];
export type TrainingPackScoringWeightOverrides = Record<string, number>;
export const ORG_TRAINING_STATUSES = ["draft", "active", "archived"] as const;
export type OrgTrainingStatus = (typeof ORG_TRAINING_STATUSES)[number];

export interface TrainingPack {
  id: string;
  organizationId: string;
  title: string;
  trainingTopic: string;
  learningObjectives: string[];
  successBehaviors: string[];
  failurePatterns: string[];
  requiredBehavioralTriggers: string[];
  scoringWeightOverrides: TrainingPackScoringWeightOverrides;
  complianceConstraints: string;
  audienceLevel: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  isPlatformAdmin?: boolean;
  isSuperUser?: boolean;
  // Explicit customer-side dashboard authorization. This is separate from mobile/app org role.
  dashboardAccessEnabled?: boolean;
  accountType: AccountType;
  tier: TierId;
  status: UserStatus;
  orgId: string | null;
  orgRole: OrgUserRole;
  divisionId?: string | null;
  timezone: string;
  pendingTimezone: string | null;
  pendingTimezoneEffectiveAt: string | null;
  planAnchorAt: string;
  manualBonusSeconds: number;
  dailySecondsCapOverride: number | null;
  allowDailyOverageThisCycle: boolean;
  dailyOverageExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgTrainingRecord {
  id: string;
  orgId: string;
  name: string;
  status: OrgTrainingStatus;
  description: string;
  divisionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgDivisionRecord {
  id: string;
  orgId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface OrgStandardScenarioDivisionAssignmentRecord {
  id: string;
  orgId: string;
  scenarioId: string;
  divisionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgTrainingPackAttachmentRecord {
  id: string;
  orgId: string;
  trainingId: string;
  trainingPackId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgTrainingScenarioAttachmentRecord {
  id: string;
  orgId: string;
  trainingId: string;
  scenarioId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgTrainingSummary extends OrgTrainingRecord {
  attachedTrainingPackIds: string[];
  attachedCustomScenarioIds: string[];
  attachedTrainingPackCount: number;
  attachedCustomScenarioCount: number;
}

export type TrainingPackAssignmentCompletionRule = "scored_required_scenarios_v1";
export type TrainingPackAssignmentProgressStatus = "not_started" | "in_progress" | "completed";

export interface TrainingPackAssignmentRecord {
  id: string;
  trainingPackId: string;
  orgId: string;
  userId: string;
  active: boolean;
  assignedAt: string;
  assignedByUserId: string | null;
  requiredScenarioIds: string[];
  completionRule: TrainingPackAssignmentCompletionRule;
  startedAt: string | null;
  completedAt: string | null;
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
  divisionId?: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
  billedSecondsAdded?: number;
  createdAt: string;
}

export type SimulationSessionStatus = "started" | "usage_recorded";

export interface SimulationSessionRecord {
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  divisionId?: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  clientStartedAt?: string | null;
  serverStartedAt: string;
  lastSeenAt: string;
  status: SimulationSessionStatus;
  usageRecordedAt?: string | null;
  usageSessionRecordId?: string | null;
}

export const SIMULATION_COMPLETION_LEVELS = ["inconclusive", "partial", "complete"] as const;
export type SimulationCompletionLevel = (typeof SIMULATION_COMPLETION_LEVELS)[number];

export interface SimulationScoreRecord {
  id: string;
  simulationSessionId?: string | null;
  userId: string;
  orgId: string | null;
  divisionId?: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  industryId?: string | null;
  startedAt: string;
  endedAt: string;
  communicationScore?: number;
  outcomeScore?: number;
  overallScore: number;
  completionLevel?: SimulationCompletionLevel;
  objectiveAchieved?: boolean;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  summary?: string;
  coachingArtifact?: SimulationScoreCoachingArtifact | null;
  normalizedCoachingThemes?: SimulationScoreNormalizedThemes | null;
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
  divisionId?: string | null;
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

export const AUDIT_ACTOR_TYPES = ["platform_admin", "mobile_user", "web_user", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

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

export const PERFORMANCE_PLAN_STATUSES = ["active", "completed", "cancelled"] as const;
export type PerformancePlanStatus = (typeof PERFORMANCE_PLAN_STATUSES)[number];

export const PERFORMANCE_ACTIVITY_METRIC_TYPES = [
  "weekly_practice_minutes",
  "total_practice_minutes",
  "weekly_session_count",
  "total_session_count"
] as const;
export type PerformanceActivityMetricType = (typeof PERFORMANCE_ACTIVITY_METRIC_TYPES)[number];

export const PERFORMANCE_GOAL_METRIC_TYPES = [
  "target_average_score",
  "improve_by_points",
  "improve_by_percent"
] as const;
export type PerformanceGoalMetricType = (typeof PERFORMANCE_GOAL_METRIC_TYPES)[number];

export const PERFORMANCE_SCOPE_SELECTION_SOURCES = ["direct", "focus_topic", "all_assigned"] as const;
export type PerformanceScopeSelectionSource = (typeof PERFORMANCE_SCOPE_SELECTION_SOURCES)[number];

export const PERFORMANCE_SCENARIO_SOURCES = ["standard", "custom", "unknown"] as const;
export type PerformanceScenarioSource = (typeof PERFORMANCE_SCENARIO_SOURCES)[number];

export const PERFORMANCE_INSIGHT_STATUSES = [
  "ahead_of_goal",
  "on_track",
  "needs_attention",
  "not_enough_data",
  "goal_met",
  "goal_ended"
] as const;
export type PerformanceInsightStatus = (typeof PERFORMANCE_INSIGHT_STATUSES)[number];

export interface PerformanceActivityGoal {
  enabled: boolean;
  metricType: PerformanceActivityMetricType | null;
  targetValue: number | null;
}

export interface PerformanceGoal {
  enabled: boolean;
  metricType: PerformanceGoalMetricType | null;
  targetScore: number | null;
  improvementAmount: number | null;
  comparisonMonthCount: 1 | 2 | 3 | 6 | null;
}

export interface PerformanceFocusTopicSnapshot {
  id: string;
  name: string;
}

export interface PerformanceScenarioScopeSnapshot {
  scenarioId: string;
  displayName: string;
  source: PerformanceScenarioSource;
  segmentId: string | null;
  segmentLabel: string | null;
  focusTopics: PerformanceFocusTopicSnapshot[];
  selectionSources: PerformanceScopeSelectionSource[];
  metadata?: Record<string, unknown>;
}

export interface PerformancePlanScope {
  allAssignedScenarios: boolean;
  selectedFocusTopicIds: string[];
  selectedScenarioIds: string[];
  scenarios: PerformanceScenarioScopeSnapshot[];
}

export interface PerformanceBaseline {
  baselineStartAt: string;
  baselineEndAt: string;
  baselineAverage: number;
  baselineSessionCount: number;
  derivedTargetScore: number;
}

export interface PerformanceActivityProgress {
  enabled: boolean;
  metricType: PerformanceActivityMetricType | null;
  targetValue: number | null;
  actualValue: number;
  cumulativeTargetValue: number;
  succeeded: boolean;
  weeklyConsistency: {
    completedWeeks: number;
    totalWeeks: number;
  } | null;
}

export interface PerformanceScoreProgress {
  enabled: boolean;
  metricType: PerformanceGoalMetricType | null;
  targetScore: number | null;
  currentAverage: number | null;
  eligibleScoreCount: number;
  baselineAverage: number | null;
  scoreImprovement: number | null;
  currentlyMeetingTarget: boolean;
  notEnoughData: boolean;
  succeeded: boolean;
}

export interface PerformanceProgress {
  generatedAt: string;
  planId: string;
  windowStartAt: string;
  windowEndAt: string;
  activity: PerformanceActivityProgress;
  performance: PerformanceScoreProgress;
  overallCurrentlyMeetingTarget: boolean;
  overallSucceeded: boolean;
}

export interface PerformanceInsight {
  status: PerformanceInsightStatus;
  message: string;
  recommendedNextStep: string;
  metadata?: Record<string, unknown>;
}

export interface PerformanceFinalResult {
  finalizedAt: string;
  windowStartAt: string;
  windowEndAt: string;
  activitySucceeded: boolean;
  performanceSucceeded: boolean;
  overallSucceeded: boolean;
  performanceInsufficientEvidence: boolean;
  finalAverageScore: number | null;
  scoreImprovement: number | null;
  totalPracticeSeconds: number;
  sessionsCompleted: number;
  weeklyConsistency: {
    completedWeeks: number;
    totalWeeks: number;
  } | null;
  scope: PerformancePlanScope;
}

export interface PerformancePlan {
  id: string;
  orgId: string;
  userId: string;
  createdByActorType: AuditActorType;
  createdByActorId: string | null;
  createdAt: string;
  submittedAt: string;
  effectiveAt: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  status: PerformancePlanStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledByActorType: AuditActorType | null;
  cancelledByActorId: string | null;
  cancellationReason: string | null;
  activityGoal: PerformanceActivityGoal;
  performanceGoal: PerformanceGoal;
  scope: PerformancePlanScope;
  baseline: PerformanceBaseline | null;
  finalResult: PerformanceFinalResult | null;
  updatedAt: string;
}

export interface PerformancePlanScopeItem {
  id: string;
  planId: string;
  orgId: string;
  userId: string;
  scenarioId: string;
  scenarioDisplayName: string;
  scenarioSource: PerformanceScenarioSource;
  segmentId: string | null;
  segmentLabel: string | null;
  focusTopicId: string | null;
  focusTopicName: string | null;
  selectionSources: PerformanceScopeSelectionSource[];
  metadataSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface PerformanceAuditEvent {
  id: string;
  planId: string;
  orgId: string;
  userId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  changedFields: string[];
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface PerformanceAuditDisplayEvent {
  id: string;
  action: string;
  actionLabel: string;
  actorLabel: string;
  actorRoleLabel: string;
  actorEmail: string | null;
  occurredAt: string;
  reason: string | null;
}

export interface PerformanceScopeSelectionRequest {
  allAssignedScenarios: boolean;
  selectedFocusTopicIds: string[];
  selectedScenarioIds: string[];
}

export interface PerformanceAssignableFocusTopic {
  id: string;
  name: string;
  scenarioCount: number;
}

export interface PerformanceAssignableScenario {
  scenarioId: string;
  displayName: string;
  source: PerformanceScenarioSource;
  segmentId: string | null;
  segmentLabel: string | null;
  focusTopics: PerformanceFocusTopicSnapshot[];
}

export interface PerformancePlanInput {
  userId: string;
  orgId?: string | null;
  startDate: string;
  endDate: string;
  timeZone: string;
  activityGoal: PerformanceActivityGoal;
  performanceGoal: PerformanceGoal;
  scopeSelection: PerformanceScopeSelectionRequest;
}

export interface PerformancePlanPreviewRequest extends PerformancePlanInput {}

export interface PerformancePlanPreviewResponse {
  generatedAt: string;
  valid: boolean;
  errors: string[];
  scope: PerformancePlanScope | null;
  baseline: PerformanceBaseline | null;
  baselinePreview: {
    baselineStartAt: string | null;
    baselineEndAt: string | null;
    eligibleScoreCount: number;
    baselineAverage: number | null;
    derivedTargetScore: number | null;
    insufficientData: boolean;
  } | null;
  availableFocusTopics: PerformanceAssignableFocusTopic[];
  availableScenarios: PerformanceAssignableScenario[];
}

export interface CreatePerformancePlanRequest extends PerformancePlanInput {}

export interface CreatePerformancePlanResponse {
  created: boolean;
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
}

export interface UpdatePerformancePlanRequest extends PerformancePlanInput {}

export interface UpdatePerformancePlanResponse {
  updated: boolean;
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
}

export interface CancelPerformancePlanRequest {
  reason?: string | null;
}

export interface CancelPerformancePlanResponse {
  plan: PerformancePlan | null;
  cancelled: boolean;
  finalizedInstead: boolean;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
}

export type MobilePerformanceCurrentDisplayState =
  | {
      state: "no_active_plans";
      activePlanCount: 0;
      activeNeedsAttentionCount: 0;
      activeCollectingEvidenceCount: 0;
    }
  | {
      state: "active_plans_collecting_evidence" | "active_plans_on_track" | "active_plans_need_attention";
      activePlanCount: number;
      activeNeedsAttentionCount: number;
      activeCollectingEvidenceCount: number;
    };

export interface MobilePerformanceCurrentResponse {
  generatedAt: string;
  activePlans: PerformancePlanSummary[];
  displayState: MobilePerformanceCurrentDisplayState;
}

export interface MobilePerformancePlanOptionsResponse {
  generatedAt: string;
  defaultTimeZone: string;
  availableFocusTopics: PerformanceAssignableFocusTopic[];
  availableScenarios: PerformanceAssignableScenario[];
}

export interface PerformancePlanSummary {
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
}

export interface MobilePerformancePlanHistoryResponse {
  generatedAt: string;
  plans: PerformancePlanSummary[];
}

export interface MobilePerformancePlanDetailResponse {
  generatedAt: string;
  plan: PerformancePlan;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
  auditEvents: PerformanceAuditDisplayEvent[];
}

export interface DashboardPerformanceUserOption {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  timeZone: string;
  divisionId: string | null;
  divisionName: string | null;
  status: UserStatus;
  orgRole: OrgUserRole;
  activePlanCount: number;
  canManagePerformancePlans: boolean;
  assignableFocusTopics: PerformanceAssignableFocusTopic[];
  assignableScenarios: PerformanceAssignableScenario[];
}

export interface DashboardPerformancePlanRow {
  plan: PerformancePlan;
  userEmail: string;
  orgName: string;
  divisionId: string | null;
  divisionName: string | null;
  progress: PerformanceProgress | null;
  insights: PerformanceInsight[];
  canCancel: boolean;
  canEdit: boolean;
}

export interface DashboardPerformanceSummary {
  visibleUserCount: number;
  activePlanCount: number;
  completedPlanCount: number;
  cancelledPlanCount: number;
  activeOnTrackCount: number;
  activeNeedsAttentionCount: number;
}

export interface DashboardPerformanceWorkspaceResponse {
  viewer: DashboardViewer;
  generatedAt: string;
  scopeMode: "portfolio" | "organization";
  selectedOrg: { orgId: string; orgName: string } | null;
  organizationSummaries: Array<{
    orgId: string;
    orgName: string;
    activePlanCount: number;
    activeNeedsAttentionCount: number;
    visibleUserCount: number;
  }>;
  defaultTimeZone: string;
  summary: DashboardPerformanceSummary;
  users: DashboardPerformanceUserOption[];
  plans: DashboardPerformancePlanRow[];
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardPerformancePlanDetailResponse {
  viewer: DashboardViewer;
  generatedAt: string;
  plan: DashboardPerformancePlanRow;
  auditEvents: PerformanceAuditDisplayEvent[];
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

export type WebAuthChallengeType = "sign_in" | "email_verification";

export interface WebAuthChallengeRecord {
  id: string;
  userId: string;
  email: string;
  challengeType: WebAuthChallengeType;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface WebAuthSessionRecord {
  sessionId: string;
  userId: string;
  accessType: DashboardAccessType | null;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  createdUserAgent: string | null;
  lastSeenUserAgent: string | null;
  createdIp: string | null;
  lastSeenIp: string | null;
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
  orgBillingPeriodStartAt?: string | null;
  orgBillingPeriodEndAt?: string | null;
  orgUsedSecondsThisPeriod?: number | null;
  orgAllottedSecondsThisPeriod?: number | null;
  orgRemainingSecondsThisPeriod?: number | null;
  orgUsagePercentThisPeriod?: number | null;
  userDailyCapSeconds?: number | null;
  userDailyOverageAllowed?: boolean;
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
    orgMonthlySecondsAllotted: number | null;
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

export interface DashboardViewer {
  accessType: DashboardAccessType;
  userId: string;
  email: string;
  isSuperUser: boolean;
  orgId: string | null;
  orgName: string | null;
}

export interface DashboardDivisionScopeOption {
  id: string;
  name: string;
  active: boolean;
  deletedAt?: string | null;
}

export interface DashboardDivisionScope {
  appliedDivisionId: string | null;
  divisions: DashboardDivisionScopeOption[];
}

export const WEB_AUTH_DELIVERY_MODES = ["log_only", "email"] as const;
export type WebAuthDeliveryMode = (typeof WEB_AUTH_DELIVERY_MODES)[number];

export interface WebAuthRequestCodeRequest {
  email: string;
}

export interface WebAuthRequestCodeResponse {
  ok: true;
  message: string;
}

export interface WebAuthVerifyCodeRequest {
  email: string;
  code: string;
}

export interface WebAuthSessionUser {
  userId: string;
  email: string;
  emailVerifiedAt: string | null;
  isPlatformAdmin: boolean;
  isSuperUser: boolean;
  dashboardAccessEnabled: boolean;
  accountType: AccountType;
  orgId: string | null;
}

export interface WebAuthSessionResponse {
  session: WebAuthSessionUser;
  dashboardViewer: DashboardViewer | null;
}

export interface WebAuthVerifyCodeResponse extends WebAuthSessionResponse {
  token: string;
  expiresAt: string;
}

export interface DashboardCustomerSummary {
  orgId: string;
  orgName: string;
  orgStatus: OrgStatus;
  contactName: string;
  contactEmail: string;
  industryLabels: string[];
  createdAt: string;
  nextRenewalAt: string;
  monthlyMinutesAllotted: number;
  activeUserCount: number;
  totalUserCount: number;
  dashboardUserCount: number;
  simulationsLast30Days: number;
  usedMinutesThisPeriod: number;
  averageScoreThisPeriod: number | null;
  scoreDeltaLast30Days: number | null;
  trainingPackCount: number;
  activeTrainingPackCount: number;
  customScenarioCount: number;
  latestActivityAt: string | null;
  customerUserEmails: string[];
}

export interface DashboardCustomerListResponse {
  viewer: DashboardViewer;
  customers: DashboardCustomerSummary[];
}

export interface DashboardCustomerTrendPoint {
  label: string;
  periodStartAt: string;
  periodEndAt: string;
  usageMinutes: number;
  simulations: number;
  averageScore: number | null;
}

export interface DashboardCustomerTrainingPackSummary {
  trainingPackId: string;
  title: string;
  trainingTopic: string;
  audienceLevel: string;
  active: boolean;
  objectiveCount: number;
  selectedScenarioCount: number | null;
  scenarioSelectionMode: "all" | "selected" | "none";
  scenarioSelectionLabel: string;
  requiredBehaviorCount: number;
  completionSupported: boolean;
  requiredScenarioCount: number;
  assignedLearnerCount: number;
  startedLearnerCount: number;
  completedLearnerCount: number;
  inProgressLearnerCount: number;
  notStartedLearnerCount: number;
  attemptsLast30Days: number;
  scoredAttemptsLast30Days: number;
  learnerCountLast30Days: number;
  averageScoreLast30Days: number | null;
  scoreDeltaLast30Days: number | null;
  latestActivityAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface DashboardCustomerUserPerformanceSummary {
  userId: string;
  email: string;
  status: UserStatus;
  orgRole: OrgUserRole;
  dashboardAccessEnabled: boolean;
  simulationsLast30Days: number;
  usedMinutesLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
  lastScenarioTitle: string | null;
}

export interface DashboardCustomerScenarioSummary {
  scenarioId: string;
  title: string;
  summary: string | null;
  segmentId: string;
  segmentLabel: string;
  source: "standard" | "custom";
  attemptsLast30Days: number;
  learnerCountLast30Days: number;
  averageScoreLast30Days: number | null;
  scoreDeltaLast30Days: number | null;
  latestActivityAt: string | null;
  topUserEmail: string | null;
  topUserAverageScore: number | null;
}

export interface DashboardTrainingAttributionSummary {
  mode: "forward_only";
  attributedUsageSessionsLast30Days: number;
  unattributedUsageSessionsLast30Days: number;
  attributedScoresLast30Days: number;
  unattributedScoresLast30Days: number;
}

export interface DashboardCoachingThemeSummary {
  themeId: string;
  theme: string;
  countLast30Days: number;
  countPrior30Days: number;
  deltaCount: number | null;
}

export interface DashboardUnmappedCoachingPhraseSummary {
  phrase: string;
  countLast30Days: number;
  countPrior30Days: number;
  deltaCount: number | null;
}

export interface DashboardCoachingNormalizationCategoryDiagnostics {
  totalPhrasesLast30Days: number;
  mappedPhrasesLast30Days: number;
  unmappedPhrasesLast30Days: number;
  mappingCoveragePercentLast30Days: number | null;
  topUnmappedPhrases: DashboardUnmappedCoachingPhraseSummary[];
}

export interface DashboardCoachingNormalizationDiagnostics {
  mode: "platform_admin_internal";
  canonicalThemeCount: number;
  strengths: DashboardCoachingNormalizationCategoryDiagnostics;
  improvementAreas: DashboardCoachingNormalizationCategoryDiagnostics;
  coachingPriorities: DashboardCoachingNormalizationCategoryDiagnostics;
}

export interface DashboardCoachingInsights {
  mode: "artifact_only";
  totalScoredAttemptsLast30Days: number;
  artifactBackedScoresLast30Days: number;
  artifactCoveragePercentLast30Days: number | null;
  normalizedThemeScoresLast30Days: number;
  normalizedThemeCoveragePercentLast30Days: number | null;
  topImprovementAreas: DashboardCoachingThemeSummary[];
  topStrengths: DashboardCoachingThemeSummary[];
  topCoachingPriorities: DashboardCoachingThemeSummary[];
  repeatedFocusArea: string | null;
  normalizationDiagnostics?: DashboardCoachingNormalizationDiagnostics | null;
}

export interface DashboardCustomerInsights {
  usage: {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
    usedMinutesThisPeriod: number;
    allottedMinutesThisPeriod: number;
    usagePercentThisPeriod: number;
  };
  trend: DashboardCustomerTrendPoint[];
  trainingPacks: DashboardCustomerTrainingPackSummary[];
  users: DashboardCustomerUserPerformanceSummary[];
  scenarios: DashboardCustomerScenarioSummary[];
  trainingPackAttribution: DashboardTrainingAttributionSummary;
  coachingInsights: DashboardCoachingInsights;
}

export interface DashboardCustomerDetailResponse {
  viewer: DashboardViewer;
  customer: DashboardCustomerSummary;
  insights: DashboardCustomerInsights;
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardPortfolioScenarioSummary extends DashboardCustomerScenarioSummary {
  orgId: string;
  orgName: string;
}

export interface DashboardOverviewResponse {
  viewer: DashboardViewer;
  summary: {
    activeCustomers: number;
    activeUsers: number;
    dashboardUsers: number;
    monthlyUsageMinutes: number;
    simulationsLast30Days: number;
    averageScoreThisPeriod: number | null;
    activeTrainingPackCount: number;
    customScenarioCount: number;
  };
  customers: DashboardCustomerSummary[];
  topScenarios: DashboardPortfolioScenarioSummary[];
  trainingPackAttribution: DashboardTrainingAttributionSummary;
  coachingInsights: DashboardCoachingInsights;
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardTrainingPackReportSummary extends DashboardCustomerTrainingPackSummary {
  orgId: string;
  orgName: string;
}

export interface DashboardTrainingPackScenarioProgressRow {
  scenarioId: string;
  title: string;
  segmentId: string;
  segmentLabel: string;
  source: "standard" | "custom";
  assignedLearnerCount: number;
  startedLearnerCount: number;
  completedLearnerCount: number;
  attemptsLast30Days: number;
  scoredAttemptsLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
}

export interface DashboardTrainingPackAssignmentProgressRow {
  assignmentId: string;
  userId: string;
  email: string;
  userStatus: UserStatus;
  status: TrainingPackAssignmentProgressStatus;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  requiredScenarioCount: number;
  completedScenarioCount: number;
  attemptsLast30Days: number;
  scoredAttemptsLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
  latestScenarioTitle: string | null;
}

export interface DashboardTrainingPackTrendPoint {
  label: string;
  periodStartAt: string;
  periodEndAt: string;
  attempts: number;
  averageScore: number | null;
}

export type DashboardAttemptActivityKind = "scored_attempt" | "usage_only";
export type DashboardAssignmentContextStatus =
  | "not_assignment_scoped"
  | "counts_toward_completion"
  | "within_assignment_window"
  | "outside_assignment_window";

export interface DashboardAttemptHistoryRow {
  activityId: string;
  activityKind: DashboardAttemptActivityKind;
  userId: string;
  userEmail: string;
  userStatus: UserStatus;
  orgId: string | null;
  orgName: string | null;
  scenarioId: string;
  scenarioTitle: string | null;
  segmentId: string;
  segmentLabel: string | null;
  trainingPackId: string | null;
  trainingPackTitle: string | null;
  packAttributed: boolean;
  assignmentId: string | null;
  assignmentContextStatus: DashboardAssignmentContextStatus;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number | null;
  overallScore: number | null;
  summary: string | null;
  coachingPriority: string | null;
  model: string | null;
  promptVersion: string | null;
  rubricVersion: string | null;
}

export interface DashboardTrainingReportResponse {
  viewer: DashboardViewer;
  summary: {
    visibleTrainingPackCount: number;
    activeTrainingPackCount: number;
    assignmentCount: number;
    startedAssignmentCount: number;
    completedAssignmentCount: number;
    inProgressAssignmentCount: number;
    notStartedAssignmentCount: number;
    engagedLearnerCountLast30Days: number;
    attributedAttemptsLast30Days: number;
    attributedScoresLast30Days: number;
    averageScoreLast30Days: number | null;
  };
  trainingPacks: DashboardTrainingPackReportSummary[];
  trainingPackAttribution: DashboardTrainingAttributionSummary;
}

export interface DashboardTrainingWorkspaceInsightMetric {
  label: string;
  averageScoreLast30Days: number | null;
}

export interface DashboardTrainingWorkspaceScenarioInsight {
  scenarioId: string;
  title: string;
  attemptsLast30Days?: number;
  averageScoreLast30Days?: number | null;
}

export interface DashboardTrainingWorkspaceUserRow {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  status: UserStatus;
  orgRole: OrgUserRole;
  attemptsLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
  latestScenarioTitle: string | null;
}

export interface DashboardTrainingWorkspaceScenarioRow {
  scenarioId: string;
  title: string;
  segmentId: string;
  segmentLabel: string;
  source: "standard" | "custom" | "unknown";
  attemptsLast30Days: number;
  averageScoreLast30Days: number | null;
  latestActivityAt: string | null;
}

export interface DashboardTrainingWorkspaceRow extends OrgTrainingSummary {
  orgName: string;
  summary: {
    totalAttemptsLast30Days: number;
    averageScoreLast30Days: number | null;
    activeLearnerCountLast30Days: number;
    totalScenarioCount: number;
    latestActivityAt: string | null;
  };
  insights: {
    strongestArea: DashboardTrainingWorkspaceInsightMetric | null;
    weakestArea: DashboardTrainingWorkspaceInsightMetric | null;
    mostUsedScenario: DashboardTrainingWorkspaceScenarioInsight | null;
    lowestPerformingScenario: DashboardTrainingWorkspaceScenarioInsight | null;
  };
  users: DashboardTrainingWorkspaceUserRow[];
  scenarios: DashboardTrainingWorkspaceScenarioRow[];
}

export interface DashboardTrainingWorkspaceResponse {
  viewer: DashboardViewer;
  generatedAt: string;
  trainings: DashboardTrainingWorkspaceRow[];
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardTrainingPackDetailResponse {
  viewer: DashboardViewer;
  pack: DashboardTrainingPackReportSummary & {
    trainingPackAttribution: DashboardTrainingAttributionSummary;
    coachingInsights: DashboardCoachingInsights;
    scenarios: DashboardTrainingPackScenarioProgressRow[];
    assignments: DashboardTrainingPackAssignmentProgressRow[];
    trend: DashboardTrainingPackTrendPoint[];
  };
}

export interface DashboardTrainingPackAssignmentRequiredScenarioRow {
  scenarioId: string;
  title: string | null;
  segmentId: string;
  segmentLabel: string | null;
  source: "standard" | "custom" | "unknown";
}

export interface DashboardTrainingPackAssignmentDetailResponse {
  viewer: DashboardViewer;
  pack: DashboardTrainingPackReportSummary;
  assignment: DashboardTrainingPackAssignmentProgressRow & {
    completionRule: TrainingPackAssignmentCompletionRule;
    requiredScenarios: DashboardTrainingPackAssignmentRequiredScenarioRow[];
  };
  attempts: DashboardAttemptHistoryRow[];
}

export interface DashboardUserReportRow {
  userId: string;
  email: string;
  orgId: string | null;
  orgName: string | null;
  status: UserStatus;
  orgRole: OrgUserRole;
  dashboardAccessEnabled: boolean;
  simulationsLast30Days: number;
  usedMinutesLast30Days: number;
  scoredAttemptsLast30Days: number;
  averageScoreLast30Days: number | null;
  scoreDeltaLast30Days: number | null;
  uniqueScenariosLast30Days: number;
  trainingPackAttemptsLast30Days: number;
  latestActivityAt: string | null;
  latestScenarioTitle: string | null;
  latestTrainingPackTitle: string | null;
}

export interface DashboardUserReportResponse {
  viewer: DashboardViewer;
  summary: {
    userCount: number;
    activeUserCount: number;
    dashboardUserCount: number;
    simulationsLast30Days: number;
    averageScoreLast30Days: number | null;
  };
  users: DashboardUserReportRow[];
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardUserAssignmentSummaryRow {
  assignmentId: string;
  trainingPackId: string;
  trainingPackTitle: string;
  status: TrainingPackAssignmentProgressStatus;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  requiredScenarioCount: number;
  completedScenarioCount: number;
}

export interface DashboardUserDetailResponse {
  viewer: DashboardViewer;
  user: DashboardUserReportRow;
  coachingInsights: DashboardCoachingInsights;
  assignments: DashboardUserAssignmentSummaryRow[];
  attempts: DashboardAttemptHistoryRow[];
  divisionScope?: DashboardDivisionScope;
}

export interface DashboardAttemptDetailResponse {
  viewer: DashboardViewer;
  attempt: DashboardAttemptHistoryRow & {
    industryId: string | null;
    industryLabel: string | null;
    scoreBreakdown: {
      communicationScore: number | null;
      outcomeScore: number | null;
      overallScore: number;
      completionLevel: SimulationCompletionLevel | null;
      objectiveAchieved: boolean | null;
      persuasion: number;
      clarity: number;
      empathy: number;
      assertiveness: number;
    } | null;
    derivedSignals: {
      strongestCategory: string | null;
      weakestCategory: string | null;
      coachingFocus: string | null;
    };
    coachingArtifact: SimulationScoreCoachingArtifact | null;
    transcriptAvailable: false;
  };
}

export interface AdminTrainingPackAssignmentsResponse {
  generatedAt: string;
  orgId: string;
  trainingPackId: string;
  assignments: TrainingPackAssignmentRecord[];
  deactivatedInvalidAssignmentCount?: number;
}

export interface SetTrainingPackAssignmentsRequest {
  userIds: string[];
}

export interface OrgTrainingListResponse {
  generatedAt: string;
  orgId: string;
  trainings: OrgTrainingSummary[];
}

export interface OrgDivisionListResponse {
  generatedAt: string;
  org: {
    id: string;
    name: string;
    divisionsEnabled: boolean;
  };
  divisions: OrgDivisionRecord[];
}

export interface UpdateOrgDivisionSettingsRequest {
  divisionsEnabled: boolean;
}

export interface CreateOrgDivisionRequest {
  name: string;
}

export interface UpdateOrgDivisionRequest {
  name: string;
}

export interface OrgStandardScenarioDivisionRow {
  scenarioId: string;
  segmentId: string;
  segmentLabel: string;
  title: string;
  enabled: boolean;
  divisionId: string | null;
}

export interface OrgStandardScenarioDivisionListResponse {
  generatedAt: string;
  org: {
    id: string;
    name: string;
    divisionsEnabled: boolean;
  };
  rows: OrgStandardScenarioDivisionRow[];
}

export interface SetOrgStandardScenarioDivisionRequest {
  divisionId: string | null;
}

export interface CreateOrgTrainingRequest {
  name?: string;
  status?: OrgTrainingStatus;
  description?: string;
  divisionId?: string | null;
}

export interface UpdateOrgTrainingRequest {
  name?: string;
  status?: OrgTrainingStatus;
  description?: string;
  divisionId?: string | null;
}

export interface SetOrgTrainingPackAttachmentsRequest {
  trainingPackIds: string[];
}

export interface SetOrgTrainingScenarioAttachmentsRequest {
  scenarioIds: string[];
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
  isPlatformAdmin?: boolean;
  dashboardAccessEnabled?: boolean;
}

export interface SuperUserSummary {
  userId: string;
  email: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuperUserListResponse {
  generatedAt: string;
  rows: SuperUserSummary[];
}

export interface CreateSuperUserRequest {
  email: string;
}

export interface SuperUserOrgOption {
  orgId: string;
  orgName: string;
  orgStatus: OrgStatus;
}

export interface SuperUserOrgOptionsResponse {
  generatedAt: string;
  orgs: SuperUserOrgOption[];
}

export interface UpdateUserRequest {
  email?: string;
  tier?: TierId;
  status?: UserStatus;
  isPlatformAdmin?: boolean;
  dashboardAccessEnabled?: boolean;
  accountType?: AccountType;
  timezone?: string;
  orgId?: string | null;
  orgRole?: OrgUserRole;
  divisionId?: string | null;
  manualBonusSeconds?: number;
  dailySecondsCapOverride?: number | null;
  allowDailyOverageThisCycle?: boolean;
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

export interface GenerateOrgCustomScenarioRequest {
  sourceMode: OrgCustomScenarioSourceMode;
  creationMethod?: OrgCustomScenarioCreationMethod;
  baseScenarioId?: string | null;
  segmentId?: string;
  applicableIndustryIds?: IndustryId[];
  draft?: {
    title?: string;
    description?: string;
    desiredOutcome?: string;
    aiRole?: string;
    scoringGuidance?: string;
  };
  generationInputs?: OrgCustomScenarioGenerationInputs;
}

export interface GenerateOrgCustomScenarioResponse {
  generated: {
    title: string;
    description: string;
    desiredOutcome?: string;
    aiRole: string;
    scoringGuidance: string;
    summary: string;
  };
  source: {
    sourceMode: OrgCustomScenarioSourceMode;
    creationMethod: OrgCustomScenarioCreationMethod;
    baseScenarioId: string | null;
    baseScenarioTitle: string | null;
    baseScenarioSegmentId: string | null;
    baseScenarioVersion: string | null;
  };
  promptPreview: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface CreateOrgCustomScenarioRequest {
  title?: string;
  description?: string;
  desiredOutcome?: string;
  aiRole?: string;
  scoringGuidance?: string;
  segmentId?: string;
  applicableIndustryIds?: IndustryId[];
  enabled?: boolean;
  provenance?: Partial<OrgCustomScenarioProvenance>;
}

export interface UpdateOrgCustomScenarioRequest {
  title?: string;
  description?: string;
  desiredOutcome?: string;
  aiRole?: string;
  scoringGuidance?: string;
  segmentId?: string;
  applicableIndustryIds?: IndustryId[];
  enabled?: boolean;
  provenance?: Partial<OrgCustomScenarioProvenance> & {
    customizationParams?: OrgCustomScenarioGenerationInputs | null;
  };
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
  simulationSessionId: string;
  userId: string;
  segmentId: string;
  scenarioId: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
}

export interface StartSimulationSessionRequest {
  simulationSessionId: string;
  segmentId: string;
  scenarioId: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  clientStartedAt?: string | null;
}

export interface StartSimulationSessionResponse {
  recognized: boolean;
  simulationSessionId: string;
  status: SimulationSessionStatus | null;
  serverStartedAt: string | null;
}

export interface RecordSimulationScoreRequest {
  // Legacy manual scoring payload. The primary score path is the AI evaluation route; keep this
  // shape only for backward-compatible internal/debug tooling, not normal product scoring flows.
  userId: string;
  segmentId: string;
  scenarioId: string;
  simulationSessionId?: string | null;
  trainingId?: string | null;
  trainingPackId?: string | null;
  startedAt: string;
  endedAt: string;
  communicationScore?: number;
  outcomeScore?: number;
  overallScore: number;
  completionLevel?: SimulationCompletionLevel;
  objectiveAchieved?: boolean;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  summary?: string;
  coachingArtifact?: SimulationScoreCoachingArtifactInput | null;
}

export interface SimulationScoreCoachingArtifact {
  strengths: string[];
  improvementAreas: string[];
  coachingPriority: string | null;
}

export interface SimulationScoreCoachingThemeTag {
  id: string;
  label: string;
}

export interface SimulationScoreNormalizedThemes {
  strengths: SimulationScoreCoachingThemeTag[];
  improvementAreas: SimulationScoreCoachingThemeTag[];
  coachingPriority: SimulationScoreCoachingThemeTag | null;
}

export interface SimulationScoreCoachingArtifactInput {
  strengths?: string[];
  improvementAreas?: string[];
  coachingPriority?: string | null;
}

export interface ApiDatabase {
  config: AppConfig;
  users: UserProfile[];
  orgs: EnterpriseOrg[];
  orgDivisions: OrgDivisionRecord[];
  orgTrainings: OrgTrainingRecord[];
  orgTrainingPackAttachments: OrgTrainingPackAttachmentRecord[];
  orgTrainingScenarioAttachments: OrgTrainingScenarioAttachmentRecord[];
  orgStandardScenarioDivisionAssignments: OrgStandardScenarioDivisionAssignmentRecord[];
  trainingPackAssignments: TrainingPackAssignmentRecord[];
  // Legacy compatibility field; extracted usage-session storage is authoritative.
  usageSessions: UsageSessionRecord[];
  // Legacy compatibility field; extracted score-record storage is authoritative.
  scoreRecords?: SimulationScoreRecord[];
  // Legacy compatibility field; extracted AI-usage storage is authoritative.
  aiUsageEvents?: AiUsageEvent[];
  // Legacy compatibility field; extracted audit-event storage is authoritative.
  auditEvents?: AuditEvent[];
  // Legacy compatibility field; extracted support-case storage is authoritative.
  supportCases?: SupportCaseRecord[];
  mobileAuthTokens: MobileAuthRecord[];
  emailVerifications: EmailVerificationRecord[];
  webAuthChallenges: WebAuthChallengeRecord[];
  // Legacy compatibility field; extracted web-auth session storage is authoritative.
  webAuthSessions?: WebAuthSessionRecord[];
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
  enabled: true,
  aiBaseline: "",
  standardScoringGuidance: ""
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
        desiredOutcome:
          "The direct report acknowledges the issue, aligns on expectations, and commits to changing the behavior.",
        aiRole: "a direct report who keeps undermining your decisions",
        enabled: true
      },
      {
        id: "sm_scope_creep_client",
        segmentId: "solution_manager",
        title: "Frustrated Client With Scope Changes",
        description: "A client is frustrated after repeated scope changes and wants accountability.",
        desiredOutcome:
          "The client feels heard, agrees on accountability, and accepts a concrete plan for next steps.",
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
        desiredOutcome:
          "The team member re-engages, accepts clear accountability, and commits to an immediate improvement plan.",
        aiRole: "an unmotivated project team member",
        enabled: true
      },
      {
        id: "pm_team_conflict",
        segmentId: "project_manager",
        title: "Conflict Between Team Members",
        description: "Two team members are in conflict and expect you to resolve it.",
        desiredOutcome:
          "The conflict is de-escalated and the teammate agrees to a specific path toward collaboration and follow-through.",
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
        desiredOutcome:
          "The prospect understands the value, reduces price resistance, and agrees to a concrete next step.",
        aiRole: "a potential customer unhappy with your discount offer",
        enabled: true
      },
      {
        id: "sales_false_rumors",
        segmentId: "sales_representative",
        title: "False Rumors About Your Company",
        description: "A prospect heard damaging rumors and questions your credibility.",
        desiredOutcome:
          "The prospect regains confidence in your credibility and agrees to continue the buying conversation.",
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
        desiredOutcome:
          "The client leaves with clarity on the technical issue and is ready to move forward without repeated confusion.",
        aiRole: "a client who repeatedly asks the same technical questions",
        enabled: true
      },
      {
        id: "se_unfixable_issue",
        segmentId: "sales_engineer",
        title: "Customer brings up issue that can't be fixed but for good reason",
        description: "A customer raises a limitation that cannot be changed due to valid constraints.",
        desiredOutcome:
          "The customer understands the constraint, sees the reasoning, and agrees on a practical path forward.",
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
        desiredOutcome:
          "The doctor recognizes your clinical concern and agrees to a respectful, safer course of action.",
        aiRole: "a new doctor who dismisses your clinical judgment",
        enabled: true
      },
      {
        id: "nurse_vaccine_conspiracy",
        segmentId: "nurse",
        title: "Patient Is Angry About Vaccines And Spews Conspiracy Theories",
        description: "An angry patient challenges vaccine guidance with conspiracy claims.",
        desiredOutcome:
          "The patient feels de-escalated, understands the guidance more clearly, and is open to the recommended next step.",
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
        desiredOutcome:
          "The family member becomes calmer, understands the procedure more clearly, and is ready to proceed appropriately.",
        aiRole: "an anxious family member acting erratically before a low-risk procedure",
        enabled: true
      },
      {
        id: "doctor_unsuccessful_surgery",
        segmentId: "doctor",
        title: "Tell Somone A Surgery Was Unsuccessful",
        description: "You need to communicate that a surgery was unsuccessful with empathy and clarity.",
        desiredOutcome:
          "The family member understands the outcome, feels respected, and can engage in the immediate next-step conversation.",
        aiRole: "a family member receiving difficult post-surgery news",
        enabled: true
      }
    ]
  }
];

export interface ScoringGuidanceIndustryContext {
  id: string;
  label: string;
  aiBaseline?: string;
  standardScoringGuidance?: string;
}

const DEFAULT_SCORING_INDUSTRY_ADD_ONS: Record<string, string[]> = {
  sales: [
    "Emphasize value articulation, objection conversion, and commitment ask quality.",
    "Reward clear business impact and next-step specificity."
  ],
  people_management: [
    "Emphasize coaching quality, accountability clarity, and conflict de-escalation.",
    "Reward balanced empathy, standards, and action-plan ownership."
  ],
  medical: [
    "Emphasize patient or family-centered communication, clarity under stress, and trust-building.",
    "Reward accurate risk framing and plain-language explanations without overpromising."
  ]
};

function uniqueIndustryContexts(
  value: ScoringGuidanceIndustryContext[] | null | undefined
): ScoringGuidanceIndustryContext[] {
  const seen = new Set<string>();
  const output: ScoringGuidanceIndustryContext[] = [];
  for (const item of value ?? []) {
    const id = (item.id ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push({
      id,
      label: (item.label ?? "").trim() || id,
      aiBaseline: typeof item.aiBaseline === "string" ? item.aiBaseline : "",
      standardScoringGuidance:
        typeof item.standardScoringGuidance === "string" ? item.standardScoringGuidance : ""
    });
  }
  return output;
}

export function buildDefaultScoringGuidance(params?: {
  scenarioTitle?: string | null;
  segmentLabel?: string | null;
  industryContexts?: ScoringGuidanceIndustryContext[] | null;
}): string {
  const scenarioTitle = typeof params?.scenarioTitle === "string" ? params.scenarioTitle.trim() : "";
  const segmentLabel = typeof params?.segmentLabel === "string" ? params.segmentLabel.trim() : "";
  const industries = uniqueIndustryContexts(params?.industryContexts);

  const lines: string[] = [
    "SCORING PARAMETERS v3 (Standard Default)",
    "",
    "Evaluator scope:",
    "- Evaluate USER performance only.",
    "- Use scenario context, persona style, and industry baseline guidance.",
    "- Reward behavior that moves this specific conversation forward.",
    ""
  ];

  if (scenarioTitle) {
    lines.push(`Scenario focus: ${scenarioTitle}`);
  }
  if (segmentLabel) {
    lines.push(`Target role focus: ${segmentLabel}`);
  }
  if (scenarioTitle || segmentLabel) {
    lines.push("");
  }

  lines.push(
    "Scoring categories (Title + Guiding Details):",
    "",
    "1) Outcome Progress and Next-Step Commitment (Weight 18)",
    "- Did the user move toward a concrete objective in this scenario?",
    "- Did they secure or clearly attempt a specific next step?",
    "- Higher score when progress is explicit, measurable, and time-bound.",
    "",
    "2) Discovery and Active Listening (Weight 12)",
    "- Did the user ask targeted questions and adapt to concerns?",
    "- Did they acknowledge and use what they heard?",
    "- Penalize scripted, non-responsive replies.",
    "",
    "3) Message Clarity and Structure (Weight 12)",
    "- Was communication concise, organized, and easy to follow?",
    "- Did the user avoid rambling and maintain a clear thread?",
    "- Reward strong framing, summarization, and transitions.",
    "",
    "4) Evidence, Reasoning, and Credibility (Weight 13)",
    "- Did the user support claims with relevant rationale, examples, or data?",
    "- Were claims believable and directly tied to objections?",
    "- Penalize unsupported assertions.",
    "",
    "5) Objection Handling and Problem Solving (Weight 13)",
    "- Did the user directly address resistance and constraints?",
    "- Did they reframe constructively and propose practical options?",
    "- Reward calm, specific, solution-oriented responses.",
    "",
    "6) Assertiveness and Conversation Control (Weight 12)",
    "- Did the user maintain direction without becoming aggressive?",
    "- Did they guide toward decisions and keep momentum?",
    "- Penalize passivity or loss of control.",
    "",
    "7) Empathy, Professionalism, and Rapport (Weight 10)",
    "- Did the user demonstrate understanding, respect, and emotional intelligence?",
    "- Was tone professional, composed, and relationship-preserving?",
    "- Penalize dismissive or tone-deaf communication.",
    "",
    "8) Industry Baseline Adherence (Weight 10)",
    "- Score how well the user's approach aligns with the active industry baseline guidance.",
    "- Reward baseline-consistent priorities, language, and constraints.",
    "- Penalize direct conflicts with baseline expectations.",
    "- If baseline guidance is missing, score neutral and note the limitation in summary.",
    "",
    "Scoring behavior rules:",
    "- Anchor judgments to observed transcript behavior.",
    "- Keep strengths and improvements specific and actionable.",
    "- Use stricter standards for hard difficulty than easy or medium.",
    "",
    "Output alignment rules:",
    "- Follow the exact JSON schema and field requirements defined elsewhere in the prompt.",
    "- Use these categories as evaluation lenses; they do not replace the required schema.",
    "- Let communication quality inform persuasion, clarity, empathy, assertiveness, and communicationScore.",
    "- Let outcome progress, desired-outcome attainment, and clear resolution evidence inform outcomeScore, completionLevel, objectiveAchieved, and the final overall judgment.",
    "- Do not fall back to legacy output-only instructions or invent alternate schema fields.",
    ""
  );

  if (industries.length > 0) {
    lines.push("Industry baseline references for selected industries:");
    for (const industry of industries) {
      const baseline = (industry.aiBaseline ?? "").trim();
      lines.push(
        baseline
          ? `- ${industry.label} (${industry.id}): ${baseline}`
          : `- ${industry.label} (${industry.id}): no baseline text configured.`
      );
    }
    lines.push("");
  }

  if (industries.some((industry) => (industry.standardScoringGuidance ?? "").trim().length > 0)) {
    lines.push("Industry-specific standard scoring focus:");
    for (const industry of industries) {
      const scoringFocus = (industry.standardScoringGuidance ?? "").trim();
      if (!scoringFocus) {
        continue;
      }
      lines.push(`- ${industry.label} (${industry.id}): ${scoringFocus}`);
    }
    lines.push("");
  }

  const addOnIds = industries.length > 0 ? industries.map((industry) => industry.id) : Object.keys(DEFAULT_SCORING_INDUSTRY_ADD_ONS);
  const addOns = Array.from(new Set(addOnIds))
    .map((industryId) => ({ industryId, rules: DEFAULT_SCORING_INDUSTRY_ADD_ONS[industryId] }))
    .filter((entry): entry is { industryId: string; rules: string[] } => Array.isArray(entry.rules));

  if (addOns.length > 0) {
    lines.push("Industry-specific add-ons:");
    for (const addOn of addOns) {
      lines.push(`${INDUSTRY_LABELS[addOn.industryId] ?? addOn.industryId.toUpperCase()} add-on:`);
      for (const rule of addOn.rules) {
        lines.push(`- ${rule}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

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
