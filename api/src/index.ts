import "express-async-errors";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { v4 as uuid } from "uuid";
import multer from "multer";
import {
  ACCOUNT_TYPES,
  AccountDeletionReceipt,
  AUDIT_ACTOR_TYPES,
  AuditActorType,
  AuditEvent,
  ApiDatabase,
  AiUsageEvent,
  AiUsageEventKind,
  AppConfig,
  DashboardAdminAccessRequestsResponse,
  DashboardAdminAccessRequestRow,
  DashboardAdminCapabilities,
  DashboardAdminDecideAccessRequest,
  DashboardAdminDecideAccessRequestResponse,
  DashboardAdminManagerOption,
  DashboardAdminUpdateUserRequest,
  DashboardAdminUpdateUserResponse,
  DashboardAdminUserRow,
  DashboardAdminUsersExportResponse,
  DashboardAdminUsersResponse,
  ArchiveDashboardTrainingContentCategoryRequest,
  CreateDashboardTrainingContentCategoryRequest,
  CreateDashboardTrainingContentRequest,
  DashboardTrainingContentLifecycleRequest,
  DashboardAttemptDetailResponse,
  DashboardAttemptHistoryRow,
  DashboardCoachingInsights,
  DashboardCustomerInsights,
  DashboardCustomerDetailResponse,
  DashboardCustomerListResponse,
  DashboardCustomerScenarioSummary,
  DashboardCustomerSummary,
  DashboardTrainingAttributionSummary,
  DashboardCustomerTrainingPackSummary,
  DashboardCustomerTrendPoint,
  DashboardCustomerUserPerformanceSummary,
  DashboardOverviewResponse,
  DashboardPerformancePlanDetailResponse,
  DashboardPerformanceWorkspaceResponse,
  DashboardPortfolioScenarioSummary,
  DashboardTrainingPackAssignmentProgressRow,
  DashboardTrainingPackAssignmentDetailResponse,
  DashboardTrainingPackAssignmentRequiredScenarioRow,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingPackScenarioProgressRow,
  DashboardTrainingPackTrendPoint,
  DashboardTrainingPackReportSummary,
  DashboardTrainingReportResponse,
  DashboardTrainingWorkspaceInsightMetric,
  DashboardTrainingWorkspaceResponse,
  DashboardTrainingWorkspaceRow,
  DashboardTrainingWorkspaceScenarioRow,
  DashboardTrainingWorkspaceUserRow,
  DashboardUnmappedCoachingPhraseSummary,
  DashboardUserAssignmentSummaryRow,
  DashboardUserDetailResponse,
  DashboardUserReportRow,
  DashboardUserReportResponse,
  DashboardViewer,
  INDUSTRY_LABELS,
  buildScenarioSummary,
  ChangeAdminPasswordRequest,
  COMMON_TIMEZONES,
  CreateUserRequest,
  CreateOrgCustomScenarioRequest,
  DEFAULT_INDUSTRIES,
  DEFAULT_ROLE_INDUSTRIES,
  DEFAULT_SEGMENTS,
  DEFAULT_TIER_DEFINITIONS,
  Difficulty,
  EnterpriseOrg,
  EnterpriseJoinRequestRecord,
  EmailVerificationRecord,
  GenerateOrgCustomScenarioRequest,
  GenerateOrgCustomScenarioResponse,
  INDUSTRY_IDS,
  IndustryDefinition,
  IndustryId,
  OrgCustomScenario,
  OrgCustomScenarioCreationMethod,
  OrgCustomScenarioGenerationInputs,
  OrgCustomScenarioSourceMode,
  OrgUserRole,
  PersonaStyle,
  MobileOnboardRequest,
  MobileOnboardResponse,
  MobilePerformancePlanOptionsResponse,
  MobilePerformancePlanDetailResponse,
  MobilePerformancePlanHistoryResponse,
  AdminTrainingPackAssignmentsResponse,
  CancelPerformancePlanRequest,
  CreateOrgDivisionRequest,
  CreateOrgTrainingRequest,
  CreatePerformancePlanRequest,
  CreatePerformancePlanUpdateRequest,
  OrgAccountsExportResponse,
  OrgAccountsExportRow,
  OrgDivisionListResponse,
  OrgDivisionRecord,
  OrgStandardScenarioDivisionAssignmentRecord,
  OrgStandardScenarioDivisionListResponse,
  OrgTrainingListResponse,
  OrgTrainingRecord,
  OrgTrainingSummary,
  OrgTrainingStatus,
  ORG_USER_ROLE_LABELS,
  OrgUsageBillingResponse,
  MobileResendVerificationRequest,
  MobileSubmitOrgJoinRequest,
  MobileUpdateSettingsRequest,
  MobileVerifyEmailRequest,
  PerformancePlan,
  PerformancePlanPreviewRequest,
  RecordUsageSessionRequest,
  StartSimulationSessionRequest,
  RecordSimulationScoreRequest,
  Scenario,
  SegmentDefinition,
  SetOrgStandardScenarioDivisionRequest,
  SetOrgTrainingPackAttachmentsRequest,
  SetOrgTrainingScenarioAttachmentsRequest,
  SetTrainingPackAssignmentsRequest,
  ReorderDashboardTrainingContentCategoriesRequest,
  ReorderDashboardTrainingContentRequest,
  SimulationScoreCoachingArtifact,
  SimulationScoreCoachingArtifactInput,
  CreateSuperUserRequest,
  SuperUserListResponse,
  SuperUserSummary,
  SuperUserOrgOptionsResponse,
  SupportCaseRecord,
  SimulationScoreRecord,
  TrainingPack,
  TrainingPackAssignmentRecord,
  TrainingPackAssignmentProgressStatus,
  TIER_IDS,
  TierDefinition,
  RoleIndustryDefinition,
  UpdateOrgDivisionRequest,
  UpdateOrgDivisionSettingsRequest,
  UpdateOrgTrainingRequest,
  UpdateOrgCustomScenarioRequest,
  UpdateDashboardTrainingContentAssignmentsRequest,
  UpdateDashboardTrainingContentCategoryRequest,
  UpdateDashboardTrainingContentRequest,
  UpdatePerformancePlanRequest,
  UpdateConfigRequest,
  UpdateUserRequest,
  UserEntitlementsResponse,
  UserProfile,
  UserStatus,
  USAGE_BILLING_INCREMENT_SECONDS,
  UsageSessionRecord,
  WebAuthChallengeType,
  WebAuthRequestCodeRequest,
  WebAuthDeliveryMode,
  WebAuthSessionResponse,
  WebAuthVerifyCodeRequest,
  WebAuthVerifyCodeResponse,
  calculateBilledSecondsFromRaw,
  createDefaultConfig,
  getRoleSegmentIdsForIndustries,
  getTierById,
  humanDailyResetLabel,
  isAccountType,
  isOrgUserRole,
  isOrgJoinRequestStatus,
  isTierId,
  isUserStatus,
  secondsToWholeMinutes,
  sumRawSeconds,
  computeMonthlyPeriodBounds,
  computeNextRenewalAt,
  buildDefaultScoringGuidance,
  splitTextForRemoteTtsFastStart
} from "@voicepractice/shared";
import {
  AI_PROMPT_VERSION,
  AI_RUBRIC_VERSION,
  buildEvaluationSystemPrompt,
  buildOpeningPrompt,
  buildRoleplaySystemPrompt,
  formatDialogueForEvaluation
} from "./aiPrompts.js";
import {
  OpenAiSpeechRequestError,
  OpenAiResponsesRequestError,
  requestCompletion,
  requestSpeechSynthesis,
  requestTranscription
} from "./openaiClient.js";
import {
  buildOpenAiRoutingStartupLogLines,
  resolveSimulationRequestConfig,
} from "./openaiModelConfig.js";
import type { OpenAiCompletionApiFamily, SimulationRoute } from "./openaiModelConfig.js";
import {
  buildTtsSpeechRequest,
  parseTtsPreset,
} from "./ttsPresetConfig.js";
import type { TtsPreset } from "./ttsPresetConfig.js";
import { decryptSupportTranscript, encryptSupportTranscript } from "./supportCrypto.js";
import {
  authorizeSupportCaseOrigin,
  decodeSupportCaseMessage,
  encodeSupportCaseMessage,
  normalizeSupportCaseOrigin,
} from "./supportCaseOrigin.js";
import { createDatabaseStorage, DatabaseStorage } from "./storage.js";
import { createAiUsageEventStore } from "./storage/aiUsageEventStore.js";
import { createAuditEventStore } from "./storage/auditEventStore.js";
import { createPerformancePlanStore } from "./storage/performancePlanStore.js";
import { createScoreRecordStore } from "./storage/scoreRecordStore.js";
import { createSimulationSessionStore } from "./storage/simulationSessionStore.js";
import { createSupportCaseStore } from "./storage/supportCaseStore.js";
import { createUsageSessionStore } from "./storage/usageSessionStore.js";
import { createUserEmployeeIdClaimStore } from "./storage/userEmployeeIdClaimStore.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";
import {
  ORG_ACCESS_REQUIRED_CODE,
  resolveMobilePaidAiOrganizationAccess,
} from "./services/mobileAiAccessPolicy.js";
import {
  calculateFiniteDailyOverageUsage,
  resolveEnterpriseDailyQuota,
  resolveEnterpriseQuotaLockReason,
  resolveFiniteDailyOverageGrantSnapshot,
  resolveStoredDailyOverageMode,
  resolveTemporaryDailyOverageExpiration,
  resolveTemporaryDailyOverageWindow,
  TemporaryDailyOverageMode,
} from "./services/temporaryDailyOverage.js";
import {
  hashEmailVerificationCode,
  normalizeEmailForExactMatch,
  timingSafeEqualText,
  verifyLatestEmailVerification,
} from "./services/emailVerification.js";
import { loadRuntimeConfig } from "./runtimeConfig.js";
import { createTrainingPackStore } from "./storage/trainingPackStore.js";
import {
  createOrgModuleEntitlementStore,
  OrgModuleEntitlementStore,
} from "./storage/orgModuleEntitlementStore.js";
import { createTrainingContentStore } from "./storage/trainingContentStore.js";
import { createTrainingContentScenarioLinkService } from "./services/trainingContentScenarioLinks.js";
import { createTrainingContentCategoryStore } from "./storage/trainingContentCategoryStore.js";
import {
  createTrainingContentAssetStore,
  TrainingContentAssetStore,
} from "./storage/trainingContentAssetStore.js";
import { createTrainingContentObjectStorage } from "./storage/trainingContentObjectStorage.js";
import { createTrainingContentBackupStorage } from "./storage/trainingContentBackupStorage.js";
import { buildOrgModuleEntitlementsResponse } from "./services/organizationModules.js";
import {
  createTrainingContentAssetService,
  mapTrainingContentAssetServiceError,
  TrainingContentAssetService,
  TrainingContentManagementRequestContext,
} from "./services/trainingContentAssetService.js";
import { TrainingContentStorageReadinessService } from "./services/trainingContentStorageReadiness.js";
import { createTrainingContentBackupService } from "./services/trainingContentBackup.js";
import {
  createTrainingContentManagementService,
  mapTrainingContentManagementServiceError,
  TrainingContentManagementService,
  TrainingContentReferenceData,
} from "./services/trainingContentManagementService.js";
import {
  createTrainingContentMobileService,
  mapTrainingContentMobileServiceError,
  MobileTrainingContentRequestContext,
  TrainingContentMobileService,
} from "./services/trainingContentMobileService.js";
import {
  buildEvaluationPromptWithOrchestrator,
  buildRoleplayPromptsWithOrchestrator
} from "./services/promptOrchestrator.js";
import {
  buildDashboardAdminCapabilities,
  canDashboardViewerAccessCustomerDirectory,
  canDashboardViewerAccessOrg,
  resolveDashboardAccessEligibility,
  resolveDashboardViewer
} from "./services/dashboardAuthorization.js";
import {
  filterRecordsByDivision,
  resolveDashboardDivisionFilter,
} from "./services/dashboardDivisionFiltering.js";
import {
  buildDashboardCoachingInsights,
  buildNormalizedSimulationScoreThemesFromArtifact,
} from "./services/coachingThemeNormalization.js";
import { AuthCodeDeliveryError, createAuthCodeDeliveryService } from "./services/authCodeDelivery.js";
import {
  initializeDatabaseStoresForReadiness,
  initializeDatabaseStoresForStartup
} from "./services/databaseStoreInitialization.js";
import { migrateUserProfileAppStateNormalization as migrateUserProfileAppStateNormalizationState } from "./services/userProfileAppStateMigration.js";
import {
  handleDashboardWebAuthCodeRequest,
} from "./services/dashboardWebAuthRequest.js";
import { DASHBOARD_TRUSTED_SESSION_MINUTES } from "./services/dashboardSessionPolicy.js";
import { hashScryptPassword, verifyScryptPassword } from "./services/passwordHash.js";
import { createAiUsageEventAccess, sumAiUsageEventTokens } from "./services/aiUsageEvents.js";
import {
  buildDashboardAttemptDetailAttempt as buildDashboardAttemptDetailAttemptPayload,
  buildDashboardAttemptHistoryRowFromScore as buildDashboardAttemptHistoryRowFromScorePayload,
  resolveDashboardAttemptActivityAssignmentStatus
} from "./services/dashboardAttemptDetails.js";
import { createPostCommitEffectRegistry, runPostCommitEffects } from "./services/postCommitEffects.js";
import type { PostCommitEffect } from "./services/postCommitEffects.js";
import {
  buildRecoveredSimulationEvaluationResult,
  isRecoverableSimulationScoreRecord,
} from "./services/mobileScoreRecovery.js";
import { createScoreRecordAccess } from "./services/scoreRecordAccess.js";
import { createSimulationHistoryAccess } from "./services/simulationHistory.js";
import { createUsageSessionAccess } from "./services/usageSessionAccess.js";
import {
  findEmployeeIdConflict,
  normalizeEmployeeIdInput,
} from "./services/employeeIds.js";
import {
  canActorManagePerformanceUser,
  canActorManageRegularUser,
  canActorSeeOrganizationUser,
  canEnterpriseActorManageRegularUser,
  canEnterpriseActorSeeOrganizationUser,
  canManagerAssignmentTargetBeManaged,
  canOrgAdminManageRole,
  clearAssignmentsForManager,
  getDashboardPermittedUserIds,
  getUserFirstName,
  getUserLastName,
  hasCompleteUserName,
  isEligibleManagerUser,
  listVisibleOrganizationUsers,
  normalizeManagerUserId,
  normalizeOptionalStoredUserName,
  normalizeRequiredUserNameInput,
  repairInvalidManagerAssignments,
  resolveStoredUserDisplayName,
  validateManagerAssignment,
} from "./services/userProfiles.js";
import {
  completeRecognizedSimulationUsage,
  normalizeSimulationSessionId,
  registerRecognizedSimulationSessionStart,
  SimulationSessionValidationError,
  touchRecognizedSimulationSession
} from "./services/simulationSessionLifecycle.js";
import { shouldBootstrapTrainingWorkspaceForSimulationRoute } from "./services/simulationHotPath.js";
import { createSimulationRuntimeCache, type SimulationRuntimeCacheStatus } from "./services/simulationRuntimeCache.js";
import {
  buildAdditiveEvaluationScoringGuidance,
  assertValidSimulationScorePayload,
  countUserTurnsForScoring,
  isConclusiveSimulationScoreRecord,
  MIN_USER_TURNS_FOR_SCORE,
  normalizeSimulationScorecard,
  SimulationScorePayloadValidationError,
  type SimulationScorecard
} from "./services/simulationScoring.js";
import {
  buildDashboardPerformancePlanDetailResponse,
  buildDashboardPerformanceWorkspaceResponse,
  buildMobilePerformanceCurrentResponse,
  buildMobilePerformancePlanOptionsResponse,
  buildMobilePerformancePlanHistoryResponse,
  buildPerformancePlanDetailResponse,
  buildPerformancePlanUpdatesResponse,
  cancelPerformancePlanWithBoundaryRule,
  createPerformancePlanFromInput,
  createPerformancePlanUpdateForPlan,
  PerformancePlanInputError,
  PerformancePlanUpdateConflictError,
  PerformancePlanUpdateInputError,
  previewPerformancePlan,
  resolvePerformanceUserDisplayName,
  updatePerformancePlanFromInput,
  type PerformancePlanUserContext
} from "./services/performanceApi.js";
import {
  finalizeOpenPerformancePlansForUserIfNeeded,
  finalizePerformancePlanIfEnded
} from "./services/performanceFinalization.js";
import type { PerformanceScopeCandidate } from "./services/performanceScope.js";
import {
  pruneStaleRecognizedSimulationSessions,
  repairOrphanedUserScopedHistory
} from "./services/integrityMaintenance.js";
import {
  deactivateInvalidTrainingPackAssignments,
  deactivateInvalidTrainingPackAssignmentsForUser,
  deactivateTrainingPackAssignmentsForUser,
  isTrainingPackAssignmentValidForUser,
  listTrainingPackAssignmentEligibleUsers,
} from "./services/trainingPackAssignments.js";
import { createWebAuthService, WebAuthTokenPayload } from "./services/webAuth.js";
import { normalizeDesiredOutcomeText } from "./services/scenarioTextNormalization.js";
import { getDefaultScoringWeights } from "./services/trainingPackRuntime.js";
import {
  buildOrgTrainingSummaries,
  ensureOrgTrainingCollections,
  findOrgTrainingRecord,
  listOrgTrainingRecords,
  normalizeOrgTrainingPackAttachments,
  normalizeOrgTrainingRecords,
  normalizeOrgTrainingScenarioAttachments,
  normalizeOrgTrainingStatus,
  replaceOrgTrainingPackAttachments,
  replaceOrgTrainingScenarioAttachments,
  seedLegacyOrgTraining,
} from "./services/orgTrainingWorkspace.js";
import {
  clearDivisionAssignmentsForDeletedDivision,
  ensureOrgDivisionCollections,
  findOrgStandardScenarioDivisionAssignmentRecord,
  findOrgDivisionRecord,
  isDivisionActive,
  isDivisionVisibleToUser,
  listOrgVisibleStandardScenarios,
  listOrgDivisions,
  normalizeOrgDivisionRecords,
  normalizeOrgStandardScenarioDivisionAssignments,
  resolveLiveDivisionAttribution,
  resolveStandardScenarioActiveDivisionId,
  resolveTrainingActiveDivisionId,
  resolveUserActiveDivisionId,
  sanitizeOrgDivisionName,
} from "./services/orgDivisions.js";
import {
  doesRecognizedSimulationSessionMatchContext,
  resolvePreferredSimulationDivisionId,
} from "./services/simulationDivisionAnchoring.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const runtimeConfig = loadRuntimeConfig();
console.log("[BOOT][ENV CHECK]", {
  NODE_ENV: process.env.NODE_ENV,
  USE_MODULAR_PROMPT_ARCHITECTURE: process.env.USE_MODULAR_PROMPT_ARCHITECTURE,
  ENABLE_INTERNAL_DEBUG_ENDPOINTS: process.env.ENABLE_INTERNAL_DEBUG_ENDPOINTS,
});

console.log("[BOOT][RUNTIME CONFIG FLAGS]", {
  useModularPromptArchitecture: runtimeConfig.useModularPromptArchitecture,
  enableInternalDebugEndpoints: runtimeConfig.enableInternalDebugEndpoints,
  enableRemoteTts: runtimeConfig.enableRemoteTts,
});
const PORT = runtimeConfig.port;
const STORAGE_PROVIDER = runtimeConfig.storageProvider;
const DB_PATH = runtimeConfig.dbPath;
const DATABASE_URL = runtimeConfig.databaseUrl;
const PG_POOL_MAX = runtimeConfig.pgPoolMax;
const PG_CONNECT_TIMEOUT_MS = runtimeConfig.pgConnectTimeoutMs;
const PG_IDLE_TIMEOUT_MS = runtimeConfig.pgIdleTimeoutMs;
const ADMIN_BOOTSTRAP_PASSWORD = runtimeConfig.adminBootstrapPassword;
const ADMIN_TOKEN_SECRET = runtimeConfig.adminTokenSecret;
const ADMIN_TOKEN_TTL_MINUTES = runtimeConfig.adminTokenTtlMinutes;
const WEB_AUTH_TOKEN_SECRET = runtimeConfig.webAuthTokenSecret;
const DASHBOARD_WEB_AUTH_SESSION_TTL_MINUTES = DASHBOARD_TRUSTED_SESSION_MINUTES;
const MOBILE_TOKEN_SECRET = runtimeConfig.mobileTokenSecret;
const APP_REVIEW_CREDENTIAL = runtimeConfig.appReviewCredential;
const OPENAI_MODEL_CONFIG = runtimeConfig.openAi;
const OPENAI_CHAT_MODEL = OPENAI_MODEL_CONFIG.chat.model;
const OPENAI_SIMULATION_MODEL = OPENAI_MODEL_CONFIG.simulation.model;
const OPENAI_SCORING_MODEL = OPENAI_MODEL_CONFIG.scoring.model;
const OPENAI_TRANSCRIPTION_MODEL = OPENAI_MODEL_CONFIG.transcription.model;
for (const line of buildOpenAiRoutingStartupLogLines(OPENAI_MODEL_CONFIG)) {
  // eslint-disable-next-line no-console
  console.log(line);
}
const ENABLE_REMOTE_TTS = runtimeConfig.enableRemoteTts;
const OPENAI_MAX_DAILY_CALLS_PER_USER = runtimeConfig.openAiMaxDailyCallsPerUser;
const OPENAI_MAX_DAILY_CALLS_GLOBAL = runtimeConfig.openAiMaxDailyCallsGlobal;
const OPENAI_MAX_DAILY_TOKENS_PER_USER = runtimeConfig.openAiMaxDailyTokensPerUser;
const OPENAI_MAX_DAILY_TOKENS_GLOBAL = runtimeConfig.openAiMaxDailyTokensGlobal;
const USE_MODULAR_PROMPT_ARCHITECTURE_ENV = runtimeConfig.useModularPromptArchitecture;
const ENABLE_INTERNAL_DEBUG_ENDPOINTS = runtimeConfig.enableInternalDebugEndpoints;
const INCLUDE_INTERNAL_DEBUG_DIAGNOSTICS = ENABLE_INTERNAL_DEBUG_ENDPOINTS && !runtimeConfig.isProduction;
const CORS_ALLOWED_ORIGINS = new Set(runtimeConfig.corsAllowedOrigins);
const ALLOW_ALL_BROWSER_ORIGINS = !runtimeConfig.isProduction && CORS_ALLOWED_ORIGINS.size === 0;
const SUPPORT_TRANSCRIPT_TTL_DAYS = 10;
const SUPPORT_MESSAGE_MAX_LENGTH = 5_000;
const EMAIL_VERIFICATION_TTL_MINUTES = 15;
const ORG_JOIN_REQUEST_TTL_DAYS = 7;
const ORG_JOIN_CODE_LENGTH = 8;
const CONTENT_DELETE_RETENTION_DAYS = 60;
const DEFAULT_MAX_SIMULATION_MINUTES = 20;
const MIN_MAX_SIMULATION_MINUTES = 1;
const MAX_MAX_SIMULATION_MINUTES = 240;
const MAX_ACTIVE_ADMIN_SESSIONS = 100;
const MAX_AUDIT_EVENTS = 20_000;
const PLATFORM_ADMIN_ACTOR_ID = "platform_admin";
const MAX_AI_INDUSTRY_BASELINE_PROMPT_CHARS = 30_000;
const MAX_ROLEPLAY_BEHAVIOR_GUIDANCE_PROMPT_CHARS = 4_000;
const OPENAI_TTS_MODEL = OPENAI_MODEL_CONFIG.speech.model;
const TTS_TEXT_MAX_CHARS = 4_000;
const SIMULATION_SPEECH_PREFETCH_PAYLOAD_WINDOW_MS = 1_500;
const SIMULATION_SPEECH_PREFETCH_TTS_TIMEOUT_MS = 12_000;
const MIN_SIMULATION_TRANSCRIPT_CHARS = 2;
const SIMULATION_MODEL_TIMEOUT_MS_BY_ROUTE: Record<SimulationRoute, number> = {
  opening: 30_000,
  turn: 30_000,
  score: 45_000,
};
const SIMULATION_TRANSCRIPTION_TIMEOUT_MS = 20_000;
const PROCESS_STARTED_AT = new Date().toISOString();
const BUILD_TIMESTAMP =
  process.env.BUILD_TIMESTAMP?.trim() ||
  process.env.RENDER_BUILD_TIMESTAMP?.trim() ||
  process.env.RENDER_DEPLOY_STARTED_AT?.trim() ||
  PROCESS_STARTED_AT;
const GIT_SHA =
  process.env.GIT_SHA?.trim() ||
  process.env.RENDER_GIT_COMMIT?.trim() ||
  process.env.COMMIT_SHA?.trim() ||
  "unknown";
const READINESS_REFRESH_MS = 15_000;
const READINESS_FAILURE_THRESHOLD = 3;
const WARNING_LOG_THROTTLE_MS = 60_000;
const TRAINING_PACK_SCENARIO_OPT_IN_PREFIX = "scenario:";
const SIMULATION_AI_BUDGET_GRACE_BUFFER_MINUTES = 5;
const SIMULATION_AI_BUDGET_GRACE_FALLBACK_MINUTES = DEFAULT_MAX_SIMULATION_MINUTES + SIMULATION_AI_BUDGET_GRACE_BUFFER_MINUTES;
const SIMULATION_AI_BUDGET_GRACE_MAX_MINUTES = MAX_MAX_SIMULATION_MINUTES + SIMULATION_AI_BUDGET_GRACE_BUFFER_MINUTES;
const SIMULATION_ORG_MONTHLY_OVERRUN_GRACE_MINUTES = 20;
const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "SELF_SIGNED_CERT_IN_CHAIN"
]);
const TRANSIENT_DATABASE_ERROR_PATTERNS = [
  "database is not ready",
  "connect etimedout",
  "request timed out",
  "connection terminated unexpectedly",
  "server closed the connection unexpectedly",
  "failed to connect",
  "could not connect to server",
  "self-signed certificate in certificate chain"
];

const warningLogByKey = new Map<string, number>();
const simulationAiBudgetGraceByUserId = new Map<string, number>();
const simulationOrgMonthlyOverrunGraceByUserId = new Map<string, number>();
const simulationRuntimeCache = createSimulationRuntimeCache();
const PLACEHOLDER_USER_TEXT_PATTERN = /^voice input captured/i;
const trainingPackStore = createTrainingPackStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
  logWarn: (message) => logWarnThrottled("training-pack:store", message, 5 * 60 * 1000)
});
let dashboardTrainingPackLoaderForTest: ((orgId: string) => Promise<TrainingPack[]>) | null = null;
let mobileAccountDeletionFailureForTest: Error | null = null;
let orgModuleEntitlementStore: OrgModuleEntitlementStore = createOrgModuleEntitlementStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
});
const trainingContentStore = createTrainingContentStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
});
const trainingContentCategoryStore = createTrainingContentCategoryStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
});
const trainingContentAssetStore: TrainingContentAssetStore = createTrainingContentAssetStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
});
const trainingContentObjectStorage = createTrainingContentObjectStorage(
  runtimeConfig.trainingContentStorage
);
const trainingContentBackupStorage = createTrainingContentBackupStorage(
  runtimeConfig.trainingContentStorage
);
const trainingContentBackup = createTrainingContentBackupService({
  config: runtimeConfig.trainingContentStorage,
  assetStore: trainingContentAssetStore,
  backupStorage: trainingContentBackupStorage,
});
const trainingContentStorageReadiness = new TrainingContentStorageReadinessService(
  runtimeConfig.trainingContentStorage,
  trainingContentObjectStorage
);
const defaultTrainingContentAssetService = createTrainingContentAssetService({
  config: runtimeConfig.trainingContentStorage,
  assetStore: trainingContentAssetStore,
  entitlementStore: orgModuleEntitlementStore,
  objectStorage: trainingContentObjectStorage,
  readiness: trainingContentStorageReadiness,
  backup: trainingContentBackup,
});
let trainingContentAssetService: TrainingContentAssetService = defaultTrainingContentAssetService;
const trainingContentScenarioLinkService = createTrainingContentScenarioLinkService(
  trainingContentStore
);
const defaultTrainingContentManagementService = createTrainingContentManagementService({
  store: trainingContentStore,
  categoryStore: trainingContentCategoryStore,
  entitlementStore: orgModuleEntitlementStore,
  storageConfig: runtimeConfig.trainingContentStorage,
  scenarioLinkService: trainingContentScenarioLinkService,
});
let trainingContentManagementService: TrainingContentManagementService =
  defaultTrainingContentManagementService;
const defaultTrainingContentMobileService = createTrainingContentMobileService({
  store: trainingContentStore,
  scenarioLinkService: trainingContentScenarioLinkService,
  entitlementStore: orgModuleEntitlementStore,
  objectStorage: trainingContentObjectStorage,
  readiness: trainingContentStorageReadiness,
  storageConfig: runtimeConfig.trainingContentStorage,
});
let trainingContentMobileService: TrainingContentMobileService =
  defaultTrainingContentMobileService;
const auditEventStore = createAuditEventStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const aiUsageEventStore = createAiUsageEventStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const supportCaseStore = createSupportCaseStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const simulationSessionStore = createSimulationSessionStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const usageSessionStore = createUsageSessionStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const scoreRecordStore = createScoreRecordStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const webAuthSessionStore = createWebAuthSessionStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const performancePlanStore = createPerformancePlanStore({
  provider: STORAGE_PROVIDER,
  dbPath: DB_PATH,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const userEmployeeIdClaimStore = createUserEmployeeIdClaimStore({
  provider: STORAGE_PROVIDER,
  databaseUrl: DATABASE_URL,
  pgPoolMax: PG_POOL_MAX,
  pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
  pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS
});
const webAuthService = createWebAuthService({
  tokenSecret: WEB_AUTH_TOKEN_SECRET,
  codeSecret: MOBILE_TOKEN_SECRET
});
const aiUsageEventAccess = createAiUsageEventAccess(aiUsageEventStore);
const usageSessionAccess = createUsageSessionAccess(usageSessionStore);
const scoreRecordAccess = createScoreRecordAccess(scoreRecordStore);
const simulationHistoryAccess = createSimulationHistoryAccess({
  usageSessionAccess,
  scoreRecordAccess
});
const authCodeDelivery = createAuthCodeDeliveryService({
  defaultProvider: runtimeConfig.authCodeDeliveryProvider,
  webAuthProvider: runtimeConfig.webAuthCodeDeliveryProvider,
  mobileEmailVerificationProvider: runtimeConfig.mobileEmailVerificationDeliveryProvider,
  resendApiKey: runtimeConfig.resendApiKey,
  fromEmail: runtimeConfig.authCodeFromEmail,
  fromName: runtimeConfig.authCodeFromName,
  replyTo: runtimeConfig.authCodeReplyTo
});

interface AdminTokenPayload {
  role: "admin";
  exp: number;
  sid: string;
}

interface AdminAuthRequest extends Request {
  admin?: AdminTokenPayload;
  adminToken?: string;
}

interface DashboardRequestPrincipal {
  token: WebAuthTokenPayload;
  user: UserProfile;
  viewer: DashboardViewer;
}

interface DashboardAuthRequest extends Request {
  dashboard?: DashboardRequestPrincipal;
}

interface WebAuthRequestPrincipal {
  token: WebAuthTokenPayload;
  user: UserProfile;
  sessionId: string;
}

interface WebAuthRequest extends Request {
  webAuth?: WebAuthRequestPrincipal;
  webAuthToken?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function logWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(message);
}

function logWarnThrottled(key: string, message: string, throttleMs = WARNING_LOG_THROTTLE_MS): void {
  const now = Date.now();
  const last = warningLogByKey.get(key) ?? 0;
  if (now - last < throttleMs) {
    return;
  }

  warningLogByKey.set(key, now);
  logWarn(message);
}

type SimulationApiPath = "responses" | "chat";

interface SimulationCompletionResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
}

function toSimulationApiPath(apiFamily: OpenAiCompletionApiFamily): SimulationApiPath {
  return apiFamily === "responses" ? "responses" : "chat";
}

function logSimulationAiMetrics(params: {
  route: SimulationRoute;
  startedAtMs: number;
  requestedModel: string;
  apiPathUsed: SimulationApiPath;
  correlationId: string;
  messageCount: number;
  promptChars: number;
  maxOutputTokens: number;
  reasoningEffort: string | null;
  completion?: SimulationCompletionResult;
  error?: unknown;
}): number {
  const latencyMs = Math.max(0, Date.now() - params.startedAtMs);
  const logPayload: Record<string, unknown> = {
    event: "ai-simulation",
    correlationId: params.correlationId,
    route: params.route,
    requestedModel: params.requestedModel,
    apiPathUsed: params.apiPathUsed,
    latencyMs,
    messageCount: params.messageCount,
    promptChars: params.promptChars,
    maxOutputTokens: params.maxOutputTokens,
    reasoningEffort: params.reasoningEffort ?? "default",
    responseModel: params.completion?.model ?? "unknown",
    tokenUsage: params.completion
      ? {
          inputTokens: params.completion.usage.inputTokens,
          outputTokens: params.completion.usage.outputTokens,
          totalTokens: params.completion.usage.totalTokens
        }
      : {
          inputTokens: "unknown",
          outputTokens: "unknown",
          totalTokens: "unknown"
        }
  };

  if (params.error) {
    logPayload.error = params.error instanceof Error ? params.error.message : String(params.error);
  }

  // eslint-disable-next-line no-console
  console.log(`[ai-simulation] ${JSON.stringify(logPayload)}`);
  return latencyMs;
}

async function requestSimulationCompletion(params: {
  route: SimulationRoute;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  correlationId: string;
  budgetContext: AiProviderBudgetContext;
}): Promise<{
  completion: SimulationCompletionResult;
  latencyMs: number;
  apiPathUsed: SimulationApiPath;
  usageEventId: string;
}> {
  const requestStartedAt = Date.now();
  const routeConfig = resolveSimulationRequestConfig(OPENAI_MODEL_CONFIG, params.route);
  const requestedModel = routeConfig.model;
  const apiPathUsed = toSimulationApiPath(routeConfig.apiFamily);
  const promptChars = params.messages.reduce((total, message) => total + message.content.length, 0);
  const messageCount = params.messages.length;

  try {
    const budgetedCompletion = await invokeAiProviderWithBudget({
      context: params.budgetContext,
      kind: params.route,
      model: requestedModel,
      promptVersion: AI_PROMPT_VERSION,
      rubricVersion: params.route === "score" ? AI_RUBRIC_VERSION : null,
      estimatedTokens: estimateCompletionReservationTokens(params.messages, routeConfig.maxOutputTokens),
      invoke: async () => await requestCompletion({
        apiFamily: routeConfig.apiFamily,
        model: requestedModel,
        messages: params.messages,
        maxOutputTokens: routeConfig.maxOutputTokens,
        reasoningEffort: routeConfig.reasoningEffort,
        temperature: params.temperature,
        timeoutMs: SIMULATION_MODEL_TIMEOUT_MS_BY_ROUTE[params.route],
        route: params.route,
        correlationId: params.correlationId,
      }),
      resolveUsage: (completion) => completion.usage,
    });
    const completion = budgetedCompletion.value;

    const latencyMs = logSimulationAiMetrics({
      route: params.route,
      startedAtMs: requestStartedAt,
      requestedModel,
      apiPathUsed,
      correlationId: params.correlationId,
      messageCount,
      promptChars,
      maxOutputTokens: routeConfig.maxOutputTokens,
      reasoningEffort: routeConfig.reasoningEffort,
      completion
    });

    return { completion, latencyMs, apiPathUsed, usageEventId: budgetedCompletion.usageEventId };
  } catch (error) {
    if (apiPathUsed === "responses") {
      const details =
        error instanceof OpenAiResponsesRequestError
          ? {
              statusCode: error.statusCode ?? null,
              errorType: error.errorType ?? null,
              errorCode: error.errorCode ?? null,
              errorMessage: error.errorMessage ?? error.message
            }
          : {
              statusCode: null,
              errorType: null,
              errorCode: null,
              errorMessage: error instanceof Error ? error.message : String(error)
            };

      // eslint-disable-next-line no-console
      console.error(
        `[ai-responses-error] ${JSON.stringify({
          event: "ai-responses-error",
          correlationId: params.correlationId,
          route: params.route,
          requestedModel,
          statusCode: details.statusCode,
          openAiError: {
            type: details.errorType,
            code: details.errorCode,
            message: details.errorMessage
          }
        })}`
      );
    }

    logSimulationAiMetrics({
      route: params.route,
      startedAtMs: requestStartedAt,
      requestedModel,
      apiPathUsed,
      correlationId: params.correlationId,
      messageCount,
      promptChars,
      maxOutputTokens: routeConfig.maxOutputTokens,
      reasoningEffort: routeConfig.reasoningEffort,
      error
    });
    throw error;
  }
}

interface PersistedSimulationAiDetails {
  requestedModel: string;
  responseModel: string;
  tokenUsage: {
    inputTokens: number | "unknown";
    outputTokens: number | "unknown";
    totalTokens: number | "unknown";
  };
  latencyMs: number | "unknown";
}

function toKnownModel(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const trimmed = value.trim();
  return trimmed || "unknown";
}

function toKnownToken(value: unknown): number | "unknown" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unknown";
  }
  return Math.floor(value);
}

function toKnownLatency(value: unknown): number | "unknown" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unknown";
  }
  return Math.floor(value);
}

function toUsageEventToken(value: number | "unknown"): number {
  return typeof value === "number" ? value : 0;
}

function buildPersistedSimulationAiDetails(params: {
  requestedModel: string;
  responseModel: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  latencyMs?: number;
}): PersistedSimulationAiDetails {
  return {
    requestedModel: toKnownModel(params.requestedModel),
    responseModel: toKnownModel(params.responseModel),
    tokenUsage: {
      inputTokens: toKnownToken(params.usage?.inputTokens),
      outputTokens: toKnownToken(params.usage?.outputTokens),
      totalTokens: toKnownToken(params.usage?.totalTokens)
    },
    latencyMs: toKnownLatency(params.latencyMs)
  };
}

function normalizeTranscriptForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLatestUserTextFromHistory(history: DialogueTurn[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn.role === "user") {
      return turn.content;
    }
  }
  return null;
}

function appearsToEchoAssistantHistory(userText: string, history: DialogueTurn[]): boolean {
  const normalizedUser = normalizeTranscriptForComparison(userText);
  if (!normalizedUser || normalizedUser.length < 24) {
    return false;
  }

  const assistantMessages = history
    .filter((message) => message.role === "assistant")
    .slice(-2)
    .map((message) => normalizeTranscriptForComparison(message.content))
    .filter(Boolean);

  return assistantMessages.some((assistantText) => {
    if (!assistantText) {
      return false;
    }
    if (assistantText.includes(normalizedUser) || normalizedUser.includes(assistantText)) {
      return true;
    }

    const assistantTokens = new Set(assistantText.split(" "));
    const userTokens = normalizedUser.split(" ");
    const overlap = userTokens.filter((token) => assistantTokens.has(token)).length;
    return userTokens.length >= 6 && overlap / userTokens.length >= 0.72;
  });
}

function hasPlaceholderOrMissingUserText(text: string | null | undefined): boolean {
  if (typeof text !== "string") {
    return true;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  return PLACEHOLDER_USER_TEXT_PATTERN.test(trimmed);
}

function hasAnyPlaceholderUserText(history: DialogueTurn[]): boolean {
  return history.some((turn) => turn.role === "user" && PLACEHOLDER_USER_TEXT_PATTERN.test(turn.content.trim()));
}

function detectSimulationPayloadType(
  request: Request,
  body: Record<string, unknown>
): { hasAudioPayload: boolean; hasTranscriptionPayload: boolean; hasTextPayload: boolean; mode: string } {
  const fileCarrier = request as Request & { file?: unknown };
  const transcriptPayload = body.transcript;
  const hasAudioPayload =
    Boolean(fileCarrier.file) ||
    typeof body.audio === "string" ||
    typeof body.audioUri === "string" ||
    typeof body.audioBase64 === "string";
  const hasTranscriptionPayload =
    typeof transcriptPayload === "string" ||
    (Boolean(transcriptPayload) &&
      typeof transcriptPayload === "object" &&
      typeof (transcriptPayload as { text?: unknown }).text === "string");
  const hasTextPayload = Array.isArray(body.history) || typeof body.text === "string";

  const mode = hasAudioPayload
    ? "audio"
    : hasTranscriptionPayload
      ? "transcription"
      : hasTextPayload
        ? "text"
        : "unknown";

  return { hasAudioPayload, hasTranscriptionPayload, hasTextPayload, mode };
}

function resolveSimulationSessionId(request: Request, body: Record<string, unknown>): string {
  const bodySimulationSessionId =
    typeof body.simulationSessionId === "string" ? body.simulationSessionId.trim() : "";
  if (bodySimulationSessionId) {
    return bodySimulationSessionId.slice(0, 120);
  }

  const bodySessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (bodySessionId) {
    return bodySessionId.slice(0, 120);
  }

  const headerSessionId =
    typeof request.headers["x-session-id"] === "string"
      ? request.headers["x-session-id"].trim()
      : Array.isArray(request.headers["x-session-id"])
        ? request.headers["x-session-id"][0]?.trim() ?? ""
        : "";
  if (headerSessionId) {
    return headerSessionId.slice(0, 120);
  }

  const headerRequestId =
    typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"].trim()
      : Array.isArray(request.headers["x-request-id"])
        ? request.headers["x-request-id"][0]?.trim() ?? ""
        : "";
  if (headerRequestId) {
    return headerRequestId.slice(0, 120);
  }

  return "unknown";
}

function resolveSimulationCorrelationId(request: Request): string {
  const correlationHeader =
    typeof request.headers["x-correlation-id"] === "string"
      ? request.headers["x-correlation-id"].trim()
      : Array.isArray(request.headers["x-correlation-id"])
        ? request.headers["x-correlation-id"][0]?.trim() ?? ""
        : "";
  if (correlationHeader) {
    return correlationHeader.slice(0, 80);
  }

  const requestHeader =
    typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"].trim()
      : Array.isArray(request.headers["x-request-id"])
        ? request.headers["x-request-id"][0]?.trim() ?? ""
        : "";
  if (requestHeader) {
    return requestHeader.slice(0, 80);
  }

  return `cid_${uuid().replace(/-/g, "").slice(0, 10)}`;
}

function resolveRecognizedSimulationSessionId(request: Request, body: Record<string, unknown>): string | null {
  return normalizeSimulationSessionId(resolveSimulationSessionId(request, body));
}

function listMissingUsageSessionFields(params: {
  simulationSessionId: string | null;
  userId: string | null;
  segmentId: string | null;
  scenarioId: string | null;
}): Array<"simulationSessionId" | "userId" | "segmentId" | "scenarioId"> {
  const requiredFields = [
    { field: "simulationSessionId" as const, value: params.simulationSessionId },
    { field: "userId" as const, value: params.userId },
    { field: "segmentId" as const, value: params.segmentId },
    { field: "scenarioId" as const, value: params.scenarioId },
  ];

  return requiredFields
    .filter((entry) => typeof entry.value !== "string" || !entry.value.trim())
    .map((entry) => entry.field);
}

async function touchRecognizedSimulationSessionBestEffort(params: {
  simulationSessionId: string | null;
  trainingPackId?: string | null;
  logKey: string;
}): Promise<void> {
  if (!params.simulationSessionId) {
    return;
  }

  try {
    await touchRecognizedSimulationSession(simulationSessionStore, {
      simulationSessionId: params.simulationSessionId,
      trainingPackId: params.trainingPackId ?? null,
      lastSeenAt: nowIso()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarnThrottled(params.logKey, `[simulation-session] failed to touch recognized session: ${message}`);
  }
}

function runSimulationPostResponseTask(
  task: () => Promise<void>,
  options: {
    logKey: string;
    description: string;
  },
): void {
  setImmediate(() => {
    void task().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logWarnThrottled(options.logKey, `[simulation-post-response] ${options.description}: ${message}`);
    });
  });
}

const PENDING_UNIFIED_TURN_TTL_MS = 5 * 60 * 1000;

type PendingUnifiedSubmitTurnResult =
  | {
      outcome: "assistant_reply";
      transcriptText: string;
      assistantText: string;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      model: string;
      promptVersion: string;
      speechPrefetch: SimulationSpeechPrefetchPayload | null;
      runtime: {
        path: "unified_submit";
        transcriptionMs: number;
        cacheStatus: "hit" | "miss" | "bypass";
        cacheReason?: string | null;
        contextBuildMs?: number | null;
        trainingPackLookupMs?: number | null;
        modelLatencyMs?: number | null;
        speechPrefetchTtsLatencyMs?: number | null;
        routeElapsedMs?: number | null;
      };
    }
  | {
      outcome: "no_clear_speech";
      transcriptText: string;
      noClearSpeechReason: "empty_transcript" | "assistant_echo" | null;
      runtime: {
        path: "unified_submit";
        transcriptionMs: number;
        cacheStatus: "hit" | "miss" | "bypass";
        cacheReason?: string | null;
        contextBuildMs?: number | null;
        trainingPackLookupMs?: number | null;
        modelLatencyMs?: number | null;
        speechPrefetchTtsLatencyMs?: number | null;
        routeElapsedMs?: number | null;
      };
    }
  | {
      outcome: "error";
      error: string;
    };

interface PendingUnifiedSubmitTurnEntry {
  userId: string;
  createdAtMs: number;
  resultPromise: Promise<PendingUnifiedSubmitTurnResult>;
  resolvedResult: PendingUnifiedSubmitTurnResult | null;
}

interface CleanedPendingUnifiedSubmitTurnEntry {
  userId: string;
  cleanedAtMs: number;
  reason: "after_resolve" | "after_reject";
}

const pendingUnifiedSubmitTurns = new Map<string, PendingUnifiedSubmitTurnEntry>();
const cleanedPendingUnifiedSubmitTurns = new Map<string, CleanedPendingUnifiedSubmitTurnEntry>();

type PendingUnifiedSubmitTurnWaitTimeoutKind = "expired" | "no_entry" | "unsettled";

interface PendingUnifiedSubmitTurnWaitOutcome {
  result: PendingUnifiedSubmitTurnResult | null;
  timeoutKind?: PendingUnifiedSubmitTurnWaitTimeoutKind;
}

function sweepExpiredPendingUnifiedSubmitTurns(nowMs = Date.now()): void {
  for (const [correlationId, entry] of pendingUnifiedSubmitTurns.entries()) {
    if (nowMs - entry.createdAtMs > PENDING_UNIFIED_TURN_TTL_MS) {
      pendingUnifiedSubmitTurns.delete(correlationId);
    }
  }
  for (const [correlationId, entry] of cleanedPendingUnifiedSubmitTurns.entries()) {
    if (nowMs - entry.cleanedAtMs > PENDING_UNIFIED_TURN_TTL_MS) {
      cleanedPendingUnifiedSubmitTurns.delete(correlationId);
    }
  }
}

function registerPendingUnifiedSubmitTurn(params: {
  correlationId: string;
  userId: string;
  resultPromise: Promise<PendingUnifiedSubmitTurnResult>;
}): void {
  sweepExpiredPendingUnifiedSubmitTurns();
  const createdAtMs = Date.now();
  const safeResultPromise = params.resultPromise.then(
    (result) => {
      // eslint-disable-next-line no-console
      console.log("[simulation-route]", {
        route: "submit-turn",
        correlationId: params.correlationId,
        stage: "pending_turn_resolved",
        elapsedMs: Date.now() - createdAtMs,
        outcome: result.outcome,
      });
      return result;
    },
    (error) => {
      const message = error instanceof Error ? error.message : "Unified simulation turn failed.";
      // eslint-disable-next-line no-console
      console.warn("[simulation-route]", {
        route: "submit-turn",
        correlationId: params.correlationId,
        stage: "pending_turn_rejected",
        elapsedMs: Date.now() - createdAtMs,
        error: message,
      });
      return {
        outcome: "error" as const,
        error: message,
      };
    },
  );
  const entry: PendingUnifiedSubmitTurnEntry = {
    userId: params.userId,
    createdAtMs,
    resultPromise: safeResultPromise,
    resolvedResult: null,
  };
  safeResultPromise.then((result) => {
    entry.resolvedResult = result;
  });
  pendingUnifiedSubmitTurns.set(params.correlationId, entry);
}

function cleanupPendingUnifiedSubmitTurn(params: {
  correlationId: string;
  userId: string;
  reason: "after_resolve" | "after_reject";
}): boolean {
  const entry = pendingUnifiedSubmitTurns.get(params.correlationId);
  if (!entry) {
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn-await",
      correlationId: params.correlationId,
      stage: "pending_turn_cleanup_skipped",
      cleanup: "pending_turn_cleanup",
      reason: "missing_entry",
      cleanupReason: params.reason,
    });
    return false;
  }

  if (entry.userId !== params.userId) {
    // eslint-disable-next-line no-console
    console.warn("[simulation-route]", {
      route: "submit-turn-await",
      correlationId: params.correlationId,
      stage: "pending_turn_cleanup_skipped",
      cleanup: "pending_turn_cleanup",
      reason: "user_mismatch",
      cleanupReason: params.reason,
    });
    return false;
  }

  pendingUnifiedSubmitTurns.delete(params.correlationId);
  cleanedPendingUnifiedSubmitTurns.set(params.correlationId, {
    userId: params.userId,
    cleanedAtMs: Date.now(),
    reason: params.reason,
  });
  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "submit-turn-await",
    correlationId: params.correlationId,
    stage: params.reason === "after_reject" ? "pending_turn_cleanup_after_reject" : "pending_turn_cleanup_after_resolve",
    cleanup: "pending_turn_cleanup",
    ageMs: Date.now() - entry.createdAtMs,
  });
  return true;
}

function logPendingUnifiedSubmitTurnCleanupSkipped(params: {
  correlationId: string;
  reason: string;
}): void {
  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "submit-turn-await",
    correlationId: params.correlationId,
    stage: "pending_turn_cleanup_skipped",
    cleanup: "pending_turn_cleanup",
    reason: params.reason,
  });
}

async function waitForPendingUnifiedSubmitTurn(params: {
  correlationId: string;
  userId: string;
  timeoutMs: number;
}): Promise<PendingUnifiedSubmitTurnWaitOutcome> {
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + Math.max(1_000, params.timeoutMs);

  while (Date.now() < deadlineMs) {
    sweepExpiredPendingUnifiedSubmitTurns();
    const cleanedEntry = cleanedPendingUnifiedSubmitTurns.get(params.correlationId);
    if (cleanedEntry) {
      if (cleanedEntry.userId !== params.userId) {
        return { result: null, timeoutKind: "no_entry" };
      }
      // eslint-disable-next-line no-console
      console.warn("[simulation-route]", {
        route: "submit-turn-await",
        correlationId: params.correlationId,
        stage: "pending_turn_await_expired",
        elapsedMs: Date.now() - startedAtMs,
        cleanupReason: cleanedEntry.reason,
      });
      return { result: null, timeoutKind: "expired" };
    }
    const entry = pendingUnifiedSubmitTurns.get(params.correlationId);
    if (entry) {
      if (entry.userId !== params.userId) {
        return { result: null, timeoutKind: "no_entry" };
      }
      if (entry.resolvedResult) {
        return { result: entry.resolvedResult };
      }

      const remainingMs = Math.max(1, deadlineMs - Date.now());
      const result = await Promise.race([
        entry.resultPromise,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), remainingMs);
        }),
      ]);
      if (result) {
        return { result };
      }
      // eslint-disable-next-line no-console
      console.warn("[simulation-route]", {
        route: "submit-turn-await",
        correlationId: params.correlationId,
        stage: "pending_turn_await_timeout_unsettled",
        elapsedMs: Date.now() - startedAtMs,
      });
      return { result: null, timeoutKind: "unsettled" };
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
  }

  // eslint-disable-next-line no-console
  console.warn("[simulation-route]", {
    route: "submit-turn-await",
    correlationId: params.correlationId,
    stage: "pending_turn_await_timeout_no_entry",
    elapsedMs: Date.now() - startedAtMs,
  });
  return { result: null, timeoutKind: "no_entry" };
}

interface SimulationSpeechPrefetchRequest {
  preset: TtsPreset;
}

interface SimulationSpeechPrefetchPayload {
  audioBase64: string;
  contentType: string;
  preset: TtsPreset;
  chunkCount: number;
  firstChunkChars: number;
  ttsLatencyMs: number;
}

function parseSimulationSpeechPrefetchRequest(value: unknown): SimulationSpeechPrefetchRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const preset = parseTtsPreset((value as { preset?: unknown }).preset);
  if (!preset) {
    return null;
  }

  return { preset };
}

function estimateTtsDurationSeconds(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean).length;
  if (tokens <= 0) {
    return 0;
  }
  return Math.max(1, Number((tokens / 2.6).toFixed(1)));
}

function isUsableSimulationTranscriptText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_SIMULATION_TRANSCRIPT_CHARS && /[A-Za-z0-9]/.test(trimmed);
}

async function maybeBuildSimulationSpeechPrefetch(params: {
  route: "opening" | "turn";
  correlationId: string;
  text: string;
  request: SimulationSpeechPrefetchRequest | null;
  budgetContext: AiProviderBudgetContext;
}): Promise<SimulationSpeechPrefetchPayload | null> {
  if (!ENABLE_REMOTE_TTS || !params.request) {
    return null;
  }

  const trimmedText = params.text.trim();
  if (!trimmedText) {
    return null;
  }

  const chunks = splitTextForRemoteTtsFastStart(trimmedText);
  const firstChunk = chunks[0]?.trim() ?? "";
  if (!firstChunk) {
    return null;
  }

  if (firstChunk.length > TTS_TEXT_MAX_CHARS) {
    // eslint-disable-next-line no-console
    console.log("[simulation-speech-prefetch]", {
      route: params.route,
      correlationId: params.correlationId,
      stage: "speech_prefetch_skipped",
      reason: "first_chunk_too_large",
      fullResponseChars: trimmedText.length,
      firstChunkChars: firstChunk.length,
      chunkCount: chunks.length,
      chunkChars: chunks.map((chunk) => chunk.length),
    });
    return null;
  }

  const { config: ttsConfig, request: speechRequest } = buildTtsSpeechRequest({
    preset: params.request.preset,
    model: OPENAI_TTS_MODEL,
    text: firstChunk,
    timeoutMs: SIMULATION_SPEECH_PREFETCH_TTS_TIMEOUT_MS,
  });
  const startedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log("[simulation-speech-prefetch]", {
    route: params.route,
    correlationId: params.correlationId,
    stage: "speech_prefetch_start",
    preset: params.request.preset,
    model: ttsConfig.model,
    voice: ttsConfig.voice,
    speed: ttsConfig.speed,
    instructionsIncluded: ttsConfig.instructionsIncluded,
    responseFormat: ttsConfig.responseFormat,
    fullResponseChars: trimmedText.length,
    firstChunkChars: firstChunk.length,
    chunkCount: chunks.length,
    chunkChars: chunks.map((chunk) => chunk.length),
  });

  try {
    const budgetedTts = await invokeAiProviderWithBudget({
      context: params.budgetContext,
      kind: "tts",
      model: ttsConfig.model,
      promptVersion: AI_PROMPT_VERSION,
      rubricVersion: null,
      estimatedTokens: 0,
      invoke: async () => await requestSpeechSynthesis(speechRequest),
    });
    const ttsResult = budgetedTts.value;
    const completedAtMs = Date.now();
    const ttsLatencyMs = completedAtMs - startedAtMs;
    // eslint-disable-next-line no-console
    console.log("[simulation-speech-prefetch]", {
      route: params.route,
      correlationId: params.correlationId,
      stage: "speech_prefetch_ready",
      preset: params.request.preset,
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
      fullResponseChars: trimmedText.length,
      firstChunkChars: firstChunk.length,
      chunkCount: chunks.length,
      chunkChars: chunks.map((chunk) => chunk.length),
      bytes: ttsResult.audioBuffer.byteLength,
      ttsLatencyMs,
    });

    return {
      audioBase64: ttsResult.audioBuffer.toString("base64"),
      contentType: ttsResult.contentType,
      preset: params.request.preset,
      chunkCount: chunks.length,
      firstChunkChars: firstChunk.length,
      ttsLatencyMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech prefetch failed.";
    const timedOut = message.toLowerCase().includes("timed out");
    // eslint-disable-next-line no-console
    console.log("[simulation-speech-prefetch]", {
      route: params.route,
      correlationId: params.correlationId,
      stage: timedOut ? "speech_prefetch_timeout" : "speech_prefetch_error",
      preset: params.request.preset,
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
      firstChunkChars: firstChunk.length,
      chunkCount: chunks.length,
      error: message,
    });
    return null;
  }
}

async function resolveSpeechPrefetchForAssistantPayload(params: {
  route: "opening" | "turn";
  correlationId: string;
  promise: Promise<SimulationSpeechPrefetchPayload | null>;
  payloadWindowMs?: number;
}): Promise<SimulationSpeechPrefetchPayload | null> {
  const payloadWindowMs = params.payloadWindowMs ?? SIMULATION_SPEECH_PREFETCH_PAYLOAD_WINDOW_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const guardedPrefetchPromise = params.promise
      .then((speechPrefetch) => ({ kind: "prefetch" as const, speechPrefetch }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Speech prefetch failed.";
        // eslint-disable-next-line no-console
        console.warn("[simulation-speech-prefetch]", {
          route: params.route,
          correlationId: params.correlationId,
          stage: "speech_prefetch_error",
          source: "payload_window_guard",
          error: message,
        });
        return { kind: "prefetch" as const, speechPrefetch: null };
      });
    const result = await Promise.race([
      guardedPrefetchPromise,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), payloadWindowMs);
      }),
    ]);

    if (result.kind === "timeout") {
      // eslint-disable-next-line no-console
      console.log("[simulation-speech-prefetch]", {
        route: params.route,
        correlationId: params.correlationId,
        stage: "speech_prefetch_skipped_payload_window",
        payloadWindowMs,
      });
      return null;
    }

    return result.speechPrefetch;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

interface SimulationRuntimeBundle {
  source: "standard" | "custom";
  segment: SegmentDefinition;
  scenario: Scenario;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  industryId: string | null;
  industryLabel: string | null;
  industryBaseline: string | null;
  divisionId: string | null;
  counterpartBehaviorGuidance: string | null;
  useModularPromptArchitecture: boolean;
  activeTrainingPack: TrainingPack | null;
  systemPrompt: string;
  openingPrompt: string;
  cacheStatus: SimulationRuntimeCacheStatus;
  cacheReason: string | null;
  contextBuildMs: number;
  trainingPackLookupMs: number;
}

async function resolveSimulationRuntimeBundle(params: {
  db: ApiDatabase;
  user: UserProfile;
  org: EnterpriseOrg | null;
  actingOrgId: string | null;
  scenarioId: string;
  trainingId: string | null;
  difficulty: Difficulty | null;
  personaStyle: PersonaStyle | null;
  requestedIndustryId: unknown;
  requestedIndustryBaseline: unknown;
  submittedTrainingPackId?: string | null;
  simulationSessionId?: string | null;
  response: Response;
}): Promise<SimulationRuntimeBundle | { bootstrapOrgId: string } | null> {
  const useModularPromptArchitecture =
    USE_MODULAR_PROMPT_ARCHITECTURE_ENV && params.org?.enableModularPromptArchitecture === true;
  const requestedIndustryId =
    typeof params.requestedIndustryId === "string" && params.requestedIndustryId.trim()
      ? params.requestedIndustryId.trim()
      : null;
  const submittedTrainingPackId =
    typeof params.submittedTrainingPackId === "string" && params.submittedTrainingPackId.trim()
      ? params.submittedTrainingPackId.trim()
      : null;
  const cacheResult =
    params.difficulty && params.personaStyle
      ? simulationRuntimeCache.read({
          simulationSessionId: params.simulationSessionId ?? null,
          userId: params.user.id,
          actingOrgId: params.actingOrgId,
          scenarioId: params.scenarioId,
          trainingId: params.trainingId,
          difficulty: params.difficulty,
          personaStyle: params.personaStyle,
          requestedIndustryId,
          submittedTrainingPackId,
          useModularPromptArchitecture,
        })
      : ({ status: "bypass", value: null, reason: "missing_effective_variant" } as const);
  if (cacheResult.status === "hit" && cacheResult.value) {
    return {
      ...cacheResult.value,
      cacheStatus: "hit",
      cacheReason: null,
      contextBuildMs: 0,
      trainingPackLookupMs: 0,
    };
  }

  const contextBuildStartedAtMs = Date.now();
  const configForUser = resolveConfigForUser(params.db, params.user, params.actingOrgId);
  const effectiveDifficulty = params.difficulty ?? configForUser.defaultDifficulty;
  const effectivePersonaStyle = params.personaStyle ?? configForUser.defaultPersonaStyle;
  const resolvedScenario = resolveMobileScenarioForUser(configForUser, params.scenarioId, params.trainingId);
  if (!resolvedScenario) {
    const shouldBootstrapTrainingWorkspace = shouldBootstrapTrainingWorkspaceForSimulationRoute({
      configForUser,
      org: params.org,
      scenarioId: params.scenarioId,
      existingOrgTrainingCount: params.org ? listOrgTrainingRecords(params.db, params.org.id).length : 0,
    });
    if (shouldBootstrapTrainingWorkspace && params.org) {
      return { bootstrapOrgId: params.org.id };
    }

    params.response.status(400).json({ error: "Invalid scenario for this account." });
    return null;
  }

  const industryPromptContext = resolveAiIndustryPromptContextForAllowedIndustries(
    configForUser,
    resolvedScenario.allowedIndustryIds,
    params.requestedIndustryId,
    params.requestedIndustryBaseline,
    {
      preferClientBaselineSnapshot: false,
      canonicalIndustryDefinitions: params.db.config.industries,
    },
  );
  const counterpartBehaviorGuidance = resolveRoleplayCounterpartBehaviorGuidance(resolvedScenario);
  const trainingPackLookupStartedAtMs = Date.now();
  const activeTrainingPack = await resolvePersistedTrainingPackForScenario({
    orgId: params.actingOrgId,
    scenarioId: resolvedScenario.scenario.id,
    useModularPromptArchitecture,
    submittedTrainingPackId,
  });
  const trainingPackLookupMs = useModularPromptArchitecture
    ? Date.now() - trainingPackLookupStartedAtMs
    : 0;
  const prompts = useModularPromptArchitecture
    ? buildRoleplayPromptsWithOrchestrator({
        scenario: resolvedScenario.scenario,
        difficulty: effectiveDifficulty,
        segmentLabel: resolvedScenario.segment.label,
        personaStyle: effectivePersonaStyle,
        industryLabel: industryPromptContext.industryLabel,
        industryBaseline: industryPromptContext.industryBaseline,
        counterpartBehaviorGuidance,
        trainingPack: activeTrainingPack,
      })
    : {
        systemPrompt: buildRoleplaySystemPrompt({
          scenario: resolvedScenario.scenario,
          difficulty: effectiveDifficulty,
          segmentLabel: resolvedScenario.segment.label,
          personaStyle: effectivePersonaStyle,
          industryLabel: industryPromptContext.industryLabel,
          industryBaseline: industryPromptContext.industryBaseline,
          counterpartBehaviorGuidance,
        }),
        openingPrompt: buildOpeningPrompt(resolvedScenario.scenario),
      };

  const runtimeBundle = {
    source: resolvedScenario.source,
    segment: resolvedScenario.segment,
    scenario: resolvedScenario.scenario,
    difficulty: effectiveDifficulty,
    personaStyle: effectivePersonaStyle,
    industryId: industryPromptContext.industryId,
    industryLabel: industryPromptContext.industryLabel,
    industryBaseline: industryPromptContext.industryBaseline,
    divisionId: resolveSimulationDivisionIdForContext({
      db: params.db,
      user: params.user,
      org: params.org,
      trainingId: params.trainingId,
      resolvedScenario,
    }),
    counterpartBehaviorGuidance,
    useModularPromptArchitecture,
    activeTrainingPack,
    systemPrompt: prompts.systemPrompt,
    openingPrompt: prompts.openingPrompt,
    cacheStatus: cacheResult.status === "bypass" ? "bypass" : "miss",
    cacheReason: cacheResult.reason ?? null,
    contextBuildMs: Math.max(0, Date.now() - contextBuildStartedAtMs),
    trainingPackLookupMs,
  } satisfies SimulationRuntimeBundle;

  simulationRuntimeCache.write(
    {
      simulationSessionId: params.simulationSessionId ?? null,
      userId: params.user.id,
      actingOrgId: params.actingOrgId,
      scenarioId: params.scenarioId,
      trainingId: params.trainingId,
      difficulty: effectiveDifficulty,
      personaStyle: effectivePersonaStyle,
      requestedIndustryId,
      submittedTrainingPackId,
      useModularPromptArchitecture,
    },
    {
      segment: runtimeBundle.segment,
      scenario: runtimeBundle.scenario,
      source: runtimeBundle.source,
      difficulty: runtimeBundle.difficulty,
      personaStyle: runtimeBundle.personaStyle,
      industryId: runtimeBundle.industryId,
      industryLabel: runtimeBundle.industryLabel,
      industryBaseline: runtimeBundle.industryBaseline,
      divisionId: runtimeBundle.divisionId,
      counterpartBehaviorGuidance: runtimeBundle.counterpartBehaviorGuidance,
      useModularPromptArchitecture: runtimeBundle.useModularPromptArchitecture,
      activeTrainingPack: runtimeBundle.activeTrainingPack,
      systemPrompt: runtimeBundle.systemPrompt,
      openingPrompt: runtimeBundle.openingPrompt,
    },
  );

  return runtimeBundle;
}

async function transcribeSimulationAudioFile(params: {
  file: { buffer: Buffer; originalname: string; mimetype: string };
  route: "transcribe" | "submit-turn";
  correlationId: string;
  budgetContext: AiProviderBudgetContext;
}): Promise<{ text: string; durationMs: number; mimeType: string; bytes: number; usageEventId: string }> {
  const startedAtMs = Date.now();
  const mimeType = params.file.mimetype || "audio/m4a";
  const budgetedTranscription = await invokeAiProviderWithBudget({
    context: params.budgetContext,
    kind: "transcribe",
    model: OPENAI_TRANSCRIPTION_MODEL,
    promptVersion: AI_PROMPT_VERSION,
    rubricVersion: null,
    estimatedTokens: 0,
    invoke: async () => await requestTranscription({
      model: OPENAI_TRANSCRIPTION_MODEL,
      audioBuffer: params.file.buffer,
      fileName: params.file.originalname || "voice-input.m4a",
      mimeType,
      language: "en",
      timeoutMs: SIMULATION_TRANSCRIPTION_TIMEOUT_MS,
      route: params.route,
      correlationId: params.correlationId,
    }),
  });
  const text = budgetedTranscription.value;

  return {
    text,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    mimeType,
    bytes: params.file.buffer.byteLength,
    usageEventId: budgetedTranscription.usageEventId,
  };
}

async function generateSimulationTurnReply(params: {
  correlationId: string;
  history: DialogueTurn[];
  runtime: SimulationRuntimeBundle;
  requestedSpeechPrefetch: SimulationSpeechPrefetchRequest | null;
  budgetContext: AiProviderBudgetContext;
}): Promise<{
  assistantText: string;
  completion: Awaited<ReturnType<typeof requestSimulationCompletion>>["completion"];
  modelLatencyMs: number;
  historyChars: number;
  promptChars: number;
  speechPrefetch: SimulationSpeechPrefetchPayload | null;
  usageEventId: string;
}> {
  const temperature = params.runtime.difficulty === "hard" ? 0.55 : 0.75;
  const promptMessages = [
    { role: "system" as const, content: params.runtime.systemPrompt },
    ...params.history.map((message) => ({ role: message.role, content: message.content })),
  ];
  const historyChars = params.history.reduce((total, message) => total + message.content.length, 0);
  const promptChars = params.runtime.systemPrompt.length + historyChars;
  const { completion, latencyMs, usageEventId } = await requestSimulationCompletion({
    route: "turn",
    messages: promptMessages,
    temperature,
    correlationId: params.correlationId,
    budgetContext: params.budgetContext,
  });
  const assistantText = completion.text.trim();
  const speechPrefetchPromise = maybeBuildSimulationSpeechPrefetch({
    route: "turn",
    correlationId: params.correlationId,
    text: assistantText,
    request: params.requestedSpeechPrefetch,
    budgetContext: params.budgetContext,
  });
  const speechPrefetch = await resolveSpeechPrefetchForAssistantPayload({
    route: "turn",
    correlationId: params.correlationId,
    promise: speechPrefetchPromise,
  });

  return {
    assistantText,
    completion,
    modelLatencyMs: latencyMs,
    historyChars,
    promptChars,
    speechPrefetch,
    usageEventId,
  };
}

function logSimulationUserTextDiagnostics(params: {
  route: "turn" | "score";
  sessionId: string;
  userText: string | null;
  placeholderDetected: boolean;
  payloadType: {
    hasAudioPayload: boolean;
    hasTranscriptionPayload: boolean;
    hasTextPayload: boolean;
    mode: string;
  };
}): void {
  if (runtimeConfig.isProduction) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[ai-simulation-input] route=${params.route} sessionId=${params.sessionId} userTextLength=${params.userText?.length ?? 0} placeholderDetected=${params.placeholderDetected} payloadMode=${params.payloadType.mode} payloadFlags=audio:${params.payloadType.hasAudioPayload},transcription:${params.payloadType.hasTranscriptionPayload},text:${params.payloadType.hasTextPayload}`
  );
}

async function getActiveTrainingPackForOrg(
  orgId: string | null | undefined,
  useModularPromptArchitecture: boolean,
  options?: {
    scenarioId?: string | null;
    onSkip?: (message: string) => void;
  }
): Promise<TrainingPack | null> {
  if (!useModularPromptArchitecture) {
    return null;
  }

  try {
    const pack = await trainingPackStore.getActiveTrainingPackForOrg(orgId);
    if (!pack) {
      return null;
    }

    const packDescriptor = runtimeConfig.isProduction
      ? "active training pack"
      : `pack "${pack.title}" (${pack.id})`;
    const requestedScenarioId = options?.scenarioId?.trim().toLowerCase();
    if ((pack.requiredBehavioralTriggers ?? []).length === 0) {
      logWarnThrottled(
        `training-pack:empty-triggers:${pack.id}`,
        `[training-pack] active pack "${pack.title}" (${pack.id}) for org "${pack.organizationId}" has empty requiredBehavioralTriggers; scenario opt-in gate will skip it.`
      );
    }

    if (!requestedScenarioId) {
      options?.onSkip?.(`[training-pack] skipping ${packDescriptor} because scenario context is missing.`);
      return null;
    }

    const scopedScenarioIds = new Set(
      (pack.requiredBehavioralTriggers ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.toLowerCase().startsWith(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX))
        .map((entry) => entry.slice(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX.length).trim().toLowerCase())
        .filter(Boolean)
    );

    if (scopedScenarioIds.size === 0) {
      options?.onSkip?.(
        `[training-pack] skipping ${packDescriptor} for scenario "${requestedScenarioId}" because no explicit opt-in was found. Add "${TRAINING_PACK_SCENARIO_OPT_IN_PREFIX}${requestedScenarioId}" or "${TRAINING_PACK_SCENARIO_OPT_IN_PREFIX}*" to requiredBehavioralTriggers.`
      );
      return null;
    }

    if (!scopedScenarioIds.has("*") && !scopedScenarioIds.has(requestedScenarioId)) {
      options?.onSkip?.(
        `[training-pack] skipping ${packDescriptor} for scenario "${requestedScenarioId}" because it is not explicitly opted in.`
      );
      return null;
    }

    return pack;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarnThrottled("training-pack:lookup", `[training-pack] failed to load active training pack: ${message}`);
    return null;
  }
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

function getSingleQueryParam(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return null;
}

function normalizeTrainingPackTriggers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function parseBooleanQueryFlag(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeIdentifier(value: unknown, fallbackPrefix: string): string {
  if (typeof value === "string" && value.trim()) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (normalized) {
      return normalized;
    }
  }

  return `${fallbackPrefix}_${uuid().slice(0, 8)}`;
}

function uniqueStrings(values: unknown[], allowed?: Set<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }

    const value = entry.trim();
    if (!value || (allowed && !allowed.has(value)) || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function getConfiguredIndustryIds(config: AppConfig): IndustryId[] {
  const ids = uniqueStrings((config.industries ?? []).map((entry) => entry.id));
  return ids.length > 0 ? ids : [...INDUSTRY_IDS];
}

function getConfiguredActiveIndustryIds(config: AppConfig): IndustryId[] {
  const activeIds = uniqueStrings(
    (config.industries ?? []).filter((entry) => entry.enabled).map((entry) => entry.id)
  );
  return activeIds.length > 0 ? activeIds : getConfiguredIndustryIds(config);
}

function normalizeIndustryIds(
  value: unknown,
  fallback: IndustryId[] = [...INDUSTRY_IDS],
  allowed?: Set<string>
): IndustryId[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const unique = uniqueStrings(value, allowed);
  return unique.length > 0 ? (unique as IndustryId[]) : [...fallback];
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function normalizeContractSignedAt(value: unknown, fallbackIso: string): string {
  if (isValidIsoDate(value)) {
    return new Date(value).toISOString();
  }

  return fallbackIso;
}

function deriveDefaultMonthlyMinutesAllotted(org: Pick<EnterpriseOrg, "dailySecondsQuota">): number {
  const dailyQuota = clampNonNegativeInteger(org.dailySecondsQuota, 8 * 60 * 60);
  return Math.max(0, Math.floor((dailyQuota * 30) / 60));
}

function normalizeMonthlyMinutesAllotted(value: unknown, fallbackMinutes: number): number {
  return clampNonNegativeInteger(value, clampNonNegativeInteger(fallbackMinutes, 0));
}

function normalizeOptionalSecondsCap(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  return clampNonNegativeInteger(value, 0);
}

function normalizeOptionalIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = parseIsoDateOrNull(value);
  return parsed ? parsed.toISOString() : null;
}

function normalizeRenewalTotalUsd(value: unknown, fallbackUsd: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Number(fallbackUsd) || 0);
  }

  return Math.round(parsed * 100) / 100;
}

function normalizeSoftLimitPercentTriggers(value: unknown, fallback: number[] = []): number[] {
  const source = Array.isArray(value) ? value : fallback;
  const unique = new Set<number>();
  for (const entry of source) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) {
      continue;
    }

    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 100) {
      continue;
    }

    unique.add(rounded);
  }

  return Array.from(unique)
    .sort((a, b) => a - b)
    .slice(0, 2);
}

function normalizeMaxSimulationMinutes(value: unknown, fallbackMinutes = DEFAULT_MAX_SIMULATION_MINUTES): number {
  const fallback = clampNonNegativeInteger(fallbackMinutes, DEFAULT_MAX_SIMULATION_MINUTES);
  const parsed = clampNonNegativeInteger(value, fallback);
  const bounded = Math.max(MIN_MAX_SIMULATION_MINUTES, Math.min(MAX_MAX_SIMULATION_MINUTES, parsed));
  return bounded;
}

function normalizeScenarioEntry(raw: unknown, segmentId: string, index: number): Scenario | null {
  const candidate = (raw ?? {}) as Partial<Scenario>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) {
    return null;
  }

  const description = typeof candidate.description === "string" && candidate.description.trim()
    ? candidate.description.trim()
    : title;
  const aiRole = typeof candidate.aiRole === "string" && candidate.aiRole.trim()
    ? candidate.aiRole.trim()
    : "a conversation partner";
  const desiredOutcome = normalizeDesiredOutcomeText(candidate.desiredOutcome);

  return {
    id: normalizeIdentifier(candidate.id, `${segmentId}_scenario_${index + 1}`),
    segmentId,
    title,
    summary: buildScenarioSummary(description),
    description,
    desiredOutcome,
    aiRole,
    enabled: candidate.enabled !== false
  };
}

function isOrgCustomScenarioSourceMode(value: unknown): value is OrgCustomScenarioSourceMode {
  return value === "scratch" || value === "standard_base";
}

function isOrgCustomScenarioCreationMethod(value: unknown): value is OrgCustomScenarioCreationMethod {
  return value === "manual" || value === "ai";
}

function sanitizeOptionalText(value: unknown, maxChars = 4_000): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, Math.max(1, maxChars));
}

function sanitizeOptionalTextArray(value: unknown, maxItems = 12, maxCharsPerItem = 240): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const cleaned = uniqueStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, maxCharsPerItem)),
  ).slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeOrgCustomScenarioGenerationInputs(value: unknown): OrgCustomScenarioGenerationInputs | null {
  const candidate = (value ?? {}) as Partial<OrgCustomScenarioGenerationInputs>;
  const normalized: OrgCustomScenarioGenerationInputs = {};

  const companyName = sanitizeOptionalText(candidate.companyName, 200);
  if (companyName) {
    normalized.companyName = companyName;
  }
  const productOrService = sanitizeOptionalText(candidate.productOrService, 500);
  if (productOrService) {
    normalized.productOrService = productOrService;
  }
  const targetPersona = sanitizeOptionalText(candidate.targetPersona, 400);
  if (targetPersona) {
    normalized.targetPersona = targetPersona;
  }
  const keyObjections = sanitizeOptionalTextArray(candidate.keyObjections, 12, 240);
  if (keyObjections) {
    normalized.keyObjections = keyObjections;
  }
  const tone = sanitizeOptionalText(candidate.tone, 100);
  if (tone) {
    normalized.tone = tone;
  }
  const difficulty = sanitizeOptionalText(candidate.difficulty, 100);
  if (difficulty) {
    normalized.difficulty = difficulty;
  }
  const mustInclude = sanitizeOptionalText(candidate.mustInclude, 2_000);
  if (mustInclude) {
    normalized.mustInclude = mustInclude;
  }
  const mustAvoid = sanitizeOptionalText(candidate.mustAvoid, 2_000);
  if (mustAvoid) {
    normalized.mustAvoid = mustAvoid;
  }
  const complianceConstraints = sanitizeOptionalText(candidate.complianceConstraints, 2_000);
  if (complianceConstraints) {
    normalized.complianceConstraints = complianceConstraints;
  }
  const specialInstructions = sanitizeOptionalText(candidate.specialInstructions, 4_000);
  if (specialInstructions) {
    normalized.specialInstructions = specialInstructions;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeOrgCustomScenarioProvenance(
  value: unknown,
  fallback: {
    sourceMode?: OrgCustomScenarioSourceMode;
    creationMethod?: OrgCustomScenarioCreationMethod;
    baseScenarioId?: string | null;
    baseScenarioTitle?: string | null;
    baseScenarioSegmentId?: string | null;
    baseScenarioVersion?: string | null;
    customizationParams?: OrgCustomScenarioGenerationInputs | null;
    generatedPrompt?: string | null;
    modelUsed?: string | null;
    generatedAt?: string | null;
  } = {},
): OrgCustomScenario["provenance"] {
  const candidate = (value ?? {}) as Partial<OrgCustomScenario["provenance"]>;
  const sourceMode = isOrgCustomScenarioSourceMode(candidate.sourceMode)
    ? candidate.sourceMode
    : (fallback.sourceMode ?? "scratch");
  const creationMethod = isOrgCustomScenarioCreationMethod(candidate.creationMethod)
    ? candidate.creationMethod
    : (fallback.creationMethod ?? "manual");
  const baseScenarioId = sanitizeOptionalText(candidate.baseScenarioId, 200) ?? fallback.baseScenarioId ?? null;
  const baseScenarioTitle = sanitizeOptionalText(candidate.baseScenarioTitle, 300) ?? fallback.baseScenarioTitle ?? null;
  const baseScenarioSegmentId =
    sanitizeOptionalText(candidate.baseScenarioSegmentId, 200) ?? fallback.baseScenarioSegmentId ?? null;
  const baseScenarioVersion =
    sanitizeOptionalText(candidate.baseScenarioVersion, 200) ?? fallback.baseScenarioVersion ?? null;
  const customizationParams =
    normalizeOrgCustomScenarioGenerationInputs(candidate.customizationParams) ??
    fallback.customizationParams ??
    null;
  const generatedPrompt = sanitizeOptionalText(candidate.generatedPrompt, 20_000) ?? fallback.generatedPrompt ?? null;
  const modelUsed = sanitizeOptionalText(candidate.modelUsed, 200) ?? fallback.modelUsed ?? null;

  let generatedAt: string | null = fallback.generatedAt ?? null;
  if (isValidIsoDate(candidate.generatedAt)) {
    generatedAt = new Date(candidate.generatedAt).toISOString();
  } else if (candidate.generatedAt === null) {
    generatedAt = null;
  }

  return {
    sourceMode,
    creationMethod,
    baseScenarioId,
    baseScenarioTitle,
    baseScenarioSegmentId,
    baseScenarioVersion,
    customizationParams,
    generatedPrompt,
    modelUsed,
    generatedAt,
  };
}

function normalizeOrgCustomScenarioEntry(raw: unknown, orgId: string, index: number, now: string): OrgCustomScenario | null {
  const candidate = (raw ?? {}) as Partial<OrgCustomScenario>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) {
    return null;
  }

  const segmentId = typeof candidate.segmentId === "string" ? candidate.segmentId.trim() : "";
  if (!segmentId) {
    return null;
  }

  const applicableIndustryIds = uniqueStrings(
    Array.isArray(candidate.applicableIndustryIds) ? candidate.applicableIndustryIds : [],
  );
  if (applicableIndustryIds.length === 0) {
    return null;
  }

  const description = typeof candidate.description === "string" && candidate.description.trim()
    ? candidate.description.trim()
    : title;
  const desiredOutcome = normalizeDesiredOutcomeText(candidate.desiredOutcome);
  const aiRole = typeof candidate.aiRole === "string" && candidate.aiRole.trim()
    ? candidate.aiRole.trim()
    : "a conversation partner";
  const scoringGuidance = typeof candidate.scoringGuidance === "string" ? candidate.scoringGuidance.trim() : "";
  const createdAt = isValidIsoDate(candidate.createdAt) ? new Date(candidate.createdAt).toISOString() : now;
  const updatedAt = isValidIsoDate(candidate.updatedAt) ? new Date(candidate.updatedAt).toISOString() : createdAt;

  const fallbackProvenance = {
    sourceMode: "scratch" as OrgCustomScenarioSourceMode,
    creationMethod: "manual" as OrgCustomScenarioCreationMethod,
  };

  return {
    id: normalizeIdentifier(candidate.id, `${segmentId}_custom_${index + 1}`),
    orgId: typeof candidate.orgId === "string" && candidate.orgId.trim() ? candidate.orgId.trim() : orgId,
    segmentId,
    title,
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary.trim()
        : buildScenarioSummary(description),
    description,
    desiredOutcome,
    aiRole,
    scoringGuidance,
    applicableIndustryIds: applicableIndustryIds as IndustryId[],
    enabled: candidate.enabled === true,
    provenance: normalizeOrgCustomScenarioProvenance(candidate.provenance, fallbackProvenance),
    createdBy:
      typeof candidate.createdBy === "string" && candidate.createdBy.trim()
        ? candidate.createdBy.trim()
        : PLATFORM_ADMIN_ACTOR_ID,
    createdAt,
    updatedAt,
  };
}

function sortOrgCustomScenariosByTitle(items: OrgCustomScenario[]): OrgCustomScenario[] {
  return [...items].sort((a, b) => {
    const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (byTitle !== 0) {
      return byTitle;
    }
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
  });
}

function normalizeOrgCustomScenarioList(value: unknown, orgId: string, now: string): OrgCustomScenario[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry, index) => normalizeOrgCustomScenarioEntry(entry, orgId, index, now))
    .filter((entry): entry is OrgCustomScenario => Boolean(entry));

  return sortOrgCustomScenariosByTitle(normalized);
}

function sortScenariosByTitle(scenarios: Scenario[]): Scenario[] {
  return [...scenarios].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}

function normalizeSegmentDefinitions(
  value: unknown,
  fallback: SegmentDefinition[]
): SegmentDefinition[] {
  if (!Array.isArray(value)) {
    return fallback.map((segment) => ({
      ...segment,
      scenarios: sortScenariosByTitle(
        (segment.scenarios ?? [])
          .map((scenario, index) => normalizeScenarioEntry(scenario, segment.id, index))
          .filter((scenario): scenario is Scenario => Boolean(scenario))
      )
    }));
  }

  const seen = new Set<string>();
  const normalized: SegmentDefinition[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const candidate = (value[i] ?? {}) as Partial<SegmentDefinition>;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (!label) {
      continue;
    }

    const id = normalizeIdentifier(candidate.id ?? label, "role");
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const summary = typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : `Conversations for ${label}.`;
    const rawScenarios = Array.isArray(candidate.scenarios) ? candidate.scenarios : [];
    const scenarios = sortScenariosByTitle(
      rawScenarios
        .map((scenario, index) => normalizeScenarioEntry(scenario, id, index))
        .filter((scenario): scenario is Scenario => Boolean(scenario))
    );

    normalized.push({
      id,
      label,
      summary,
      enabled: candidate.enabled !== false,
      scenarios
    });
  }

  return normalized;
}

function normalizeIndustryDefinitions(
  value: unknown,
  fallback: IndustryDefinition[]
): IndustryDefinition[] {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set<string>();
  const normalized: IndustryDefinition[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const candidate = (source[i] ?? {}) as Partial<IndustryDefinition>;
    const id = normalizeIdentifier(candidate.id, "industry");
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const label = typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : id;
    const aiBaseline = typeof candidate.aiBaseline === "string"
      ? candidate.aiBaseline.trim()
      : "";
    const standardScoringGuidance = typeof candidate.standardScoringGuidance === "string"
      ? candidate.standardScoringGuidance.trim()
      : "";

    normalized.push({
      id,
      label,
      enabled: candidate.enabled !== false,
      aiBaseline,
      standardScoringGuidance
    });
  }

  if (normalized.length === 0) {
    return fallback.map((entry) => ({ ...entry }));
  }

  if (!normalized.some((entry) => entry.enabled)) {
    normalized[0].enabled = true;
  }

  return normalized.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function normalizeRoleIndustryDefinitions(
  value: unknown,
  industries: IndustryDefinition[],
  segments: SegmentDefinition[],
  fallback: RoleIndustryDefinition[],
  allowEmpty = false
): RoleIndustryDefinition[] {
  const source = Array.isArray(value) ? value : fallback;
  const allowedIndustryIds = new Set(industries.map((entry) => entry.id));
  const allowedRoleIds = new Set(segments.map((entry) => entry.id));
  const deduped = new Map<string, RoleIndustryDefinition>();

  for (const raw of source) {
    const candidate = (raw ?? {}) as Partial<RoleIndustryDefinition>;
    if (typeof candidate.industryId !== "string" || typeof candidate.roleId !== "string") {
      continue;
    }

    const industryId = candidate.industryId.trim();
    const roleId = candidate.roleId.trim();
    if (!industryId || !roleId || !allowedIndustryIds.has(industryId) || !allowedRoleIds.has(roleId)) {
      continue;
    }

    deduped.set(`${roleId}::${industryId}`, {
      roleId,
      industryId,
      active: candidate.active !== false
    });
  }

  let normalized = Array.from(deduped.values());
  if (!allowEmpty && normalized.length === 0) {
    normalized = fallback.filter(
      (entry) => allowedIndustryIds.has(entry.industryId) && allowedRoleIds.has(entry.roleId)
    );
  }

  return normalized.sort((a, b) => {
    const byRole = a.roleId.localeCompare(b.roleId, undefined, { sensitivity: "base" });
    if (byRole !== 0) {
      return byRole;
    }

    return a.industryId.localeCompare(b.industryId, undefined, { sensitivity: "base" });
  });
}

function normalizeContactName(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown";
}

function normalizeContactEmail(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "unknown@example.com";
}

function normalizeOrgUserRole(value: unknown): OrgUserRole {
  if (typeof value === "string" && isOrgUserRole(value)) {
    return value;
  }

  return "user";
}

function ensureOrgContractFields(org: EnterpriseOrg): EnterpriseOrg {
  const signedAtFallback = isValidIsoDate(org.createdAt) ? org.createdAt : nowIso();
  const monthlyFallback = deriveDefaultMonthlyMinutesAllotted(org);
  const pendingPerUserDailySecondsCap = normalizeOptionalSecondsCap(org.pendingPerUserDailySecondsCap);
  const pendingPerUserDailySecondsCapEffectiveAt = normalizeOptionalIsoDate(org.pendingPerUserDailySecondsCapEffectiveAt);
  return {
    ...org,
    dailySecondsQuota: clampNonNegativeInteger(org.dailySecondsQuota, 0),
    perUserDailySecondsCap: clampNonNegativeInteger(org.perUserDailySecondsCap, 0),
    manualBonusSeconds: clampNonNegativeInteger(org.manualBonusSeconds, 0),
    contractSignedAt: normalizeContractSignedAt(org.contractSignedAt, signedAtFallback),
    monthlyMinutesAllotted: normalizeMonthlyMinutesAllotted(org.monthlyMinutesAllotted, monthlyFallback),
    renewalTotalUsd: normalizeRenewalTotalUsd(org.renewalTotalUsd, 0),
    softLimitPercentTriggers: normalizeSoftLimitPercentTriggers(org.softLimitPercentTriggers),
    maxSimulationMinutes: normalizeMaxSimulationMinutes(org.maxSimulationMinutes),
    pendingPerUserDailySecondsCap:
      pendingPerUserDailySecondsCap !== null && pendingPerUserDailySecondsCapEffectiveAt
        ? pendingPerUserDailySecondsCap
        : null,
    pendingPerUserDailySecondsCapEffectiveAt:
      pendingPerUserDailySecondsCap !== null && pendingPerUserDailySecondsCapEffectiveAt
        ? pendingPerUserDailySecondsCapEffectiveAt
        : null,
    enableModularPromptArchitecture: org.enableModularPromptArchitecture === true,
    divisionsEnabled: org.divisionsEnabled === true
  };
}

const DEMO_ENTERPRISE_ORGS: Array<{
  id: string;
  name: string;
  activeIndustries: IndustryId[];
  contactName: string;
  contactEmail: string;
  establishedAt: string;
}> = [
  {
    id: "org_demo_people",
    name: "Northstar People Ops",
    activeIndustries: ["people_management"],
    contactName: "Jessica Lane",
    contactEmail: "jessica.lane@northstarpeople.example",
    establishedAt: "2024-04-18T00:00:00.000Z"
  },
  {
    id: "org_demo_sales",
    name: "Summit Revenue Systems",
    activeIndustries: ["sales"],
    contactName: "Marcus Reed",
    contactEmail: "marcus.reed@summitrevenue.example",
    establishedAt: "2023-10-02T00:00:00.000Z"
  },
  {
    id: "org_demo_medical",
    name: "Acme Health Group",
    activeIndustries: ["medical"],
    contactName: "Dr. Priya Shah",
    contactEmail: "priya.shah@acmehealth.example",
    establishedAt: "2025-01-27T00:00:00.000Z"
  }
];

const DEMO_ENTERPRISE_USERS: Array<{
  id: string;
  email: string;
  orgId: string;
  orgRole: OrgUserRole;
}> = [
  {
    id: "usr_demo_people_admin",
    email: "admin@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_people_mgr",
    email: "manager@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_people_hr",
    email: "hr@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "user"
  },
  {
    id: "usr_demo_sales_admin",
    email: "admin@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_sales_rep",
    email: "rep@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_sales_se",
    email: "se@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "user"
  },
  {
    id: "usr_demo_medical_admin",
    email: "admin@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_medical_nurse",
    email: "nurse@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_medical_doc",
    email: "doctor@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "user"
  }
];

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmailDomain(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!withoutAt || withoutAt.includes(" ") || !withoutAt.includes(".")) {
    return null;
  }

  return withoutAt;
}

function extractEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0 || atIndex === email.length - 1) {
    return null;
  }

  return normalizeEmailDomain(email.slice(atIndex + 1));
}

function normalizeJoinCode(value: string | undefined | null): string {
  if (!value) {
    return "";
  }

  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface AppendAuditEventInput {
  actorType: AuditEvent["actorType"];
  actorId?: string | null;
  action: string;
  orgId?: string | null;
  userId?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
}

const pendingAuditEventsByDb = new WeakMap<ApiDatabase, AuditEvent[]>();
const pendingPostCommitEffectsByDb = createPostCommitEffectRegistry<ApiDatabase>();

function getPendingAuditEvents(db: ApiDatabase): AuditEvent[] {
  return pendingAuditEventsByDb.get(db) ?? [];
}

function queuePendingAuditEvent(db: ApiDatabase, event: AuditEvent): void {
  const pending = pendingAuditEventsByDb.get(db);
  if (pending) {
    pending.push(event);
    return;
  }

  pendingAuditEventsByDb.set(db, [event]);
}

function drainPendingAuditEvents(db: ApiDatabase): AuditEvent[] {
  const pending = pendingAuditEventsByDb.get(db) ?? [];
  pendingAuditEventsByDb.delete(db);
  return pending;
}

function queueDatabasePostCommitEffect(db: ApiDatabase, effect: PostCommitEffect): void {
  const description = effect.description.trim();
  if (!description) {
    return;
  }

  pendingPostCommitEffectsByDb.queue(db, {
    ...effect,
    description
  });
}

async function runDatabasePostCommitEffects(effects: readonly PostCommitEffect[]): Promise<void> {
  await runPostCommitEffects(effects, {
    onFailure: (effect, error) => {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(
        `[cross-store][${effect.category}] ${effect.description} failed after primary app-state save: ${message}`
      );
    }
  });
}

function appendAuditEvent(db: ApiDatabase, input: AppendAuditEventInput): void {
  const event: AuditEvent = {
    id: `audit_${uuid()}`,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action.trim().slice(0, 80) || "unknown",
    orgId: input.orgId ?? null,
    userId: input.userId ?? null,
    message: input.message.trim().slice(0, 300) || "Action recorded.",
    metadata: input.metadata ?? null,
    createdAt: nowIso()
  };

  queuePendingAuditEvent(db, event);
}

function appendPlatformAuditEvent(
  db: ApiDatabase,
  input: Omit<AppendAuditEventInput, "actorType" | "actorId">
): void {
  appendAuditEvent(db, {
    ...input,
    actorType: "platform_admin",
    actorId: PLATFORM_ADMIN_ACTOR_ID
  });
}

function appendMobileAuditEvent(
  db: ApiDatabase,
  actor: UserProfile,
  input: Omit<AppendAuditEventInput, "actorType" | "actorId">
): void {
  appendAuditEvent(db, {
    ...input,
    actorType: "mobile_user",
    actorId: actor.id,
    orgId: input.orgId ?? actor.orgId
  });
}

function appendWebAuditEvent(
  db: ApiDatabase,
  actor: UserProfile,
  input: Omit<AppendAuditEventInput, "actorType" | "actorId">
): void {
  appendAuditEvent(db, {
    ...input,
    actorType: "web_user",
    actorId: actor.id,
    orgId: input.orgId ?? actor.orgId
  });
}

interface RateLimitState {
  count: number;
  windowStartMs: number;
}

interface RateLimiterOptions {
  name: string;
  windowMs: number;
  max: number;
  keySelector?: (request: Request) => string;
  onLimitExceeded?: (request: Request, retryAfterSeconds: number) => void;
}

const rateLimitByKey = new Map<string, RateLimitState>();
let rateLimitCleanupCounter = 0;

function getClientIp(request: Request): string {
  const normalizeIp = (value: string | null | undefined): string | null => {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith("::ffff:")) {
      return trimmed.slice(7);
    }
    if (trimmed === "::1") {
      return "127.0.0.1";
    }
    return trimmed;
  };

  const isPrivateOrLoopbackIp = (ip: string): boolean => {
    const lower = ip.toLowerCase();
    if (
      lower === "127.0.0.1" ||
      lower === "localhost" ||
      lower.startsWith("10.") ||
      lower.startsWith("192.168.") ||
      lower.startsWith("169.254.") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    ) {
      return true;
    }

    if (lower.startsWith("172.")) {
      const secondOctet = Number(lower.split(".")[1]);
      return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
  };

  const remoteAddress = normalizeIp(request.socket.remoteAddress);
  const canTrustForwarded = remoteAddress ? isPrivateOrLoopbackIp(remoteAddress) : false;

  if (canTrustForwarded) {
    const forwarded = request.headers["x-forwarded-for"];
    const firstForwarded = (() => {
      if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0] ?? null;
      }
      if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[0] ?? null;
      }
      return null;
    })();
    const forwardedIp = normalizeIp(firstForwarded);
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  return remoteAddress || "unknown";
}

function cleanupRateLimitStore(nowMs: number): void {
  rateLimitCleanupCounter += 1;
  if (rateLimitCleanupCounter % 200 !== 0 && rateLimitByKey.size < 5_000) {
    return;
  }

  const expireBeforeMs = nowMs - 2 * 60 * 60 * 1000;
  for (const [key, value] of rateLimitByKey.entries()) {
    if (value.windowStartMs < expireBeforeMs) {
      rateLimitByKey.delete(key);
    }
  }
}

function consumeRateLimit(
  options: RateLimiterOptions,
  request: Request,
  response: Response,
  selectorOverride?: string
): boolean {
  const windowMs = Math.max(1_000, Math.floor(options.windowMs));
  const max = Math.max(1, Math.floor(options.max));
  const nowMs = Date.now();
  cleanupRateLimitStore(nowMs);

  const selectorValue = selectorOverride || options.keySelector?.(request) || getClientIp(request);
  const key = `${options.name}:${selectorValue || "unknown"}`;
  const existing = rateLimitByKey.get(key);
  const state =
    existing && nowMs - existing.windowStartMs < windowMs
      ? existing
      : {
          count: 0,
          windowStartMs: nowMs
        };

  state.count += 1;
  rateLimitByKey.set(key, state);

  if (state.count > max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.windowStartMs + windowMs - nowMs) / 1000));
    options.onLimitExceeded?.(request, retryAfterSeconds);
    response.setHeader("Retry-After", String(retryAfterSeconds));
    response.status(429).json({
      error: "Too many requests. Please wait and retry."
    });
    return false;
  }

  return true;
}

function rejectIfRateLimitAlreadyExhausted(
  options: RateLimiterOptions,
  request: Request,
  response: Response
): boolean {
  const windowMs = Math.max(1_000, Math.floor(options.windowMs));
  const max = Math.max(1, Math.floor(options.max));
  const nowMs = Date.now();
  cleanupRateLimitStore(nowMs);

  const selectorValue = options.keySelector?.(request) || getClientIp(request);
  const state = rateLimitByKey.get(`${options.name}:${selectorValue || "unknown"}`);
  if (!state || nowMs - state.windowStartMs >= windowMs || state.count < max) {
    return false;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((state.windowStartMs + windowMs - nowMs) / 1000));
  options.onLimitExceeded?.(request, retryAfterSeconds);
  response.setHeader("Retry-After", String(retryAfterSeconds));
  response.status(429).json({
    error: "Too many requests. Please wait and retry."
  });
  return true;
}

function createRateLimiter(options: RateLimiterOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (consumeRateLimit(options, request, response)) {
      next();
    }
  };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) {
    return "UTC";
  }

  if (isValidTimeZone(timeZone)) {
    return timeZone;
  }

  return "UTC";
}

type DialogueRole = "user" | "assistant";

interface DialogueTurn {
  role: DialogueRole;
  content: string;
}

interface NormalizeDialogueHistoryOptions {
  maxTurns?: number | null;
}

function normalizeDialogueHistory(value: unknown, options?: NormalizeDialogueHistoryOptions): DialogueTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const safe: DialogueTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      continue;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      continue;
    }

    const normalizedWhitespace = trimmed.replace(/\s+/g, " ");
    safe.push({ role, content: normalizedWhitespace.slice(0, 2_500) });
  }

  const maxTurns = options?.maxTurns;
  if (typeof maxTurns !== "number" || !Number.isFinite(maxTurns) || maxTurns <= 0) {
    return safe;
  }

  const normalizedMaxTurns = Math.floor(maxTurns);
  return safe.length > normalizedMaxTurns ? safe.slice(safe.length - normalizedMaxTurns) : safe;
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isPersonaStyle(value: unknown): value is PersonaStyle {
  return value === "defensive" || value === "frustrated" || value === "skeptical";
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Evaluator returned invalid JSON.");
  }

  return text.slice(start, end + 1);
}

const MAX_PERSISTED_COACHING_ITEMS = 3;
const MAX_PERSISTED_COACHING_TEXT_LENGTH = 160;

function createDefaultDatabase(): ApiDatabase {
  const now = nowIso();
  const config = createDefaultConfig(now);
  return {
    config,
    users: [],
    orgs: [],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    // Legacy compatibility placeholder. Persisted app-state snapshots strip usageSessions once the
    // dedicated store takes authority, but the in-memory shape stays stable for shared helpers.
    usageSessions: [],
    mobileAuthTokens: [],
    accountDeletionReceipts: [],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: {},
    admin: {
      passwordHash: null,
      activeSessionIds: []
    }
  };
}

function purgeExpiredSupportTranscripts(db: { supportCases?: SupportCaseRecord[] }, nowIso: string): void {
  const cases = db.supportCases;
  if (!cases || cases.length === 0) {
    return;
  }

  const nowMs = new Date(nowIso).getTime();
  for (const entry of cases) {
    if (!entry.transcriptExpiresAt || !entry.transcriptEncrypted) {
      continue;
    }

    const expiresMs = new Date(entry.transcriptExpiresAt).getTime();
    if (Number.isNaN(expiresMs) || expiresMs > nowMs) {
      continue;
    }

    entry.transcriptEncrypted = null;
    entry.transcriptFileName = null;
    entry.transcriptExpiresAt = null;
  }
}

function hasPrefixedId(value: string | null | undefined, prefix: string): boolean {
  return typeof value === "string" && value.startsWith(prefix);
}

function ensureDemoEnterpriseData(db: {
  users: UserProfile[];
  orgs: EnterpriseOrg[];
  config: AppConfig;
  scoreRecords?: SimulationScoreRecord[];
}, now: string): void {
  const allowedIndustryIds = new Set(getConfiguredIndustryIds(db.config));
  const defaultIndustryIds = getConfiguredActiveIndustryIds(db.config);

  for (const demoOrg of DEMO_ENTERPRISE_ORGS) {
    const existing = db.orgs.find((org) => org.id === demoOrg.id);
    if (existing) {
      existing.contactName = demoOrg.contactName;
      existing.contactEmail = demoOrg.contactEmail;
      existing.joinCode =
        normalizeJoinCode(existing.joinCode) || normalizeJoinCode(demoOrg.id).slice(0, ORG_JOIN_CODE_LENGTH);
      existing.activeIndustries = normalizeIndustryIds(existing.activeIndustries, defaultIndustryIds, allowedIndustryIds);
      // Demo orgs use a stable established date so "renewal" and reporting are deterministic.
      existing.createdAt = demoOrg.establishedAt;
      existing.updatedAt = existing.updatedAt || existing.createdAt || demoOrg.establishedAt;
      existing.contractSignedAt = normalizeContractSignedAt(existing.contractSignedAt, demoOrg.establishedAt);
      existing.monthlyMinutesAllotted = normalizeMonthlyMinutesAllotted(
        existing.monthlyMinutesAllotted,
        deriveDefaultMonthlyMinutesAllotted(existing)
      );
      existing.renewalTotalUsd = normalizeRenewalTotalUsd(existing.renewalTotalUsd, 0);
      existing.softLimitPercentTriggers = normalizeSoftLimitPercentTriggers(existing.softLimitPercentTriggers, [75, 90]);
      existing.maxSimulationMinutes = normalizeMaxSimulationMinutes(existing.maxSimulationMinutes);
      existing.pendingPerUserDailySecondsCap = normalizeOptionalSecondsCap(existing.pendingPerUserDailySecondsCap);
      existing.pendingPerUserDailySecondsCapEffectiveAt = normalizeOptionalIsoDate(
        existing.pendingPerUserDailySecondsCapEffectiveAt
      );
      existing.customScenarios = Array.isArray(existing.customScenarios) ? existing.customScenarios : [];
      continue;
    }

    db.orgs.push({
      id: demoOrg.id,
      name: demoOrg.name,
      status: "active",
      contactName: demoOrg.contactName,
      contactEmail: demoOrg.contactEmail,
      emailDomain: null,
      joinCode: normalizeJoinCode(demoOrg.id).slice(0, ORG_JOIN_CODE_LENGTH),
      activeIndustries: normalizeIndustryIds(demoOrg.activeIndustries, defaultIndustryIds, allowedIndustryIds),
      dailySecondsQuota: db.config.enterprise.defaultOrgDailySecondsQuota,
      perUserDailySecondsCap: db.config.enterprise.defaultPerUserDailySecondsCap,
      pendingPerUserDailySecondsCap: null,
      pendingPerUserDailySecondsCapEffectiveAt: null,
      manualBonusSeconds: 0,
      contractSignedAt: demoOrg.establishedAt,
      monthlyMinutesAllotted: Math.floor((db.config.enterprise.defaultOrgDailySecondsQuota * 30) / 60),
      renewalTotalUsd: 0,
      softLimitPercentTriggers: [75, 90],
      maxSimulationMinutes: DEFAULT_MAX_SIMULATION_MINUTES,
      divisionsEnabled: false,
      customScenarios: [],
      createdAt: demoOrg.establishedAt,
      updatedAt: demoOrg.establishedAt
    });
  }

  for (const demoUser of DEMO_ENTERPRISE_USERS) {
    const duplicateById = db.users.find((user) => user.id === demoUser.id);
    const duplicateByEmail = db.users.find(
      (user) => user.email.toLowerCase() === demoUser.email.toLowerCase()
    );
    const existingUser = duplicateById ?? duplicateByEmail;
    if (existingUser) {
      existingUser.emailVerifiedAt = existingUser.emailVerifiedAt ?? existingUser.createdAt ?? now;
      existingUser.firstName = normalizeOptionalStoredUserName(existingUser.firstName);
      existingUser.lastName = normalizeOptionalStoredUserName(existingUser.lastName);
      existingUser.accountType = "enterprise";
      existingUser.tier = "enterprise";
      const normalizedEmployeeId = normalizeEmployeeIdInput(existingUser.employeeId);
      existingUser.employeeId = normalizedEmployeeId.ok ? normalizedEmployeeId.value : null;
      existingUser.managerUserId = normalizeManagerUserId(existingUser.managerUserId);
      existingUser.orgId = demoUser.orgId;
      existingUser.orgRole = demoUser.orgRole;
      existingUser.status = existingUser.status ?? "active";
      existingUser.timezone = existingUser.timezone ?? "America/New_York";
      existingUser.dailySecondsCapOverride = normalizeOptionalSecondsCap(existingUser.dailySecondsCapOverride);
      existingUser.allowDailyOverageThisCycle = existingUser.allowDailyOverageThisCycle === true;
      existingUser.dailyOverageExpiresAt = normalizeOptionalIsoDate(existingUser.dailyOverageExpiresAt);
      existingUser.dailyOverageMode = resolveStoredDailyOverageMode({
        allowed: existingUser.allowDailyOverageThisCycle,
        mode: existingUser.dailyOverageMode,
      });
      existingUser.dailyOverageStartedAt = normalizeOptionalIsoDate(existingUser.dailyOverageStartedAt);
      existingUser.dailyOverageBaseSecondsCap = normalizeOptionalSecondsCap(existingUser.dailyOverageBaseSecondsCap);
      existingUser.dailyOverageExtraSecondsGranted = normalizeOptionalSecondsCap(existingUser.dailyOverageExtraSecondsGranted);
      existingUser.updatedAt = existingUser.updatedAt || now;
      continue;
    }

    db.users.push({
      id: demoUser.id,
      email: demoUser.email,
      firstName: null,
      lastName: null,
      employeeId: null,
      managerUserId: null,
      emailVerifiedAt: now,
      accountType: "enterprise",
      tier: "enterprise",
      status: "active",
      orgId: demoUser.orgId,
      orgRole: demoUser.orgRole,
      timezone: "America/New_York",
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      dailySecondsCapOverride: null,
      allowDailyOverageThisCycle: false,
      dailyOverageExpiresAt: null,
      dailyOverageMode: null,
      dailyOverageStartedAt: null,
      dailyOverageBaseSecondsCap: null,
      dailyOverageExtraSecondsGranted: null,
      mobileProfileReonboardingRequired: false,
      createdAt: now,
      updatedAt: now
    });
  }

  const nowDate = new Date(now);
  // This legacy demo helper intentionally no longer seeds usageSessions directly. Extracted
  // usage-session storage is authoritative, so any future demo-usage seeding must go through the
  // dedicated store/access path rather than mutating db.usageSessions in memory.

  const demoScores: Array<{
    id: string;
    userId: string;
    orgId: string;
    segmentId: string;
    scenarioId: string;
    overallScore: number;
    persuasion: number;
    clarity: number;
    empathy: number;
    assertiveness: number;
    daysAgo: number;
  }> = [
    {
      id: "score_demo_people_admin_1",
      userId: "usr_demo_people_admin",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_undermining_report",
      overallScore: 82,
      persuasion: 8,
      clarity: 7,
      empathy: 8,
      assertiveness: 7,
      daysAgo: 16
    },
    {
      id: "score_demo_people_mgr_1",
      userId: "usr_demo_people_mgr",
      orgId: "org_demo_people",
      segmentId: "project_manager",
      scenarioId: "pm_team_conflict",
      overallScore: 74,
      persuasion: 7,
      clarity: 7,
      empathy: 6,
      assertiveness: 7,
      daysAgo: 12
    },
    {
      id: "score_demo_people_hr_1",
      userId: "usr_demo_people_hr",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_scope_creep_client",
      overallScore: 68,
      persuasion: 6,
      clarity: 6,
      empathy: 7,
      assertiveness: 6,
      daysAgo: 8
    },
    {
      id: "score_demo_sales_admin_1",
      userId: "usr_demo_sales_admin",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_unfixable_issue",
      overallScore: 86,
      persuasion: 8,
      clarity: 9,
      empathy: 7,
      assertiveness: 8,
      daysAgo: 14
    },
    {
      id: "score_demo_sales_rep_1",
      userId: "usr_demo_sales_rep",
      orgId: "org_demo_sales",
      segmentId: "sales_representative",
      scenarioId: "sales_discount_pushback",
      overallScore: 78,
      persuasion: 8,
      clarity: 7,
      empathy: 7,
      assertiveness: 7,
      daysAgo: 10
    },
    {
      id: "score_demo_sales_se_1",
      userId: "usr_demo_sales_se",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_repeating_questions",
      overallScore: 81,
      persuasion: 7,
      clarity: 8,
      empathy: 7,
      assertiveness: 8,
      daysAgo: 6
    },
    {
      id: "score_demo_medical_admin_1",
      userId: "usr_demo_medical_admin",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_erratic_family_member",
      overallScore: 90,
      persuasion: 8,
      clarity: 9,
      empathy: 9,
      assertiveness: 8,
      daysAgo: 15
    },
    {
      id: "score_demo_medical_nurse_1",
      userId: "usr_demo_medical_nurse",
      orgId: "org_demo_medical",
      segmentId: "nurse",
      scenarioId: "nurse_vaccine_conspiracy",
      overallScore: 76,
      persuasion: 7,
      clarity: 7,
      empathy: 8,
      assertiveness: 6,
      daysAgo: 9
    },
    {
      id: "score_demo_medical_doc_1",
      userId: "usr_demo_medical_doc",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_unsuccessful_surgery",
      overallScore: 84,
      persuasion: 7,
      clarity: 8,
      empathy: 8,
      assertiveness: 7,
      daysAgo: 5
    }
  ];

  if (!Array.isArray(db.scoreRecords)) {
    db.scoreRecords = [];
  }

  for (const score of demoScores) {
    if (db.scoreRecords.some((existing) => existing.id === score.id)) {
      continue;
    }

    const startedAt = new Date(nowDate.getTime() - score.daysAgo * 24 * 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + 6 * 60 * 1000);

    db.scoreRecords.push({
      id: score.id,
      userId: score.userId,
      orgId: score.orgId,
      segmentId: score.segmentId,
      scenarioId: score.scenarioId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      overallScore: score.overallScore,
      persuasion: score.persuasion,
      clarity: score.clarity,
      empathy: score.empathy,
      assertiveness: score.assertiveness,
      createdAt: endedAt.toISOString()
    });
  }
}

function ensureDemoSupportCases(db: { supportCases: SupportCaseRecord[] }, nowIso: string): void {
  if (!Array.isArray(db.supportCases)) {
    return;
  }

  if (db.supportCases.some((entry) => entry && typeof entry.id === "string" && entry.id.startsWith("case_demo_"))) {
    return;
  }

  const createdAt = nowIso;
  const nowMs = new Date(nowIso).getTime();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  const transcriptExpiresAt = new Date(nowMs + tenDaysMs).toISOString();

  const demoTranscript1 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Discount Pushback",
    "Segment: Sales Representative",
    "Difficulty: Medium",
    "Persona: Skeptical",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I hear you. Let me explain what the discount includes and why it is priced that way.",
    "AI: I do not understand why you cannot just match the competitor. It feels like you are stalling.",
    "User: If we matched that number, we would have to remove onboarding and support. Would that still work for you?",
    "AI: Maybe. But I need something concrete, not hypotheticals."
  ].join("\n");

  const demoTranscript2 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Conflict Between Team Members",
    "Segment: Project Manager",
    "Difficulty: Hard",
    "Persona: Frustrated",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I want to understand both perspectives. What happened from your point of view?",
    "AI: This is a waste of time. They never listen and you always take their side.",
    "User: I am not taking sides. I am going to set ground rules and we will agree on next steps today.",
    "AI: Fine. But if nothing changes, I am done."
  ].join("\n");

  const demoTranscript3 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Family Member Is Erratic And Afraid About Low Risk Procedure",
    "Segment: Doctor",
    "Difficulty: Easy",
    "Persona: Defensive",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I can see how scary this feels. Let me walk you through what will happen step by step.",
    "AI: You are not listening. People die from this. Why are you minimizing it?",
    "User: I am not minimizing it. I am taking it seriously and I will answer every question you have.",
    "AI: Okay... I just need to understand the risks."
  ].join("\n");

  db.supportCases.push(
    {
      id: "case_demo_1",
      status: "open",
      userId: "usr_demo_sales_rep",
      orgId: "org_demo_sales",
      segmentId: "sales_representative",
      scenarioId: "sales_discount_pushback",
      message: "Score felt too harsh. The assistant kept changing the requirements mid-call.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript1),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-1.txt",
      transcriptMeta: {
        scenarioTitle: "Discount Pushback",
        segmentLabel: "Sales Representative",
        difficulty: "medium",
        personaStyle: "skeptical",
        startedAt: new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 3 * 24 * 60 * 60 * 1000 + 9 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "case_demo_2",
      status: "open",
      userId: "usr_demo_people_mgr",
      orgId: "org_demo_people",
      segmentId: "project_manager",
      scenarioId: "pm_team_conflict",
      message: "Audio cut out mid-turn and the response didn't match what I said.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript2),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-2.txt",
      transcriptMeta: {
        scenarioTitle: "Conflict Between Team Members",
        segmentLabel: "Project Manager",
        difficulty: "hard",
        personaStyle: "frustrated",
        startedAt: new Date(nowMs - 5 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 5 * 24 * 60 * 60 * 1000 + 7 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "case_demo_3",
      status: "closed",
      userId: "usr_demo_medical_doc",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_erratic_family_member",
      message: "The assistant was fine, but the score summary mentioned details I didn't say. Please review.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript3),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-3.txt",
      transcriptMeta: {
        scenarioTitle: "Family Member Is Erratic And Afraid About Low Risk Procedure",
        segmentLabel: "Doctor",
        difficulty: "easy",
        personaStyle: "defensive",
        startedAt: new Date(nowMs - 9 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 9 * 24 * 60 * 60 * 1000 + 6 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    }
  );
}

function purgeDemoSeedData(db: ApiDatabase): void {
  const demoOrgIds = new Set(
    db.orgs
      .filter((org) => hasPrefixedId(org.id, "org_demo_") || org.id === "org_starter")
      .map((org) => org.id)
  );

  const demoUserIds = new Set(
    db.users
      .filter(
        (user) => hasPrefixedId(user.id, "usr_demo_") || (user.orgId !== null && demoOrgIds.has(user.orgId))
      )
      .map((user) => user.id)
  );

  db.orgs = db.orgs.filter((org) => !demoOrgIds.has(org.id));
  db.users = db.users.filter(
    (user) => !demoUserIds.has(user.id) && (user.orgId === null || !demoOrgIds.has(user.orgId))
  );
  db.orgTrainings = db.orgTrainings.filter((training) => !demoOrgIds.has(training.orgId));
  const remainingTrainingIds = new Set(db.orgTrainings.map((training) => training.id));
  db.orgTrainingPackAttachments = db.orgTrainingPackAttachments.filter(
    (attachment) => !demoOrgIds.has(attachment.orgId) && remainingTrainingIds.has(attachment.trainingId)
  );
  db.orgTrainingScenarioAttachments = db.orgTrainingScenarioAttachments.filter(
    (attachment) => !demoOrgIds.has(attachment.orgId) && remainingTrainingIds.has(attachment.trainingId)
  );

  // Legacy compatibility only: extracted usageSessions are authoritative. This cleanup exists so
  // pre-extraction app-state snapshots cannot reintroduce demo sessions during boot migration.
  db.usageSessions = db.usageSessions.filter(
    (session) =>
      !hasPrefixedId(session.id, "sess_demo_") &&
      !demoUserIds.has(session.userId) &&
      (session.orgId === null || !demoOrgIds.has(session.orgId))
  );

  if (Array.isArray(db.scoreRecords)) {
    db.scoreRecords = db.scoreRecords.filter(
      (record) =>
        !hasPrefixedId(record.id, "score_demo_") &&
        !demoUserIds.has(record.userId) &&
        (record.orgId === null || !demoOrgIds.has(record.orgId))
    );
  }

  if (Array.isArray(db.aiUsageEvents)) {
    db.aiUsageEvents = db.aiUsageEvents.filter(
      (event) => !demoUserIds.has(event.userId) && (event.orgId === null || !demoOrgIds.has(event.orgId))
    );
  }

  if (Array.isArray(db.auditEvents)) {
    db.auditEvents = db.auditEvents.filter(
      (event) =>
        (event.userId === null || !demoUserIds.has(event.userId)) &&
        (event.orgId === null || !demoOrgIds.has(event.orgId)) &&
        (event.actorType !== "mobile_user" || event.actorId === null || !demoUserIds.has(event.actorId))
    );
  }

  if (Array.isArray(db.supportCases)) {
    db.supportCases = db.supportCases.filter(
      (row) =>
        !hasPrefixedId(row.id, "case_demo_") &&
        !demoUserIds.has(row.userId) &&
        (row.orgId === null || !demoOrgIds.has(row.orgId))
    );
  }

  db.mobileAuthTokens = db.mobileAuthTokens.filter((row) => !demoUserIds.has(row.userId));
  db.emailVerifications = db.emailVerifications.filter((row) => !demoUserIds.has(row.userId));
  db.enterpriseJoinRequests = db.enterpriseJoinRequests.filter(
    (row) => !demoUserIds.has(row.userId) && !demoOrgIds.has(row.orgId)
  );
}

function mergeScenariosWithDefaults(
  existing: Scenario[],
  defaults: Scenario[],
  segmentId: string
): Scenario[] {
  const existingById = new Map(existing.map((scenario) => [scenario.id, scenario]));
  const defaultScenarioIds = new Set(defaults.map((scenario) => scenario.id));

  const mergedDefaults = defaults.map((defaultScenario) => {
    const current = existingById.get(defaultScenario.id);
    if (!current) {
      return defaultScenario;
    }

    return {
      ...defaultScenario,
      ...current,
      id: defaultScenario.id,
      segmentId
    };
  });

  const customScenarios = existing
    .filter((scenario) => !defaultScenarioIds.has(scenario.id))
    .map((scenario) => ({ ...scenario, segmentId }));

  return sortScenariosByTitle(
    [...mergedDefaults, ...customScenarios]
      .map((scenario, index) => normalizeScenarioEntry(scenario, segmentId, index))
      .filter((scenario): scenario is Scenario => Boolean(scenario))
  );
}

function mergeSegmentsWithDefaults(
  existing: SegmentDefinition[],
  defaults: SegmentDefinition[]
): SegmentDefinition[] {
  const existingById = new Map(existing.map((segment) => [segment.id, segment]));
  const defaultSegmentIds = new Set(defaults.map((segment) => segment.id));

  const mergedDefaults = defaults.map((defaultSegment) => {
    const current = existingById.get(defaultSegment.id);
    if (!current) {
      return defaultSegment;
    }

    return {
      ...defaultSegment,
      ...current,
      id: defaultSegment.id,
      scenarios: mergeScenariosWithDefaults(current.scenarios ?? [], defaultSegment.scenarios, defaultSegment.id)
    };
  });

  const customSegments = existing
    .filter((segment) => !defaultSegmentIds.has(segment.id))
    .map((segment) => ({
      ...segment,
      scenarios: sortScenariosByTitle(
        (segment.scenarios ?? [])
          .map((scenario, index) => normalizeScenarioEntry({ ...scenario, segmentId: segment.id }, segment.id, index))
          .filter((scenario): scenario is Scenario => Boolean(scenario))
      )
    }));

  return [...mergedDefaults, ...customSegments];
}

function createJoinCodeSeed(input: string): string {
  const cleaned = normalizeJoinCode(input);
  return cleaned || "ORG";
}

function generateUniqueJoinCode(existingCodes: Set<string>, seed: string): string {
  const base = createJoinCodeSeed(seed);
  let candidate = base.slice(0, ORG_JOIN_CODE_LENGTH);
  if (candidate.length < ORG_JOIN_CODE_LENGTH) {
    candidate = (candidate + "ABCDEFGH").slice(0, ORG_JOIN_CODE_LENGTH);
  }

  if (!existingCodes.has(candidate)) {
    existingCodes.add(candidate);
    return candidate;
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, ORG_JOIN_CODE_LENGTH);
    if (!existingCodes.has(suffix)) {
      existingCodes.add(suffix);
      return suffix;
    }
  }

  const fallback = crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, ORG_JOIN_CODE_LENGTH);
  existingCodes.add(fallback);
  return fallback;
}

function ensureOrgJoinCodes(orgs: EnterpriseOrg[]): EnterpriseOrg[] {
  const existingCodes = new Set<string>();
  return orgs.map((org) => {
    const requestedCode = normalizeJoinCode(org.joinCode);
    const joinCode = requestedCode && !existingCodes.has(requestedCode)
      ? (existingCodes.add(requestedCode), requestedCode)
      : generateUniqueJoinCode(existingCodes, org.id || org.name || org.contactEmail);

    return {
      ...org,
      joinCode
    };
  });
}

function expireOrgJoinRequests(db: { enterpriseJoinRequests?: EnterpriseJoinRequestRecord[] }, now: Date): void {
  const list = db.enterpriseJoinRequests;
  if (!Array.isArray(list) || list.length === 0) {
    return;
  }

  const nowMs = now.getTime();
  for (const row of list) {
    if (row.status !== "pending") {
      continue;
    }

    const expiresMs = new Date(row.expiresAt).getTime();
    if (Number.isNaN(expiresMs) || expiresMs > nowMs) {
      continue;
    }

    row.status = "expired";
    row.updatedAt = now.toISOString();
    row.decidedAt = now.toISOString();
    row.decidedByUserId = null;
    row.decisionReason = "Request expired after 7 days.";
  }
}

function ensureDatabaseShape(raw: unknown): ApiDatabase {
  const fallback = createDefaultDatabase();
  const candidate = (raw ?? {}) as Partial<ApiDatabase>;
  const now = nowIso();

  const configCandidate = candidate.config;
  const mergedSegmentsWithDefaults = mergeSegmentsWithDefaults(
    Array.isArray(configCandidate?.segments) && configCandidate.segments.length > 0
      ? configCandidate.segments
      : DEFAULT_SEGMENTS,
    DEFAULT_SEGMENTS
  );
  const mergedSegments = normalizeSegmentDefinitions(mergedSegmentsWithDefaults, DEFAULT_SEGMENTS);
  const mergedIndustries = normalizeIndustryDefinitions(
    configCandidate?.industries,
    fallback.config.industries ?? DEFAULT_INDUSTRIES
  );
  const mergedRoleIndustries = normalizeRoleIndustryDefinitions(
    configCandidate?.roleIndustries,
    mergedIndustries,
    mergedSegments,
    fallback.config.roleIndustries ?? DEFAULT_ROLE_INDUSTRIES
  );

  const candidateActiveSegmentId =
    configCandidate?.activeSegmentId && typeof configCandidate.activeSegmentId === "string"
      ? configCandidate.activeSegmentId
      : fallback.config.activeSegmentId;
  const resolvedActiveSegmentId =
    mergedSegments.some((segment) => segment.id === candidateActiveSegmentId && segment.enabled) &&
    candidateActiveSegmentId
      ? candidateActiveSegmentId
      : mergedSegments.find((segment) => segment.enabled)?.id ?? fallback.config.activeSegmentId;

  const config: AppConfig = {
    activeSegmentId: resolvedActiveSegmentId,
    defaultDifficulty: configCandidate?.defaultDifficulty ?? fallback.config.defaultDifficulty,
    defaultPersonaStyle: configCandidate?.defaultPersonaStyle ?? fallback.config.defaultPersonaStyle,
    industries: mergedIndustries,
    roleIndustries: mergedRoleIndustries,
    segments: mergedSegments,
    tiers:
      Array.isArray(configCandidate?.tiers) && configCandidate?.tiers.length > 0
        ? configCandidate.tiers
        : DEFAULT_TIER_DEFINITIONS,
    enterprise: {
      visibleInApp: configCandidate?.enterprise?.visibleInApp ?? fallback.config.enterprise.visibleInApp,
      contactEmail: configCandidate?.enterprise?.contactEmail ?? fallback.config.enterprise.contactEmail,
      contactUrl: configCandidate?.enterprise?.contactUrl ?? fallback.config.enterprise.contactUrl,
      defaultOrgDailySecondsQuota:
        configCandidate?.enterprise?.defaultOrgDailySecondsQuota ??
        fallback.config.enterprise.defaultOrgDailySecondsQuota,
      defaultPerUserDailySecondsCap:
        configCandidate?.enterprise?.defaultPerUserDailySecondsCap ??
        fallback.config.enterprise.defaultPerUserDailySecondsCap,
      allowManualBonusSeconds:
        configCandidate?.enterprise?.allowManualBonusSeconds ??
        fallback.config.enterprise.allowManualBonusSeconds
    },
    featureFlags: {
      scoringEnabled:
        configCandidate?.featureFlags?.scoringEnabled ?? fallback.config.featureFlags.scoringEnabled,
      customScenarioBuilder:
        configCandidate?.featureFlags?.customScenarioBuilder ??
        fallback.config.featureFlags.customScenarioBuilder
    },
    updatedAt: configCandidate?.updatedAt || now
  };

  const configuredIndustryIds = new Set(getConfiguredIndustryIds(config));
  const fallbackOrgIndustryIds = getConfiguredActiveIndustryIds(config);

  const normalizedOrgs = ensureOrgJoinCodes(
    (Array.isArray(candidate.orgs) && candidate.orgs.length > 0 ? candidate.orgs : fallback.orgs)
      .map((org) => {
        const normalizedOrg = ensureOrgContractFields({
          ...org,
          contactName: normalizeContactName((org as Partial<EnterpriseOrg>).contactName),
          contactEmail: normalizeContactEmail((org as Partial<EnterpriseOrg>).contactEmail),
          activeIndustries: normalizeIndustryIds(
            (org as Partial<EnterpriseOrg>).activeIndustries,
            fallbackOrgIndustryIds,
            configuredIndustryIds
          )
        } as EnterpriseOrg);

        return {
          ...normalizedOrg,
          customScenarios: normalizeOrgCustomScenarioList(
            (org as Partial<EnterpriseOrg>).customScenarios,
            normalizedOrg.id,
            now
          )
        };
      })
  );
  const validOrgIds = new Set(normalizedOrgs.map((org) => org.id));
  const normalizedOrgDivisions = normalizeOrgDivisionRecords(
    (candidate as Partial<ApiDatabase>).orgDivisions,
    validOrgIds,
    now
  );
  const activeDivisionIdsByOrg = new Map<string, Set<string>>();
  for (const division of normalizedOrgDivisions) {
    if (!division.active) {
      continue;
    }
    const divisionIds = activeDivisionIdsByOrg.get(division.orgId) ?? new Set<string>();
    divisionIds.add(division.id);
    activeDivisionIdsByOrg.set(division.orgId, divisionIds);
  }

  const normalizedUsers: UserProfile[] = (Array.isArray(candidate.users) ? candidate.users : fallback.users).map((user) => {
    const candidateUser = user as Partial<UserProfile>;
    const normalizedDivisionId =
      typeof candidateUser.divisionId === "string" ? candidateUser.divisionId.trim() : null;
    const activeDivisionIds =
      candidateUser.accountType === "enterprise" && typeof candidateUser.orgId === "string"
        ? activeDivisionIdsByOrg.get(candidateUser.orgId)
        : null;

    return {
      ...user,
      firstName: normalizeOptionalStoredUserName(candidateUser.firstName),
      lastName: normalizeOptionalStoredUserName(candidateUser.lastName),
      employeeId: (() => {
        const normalizedEmployeeId = normalizeEmployeeIdInput(candidateUser.employeeId);
        return normalizedEmployeeId.ok ? normalizedEmployeeId.value : null;
      })(),
      managerUserId:
        candidateUser.accountType === "enterprise" ? normalizeManagerUserId(candidateUser.managerUserId) : null,
      isPlatformAdmin: candidateUser.isPlatformAdmin === true,
      isSuperUser: candidateUser.isSuperUser === true,
      dashboardAccessEnabled: candidateUser.accountType === "enterprise" ? candidateUser.dashboardAccessEnabled === true : false,
      mobileProfileReonboardingRequired:
        candidateUser.accountType === "enterprise" ? candidateUser.mobileProfileReonboardingRequired === true : false,
      manualBonusSeconds: clampNonNegativeInteger(candidateUser.manualBonusSeconds, 0),
      emailVerifiedAt:
        typeof candidateUser.emailVerifiedAt === "string" || candidateUser.emailVerifiedAt === null
          ? (candidateUser.emailVerifiedAt as string | null)
          : candidateUser.createdAt ?? now,
      dailySecondsCapOverride: normalizeOptionalSecondsCap(candidateUser.dailySecondsCapOverride),
      allowDailyOverageThisCycle: candidateUser.allowDailyOverageThisCycle === true,
      dailyOverageExpiresAt: normalizeOptionalIsoDate(candidateUser.dailyOverageExpiresAt),
      dailyOverageMode: resolveStoredDailyOverageMode({
        allowed: candidateUser.allowDailyOverageThisCycle === true,
        mode: candidateUser.dailyOverageMode,
      }),
      dailyOverageStartedAt: normalizeOptionalIsoDate(candidateUser.dailyOverageStartedAt),
      dailyOverageBaseSecondsCap: normalizeOptionalSecondsCap(candidateUser.dailyOverageBaseSecondsCap),
      dailyOverageExtraSecondsGranted: normalizeOptionalSecondsCap(candidateUser.dailyOverageExtraSecondsGranted),
      divisionId:
        candidateUser.accountType === "enterprise" &&
        typeof candidateUser.orgId === "string" &&
        normalizedDivisionId &&
        activeDivisionIds?.has(normalizedDivisionId)
          ? normalizedDivisionId
          : null,
      orgRole: candidateUser.accountType === "enterprise" ? normalizeOrgUserRole(candidateUser.orgRole) : "user"
    };
  });
  repairInvalidManagerAssignments(normalizedUsers, now);
  const normalizedOrgTrainings = normalizeOrgTrainingRecords(
    (candidate as Partial<ApiDatabase>).orgTrainings,
    validOrgIds,
    now
  ).map((training) => ({
    ...training,
    divisionId: activeDivisionIdsByOrg.get(training.orgId)?.has(training.divisionId ?? "") ? training.divisionId ?? null : null
  }));
  const validTrainingIds = new Set(normalizedOrgTrainings.map((training) => training.id));
  const validStandardScenarioIds = new Set(
    config.segments.flatMap((segment) => (segment.scenarios ?? []).map((scenario) => scenario.id))
  );
  const normalizedOrgStandardScenarioDivisionAssignments = normalizeOrgStandardScenarioDivisionAssignments(
    (candidate as Partial<ApiDatabase>).orgStandardScenarioDivisionAssignments,
    validOrgIds,
    new Set(normalizedOrgDivisions.filter((division) => division.active).map((division) => division.id)),
    validStandardScenarioIds,
    now
  );
  const normalizedOrgTrainingPackAttachments = normalizeOrgTrainingPackAttachments(
    (candidate as Partial<ApiDatabase>).orgTrainingPackAttachments,
    validOrgIds,
    validTrainingIds,
    now
  );
  const normalizedOrgTrainingScenarioAttachments = normalizeOrgTrainingScenarioAttachments(
    (candidate as Partial<ApiDatabase>).orgTrainingScenarioAttachments,
    validOrgIds,
    validTrainingIds,
    now
  );
  const legacySupportCases = Array.isArray((candidate as Partial<ApiDatabase>).supportCases)
    ? (candidate as Partial<ApiDatabase>).supportCases ?? []
    : null;
  const legacyAiUsageEvents = Array.isArray((candidate as Partial<ApiDatabase>).aiUsageEvents)
    ? (candidate as Partial<ApiDatabase>).aiUsageEvents ?? []
    : null;
  const legacyScoreRecords = Array.isArray((candidate as Partial<ApiDatabase>).scoreRecords)
    ? (candidate as Partial<ApiDatabase>).scoreRecords ?? []
    : null;

  const normalized: ApiDatabase = {
    config,
    users: normalizedUsers,
    orgs: normalizedOrgs,
    orgDivisions: normalizedOrgDivisions,
    orgTrainings: normalizedOrgTrainings,
    orgTrainingPackAttachments: normalizedOrgTrainingPackAttachments,
    orgTrainingScenarioAttachments: normalizedOrgTrainingScenarioAttachments,
    orgStandardScenarioDivisionAssignments: normalizedOrgStandardScenarioDivisionAssignments,
    trainingPackAssignments: Array.isArray((candidate as Partial<ApiDatabase>).trainingPackAssignments)
      ? ((candidate as Partial<ApiDatabase>).trainingPackAssignments ?? []).map((assignment) => ({
          ...assignment,
          active: assignment.active !== false,
          assignedByUserId:
            typeof assignment.assignedByUserId === "string" || assignment.assignedByUserId === null
              ? assignment.assignedByUserId
              : null,
          requiredScenarioIds: Array.isArray(assignment.requiredScenarioIds)
            ? assignment.requiredScenarioIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            : [],
          completionRule: assignment.completionRule ?? "scored_required_scenarios_v1",
          startedAt: normalizeOptionalIsoDate(assignment.startedAt),
          completedAt: normalizeOptionalIsoDate(assignment.completedAt)
        }))
      : [],
    // Legacy compatibility field only. Dedicated usage-session storage becomes authoritative after
    // boot migration, but the in-memory shape stays stable for helpers/tests that still expect it.
    usageSessions: Array.isArray(candidate.usageSessions) ? candidate.usageSessions : fallback.usageSessions,
    auditEvents: Array.isArray((candidate as Partial<ApiDatabase>).auditEvents)
      ? (candidate as Partial<ApiDatabase>).auditEvents ?? []
      : undefined,
    mobileAuthTokens:
      Array.isArray(candidate.mobileAuthTokens) ? candidate.mobileAuthTokens : fallback.mobileAuthTokens,
    accountDeletionReceipts: Array.isArray(candidate.accountDeletionReceipts)
      ? candidate.accountDeletionReceipts.filter((entry): entry is AccountDeletionReceipt => (
          Boolean(entry)
          && typeof entry.tokenHash === "string"
          && entry.tokenHash.length === 64
          && typeof entry.userIdHash === "string"
          && entry.userIdHash.length === 64
          && typeof entry.createdAt === "string"
          && Number.isFinite(new Date(entry.createdAt).getTime())
          && typeof entry.expiresAt === "string"
          && Number.isFinite(new Date(entry.expiresAt).getTime())
        ))
      : [],
    emailVerifications: Array.isArray(candidate.emailVerifications)
      ? candidate.emailVerifications
      : fallback.emailVerifications,
    webAuthChallenges:
      Array.isArray((candidate as Partial<ApiDatabase>).webAuthChallenges)
        ? (candidate as Partial<ApiDatabase>).webAuthChallenges ?? []
        : [],
    webAuthSessions:
      Array.isArray((candidate as Partial<ApiDatabase>).webAuthSessions)
        ? (candidate as Partial<ApiDatabase>).webAuthSessions ?? []
        : undefined,
    enterpriseJoinRequests: Array.isArray(candidate.enterpriseJoinRequests)
      ? candidate.enterpriseJoinRequests
      : fallback.enterpriseJoinRequests,
    appStateMigrations:
      candidate.appStateMigrations && typeof candidate.appStateMigrations === "object" && !Array.isArray(candidate.appStateMigrations)
        ? Object.fromEntries(
            Object.entries(candidate.appStateMigrations).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0
            )
          )
        : {},
    admin: {
      passwordHash:
        candidate.admin && typeof candidate.admin.passwordHash === "string"
          ? candidate.admin.passwordHash
          : null,
      activeSessionIds:
        candidate.admin && Array.isArray(candidate.admin.activeSessionIds)
          ? candidate.admin.activeSessionIds
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter((entry) => entry.length > 0)
              .slice(-MAX_ACTIVE_ADMIN_SESSIONS)
          : []
    }
  };
  if (legacyAiUsageEvents) {
    normalized.aiUsageEvents = legacyAiUsageEvents;
  }
  if (legacyScoreRecords) {
    normalized.scoreRecords = legacyScoreRecords;
  }
  if (legacySupportCases) {
    normalized.supportCases = legacySupportCases;
  }

  purgeDemoSeedData(normalized);
  purgeExpiredSupportTranscripts(normalized, now);
  expireOrgJoinRequests(normalized, new Date(now));
  return normalized;
}

let databaseStorage: DatabaseStorage | null = null;
let databaseCache: ApiDatabase | null = null;
let databaseOperationQueue: Promise<void> = Promise.resolve();
let isDatabaseReady = false;
let databaseReadyCheckedAt: string | null = null;
let databaseReadyError: string | null = null;
let databaseReadyConsecutiveFailures = 0;
let isReadinessRefreshInFlight = false;
let lastReadinessLoggedError: string | null = null;

function getOrCreateDatabaseStorage(): DatabaseStorage {
  if (!databaseStorage) {
    databaseStorage = createDatabaseStorage({
      provider: STORAGE_PROVIDER,
      dbPath: DB_PATH,
      databaseUrl: DATABASE_URL,
      pgPoolMax: PG_POOL_MAX,
      pgConnectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
      pgIdleTimeoutMs: PG_IDLE_TIMEOUT_MS,
      ensureDatabaseShape,
      createDefaultDatabase
    });
  }

  return databaseStorage;
}

async function loadDatabase(options?: { forceStorageRead?: boolean }): Promise<ApiDatabase> {
  if (!options?.forceStorageRead && databaseCache) {
    return databaseCache;
  }

  const storage = getOrCreateDatabaseStorage();
  const loaded = await storage.load();
  await userEmployeeIdClaimStore.syncFromUsers(loaded.users);
  databaseCache = loaded;
  return loaded;
}

function buildPersistedDatabaseSnapshot(db: ApiDatabase): ApiDatabase {
  const snapshot = { ...db };
  delete (snapshot as Partial<ApiDatabase>).usageSessions;
  delete (snapshot as Partial<ApiDatabase>).aiUsageEvents;
  delete (snapshot as Partial<ApiDatabase>).scoreRecords;
  delete (snapshot as Partial<ApiDatabase>).webAuthSessions;
  delete (snapshot as Partial<ApiDatabase>).auditEvents;
  delete (snapshot as Partial<ApiDatabase>).supportCases;
  return snapshot;
}

async function saveDatabase(db: ApiDatabase): Promise<void> {
  const storage = getOrCreateDatabaseStorage();
  await userEmployeeIdClaimStore.syncFromUsers(db.users);
  await storage.save(buildPersistedDatabaseSnapshot(db));
  databaseCache = db;
}

async function migrateUserProfileAppStateNormalization(): Promise<void> {
  await withDatabaseLock(async () => {
    const storage = getOrCreateDatabaseStorage();
    await migrateUserProfileAppStateNormalizationState({
      storage,
      ensureDatabaseShape,
      buildPersistedDatabaseSnapshot,
      syncEmployeeIds: async (users) => {
        await userEmployeeIdClaimStore.syncFromUsers(users);
      }
    });
    const loaded = await storage.load();
    await userEmployeeIdClaimStore.syncFromUsers(loaded.users);
    databaseCache = loaded;
  });
}

async function withDatabaseLock<T>(runner: () => Promise<T>): Promise<T> {
  let releaseLock: () => void = () => {};
  const waitForTurn = databaseOperationQueue;
  databaseOperationQueue = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  await waitForTurn;
  try {
    return await runner();
  } finally {
    releaseLock();
  }
}

async function withDatabaseRead<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  return await withDatabaseLock(async () => {
    const db = await loadDatabase();
    return await handler(db);
  });
}

async function withFreshDatabaseRead<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  return await withDatabaseLock(async () => {
    const db = await loadDatabase({ forceStorageRead: true });
    return await handler(db);
  });
}

async function refreshReportingSnapshots(): Promise<void> {
  await usageSessionStore.refreshSnapshot();
  await scoreRecordStore.refreshSnapshot();
}

async function withFreshReportingRead<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  return await withDatabaseLock(async () => {
    await refreshReportingSnapshots();
    const db = await loadDatabase({ forceStorageRead: true });
    return await handler(db);
  });
}

async function withFreshReportingWrite<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  const completed = await withDatabaseLock(async () => {
    await refreshReportingSnapshots();
    const db = await loadDatabase({ forceStorageRead: true });
    try {
      const result = await handler(db);
      const pendingAuditEvents = drainPendingAuditEvents(db);
      if (pendingAuditEvents.length > 0) {
        await auditEventStore.appendEvents(pendingAuditEvents, { maxRecords: MAX_AUDIT_EVENTS });
      }
      await saveDatabase(db);
      return {
        result,
        postCommitEffects: pendingPostCommitEffectsByDb.drain(db)
      };
    } catch (error) {
      drainPendingAuditEvents(db);
      pendingPostCommitEffectsByDb.discard(db);
      throw error;
    }
  });

  await runDatabasePostCommitEffects(completed.postCommitEffects);
  return completed.result;
}

async function withDatabaseWrite<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  const completed = await withDatabaseLock(async () => {
    const db = await loadDatabase();
    try {
      const result = await handler(db);
      const pendingAuditEvents = drainPendingAuditEvents(db);
      if (pendingAuditEvents.length > 0) {
        await auditEventStore.appendEvents(pendingAuditEvents, { maxRecords: MAX_AUDIT_EVENTS });
      }
      await saveDatabase(db);
      return {
        result,
        postCommitEffects: pendingPostCommitEffectsByDb.drain(db)
      };
    } catch (error) {
      drainPendingAuditEvents(db);
      pendingPostCommitEffectsByDb.discard(db);
      throw error;
    }
  });

  /**
   * Cross-store sequencing policy:
   * 1. Primary app-state mutations and authoritative extracted-store writes happen inside the handler.
   * 2. Secondary audit events are flushed before the monolithic app-state save.
   * 3. Fail-closed revocations and orphan cleanup run only after the primary save succeeds, outside the lock.
   */
  await runDatabasePostCommitEffects(completed.postCommitEffects);
  return completed.result;
}

const withDatabase = withDatabaseWrite;

async function migrateLegacyAuditEventsFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "auditEvents")) {
      return;
    }

    const legacyAuditEvents = Array.isArray(db.auditEvents) ? db.auditEvents : [];
    const migration = await auditEventStore.importLegacyEvents(legacyAuditEvents, {
      maxRecords: MAX_AUDIT_EVENTS
    });
    delete (db as Partial<ApiDatabase>).auditEvents;
    await saveDatabase(db);

    if (legacyAuditEvents.length > 0 || migration.trimmedCount > 0) {
      logWarn(
        `[audit][migration] moved ${migration.importedCount} legacy events to dedicated storage; `
        + `trimmed ${migration.trimmedCount} events beyond the ${MAX_AUDIT_EVENTS} record cap.`
      );
    }
  });
}

async function migrateLegacyAiUsageEventsFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "aiUsageEvents")) {
      return;
    }

    const legacyAiUsageEvents = Array.isArray(db.aiUsageEvents) ? db.aiUsageEvents : [];
    const migration = await aiUsageEventStore.importLegacyEvents(legacyAiUsageEvents, { now: new Date() });
    delete (db as Partial<ApiDatabase>).aiUsageEvents;
    await saveDatabase(db);

    if (legacyAiUsageEvents.length > 0 || migration.prunedCount > 0) {
      logWarn(
        `[ai-usage][migration] moved ${migration.importedCount} legacy AI usage events to dedicated storage; `
        + `pruned ${migration.prunedCount} events outside the retention window.`
      );
    }
  });
}

async function migrateLegacyUsageSessionsFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "usageSessions")) {
      return;
    }

    const legacyUsageSessions = Array.isArray(db.usageSessions) ? db.usageSessions : [];
    const migration = await usageSessionStore.importLegacyRecords(legacyUsageSessions);
    delete (db as Partial<ApiDatabase>).usageSessions;
    await saveDatabase(db);

    if (legacyUsageSessions.length > 0) {
      logWarn(
        `[usage-sessions][migration] moved ${migration.importedCount} legacy usage sessions to dedicated storage.`
      );
    }
  });
}

async function migrateLegacyScoreRecordsFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "scoreRecords")) {
      return;
    }

    const legacyScoreRecords = Array.isArray(db.scoreRecords) ? db.scoreRecords : [];
    const migration = await scoreRecordStore.importLegacyRecords(legacyScoreRecords);
    delete (db as Partial<ApiDatabase>).scoreRecords;
    await saveDatabase(db);

    if (legacyScoreRecords.length > 0) {
      logWarn(
        `[score-records][migration] moved ${migration.importedCount} legacy score records to dedicated storage.`
      );
    }
  });
}

async function migrateLegacyWebAuthSessionsFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "webAuthSessions")) {
      return;
    }

    const legacySessions = Array.isArray(db.webAuthSessions) ? db.webAuthSessions : [];
    const migration = await webAuthSessionStore.importLegacySessions(legacySessions, { now: new Date() });
    delete (db as Partial<ApiDatabase>).webAuthSessions;
    await saveDatabase(db);

    if (legacySessions.length > 0 || migration.skippedExpiredCount > 0) {
      logWarn(
        `[web-auth][migration] moved ${migration.importedCount} legacy sessions to dedicated storage; `
        + `skipped ${migration.skippedExpiredCount} expired sessions.`
      );
    }
  });
}

async function migrateLegacySupportCasesFromAppState(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    if (!Object.prototype.hasOwnProperty.call(db, "supportCases")) {
      return;
    }

    const legacySupportCases = Array.isArray(db.supportCases) ? db.supportCases : [];
    const migration = await supportCaseStore.importLegacyCases(legacySupportCases, { now: new Date() });
    delete (db as Partial<ApiDatabase>).supportCases;
    await saveDatabase(db);

    if (legacySupportCases.length > 0) {
      logWarn(
        `[support][migration] moved ${migration.importedCount} legacy support cases to dedicated storage.`
      );
    }
  });
}

async function runStartupUsageIntegrityMaintenance(): Promise<void> {
  await withDatabaseLock(async () => {
    const db = await loadDatabase();
    const orphanRepair = await repairOrphanedUserScopedHistory({
      db,
      usageSessionAccess,
      simulationSessionStore,
      scoreRecordAccess,
      aiUsageEventAccess,
      supportCaseStore
    });
    const staleSessionPrune = await pruneStaleRecognizedSimulationSessions({
      simulationSessionStore,
      now: new Date()
    });

    const hasOrphanRepair =
      orphanRepair.orphanedUsageSessionsDeleted > 0
      || orphanRepair.orphanedSimulationSessionsDeleted > 0
      || orphanRepair.orphanedScoreRecordsDeleted > 0
      || orphanRepair.orphanedAiUsageEventsDeleted > 0
      || orphanRepair.orphanedSupportCasesDeleted > 0
      || orphanRepair.invalidTrainingPackAssignmentsDeactivated > 0;
    if (hasOrphanRepair) {
      logWarn(
        `[integrity][startup] cleaned invalid user-scoped history `
        + `(usage=${orphanRepair.orphanedUsageSessionsDeleted}, `
        + `recognized_sessions=${orphanRepair.orphanedSimulationSessionsDeleted}, `
        + `scores=${orphanRepair.orphanedScoreRecordsDeleted}, `
        + `ai_usage=${orphanRepair.orphanedAiUsageEventsDeleted}, `
        + `support=${orphanRepair.orphanedSupportCasesDeleted}, `
        + `assignments=${orphanRepair.invalidTrainingPackAssignmentsDeactivated}).`
      );
    }

    if (staleSessionPrune.prunedStartedSessions > 0) {
      logWarn(
        `[integrity][startup] pruned ${staleSessionPrune.prunedStartedSessions} stale started simulation sessions `
        + `last seen before ${staleSessionPrune.cutoffAt}.`
      );
    }
  });
}

async function revokeWebAuthSessionById(sessionId: string): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return;
  }

  await webAuthSessionStore.revokeSession(normalizedSessionId);
}

async function revokeWebAuthSessionsForUserId(userId: string): Promise<void> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  await webAuthSessionStore.revokeUserSessions(normalizedUserId);
}

async function revokeWebAuthSessionsForUserIds(userIds: string[]): Promise<void> {
  await webAuthSessionStore.revokeSessionsForUsers(userIds);
}

async function refreshDatabaseReadiness(): Promise<void> {
  const wasReady = isDatabaseReady;
  try {
    await initializeDatabaseStoresForReadiness({
      stores: {
        auditEventStore,
        aiUsageEventStore,
        simulationSessionStore,
        usageSessionStore,
        scoreRecordStore,
        supportCaseStore,
        webAuthSessionStore,
        performancePlanStore,
        userEmployeeIdClaimStore,
        orgModuleEntitlementStore,
        trainingContentStore,
        trainingContentAssetStore
      },
      loadDatabase: async () => {
        await loadDatabase({ forceStorageRead: true });
      },
      migrateUserProfileAppStateNormalization
    });
    isDatabaseReady = true;
    databaseReadyError = null;
    databaseReadyConsecutiveFailures = 0;
    lastReadinessLoggedError = null;
    if (!wasReady) {
      logWarn("[readiness] database connectivity restored.");
    }
  } catch (error) {
    databaseReadyError = error instanceof Error ? error.message : String(error);
    databaseReadyConsecutiveFailures += 1;
    if (!isDatabaseReady || databaseReadyConsecutiveFailures >= READINESS_FAILURE_THRESHOLD) {
      isDatabaseReady = false;
    }
    const shouldLog =
      databaseReadyConsecutiveFailures === 1 ||
      databaseReadyConsecutiveFailures % READINESS_FAILURE_THRESHOLD === 0 ||
      databaseReadyError !== lastReadinessLoggedError;
    if (shouldLog) {
      logWarn(
        `[readiness] database unavailable (${databaseReadyConsecutiveFailures}/${READINESS_FAILURE_THRESHOLD}): ${databaseReadyError}`
      );
      lastReadinessLoggedError = databaseReadyError;
    }
  } finally {
    databaseReadyCheckedAt = nowIso();
  }
}

function queueDatabaseReadinessRefresh(): void {
  if (isReadinessRefreshInFlight) {
    return;
  }

  isReadinessRefreshInFlight = true;
  void refreshDatabaseReadiness().finally(() => {
    isReadinessRefreshInFlight = false;
  });
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signAdminToken(payload: AdminTokenPayload): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function verifyAdminToken(token: string): AdminTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as AdminTokenPayload;
  } catch {
    return null;
  }

  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    return null;
  }

  if (payload.role !== "admin" || typeof payload.sid !== "string" || !payload.sid.trim()) {
    return null;
  }

  return payload;
}

function addActiveAdminSession(db: ApiDatabase, sessionId: string): void {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...(db.admin.activeSessionIds ?? []), sessionId]) {
    const normalized = typeof entry === "string" ? entry.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  db.admin.activeSessionIds = next.slice(-MAX_ACTIVE_ADMIN_SESSIONS);
}

function removeActiveAdminSession(db: ApiDatabase, sessionId: string): void {
  const target = sessionId.trim();
  if (!target) {
    return;
  }

  db.admin.activeSessionIds = (db.admin.activeSessionIds ?? []).filter((entry) => entry !== target);
}

function getIncomingAdminToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const legacyHeader = request.headers["x-admin-token"];
  if (typeof legacyHeader === "string" && legacyHeader.trim()) {
    return legacyHeader.trim();
  }

  return null;
}

function getIncomingMobileToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const mobileHeader = request.headers["x-mobile-token"];
  if (typeof mobileHeader === "string" && mobileHeader.trim()) {
    return mobileHeader.trim();
  }

  return null;
}

function getIncomingWebAuthToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const webHeader = request.headers["x-web-auth-token"];
  if (typeof webHeader === "string" && webHeader.trim()) {
    return webHeader.trim();
  }

  return null;
}

function hashMobileToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

async function withIsolatedDatabaseWrite<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  const completed = await withDatabaseLock(async () => {
    const db = structuredClone(await loadDatabase());
    try {
      const result = await handler(db);
      const pendingAuditEvents = drainPendingAuditEvents(db);
      if (pendingAuditEvents.length > 0) {
        await auditEventStore.appendEvents(pendingAuditEvents, { maxRecords: MAX_AUDIT_EVENTS });
      }
      await saveDatabase(db);
      return { result, postCommitEffects: pendingPostCommitEffectsByDb.drain(db) };
    } catch (error) {
      drainPendingAuditEvents(db);
      pendingPostCommitEffectsByDb.discard(db);
      throw error;
    }
  });

  await runDatabasePostCommitEffects(completed.postCommitEffects);
  return completed.result;
}

const DEIDENTIFIED_ACCOUNT_USER_ID = "deleted_user";
const ACCOUNT_DELETION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;

function hashDeletedAccountUserId(userId: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(`deleted-account:${userId}`).digest("hex");
}

function hasMatchingAccountDeletionReceipt(
  db: ApiDatabase,
  token: string,
  userId: string,
  now: Date
): boolean {
  const tokenHash = hashMobileToken(token);
  const userIdHash = hashDeletedAccountUserId(userId);
  return (db.accountDeletionReceipts ?? []).some((receipt) => (
    receipt.tokenHash === tokenHash
    && receipt.userIdHash === userIdHash
    && new Date(receipt.expiresAt).getTime() > now.getTime()
  ));
}

function findAuthenticatedMobileUserId(db: ApiDatabase, token: string): string | null {
  const actualBuffer = Buffer.from(hashMobileToken(token), "hex");
  for (const record of db.mobileAuthTokens) {
    const expectedBuffer = Buffer.from(record.tokenHash, "hex");
    if (expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      return record.userId;
    }
  }
  return null;
}

function createMobileAuthToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

const EXISTING_MOBILE_ONBOARDING_TOKEN_PREFIX = "mobile_onboarding_v1";

interface ExistingMobileOnboardingTokenPayload {
  purpose: "existing_mobile_onboarding";
  version: 1;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  timezone: string;
  joinCode: string | null;
  expiresAt: string;
}

function createExistingMobileOnboardingToken(payload: ExistingMobileOnboardingTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signedValue = `${EXISTING_MOBILE_ONBOARDING_TOKEN_PREFIX}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(signedValue).digest("base64url");
  return `${signedValue}.${signature}`;
}

function parseExistingMobileOnboardingToken(
  token: string,
  now: Date
): ExistingMobileOnboardingTokenPayload | null {
  const [prefix, encodedPayload, suppliedSignature, ...extra] = token.split(".");
  if (
    prefix !== EXISTING_MOBILE_ONBOARDING_TOKEN_PREFIX
    || !encodedPayload
    || !suppliedSignature
    || extra.length > 0
  ) {
    return null;
  }

  const signedValue = `${prefix}.${encodedPayload}`;
  const expectedSignature = crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(signedValue).digest("base64url");
  if (!timingSafeEqualText(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<ExistingMobileOnboardingTokenPayload>;
    const expiresAtMs = typeof parsed.expiresAt === "string" ? new Date(parsed.expiresAt).getTime() : Number.NaN;
    if (
      parsed.purpose !== "existing_mobile_onboarding"
      || parsed.version !== 1
      || typeof parsed.userId !== "string"
      || !parsed.userId.trim()
      || typeof parsed.email !== "string"
      || !isEmailLike(parsed.email)
      || typeof parsed.firstName !== "string"
      || !parsed.firstName.trim()
      || typeof parsed.lastName !== "string"
      || !parsed.lastName.trim()
      || typeof parsed.timezone !== "string"
      || !parsed.timezone.trim()
      || (parsed.joinCode !== null && typeof parsed.joinCode !== "string")
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= now.getTime()
    ) {
      return null;
    }

    return {
      purpose: "existing_mobile_onboarding",
      version: 1,
      userId: parsed.userId.trim(),
      email: parsed.email.trim().toLowerCase(),
      firstName: parsed.firstName.trim(),
      lastName: parsed.lastName.trim(),
      timezone: parsed.timezone.trim(),
      joinCode: typeof parsed.joinCode === "string" && parsed.joinCode.trim() ? parsed.joinCode.trim() : null,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  } catch {
    return null;
  }
}

function isExistingMobileOnboardingTokenForUser(
  token: string,
  user: UserProfile,
  now: Date
): ExistingMobileOnboardingTokenPayload | null {
  const payload = parseExistingMobileOnboardingToken(token, now);
  if (
    !payload
    || payload.userId !== user.id
    || payload.email !== user.email.trim().toLowerCase()
  ) {
    return null;
  }
  return payload;
}

function upsertMobileAuthToken(db: ApiDatabase, userId: string, issuedAtIso: string): string {
  const authToken = createMobileAuthToken();
  const tokenHash = hashMobileToken(authToken);
  const existing = db.mobileAuthTokens.find((entry) => entry.userId === userId);

  if (existing) {
    existing.tokenHash = tokenHash;
    existing.updatedAt = issuedAtIso;
    return authToken;
  }

  db.mobileAuthTokens.push({
    userId,
    tokenHash,
    createdAt: issuedAtIso,
    updatedAt: issuedAtIso
  });

  return authToken;
}

function hasCompleteMobileProfile(user: UserProfile): boolean {
  return Boolean(user.emailVerifiedAt) && hasCompleteUserName(user);
}

function hasValidMobileTokenForUser(
  db: ApiDatabase,
  userId: string,
  token: string,
  options?: { allowReonboardingToken?: boolean; allowIncompleteProfile?: boolean }
): boolean {
  const authRecord = db.mobileAuthTokens.find((entry) => entry.userId === userId);
  if (!authRecord || !authRecord.tokenHash) {
    return false;
  }

  const expectedBuffer = Buffer.from(authRecord.tokenHash, "hex");
  const actualBuffer = Buffer.from(hashMobileToken(token), "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return false;
  }

  const user = getUserById(db, userId);
  if (user?.mobileProfileReonboardingRequired === true && options?.allowReonboardingToken !== true) {
    return false;
  }

  if (user && !hasCompleteMobileProfile(user) && options?.allowIncompleteProfile !== true) {
    return false;
  }

  return true;
}

async function withMobileTrainingContentContext<T>(
  request: Request,
  response: Response,
  handler: (context: MobileTrainingContentRequestContext) => Promise<T>
): Promise<T | null> {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return null;
  }

  return withFreshDatabaseRead(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }
    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const organization = user.orgId ? getOrgById(db, user.orgId) : null;
    const configForUser = resolveConfigForUser(db, user);
    return handler({
      user,
      users: db.users,
      organizationActive: organization?.status === "active",
      scenarioConfig: {
        segments: configForUser.segments,
        orgCustomScenarios: configForUser.orgCustomScenarios,
        orgTrainings: configForUser.orgTrainings,
      },
    });
  });
}

function respondWithTrainingContentMobileError(error: unknown, response: Response): void {
  const mapped = mapTrainingContentMobileServiceError(error);
  response.status(mapped.status).json(mapped.body);
}

function createVerificationCode(): string {
  const numeric = crypto.randomInt(0, 1_000_000);
  return String(numeric).padStart(6, "0");
}

function buildDomainMatchForEmail(_db: ApiDatabase, _email: string): null {
  // Deprecated compatibility field: organization discovery is company-code based.
  return null;
}

async function issueEmailVerification(
  db: ApiDatabase,
  user: UserProfile,
  now: Date,
  experience: "dashboard" | "mobile"
): Promise<{ expiresAt: string; delivery: WebAuthDeliveryMode }> {
  const nowIsoValue = now.toISOString();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000).toISOString();
  const code = createVerificationCode();
  const codeHash = hashEmailVerificationCode(MOBILE_TOKEN_SECRET, user.id, user.email, code);

  const record: EmailVerificationRecord = {
    id: `ver_${uuid()}`,
    userId: user.id,
    email: user.email,
    codeHash,
    createdAt: nowIsoValue,
    expiresAt,
    consumedAt: null
  };

  db.emailVerifications.push(record);
  return {
    expiresAt,
    delivery: await authCodeDelivery.sendEmailVerificationCode({
      email: user.email,
      code,
      expiresAt,
      experience
    })
  };
}

function logDashboardWebAuthRequestIgnored(email: string, reason: string): void {
  const normalizedEmail = email.trim().toLowerCase() || "<empty>";
  logWarnThrottled(
    `web-auth-request:${reason}:${normalizedEmail}`,
    `[web-auth][request-code] ignored request for ${normalizedEmail}: ${reason}`,
    60 * 1000
  );
}

function logDashboardWebAuthRequestRateLimited(request: Request, retryAfterSeconds: number): void {
  const clientIp = getClientIp(request) || "unknown";
  logWarnThrottled(
    `web-auth-request:rate-limited:${clientIp}`,
    `[web-auth][request-code] rate limited client ${clientIp}; retry_after_seconds=${retryAfterSeconds}`,
    60 * 1000
  );
}

const DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE = "Could not verify code. Request a new code and try again.";

function normalizePersistedCoachingText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_PERSISTED_COACHING_TEXT_LENGTH);
}

function normalizePersistedCoachingList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizePersistedCoachingText(entry);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(normalized);
    if (items.length >= MAX_PERSISTED_COACHING_ITEMS) {
      break;
    }
  }

  return items;
}

function normalizeSimulationScoreCoachingArtifact(
  value: SimulationScoreCoachingArtifactInput | null | undefined
): SimulationScoreCoachingArtifact | null {
  const strengths = normalizePersistedCoachingList(value?.strengths);
  const improvementAreas = normalizePersistedCoachingList(value?.improvementAreas);
  const coachingPriority = normalizePersistedCoachingText(value?.coachingPriority) ?? improvementAreas[0] ?? null;

  if (strengths.length === 0 && improvementAreas.length === 0 && !coachingPriority) {
    return null;
  }

  return {
    strengths,
    improvementAreas,
    coachingPriority
  };
}

function buildSimulationScoreCoachingArtifactFromScorecard(
  scorecard: SimulationScorecard
): SimulationScoreCoachingArtifact | null {
  return normalizeSimulationScoreCoachingArtifact({
    strengths: scorecard.strengths,
    improvementAreas: scorecard.improvements,
    coachingPriority: scorecard.improvements[0] ?? null
  });
}

function buildWebAuthSessionUser(user: UserProfile): WebAuthSessionResponse["session"] {
  return {
    userId: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    isPlatformAdmin: user.isPlatformAdmin === true,
    isSuperUser: user.isSuperUser === true,
    dashboardAccessEnabled: user.dashboardAccessEnabled === true,
    accountType: user.accountType,
    orgId: user.orgId
  };
}

function getWebAuthRequestUserAgent(request: Request): string | null {
  const header = request.get("user-agent");
  const trimmed = header?.trim();
  return trimmed || null;
}

function buildWebAuthSessionRequestMetadata(request: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  return {
    userAgent: getWebAuthRequestUserAgent(request),
    ipAddress: getClientIp(request)
  };
}

interface AuthenticatedWebSessionContext {
  db: ApiDatabase;
  token: WebAuthTokenPayload;
  user: UserProfile;
  sessionId: string;
}

async function loadAuthenticatedWebSessionContext(
  request: Request,
  response: Response
): Promise<AuthenticatedWebSessionContext | null> {
  const token = getIncomingWebAuthToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing web auth token.", code: "web_auth_invalid" });
    return null;
  }

  const payload = webAuthService.verifyToken(token);
  if (!payload) {
    response.status(401).json({ error: "Invalid or expired web auth token.", code: "web_auth_invalid" });
    return null;
  }

  const now = new Date();
  const sessionRecord = await webAuthSessionStore.getActiveSession(payload.sid, payload.sub, now);
  if (!sessionRecord) {
    response.status(401).json({ error: "Invalid or expired web auth token.", code: "web_auth_invalid" });
    return null;
  }

  const context = await withDatabaseRead(async (db) => {
    const user = getUserById(db, payload.sub);
    if (!user || user.status !== "active" || !user.emailVerifiedAt) {
      return null;
    }

    return {
      db,
      user
    };
  });

  if (!context) {
    await revokeWebAuthSessionById(sessionRecord.sessionId);
    response.status(401).json({ error: "Web auth session is no longer valid.", code: "web_auth_invalid" });
    return null;
  }

  const touched = webAuthService.touchSession(
    sessionRecord,
    now,
    buildWebAuthSessionRequestMetadata(request)
  );
  if (touched) {
    await webAuthSessionStore.saveSession(sessionRecord);
  }

  return {
    db: context.db,
    token: payload,
    user: context.user,
    sessionId: sessionRecord.sessionId
  };
}

async function requireAdmin(request: AdminAuthRequest, response: Response, next: NextFunction): Promise<void> {
  const token = getIncomingAdminToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing admin token." });
    return;
  }

  const payload = verifyAdminToken(token);
  if (!payload) {
    response.status(401).json({ error: "Invalid or expired admin token." });
    return;
  }

  const hasActiveSession = await withDatabaseRead(async (db) => (db.admin.activeSessionIds ?? []).includes(payload.sid));
  if (!hasActiveSession) {
    response.status(401).json({ error: "Invalid or expired admin token." });
    return;
  }

  request.admin = payload;
  request.adminToken = token;
  next();
}

async function requireWebAuth(request: WebAuthRequest, response: Response, next: NextFunction): Promise<void> {
  const context = await loadAuthenticatedWebSessionContext(request, response);
  if (!context) {
    return;
  }

  request.webAuth = {
    token: context.token,
    user: context.user,
    sessionId: context.sessionId
  };
  request.webAuthToken = getIncomingWebAuthToken(request) ?? undefined;
  next();
}

async function requireDashboardAuth(
  request: DashboardAuthRequest,
  response: Response,
  next: NextFunction
): Promise<void> {
  const context = await loadAuthenticatedWebSessionContext(request, response);
  if (!context) {
    return;
  }

  const viewer = resolveDashboardViewer(context.db, context.user);
  if (!viewer) {
    await revokeWebAuthSessionById(context.sessionId);
    response.status(403).json({
      error: "Dashboard access is not enabled for this account.",
      code: "dashboard_session_invalid",
    });
    return;
  }

  request.dashboard = { token: context.token, user: context.user, viewer };
  next();
}

function applyPendingTimezoneIfDue(user: UserProfile, now: Date): boolean {
  if (!user.pendingTimezone || !user.pendingTimezoneEffectiveAt) {
    return false;
  }

  if (new Date(user.pendingTimezoneEffectiveAt).getTime() > now.getTime()) {
    return false;
  }

  user.timezone = resolveTimeZone(user.pendingTimezone);
  user.pendingTimezone = null;
  user.pendingTimezoneEffectiveAt = null;
  user.updatedAt = now.toISOString();
  return true;
}

function materializeUserTimezone(user: UserProfile, now: Date): string {
  applyPendingTimezoneIfDue(user, now);
  user.timezone = resolveTimeZone(user.timezone);
  return user.timezone;
}

function getUserById(db: ApiDatabase, userId: string): UserProfile | undefined {
  return db.users.find((user) => user.id === userId);
}

function getOrgById(db: ApiDatabase, orgId: string | null): EnterpriseOrg | undefined {
  if (!orgId) {
    return undefined;
  }

  return db.orgs.find((org) => org.id === orgId);
}

function isSuperUser(user: UserProfile): boolean {
  return user.isSuperUser === true;
}

function getIncomingSuperUserOrgId(request: Request): string | null {
  const headerValue = request.headers["x-superuser-org-id"];
  if (typeof headerValue !== "string") {
    return null;
  }

  const trimmed = headerValue.trim();
  return trimmed ? trimmed : null;
}

interface MobileAccessContext {
  user: UserProfile;
  actingOrg: EnterpriseOrg | null;
  actingOrgId: string | null;
  isSuperUser: boolean;
}

function resolveMobileAccessContext(
  db: ApiDatabase,
  user: UserProfile,
  request: Request,
  response: Response,
  options?: { requireSuperUserOrgSelection?: boolean }
): MobileAccessContext | null {
  if (user.status !== "active") {
    response.status(403).json({ error: "User account is disabled." });
    return null;
  }

  if (isSuperUser(user)) {
    const requestedOrgId = getIncomingSuperUserOrgId(request);
    if (!requestedOrgId) {
      if (options?.requireSuperUserOrgSelection === true) {
        response.status(400).json({
          error: "Select an enterprise account environment first.",
          code: ORG_ACCESS_REQUIRED_CODE,
        });
        return null;
      }

      return {
        user,
        actingOrg: null,
        actingOrgId: null,
        isSuperUser: true,
      };
    }

    const actingOrg = getOrgById(db, requestedOrgId);
    if (!actingOrg) {
      response.status(404).json({ error: "Selected enterprise account was not found." });
      return null;
    }

    return {
      user,
      actingOrg,
      actingOrgId: actingOrg.id,
      isSuperUser: true,
    };
  }

  if (user.accountType === "enterprise") {
    const actingOrg = getOrgById(db, user.orgId);
    if (!actingOrg || actingOrg.status !== "active") {
      response.status(403).json({
        error: "Enterprise account is not active.",
        code: ORG_ACCESS_REQUIRED_CODE,
      });
      return null;
    }

    return {
      user,
      actingOrg,
      actingOrgId: actingOrg.id,
      isSuperUser: false,
    };
  }

  return {
    user,
    actingOrg: null,
    actingOrgId: null,
    isSuperUser: false,
  };
}

function roundMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

function averageScore(records: Array<{ overallScore: number }>): number | null {
  if (records.length === 0) {
    return null;
  }

  return Math.round(records.reduce((total, record) => total + record.overallScore, 0) / records.length);
}

function averageScoreDelta(
  currentRecords: Array<{ overallScore: number }>,
  previousRecords: Array<{ overallScore: number }>
): number | null {
  const currentAverage = averageScore(currentRecords);
  const previousAverage = averageScore(previousRecords);
  if (currentAverage === null || previousAverage === null) {
    return null;
  }

  return Math.round((currentAverage - previousAverage) * 10) / 10;
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsedMs = new Date(value).getTime();
    if (!Number.isFinite(parsedMs) || parsedMs <= bestMs) {
      continue;
    }

    bestMs = parsedMs;
    bestValue = value;
  }

  return bestValue;
}

function minIsoDate(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsedMs = new Date(value).getTime();
    if (!Number.isFinite(parsedMs) || parsedMs >= bestMs) {
      continue;
    }

    bestMs = parsedMs;
    bestValue = value;
  }

  return bestValue;
}

function listUsageSessions(
  db: Pick<ApiDatabase, "usageSessions">,
  query?: Parameters<typeof usageSessionAccess.list>[1]
): UsageSessionRecord[] {
  return usageSessionAccess.list(db, query);
}

function listScoreRecords(
  db: Pick<ApiDatabase, "scoreRecords">,
  query?: Parameters<typeof scoreRecordAccess.list>[1]
): SimulationScoreRecord[] {
  return scoreRecordAccess.list(db, query);
}

function filterOrgUsageSessions(
  db: ApiDatabase,
  orgId: string,
  startMs: number,
  endMs: number,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): UsageSessionRecord[] {
  return filterRecordsByDivision(
    usageSessionAccess.listByOrgRange(db, {
      orgId,
      startedAtFrom: new Date(startMs),
      startedAtBefore: new Date(endMs)
    }).filter((session) => !permittedUserIds || permittedUserIds.has(session.userId)),
    divisionId
  );
}

function filterOrgScoreRecords(
  db: ApiDatabase,
  orgId: string,
  startMs: number,
  endMs: number,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): SimulationScoreRecord[] {
  return filterRecordsByDivision(
    scoreRecordAccess.listByOrgRange(db, {
      orgId,
      endedAtFrom: new Date(startMs),
      endedAtBefore: new Date(endMs),
      conclusiveOnly: true
    }).filter((record) => !permittedUserIds || permittedUserIds.has(record.userId)),
    divisionId
  );
}

function filterDashboardAccessibleUsageSessions(
  db: ApiDatabase,
  orgIds: Set<string>,
  startMs: number,
  endMs: number,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): UsageSessionRecord[] {
  return filterRecordsByDivision(
    listUsageSessions(db).filter((session) => {
      if (!session.orgId || !orgIds.has(session.orgId)) {
        return false;
      }
      if (permittedUserIds && !permittedUserIds.has(session.userId)) {
        return false;
      }
      const startedAtMs = new Date(session.startedAt).getTime();
      return Number.isFinite(startedAtMs) && startedAtMs >= startMs && startedAtMs < endMs;
    }),
    divisionId
  );
}

function filterDashboardAccessibleScoreRecords(
  db: ApiDatabase,
  orgIds: Set<string>,
  startMs: number,
  endMs: number,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): SimulationScoreRecord[] {
  return filterRecordsByDivision(
    listScoreRecords(db, { conclusiveOnly: true }).filter((record) => {
      if (!record.orgId || !orgIds.has(record.orgId)) {
        return false;
      }
      if (permittedUserIds && !permittedUserIds.has(record.userId)) {
        return false;
      }
      const endedAtMs = new Date(record.endedAt).getTime();
      return Number.isFinite(endedAtMs) && endedAtMs >= startMs && endedAtMs < endMs;
    }),
    divisionId
  );
}

function formatDashboardMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short" });
}

function parseTrainingPackScenarioSelection(triggers: string[]): {
  mode: "all" | "selected" | "none";
  selectedScenarioIds: string[];
} {
  let mode: "all" | "selected" | "none" = "none";
  const selectedScenarioIds = new Set<string>();

  for (const trigger of triggers) {
    const lower = trigger.trim().toLowerCase();
    if (!lower.startsWith(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX)) {
      continue;
    }

    const scenarioId = trigger.slice(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX.length).trim();
    if (!scenarioId) {
      continue;
    }

    if (scenarioId === "*") {
      mode = "all";
      selectedScenarioIds.clear();
      break;
    }

    mode = "selected";
    selectedScenarioIds.add(scenarioId);
  }

  return {
    mode,
    selectedScenarioIds: Array.from(selectedScenarioIds)
  };
}

function isTrainingPackScopedToScenario(pack: TrainingPack, scenarioId: string): boolean {
  const selection = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
  if (selection.mode === "all") {
    return true;
  }
  if (selection.mode !== "selected") {
    return false;
  }

  const normalizedScenarioId = scenarioId.trim().toLowerCase();
  return selection.selectedScenarioIds.some((entry) => entry.trim().toLowerCase() === normalizedScenarioId);
}

async function resolvePersistedTrainingPackForScenario(params: {
  orgId: string | null | undefined;
  scenarioId: string;
  useModularPromptArchitecture: boolean;
  submittedTrainingPackId?: string | null;
}): Promise<TrainingPack | null> {
  if (!params.useModularPromptArchitecture) {
    return null;
  }

  const submittedTrainingPackId = params.submittedTrainingPackId?.trim();
  if (submittedTrainingPackId) {
    if (!params.orgId) {
      return null;
    }
    const activePack = await getActiveTrainingPackForOrg(params.orgId, params.useModularPromptArchitecture, {
      scenarioId: params.scenarioId,
      onSkip: (message) => logWarnThrottled("training-pack:scope", message)
    });
    if (activePack?.id === submittedTrainingPackId) {
      return activePack;
    }
    const packs = await listTrainingPacksForDashboardOrg(params.orgId);
    const submittedPack = packs.find((pack) => pack.id === submittedTrainingPackId);
    if (submittedPack && isTrainingPackScopedToScenario(submittedPack, params.scenarioId)) {
      return submittedPack;
    }
  }

  return getActiveTrainingPackForOrg(params.orgId, params.useModularPromptArchitecture, {
    scenarioId: params.scenarioId,
    onSkip: (message) => logWarnThrottled("training-pack:scope", message)
  });
}

function buildTrainingPackAttributionSummary(params: {
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
}): DashboardTrainingAttributionSummary {
  return simulationHistoryAccess.buildTrainingPackAttributionSummary(params);
}

function resolveTrainingPackRequiredScenarioIds(
  pack: TrainingPack,
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>
): string[] {
  const selection = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
  if (selection.mode === "all") {
    return Array.from(scenarioCatalog.keys());
  }
  if (selection.mode !== "selected") {
    return [];
  }
  return selection.selectedScenarioIds.filter((scenarioId) => scenarioId.trim().length > 0);
}

function listTrainingPackAssignments(
  db: ApiDatabase,
  orgId: string,
  trainingPackId: string,
  options?: { activeOnly?: boolean }
): TrainingPackAssignmentRecord[] {
  const activeOnly = options?.activeOnly !== false;
  return (db.trainingPackAssignments ?? []).filter((assignment) => {
    if (assignment.orgId !== orgId || assignment.trainingPackId !== trainingPackId) {
      return false;
    }
    if (activeOnly && assignment.active !== true) {
      return false;
    }
    return true;
  });
}

function listVisibleTrainingPackAssignments(
  db: ApiDatabase,
  orgId: string,
  trainingPackId: string
): TrainingPackAssignmentRecord[] {
  return listTrainingPackAssignments(db, orgId, trainingPackId).filter((assignment) =>
    isTrainingPackAssignmentValidForUser(assignment, getUserById(db, assignment.userId))
  );
}

function resolveTrainingPackAssignmentCompletionAt(
  assignment: TrainingPackAssignmentRecord,
  scoreRecords: SimulationScoreRecord[]
): string | null {
  return simulationHistoryAccess.resolveTrainingPackAssignmentCompletionAt(assignment, scoreRecords);
}

function computeTrainingPackAssignmentProgress(params: {
  db: ApiDatabase;
  assignment: TrainingPackAssignmentRecord;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  allSessions: UsageSessionRecord[];
  allScores: SimulationScoreRecord[];
  recentSessions: UsageSessionRecord[];
  recentScores: SimulationScoreRecord[];
}): DashboardTrainingPackAssignmentProgressRow {
  const user = getUserById(params.db, params.assignment.userId);
  return simulationHistoryAccess.computeTrainingPackAssignmentProgress({
    assignment: params.assignment,
    user: user ? { email: user.email, status: user.status } : null,
    scenarioCatalog: params.scenarioCatalog,
    allSessions: params.allSessions,
    allScores: params.allScores,
    recentSessions: params.recentSessions,
    recentScores: params.recentScores
  });
}

function syncTrainingPackAssignmentLifecycle(
  db: ApiDatabase,
  assignment: TrainingPackAssignmentRecord
): TrainingPackAssignmentRecord {
  return simulationHistoryAccess.syncTrainingPackAssignmentLifecycle(db, assignment);
}

function projectTrainingPackAssignmentLifecycle(
  db: ApiDatabase,
  assignment: TrainingPackAssignmentRecord
): TrainingPackAssignmentRecord {
  return simulationHistoryAccess.projectTrainingPackAssignmentLifecycle(db, assignment);
}

function syncTrainingPackAssignmentsForUserPack(
  db: ApiDatabase,
  orgId: string | null | undefined,
  userId: string,
  trainingPackId: string | null | undefined
): void {
  if (!orgId || !trainingPackId) {
    return;
  }

  const assignments = listTrainingPackAssignments(db, orgId, trainingPackId).filter((assignment) => assignment.userId === userId);
  if (assignments.length === 0) {
    return;
  }

  const now = nowIso();
  for (const assignment of assignments) {
    const previousStartedAt = assignment.startedAt;
    const previousCompletedAt = assignment.completedAt;
    syncTrainingPackAssignmentLifecycle(db, assignment);
    if (assignment.startedAt !== previousStartedAt || assignment.completedAt !== previousCompletedAt) {
      assignment.updatedAt = now;
    }
  }
}

function buildTrainingPackTrendPoints(
  packSessions: UsageSessionRecord[],
  packScores: SimulationScoreRecord[],
  now: Date
): DashboardTrainingPackTrendPoint[] {
  const points: DashboardTrainingPackTrendPoint[] = [];

  for (let offset = 2; offset >= 0; offset -= 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    const sessions = packSessions.filter((session) => {
      const startedAtMs = new Date(session.startedAt).getTime();
      return Number.isFinite(startedAtMs) && startedAtMs >= monthStart.getTime() && startedAtMs < monthEnd.getTime();
    });
    const scores = packScores.filter((record) => {
      const endedAtMs = new Date(record.endedAt).getTime();
      return Number.isFinite(endedAtMs) && endedAtMs >= monthStart.getTime() && endedAtMs < monthEnd.getTime();
    });

    points.push({
      label: formatDashboardMonthLabel(monthStart),
      periodStartAt: monthStart.toISOString(),
      periodEndAt: monthEnd.toISOString(),
      attempts: sessions.length,
      averageScore: averageScore(scores)
    });
  }

  return points;
}

function buildTrainingPackScenarioProgressRows(params: {
  requiredScenarioIds: string[];
  assignments: TrainingPackAssignmentRecord[];
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  packSessions: UsageSessionRecord[];
  packScores: SimulationScoreRecord[];
  recentPackSessions: UsageSessionRecord[];
  recentPackScores: SimulationScoreRecord[];
}): DashboardTrainingPackScenarioProgressRow[] {
  return params.requiredScenarioIds
    .filter((scenarioId, index, entries) => scenarioId.trim().length > 0 && entries.indexOf(scenarioId) === index)
    .map((scenarioId): DashboardTrainingPackScenarioProgressRow => {
      const scenarioMeta = params.scenarioCatalog.get(scenarioId);
      const scopedAssignments = params.assignments.filter((assignment) => assignment.requiredScenarioIds.includes(scenarioId));
      const startedLearnerCount = scopedAssignments.filter((assignment) => {
        const assignedAtMs = new Date(assignment.assignedAt).getTime();
        return (
          params.packSessions.some((session) => {
            if (session.userId !== assignment.userId || session.scenarioId !== scenarioId) {
              return false;
            }
            const activityAtMs = new Date(session.startedAt).getTime();
            return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
          }) ||
          params.packScores.some((record) => {
            if (record.userId !== assignment.userId || record.scenarioId !== scenarioId) {
              return false;
            }
            const activityAtMs = new Date(record.endedAt).getTime();
            return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
          })
        );
      }).length;
      const completedLearnerCount = scopedAssignments.filter((assignment) => {
        const assignedAtMs = new Date(assignment.assignedAt).getTime();
        return params.packScores.some((record) => {
          if (record.userId !== assignment.userId || record.scenarioId !== scenarioId) {
            return false;
          }
          const activityAtMs = new Date(record.endedAt).getTime();
          return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
        });
      }).length;
      const recentScenarioSessions = params.recentPackSessions.filter((session) => session.scenarioId === scenarioId);
      const recentScenarioScores = params.recentPackScores.filter((record) => record.scenarioId === scenarioId);

      return {
        scenarioId,
        title: scenarioMeta?.title ?? scenarioId,
        segmentId: scenarioMeta?.segmentId ?? "unknown",
        segmentLabel: scenarioMeta?.segmentLabel ?? "Unknown",
        source: scenarioMeta?.source ?? "standard",
        assignedLearnerCount: scopedAssignments.length,
        startedLearnerCount,
        completedLearnerCount,
        attemptsLast30Days: recentScenarioSessions.length,
        scoredAttemptsLast30Days: recentScenarioScores.length,
        averageScoreLast30Days: averageScore(recentScenarioScores),
        latestActivityAt: maxIsoDate([
          ...recentScenarioSessions.map((session) => session.endedAt),
          ...recentScenarioScores.map((record) => record.endedAt)
        ])
      };
    })
    .sort((left, right) => {
      if (right.assignedLearnerCount !== left.assignedLearnerCount) {
        return right.assignedLearnerCount - left.assignedLearnerCount;
      }
      return left.title.localeCompare(right.title);
    });
}

interface DashboardScenarioCatalogEntry {
  scenarioId: string;
  title: string;
  summary: string | null;
  segmentId: string;
  segmentLabel: string;
  source: "standard" | "custom";
}

function buildDashboardScenarioCatalog(db: ApiDatabase, org: EnterpriseOrg): Map<string, DashboardScenarioCatalogEntry> {
  const catalog = new Map<string, DashboardScenarioCatalogEntry>();

  for (const segment of db.config.segments) {
    if (segment.enabled !== true) {
      continue;
    }

    for (const scenario of segment.scenarios ?? []) {
      if (scenario.enabled === false) {
        continue;
      }

      catalog.set(scenario.id, {
        scenarioId: scenario.id,
        title: scenario.title,
        summary: scenario.summary ?? null,
        segmentId: segment.id,
        segmentLabel: segment.label,
        source: "standard"
      });
    }
  }

  for (const customScenario of ensureOrgCustomScenarioCollection(org)) {
    if (customScenario.enabled === false) {
      continue;
    }

    const segmentLabel = getConfigSegmentById(db.config, customScenario.segmentId)?.label ?? customScenario.segmentId;
    catalog.set(customScenario.id, {
      scenarioId: customScenario.id,
      title: customScenario.title,
      summary: customScenario.summary ?? buildScenarioSummary(customScenario.description),
      segmentId: customScenario.segmentId,
      segmentLabel,
      source: "custom"
    });
  }

  return catalog;
}

async function listTrainingPacksForDashboardOrg(orgId: string): Promise<TrainingPack[]> {
  if (dashboardTrainingPackLoaderForTest) {
    return dashboardTrainingPackLoaderForTest(orgId);
  }

  try {
    return await trainingPackStore.listTrainingPacksForOrg(orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarnThrottled("dashboard:training-packs", `[dashboard] failed to load training packs for ${orgId}: ${message}`);
    return [];
  }
}

async function buildPerformanceScopeCandidatesForUser(
  db: ApiDatabase,
  org: EnterpriseOrg,
  user: UserProfile
): Promise<PerformanceScopeCandidate[]> {
  await ensureOrgTrainingWorkspace(db, org);
  const catalog = buildDashboardScenarioCatalog(db, org);
  const visibleStandardScenarioIds = new Set(
    listOrgVisibleStandardScenarios({ config: db.config, org })
      .filter((row) => row.enabled)
      .map((row) => row.scenarioId)
  );
  const userDivisionId = resolveUserActiveDivisionId(db, org.id, user);
  const activeAssignments = db.trainingPackAssignments.filter(
    (assignment) => assignment.orgId === org.id && assignment.userId === user.id && assignment.active === true
  );
  const assignedScenarioIds = new Set<string>();
  const focusTopicsByScenarioId = new Map<string, Map<string, string>>();
  const trainingPacks = await listTrainingPacksForDashboardOrg(org.id);
  const validTrainingPackIds = new Set(trainingPacks.filter((pack) => pack.active === true).map((pack) => pack.id));
  const trainingSummaries = buildOrgTrainingSummaries({
    db,
    orgId: org.id,
    validTrainingPackIds,
    validScenarioIds: ensureOrgCustomScenarioCollection(org).map((scenario) => scenario.id)
  }).filter((training) => training.status === "active");

  const addFocusTopic = (scenarioId: string, topic: { id: string; name: string }): void => {
    const topics = focusTopicsByScenarioId.get(scenarioId) ?? new Map<string, string>();
    topics.set(topic.id, topic.name);
    focusTopicsByScenarioId.set(scenarioId, topics);
  };

  for (const assignment of activeAssignments) {
    if (!validTrainingPackIds.has(assignment.trainingPackId)) {
      continue;
    }
    for (const scenarioId of assignment.requiredScenarioIds ?? []) {
      assignedScenarioIds.add(scenarioId);
    }
  }

  for (const training of trainingSummaries) {
    const trainingDivisionId = resolveTrainingActiveDivisionId(db, org.id, training.id);
    if (!isDivisionVisibleToUser({
      divisionsEnabled: org.divisionsEnabled === true,
      userDivisionId,
      contentDivisionId: trainingDivisionId
    })) {
      continue;
    }

    const topic = { id: training.id, name: training.name };
    const attachedAssignmentPackIds = new Set(training.attachedTrainingPackIds);
    for (const assignment of activeAssignments) {
      if (!attachedAssignmentPackIds.has(assignment.trainingPackId)) {
        continue;
      }
      for (const scenarioId of assignment.requiredScenarioIds ?? []) {
        assignedScenarioIds.add(scenarioId);
        addFocusTopic(scenarioId, topic);
      }
    }
    for (const scenarioId of training.attachedCustomScenarioIds) {
      assignedScenarioIds.add(scenarioId);
      addFocusTopic(scenarioId, topic);
    }
  }

  return Array.from(assignedScenarioIds)
    .map((scenarioId): PerformanceScopeCandidate | null => {
      const entry = catalog.get(scenarioId);
      if (!entry) {
        return null;
      }
      if (entry.source === "standard") {
        if (!visibleStandardScenarioIds.has(entry.scenarioId)) {
          return null;
        }
        const scenarioDivisionId = resolveStandardScenarioActiveDivisionId(db, org.id, entry.scenarioId);
        if (!isDivisionVisibleToUser({
          divisionsEnabled: org.divisionsEnabled === true,
          userDivisionId,
          contentDivisionId: scenarioDivisionId
        })) {
          return null;
        }
      }
      const fallbackTopic = { id: `role:${entry.segmentId}`, name: entry.segmentLabel || "Assigned role" };
      const focusTopics = Array.from(focusTopicsByScenarioId.get(entry.scenarioId)?.entries() ?? [[fallbackTopic.id, fallbackTopic.name]])
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      return {
        scenarioId: entry.scenarioId,
        displayName: entry.title,
        source: entry.source,
        segmentId: entry.segmentId,
        segmentLabel: entry.segmentLabel,
        focusTopics,
        metadata: { summary: entry.summary }
      };
    })
    .filter((candidate): candidate is PerformanceScopeCandidate => candidate !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.scenarioId.localeCompare(right.scenarioId));
}

async function buildPerformanceUserContext(
  db: ApiDatabase,
  user: UserProfile
): Promise<PerformancePlanUserContext | null> {
  if (user.accountType !== "enterprise" || !user.orgId || user.status !== "active") {
    return null;
  }
  const org = getOrgById(db, user.orgId);
  if (!org || org.status !== "active") {
    return null;
  }
  const divisionId = resolveUserActiveDivisionId(db, org.id, user);
  const divisionName = divisionId ? findOrgDivisionRecord(db, org.id, divisionId)?.name ?? null : null;
  return {
    userId: user.id,
    email: user.email,
    displayName: resolvePerformanceUserDisplayName(user),
    orgId: org.id,
    orgName: org.name,
    timeZone: resolveTimeZone(user.timezone),
    divisionId,
    divisionName,
    status: user.status,
    orgRole: user.orgRole,
    candidates: await buildPerformanceScopeCandidatesForUser(db, org, user)
  };
}

async function listDashboardPerformanceUserContexts(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  divisionId: string | null,
  explicitOrgId: string | null = null
): Promise<PerformancePlanUserContext[]> {
  const viewer = principal.viewer;
  const accessibleOrgIds = new Set(listDashboardAccessibleOrgs(db, viewer).map((org) => org.id));
  if (explicitOrgId) {
    if (!accessibleOrgIds.has(explicitOrgId)) {
      return [];
    }
    accessibleOrgIds.clear();
    accessibleOrgIds.add(explicitOrgId);
  }
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: accessibleOrgIds,
  });
  const contexts: PerformancePlanUserContext[] = [];
  for (const user of db.users) {
    if (user.accountType !== "enterprise" || !user.orgId || !accessibleOrgIds.has(user.orgId)) {
      continue;
    }
    if (!permittedUserIds.has(user.id)) {
      continue;
    }
    const context = await buildPerformanceUserContext(db, user);
    if (!context) {
      continue;
    }
    if (divisionId && context.divisionId !== divisionId) {
      continue;
    }
    contexts.push(context);
  }
  return contexts.sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
      left.email.localeCompare(right.email, undefined, { sensitivity: "base" }) ||
      left.userId.localeCompare(right.userId)
  );
}

async function getDashboardPerformanceUserContext(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  userId: string,
  explicitOrgId: string | null,
  divisionId: string | null
): Promise<PerformancePlanUserContext | null> {
  const user = getUserById(db, userId);
  if (!user || user.accountType !== "enterprise" || !user.orgId) {
    return null;
  }
  if (!canDashboardViewerAccessPerformanceTarget(db, principal, user, explicitOrgId, divisionId)) {
    return null;
  }
  const context = await buildPerformanceUserContext(db, user);
  if (!context) {
    return null;
  }
  return context;
}

function canDashboardViewerAccessPerformanceTarget(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  target: UserProfile,
  explicitOrgId: string | null,
  divisionId: string | null
): boolean {
  const viewer = principal.viewer;
  if (target.accountType !== "enterprise" || !target.orgId) {
    return false;
  }
  if (explicitOrgId && target.orgId !== explicitOrgId) {
    return false;
  }
  if (!canDashboardViewerAccessOrg(viewer, target.orgId)) {
    return false;
  }
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: new Set([target.orgId]),
  });
  if (!permittedUserIds.has(target.id)) {
    return false;
  }
  if (divisionId) {
    const targetDivisionId = resolveUserActiveDivisionId(db, target.orgId, target);
    if (targetDivisionId !== divisionId) {
      return false;
    }
  }
  return true;
}

function getPerformancePlanRowContext(
  db: ApiDatabase,
  plan: PerformancePlan
): { userEmail: string; orgName: string; divisionId: string | null; divisionName: string | null } | null {
  const user = getUserById(db, plan.userId);
  const org = getOrgById(db, plan.orgId);
  if (!user || !org) {
    return null;
  }
  const divisionId = resolveUserActiveDivisionId(db, org.id, user);
  const divisionName = divisionId ? findOrgDivisionRecord(db, org.id, divisionId)?.name ?? null : null;
  return {
    userEmail: user.email,
    orgName: org.name,
    divisionId,
    divisionName
  };
}

function canManagePerformancePlanForUser(actor: UserProfile, viewer: DashboardViewer, target: UserProfile): boolean {
  return canActorManagePerformanceUser({ actor, viewer, target });
}

function resolvePerformanceDashboardAuditActorType(viewer: DashboardViewer): AuditActorType {
  return viewer.accessType === "super_user" ? "platform_admin" : "web_user";
}

const PERFORMANCE_DUPLICATE_ACTIVE_PLAN_MESSAGE = "An identical active Performance goal already exists for this user.";
const PERFORMANCE_DUPLICATE_ACTIVE_PLAN_CODE = "performance_plan_duplicate_active_definition";

function isDuplicatePerformancePlanError(error: unknown): boolean {
  return error instanceof Error && error.message === PERFORMANCE_DUPLICATE_ACTIVE_PLAN_MESSAGE;
}

function normalizeCancelReason(body: CancelPerformancePlanRequest): string | null {
  if (typeof body.reason !== "string") {
    return null;
  }
  const trimmed = body.reason.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function isPlainRequestBody(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectMobilePerformanceTargetSpoof(
  body: unknown,
  userId: string,
  orgId: string,
  response: Response
): boolean {
  if (!isPlainRequestBody(body)) {
    return false;
  }
  const requestedUserId = typeof body.userId === "string" ? body.userId.trim() : null;
  if (requestedUserId && requestedUserId !== userId) {
    response.status(403).json({ error: "Mobile users can only create Performance goals for themselves." });
    return true;
  }
  const requestedOrgId = typeof body.orgId === "string" ? body.orgId.trim() : null;
  if (requestedOrgId && requestedOrgId !== orgId) {
    response.status(403).json({ error: "Mobile users can only create Performance goals in their own enterprise account." });
    return true;
  }
  return false;
}

function buildMobilePerformancePlanInput(
  body: unknown,
  userId: string,
  orgId: string
): PerformancePlanPreviewRequest {
  return {
    ...(isPlainRequestBody(body) ? body : {}),
    userId,
    orgId
  } as PerformancePlanPreviewRequest;
}

async function buildDashboardCustomerSummary(
  db: ApiDatabase,
  org: EnterpriseOrg,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): Promise<DashboardCustomerSummary> {
  const normalizedOrg = ensureOrgContractFields(org);
  const now = new Date();
  const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(normalizedOrg, now), now);
  const usage = buildDashboardOrgUsageSnapshot(db, normalizedOrg, now, divisionId, permittedUserIds);
  const last30DaysThreshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  const customerUsers = db.users
    .filter((user) =>
      user.accountType === "enterprise" &&
      user.orgId === normalizedOrg.id &&
      (!permittedUserIds || permittedUserIds.has(user.id))
    )
    .sort((left, right) => left.email.localeCompare(right.email));
  const activeUserCount = customerUsers.filter((user) => user.status === "active").length;
  const dashboardUserCount = customerUsers.filter((user) => user.dashboardAccessEnabled === true).length;
  const simulationsLast30Days = usageSessionAccess.listByOrgRange(db, {
    orgId: normalizedOrg.id,
    startedAtFrom: new Date(last30DaysThreshold)
  }).filter((session) =>
    (!divisionId || (session.divisionId ?? null) === divisionId) &&
    (!permittedUserIds || permittedUserIds.has(session.userId))
  ).length;

  const scoresThisPeriod = scoreRecordAccess.listByOrgRange(db, {
    orgId: normalizedOrg.id,
    endedAtFrom: new Date(billing.periodStartAt),
    endedAtBefore: new Date(billing.periodEndAt),
    conclusiveOnly: true
  }).filter((record) =>
    (!divisionId || (record.divisionId ?? null) === divisionId) &&
    (!permittedUserIds || permittedUserIds.has(record.userId))
  );
  const recentScores = filterOrgScoreRecords(db, normalizedOrg.id, last30DaysThreshold, now.getTime(), divisionId, permittedUserIds);
  const previousScores = filterOrgScoreRecords(
    db,
    normalizedOrg.id,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );
  const trainingPacks = await listTrainingPacksForDashboardOrg(normalizedOrg.id);
  const customScenarioCount = ensureOrgCustomScenarioCollection(normalizedOrg).filter((scenario) => scenario.enabled !== false).length;
  const orgSessions = filterRecordsByDivision(
    listUsageSessions(db, { orgId: normalizedOrg.id }).filter((session) => !permittedUserIds || permittedUserIds.has(session.userId)),
    divisionId
  );
  const orgScores = filterRecordsByDivision(
    listScoreRecords(db, { orgId: normalizedOrg.id }).filter((record) => !permittedUserIds || permittedUserIds.has(record.userId)),
    divisionId
  );
  const latestActivityAt = maxIsoDate([
    ...orgSessions.map((session) => session.endedAt),
    ...orgScores.map((record) => record.endedAt)
  ]);

  return {
    orgId: normalizedOrg.id,
    orgName: normalizedOrg.name,
    orgStatus: normalizedOrg.status,
    contactName: normalizedOrg.contactName,
    contactEmail: normalizedOrg.contactEmail,
    industryLabels: normalizedOrg.activeIndustries.map((industryId) => INDUSTRY_LABELS[industryId] ?? industryId),
    createdAt: normalizedOrg.createdAt,
    nextRenewalAt: billing.nextRenewalAt,
    monthlyMinutesAllotted: normalizedOrg.monthlyMinutesAllotted,
    activeUserCount,
    totalUserCount: customerUsers.length,
    dashboardUserCount,
    simulationsLast30Days,
    usedMinutesThisPeriod: Math.round(usage.usedSeconds / 60),
    averageScoreThisPeriod:
      scoresThisPeriod.length > 0
        ? Math.round(scoresThisPeriod.reduce((total, record) => total + record.overallScore, 0) / scoresThisPeriod.length)
        : null,
    scoreDeltaLast30Days: averageScoreDelta(recentScores, previousScores),
    trainingPackCount: trainingPacks.length,
    activeTrainingPackCount: trainingPacks.filter((pack) => pack.active === true).length,
    customScenarioCount,
    latestActivityAt,
    customerUserEmails: customerUsers.map((user) => user.email)
  };
}

function buildDashboardCustomerTrend(
  db: ApiDatabase,
  org: EnterpriseOrg,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): DashboardCustomerTrendPoint[] {
  const points: DashboardCustomerTrendPoint[] = [];

  for (let offset = 2; offset >= 0; offset -= 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
    const sessions = filterOrgUsageSessions(db, org.id, monthStart.getTime(), monthEnd.getTime(), divisionId, permittedUserIds);
    const scores = filterOrgScoreRecords(db, org.id, monthStart.getTime(), monthEnd.getTime(), divisionId, permittedUserIds);
    const billedSeconds = sessions.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );

    points.push({
      label: formatDashboardMonthLabel(monthStart),
      periodStartAt: monthStart.toISOString(),
      periodEndAt: monthEnd.toISOString(),
      usageMinutes: roundMinutes(billedSeconds),
      simulations: sessions.length,
      averageScore: averageScore(scores)
    });
  }

  return points;
}

function buildDashboardCustomerUserRows(
  db: ApiDatabase,
  org: EnterpriseOrg,
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): DashboardCustomerUserPerformanceSummary[] {
  const last30DaysThreshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const sessions = filterOrgUsageSessions(db, org.id, last30DaysThreshold, now.getTime(), divisionId, permittedUserIds);
  const scores = filterOrgScoreRecords(db, org.id, last30DaysThreshold, now.getTime(), divisionId, permittedUserIds);

  const rows = db.users
    .filter((user) =>
      user.accountType === "enterprise" &&
      user.orgId === org.id &&
      (!permittedUserIds || permittedUserIds.has(user.id))
    )
    .sort((left, right) => left.email.localeCompare(right.email))
    .map((user): DashboardCustomerUserPerformanceSummary => {
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
      const latestActivityAt = maxIsoDate([latestSession?.endedAt ?? null, latestScore?.endedAt ?? null]);
      const latestScenarioId = latestScore?.scenarioId ?? latestSession?.scenarioId ?? null;

      return {
        userId: user.id,
        email: user.email,
        employeeId: user.employeeId ?? null,
        status: user.status,
        orgRole: user.orgRole,
        dashboardAccessEnabled: user.dashboardAccessEnabled === true,
        simulationsLast30Days: userSessions.length,
        usedMinutesLast30Days: roundMinutes(billedSeconds),
        averageScoreLast30Days: averageScore(userScores),
        latestActivityAt,
        lastScenarioTitle: latestScenarioId ? scenarioCatalog.get(latestScenarioId)?.title ?? latestScenarioId : null
      };
    });

  return divisionId ? rows.filter((row) => row.simulationsLast30Days > 0 || row.averageScoreLast30Days !== null) : rows;
}

function buildDashboardCustomerScenarioRows(
  db: ApiDatabase,
  org: EnterpriseOrg,
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): DashboardCustomerScenarioSummary[] {
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const sessions = filterOrgUsageSessions(db, org.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const currentScores = filterOrgScoreRecords(db, org.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const previousScores = filterOrgScoreRecords(
    db,
    org.id,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );

  const aggregates = new Map<
    string,
    {
      scenarioId: string;
      segmentId: string;
      attempts: number;
      learnerIds: Set<string>;
      latestActivityAt: string | null;
      totalScore: number;
      scoreCount: number;
      previousTotalScore: number;
      previousScoreCount: number;
      userScores: Map<string, { totalScore: number; count: number }>;
    }
  >();

  function ensureScenarioAggregate(scenarioId: string, segmentId: string) {
    const existing = aggregates.get(scenarioId);
    if (existing) {
      return existing;
    }

    const created = {
      scenarioId,
      segmentId,
      attempts: 0,
      learnerIds: new Set<string>(),
      latestActivityAt: null,
      totalScore: 0,
      scoreCount: 0,
      previousTotalScore: 0,
      previousScoreCount: 0,
      userScores: new Map<string, { totalScore: number; count: number }>()
    };
    aggregates.set(scenarioId, created);
    return created;
  }

  for (const session of sessions) {
    const aggregate = ensureScenarioAggregate(session.scenarioId, session.segmentId);
    aggregate.attempts += 1;
    aggregate.learnerIds.add(session.userId);
    aggregate.latestActivityAt = maxIsoDate([aggregate.latestActivityAt, session.endedAt]);
  }

  for (const record of currentScores) {
    const aggregate = ensureScenarioAggregate(record.scenarioId, record.segmentId);
    aggregate.totalScore += record.overallScore;
    aggregate.scoreCount += 1;
    aggregate.latestActivityAt = maxIsoDate([aggregate.latestActivityAt, record.endedAt]);
    const existingUser = aggregate.userScores.get(record.userId) ?? { totalScore: 0, count: 0 };
    aggregate.userScores.set(record.userId, {
      totalScore: existingUser.totalScore + record.overallScore,
      count: existingUser.count + 1
    });
  }

  for (const record of previousScores) {
    const aggregate = ensureScenarioAggregate(record.scenarioId, record.segmentId);
    aggregate.previousTotalScore += record.overallScore;
    aggregate.previousScoreCount += 1;
  }

  return Array.from(aggregates.values())
    .map((aggregate): DashboardCustomerScenarioSummary => {
      const meta = scenarioCatalog.get(aggregate.scenarioId);
      const topUser = Array.from(aggregate.userScores.entries())
        .map(([userId, value]) => ({
          user: getUserById(db, userId),
          averageScore: value.count > 0 ? value.totalScore / value.count : 0
        }))
        .sort((left, right) => right.averageScore - left.averageScore)[0];
      const averageScoreLast30Days =
        aggregate.scoreCount > 0 ? Math.round(aggregate.totalScore / aggregate.scoreCount) : null;
      const previousAverageScore =
        aggregate.previousScoreCount > 0 ? aggregate.previousTotalScore / aggregate.previousScoreCount : null;

      return {
        scenarioId: aggregate.scenarioId,
        title: meta?.title ?? aggregate.scenarioId,
        summary: meta?.summary ?? null,
        segmentId: meta?.segmentId ?? aggregate.segmentId,
        segmentLabel: meta?.segmentLabel ?? aggregate.segmentId,
        source: meta?.source ?? "standard",
        attemptsLast30Days: aggregate.attempts,
        learnerCountLast30Days: aggregate.learnerIds.size,
        averageScoreLast30Days,
        scoreDeltaLast30Days:
          averageScoreLast30Days !== null && previousAverageScore !== null
            ? Math.round((averageScoreLast30Days - previousAverageScore) * 10) / 10
            : null,
        latestActivityAt: aggregate.latestActivityAt,
        topUserEmail: topUser?.user?.email ?? null,
        topUserAverageScore: topUser ? Math.round(topUser.averageScore) : null
      };
    })
    .sort((left, right) => {
      if (right.attemptsLast30Days !== left.attemptsLast30Days) {
        return right.attemptsLast30Days - left.attemptsLast30Days;
      }
      return (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
    });
}

async function buildDashboardTrainingPackRows(
  db: ApiDatabase,
  org: EnterpriseOrg,
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): Promise<DashboardCustomerTrainingPackSummary[]> {
  const packs = await listTrainingPacksForDashboardOrg(org.id);
  const availableScenarioCount = scenarioCatalog.size;
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const allPackSessions = filterRecordsByDivision(
    listUsageSessions(db, { orgId: org.id }).filter(
      (session) => Boolean(session.trainingPackId) && (!permittedUserIds || permittedUserIds.has(session.userId))
    ),
    divisionId
  );
  const allPackScores = filterRecordsByDivision(
    listScoreRecords(db, { orgId: org.id, conclusiveOnly: true }).filter(
      (record) => Boolean(record.trainingPackId) && (!permittedUserIds || permittedUserIds.has(record.userId))
    ),
    divisionId
  );
  const currentSessions = allPackSessions.filter((session) => {
    const startedAtMs = new Date(session.startedAt).getTime();
    return Number.isFinite(startedAtMs) && startedAtMs >= last30DaysThreshold && startedAtMs < nowMs;
  });
  const currentScores = allPackScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < nowMs;
  });
  const previousScores = allPackScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= previous30DaysThreshold && endedAtMs < last30DaysThreshold;
  });

  return packs
    .slice()
    .sort(
      (left, right) =>
        Number(right.active === true) - Number(left.active === true) ||
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )
    .map((pack): DashboardCustomerTrainingPackSummary => {
      const selection = parseTrainingPackScenarioSelection(pack.requiredBehavioralTriggers ?? []);
      const requiredScenarioIds = resolveTrainingPackRequiredScenarioIds(pack, scenarioCatalog);
      const selectedScenarioCount =
        selection.mode === "all" ? availableScenarioCount : selection.mode === "selected" ? selection.selectedScenarioIds.length : 0;
      const requiredBehaviorCount = (pack.requiredBehavioralTriggers ?? []).filter(
        (entry) => !entry.toLowerCase().startsWith(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX)
      ).length;
      const packAllSessions = allPackSessions.filter((session) => session.trainingPackId === pack.id);
      const packAllScores = allPackScores.filter((record) => record.trainingPackId === pack.id);
      const packSessions = currentSessions.filter((session) => session.trainingPackId === pack.id);
      const packScores = currentScores.filter((record) => record.trainingPackId === pack.id);
      const previousPackScores = previousScores.filter((record) => record.trainingPackId === pack.id);
      const assignments = listVisibleTrainingPackAssignments(db, org.id, pack.id).map((assignment) =>
        projectTrainingPackAssignmentLifecycle(db, assignment)
      ).filter((assignment) => !permittedUserIds || permittedUserIds.has(assignment.userId));
      const assignmentRows = assignments
        .map((assignment) =>
          computeTrainingPackAssignmentProgress({
            db,
            assignment,
            scenarioCatalog,
            allSessions: packAllSessions,
            allScores: packAllScores,
            recentSessions: packSessions,
            recentScores: packScores
          })
        )
        .filter((row) => !divisionId || row.status !== "not_started");
      const completionSupported =
        requiredScenarioIds.length > 0 || assignments.some((assignment) => assignment.requiredScenarioIds.length > 0);
      const learnerCount = new Set<string>([
        ...packSessions.map((session) => session.userId),
        ...packScores.map((record) => record.userId)
      ]).size;
      const latestActivityAt = maxIsoDate([
        ...packSessions.map((session) => session.endedAt),
        ...packScores.map((record) => record.endedAt)
      ]);

      return {
        trainingPackId: pack.id,
        title: pack.title,
        trainingTopic: pack.trainingTopic,
        audienceLevel: pack.audienceLevel,
        active: pack.active === true,
        objectiveCount: (pack.learningObjectives ?? []).length,
        selectedScenarioCount: selection.mode === "none" ? 0 : selectedScenarioCount,
        scenarioSelectionMode: selection.mode,
        scenarioSelectionLabel:
          selection.mode === "all"
            ? `All enabled scenarios (${availableScenarioCount})`
            : selection.mode === "selected"
              ? `${selectedScenarioCount} selected`
              : "No scenario mapping stored",
        requiredBehaviorCount,
        completionSupported,
        requiredScenarioCount: requiredScenarioIds.length,
        assignedLearnerCount: assignmentRows.length,
        startedLearnerCount: assignmentRows.filter((row) => row.status !== "not_started").length,
        completedLearnerCount: assignmentRows.filter((row) => row.status === "completed").length,
        inProgressLearnerCount: assignmentRows.filter((row) => row.status === "in_progress").length,
        notStartedLearnerCount: assignmentRows.filter((row) => row.status === "not_started").length,
        attemptsLast30Days: packSessions.length,
        scoredAttemptsLast30Days: packScores.length,
        learnerCountLast30Days: learnerCount,
        averageScoreLast30Days: averageScore(packScores),
        scoreDeltaLast30Days: averageScoreDelta(packScores, previousPackScores),
        latestActivityAt,
        updatedAt: pack.updatedAt,
        createdAt: pack.createdAt
      };
    });
}

function isDashboardDivisionScopedAssignmentVisible(
  row: Pick<DashboardTrainingPackAssignmentProgressRow, "status">,
  divisionId: string | null
): boolean {
  return !divisionId || row.status !== "not_started";
}

async function buildDashboardTrainingPackDetail(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  trainingPackId: string,
  divisionId: string | null = null,
  explicitOrgId: string | null = null
): Promise<DashboardTrainingPackDetailResponse | null> {
  const viewer = principal.viewer;
  const located = await findDashboardAccessibleTrainingPack(db, viewer, trainingPackId, explicitOrgId);
  if (!located) {
    return null;
  }

  const { org, pack, scenarioCatalog } = located;
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: new Set([org.id]),
  });
  const now = new Date();
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const packRows = await buildDashboardTrainingPackRows(db, org, scenarioCatalog, now, divisionId, permittedUserIds);
  const packSummary = packRows.find((row) => row.trainingPackId === pack.id);
  if (!packSummary) {
    return null;
  }

  const allPackSessions = filterRecordsByDivision(
    listUsageSessions(db, { orgId: org.id, trainingPackId: pack.id }).filter((session) =>
      permittedUserIds.has(session.userId)
    ),
    divisionId
  );
  const allPackScores = filterRecordsByDivision(
    listScoreRecords(db, { orgId: org.id, trainingPackId: pack.id, conclusiveOnly: true }).filter((record) =>
      permittedUserIds.has(record.userId)
    ),
    divisionId
  );
  const recentPackSessions = allPackSessions.filter((session) => {
    const startedAtMs = new Date(session.startedAt).getTime();
    return Number.isFinite(startedAtMs) && startedAtMs >= last30DaysThreshold && startedAtMs < nowMs;
  });
  const recentPackScores = allPackScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < nowMs;
  });
  const previousPackScores = allPackScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= previous30DaysThreshold && endedAtMs < last30DaysThreshold;
  });
  const assignmentProgressRows = listVisibleTrainingPackAssignments(db, org.id, pack.id)
    .filter((assignment) => permittedUserIds.has(assignment.userId))
    .map((assignment) => projectTrainingPackAssignmentLifecycle(db, assignment))
    .map((assignment) => {
      const progress = computeTrainingPackAssignmentProgress({
        db,
        assignment,
        scenarioCatalog,
        allSessions: allPackSessions,
        allScores: allPackScores,
        recentSessions: recentPackSessions,
        recentScores: recentPackScores
      });
      return { assignment, progress };
    })
    .filter((entry) => isDashboardDivisionScopedAssignmentVisible(entry.progress, divisionId));
  const assignmentRows = assignmentProgressRows
    .map((entry) => entry.progress)
    .sort((left, right) => {
      if (left.status !== right.status) {
        const order: Record<TrainingPackAssignmentProgressStatus, number> = {
          in_progress: 0,
          not_started: 1,
          completed: 2
        };
        return order[left.status] - order[right.status];
      }
      const latestDelta =
        (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.email.localeCompare(right.email);
    });
  const requiredScenarioIds = resolveTrainingPackRequiredScenarioIds(pack, scenarioCatalog);
  const scenarioRows = buildTrainingPackScenarioProgressRows({
    requiredScenarioIds,
    assignments: assignmentProgressRows.map((entry) => entry.assignment),
    scenarioCatalog,
    packSessions: allPackSessions,
    packScores: allPackScores,
    recentPackSessions,
    recentPackScores
  });

  return {
    viewer,
    pack: {
      ...packSummary,
      orgId: org.id,
      orgName: org.name,
      trainingPackAttribution: buildTrainingPackAttributionSummary({
        usageSessions: recentPackSessions,
        scoreRecords: recentPackScores
      }),
      coachingInsights: buildDashboardCoachingInsights({
        currentScores: recentPackScores,
        previousScores: previousPackScores
      }),
      scenarios: scenarioRows,
      assignments: assignmentRows,
      trend: buildTrainingPackTrendPoints(allPackSessions, allPackScores, now)
    }
  };
}

function findRelatedUsageSessionForScore(
  sessions: UsageSessionRecord[],
  score: SimulationScoreRecord
): UsageSessionRecord | null {
  return simulationHistoryAccess.findRelatedUsageSessionForScore(sessions, score);
}

function buildTrainingPackTitleMap(packs: TrainingPack[]): Map<string, string> {
  const titles = new Map<string, string>();
  packs.forEach((pack) => titles.set(pack.id, pack.title));
  return titles;
}

function findAssignmentForUserPackActivity(
  db: ApiDatabase,
  orgId: string,
  userId: string,
  trainingPackId: string | null | undefined,
  activityAt: string
): TrainingPackAssignmentRecord | null {
  if (!trainingPackId) {
    return null;
  }

  const activityAtMs = new Date(activityAt).getTime();
  const assignments = listTrainingPackAssignments(db, orgId, trainingPackId, { activeOnly: false })
    .filter((assignment) => assignment.userId === userId)
    .sort((left, right) => new Date(right.assignedAt).getTime() - new Date(left.assignedAt).getTime());

  for (const assignment of assignments) {
    const assignedAtMs = new Date(assignment.assignedAt).getTime();
    if (Number.isFinite(assignedAtMs) && Number.isFinite(activityAtMs) && assignedAtMs <= activityAtMs) {
      return projectTrainingPackAssignmentLifecycle(db, assignment);
    }
  }

  return assignments[0] ? projectTrainingPackAssignmentLifecycle(db, assignments[0]) : null;
}

function buildDashboardAttemptHistoryRowFromScore(params: {
  db: ApiDatabase;
  score: SimulationScoreRecord;
  user: UserProfile;
  org: EnterpriseOrg | null;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  trainingPackTitles: Map<string, string>;
  relatedSession: UsageSessionRecord | null;
  assignment: TrainingPackAssignmentRecord | null;
}): DashboardAttemptHistoryRow {
  return buildDashboardAttemptHistoryRowFromScorePayload({
    score: params.score,
    user: params.user,
    org: params.org,
    scenarioCatalog: params.scenarioCatalog,
    trainingPackTitles: params.trainingPackTitles,
    relatedSession: params.relatedSession,
    assignment: params.assignment
  });
}

function buildDashboardAttemptHistoryRowFromSession(params: {
  session: UsageSessionRecord;
  user: UserProfile;
  org: EnterpriseOrg | null;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  trainingPackTitles: Map<string, string>;
  assignment: TrainingPackAssignmentRecord | null;
}): DashboardAttemptHistoryRow {
  const { session, user, org, scenarioCatalog, trainingPackTitles, assignment } = params;
  const scenarioMeta = scenarioCatalog.get(session.scenarioId);

  return {
    activityId: session.id,
    activityKind: "usage_only",
    userId: user.id,
    userEmail: user.email,
    userStatus: user.status,
    orgId: org?.id ?? null,
    orgName: org?.name ?? null,
    scenarioId: session.scenarioId,
    scenarioTitle: scenarioMeta?.title ?? session.scenarioId,
    segmentId: session.segmentId,
    segmentLabel: scenarioMeta?.segmentLabel ?? session.segmentId,
    trainingPackId: session.trainingPackId ?? null,
    trainingPackTitle: session.trainingPackId ? trainingPackTitles.get(session.trainingPackId) ?? session.trainingPackId : null,
    packAttributed: Boolean(session.trainingPackId),
    assignmentId: assignment?.id ?? null,
    assignmentContextStatus: resolveDashboardAttemptActivityAssignmentStatus({
      assignment,
      activityAt: session.endedAt,
      scenarioId: session.scenarioId,
      isScored: false
    }),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    rawDurationSeconds: session.rawDurationSeconds,
    overallScore: null,
    summary: null,
    coachingPriority: null,
    model: null,
    promptVersion: null,
    rubricVersion: null
  };
}

function sortDashboardAttemptHistoryRows(rows: DashboardAttemptHistoryRow[]): DashboardAttemptHistoryRow[] {
  return rows
    .slice()
    .sort((left, right) => {
      const byTime = new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime();
      if (byTime !== 0) {
        return byTime;
      }
      if (left.activityKind !== right.activityKind) {
        return left.activityKind === "scored_attempt" ? -1 : 1;
      }
      return left.activityId.localeCompare(right.activityId);
    });
}

async function buildDashboardTrainingPackAssignmentDetail(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  trainingPackId: string,
  assignmentId: string,
  divisionId: string | null = null,
  explicitOrgId: string | null = null
): Promise<DashboardTrainingPackAssignmentDetailResponse | null> {
  const viewer = principal.viewer;
  const located = await findDashboardAccessibleTrainingPack(db, viewer, trainingPackId, explicitOrgId);
  if (!located) {
    return null;
  }

  const { org, pack, scenarioCatalog } = located;
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: new Set([org.id]),
  });
  const assignment = listVisibleTrainingPackAssignments(db, org.id, pack.id)
    .filter((entry) => permittedUserIds.has(entry.userId))
    .find((entry) => entry.id === assignmentId);
  if (!assignment) {
    return null;
  }

  const user = getUserById(db, assignment.userId);
  if (!user || !isTrainingPackAssignmentValidForUser(assignment, user)) {
    return null;
  }

  const packRows = await buildDashboardTrainingPackRows(db, org, scenarioCatalog, new Date(), divisionId, permittedUserIds);
  const packSummary = packRows.find((row) => row.trainingPackId === pack.id);
  if (!packSummary) {
    return null;
  }

  const packSessions = filterRecordsByDivision(
    listUsageSessions(db, {
      orgId: org.id,
      userId: assignment.userId,
      trainingPackId: pack.id
    }),
    divisionId
  );
  const packScores = filterRecordsByDivision(
    listScoreRecords(db, {
      orgId: org.id,
      userId: assignment.userId,
      trainingPackId: pack.id,
      conclusiveOnly: true
    }),
    divisionId
  );
  const projectedAssignment = projectTrainingPackAssignmentLifecycle(db, assignment);
  const assignmentRow = computeTrainingPackAssignmentProgress({
    db,
    assignment: projectedAssignment,
    scenarioCatalog,
    allSessions: packSessions,
    allScores: packScores,
    recentSessions: packSessions,
    recentScores: packScores
  });
  if (!isDashboardDivisionScopedAssignmentVisible(assignmentRow, divisionId)) {
    return null;
  }
  const trainingPackTitles = buildTrainingPackTitleMap([pack]);
  const usedSessionIds = new Set<string>();
  const attemptRows: DashboardAttemptHistoryRow[] = [];

  for (const score of packScores) {
    const relatedSession = findRelatedUsageSessionForScore(packSessions, score);
    if (relatedSession) {
      usedSessionIds.add(relatedSession.id);
    }
    attemptRows.push(
      buildDashboardAttemptHistoryRowFromScore({
        db,
        score,
        user,
        org,
        scenarioCatalog,
        trainingPackTitles,
        relatedSession,
        assignment: projectedAssignment
      })
    );
  }

  for (const session of packSessions) {
    if (usedSessionIds.has(session.id)) {
      continue;
    }
    attemptRows.push(
      buildDashboardAttemptHistoryRowFromSession({
        session,
        user,
        org,
        scenarioCatalog,
        trainingPackTitles,
        assignment: projectedAssignment
      })
    );
  }

  const requiredScenarios: DashboardTrainingPackAssignmentRequiredScenarioRow[] = projectedAssignment.requiredScenarioIds.map((scenarioId) => {
    const scenarioMeta = scenarioCatalog.get(scenarioId);
    return {
      scenarioId,
      title: scenarioMeta?.title ?? scenarioId,
      segmentId: scenarioMeta?.segmentId ?? "unknown",
      segmentLabel: scenarioMeta?.segmentLabel ?? null,
      source: scenarioMeta?.source ?? "unknown"
    };
  });

  return {
    viewer,
    pack: {
      ...packSummary,
      orgId: org.id,
      orgName: org.name
    },
    assignment: {
      ...assignmentRow,
      completionRule: projectedAssignment.completionRule,
      requiredScenarios
    },
    attempts: sortDashboardAttemptHistoryRows(attemptRows)
  };
}

async function buildDashboardUserDetail(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  userId: string,
  divisionId: string | null = null
): Promise<DashboardUserDetailResponse | null> {
  const viewer = principal.viewer;
  const report = await buildDashboardUserReport(db, principal, divisionId);
  const userRow = report.users.find((entry) => entry.userId === userId);
  if (!userRow || !userRow.orgId) {
    return null;
  }

  const org = getOrgById(db, userRow.orgId);
  const user = getUserById(db, userId);
  if (!org || !user || !canDashboardViewerAccessOrg(viewer, org.id)) {
    return null;
  }

  const scenarioCatalog = buildDashboardScenarioCatalog(db, org);
  const packs = await listTrainingPacksForDashboardOrg(org.id);
  const trainingPackTitles = buildTrainingPackTitleMap(packs);
  const userSessions = filterRecordsByDivision(listUsageSessions(db, { userId: user.id, orgId: org.id }), divisionId);
  const userScores = filterRecordsByDivision(
    listScoreRecords(db, { userId: user.id, orgId: org.id, conclusiveOnly: true }),
    divisionId
  );
  const now = Date.now();
  const last30DaysThreshold = now - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = now - 60 * 24 * 60 * 60 * 1000;
  const recentUserScores = userScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < now;
  });
  const previousUserScores = userScores.filter((record) => {
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= previous30DaysThreshold && endedAtMs < last30DaysThreshold;
  });
  const assignments = (db.trainingPackAssignments ?? [])
    .filter((assignment) =>
      assignment.active === true &&
      assignment.userId === user.id &&
      assignment.orgId === org.id &&
      isTrainingPackAssignmentValidForUser(assignment, user)
    )
    .map((assignment) => projectTrainingPackAssignmentLifecycle(db, assignment));
  const assignmentRows: DashboardUserAssignmentSummaryRow[] = assignments
    .flatMap((assignment) => {
      const pack = packs.find((entry) => entry.id === assignment.trainingPackId);
      const packSessions = userSessions.filter((session) => session.trainingPackId === assignment.trainingPackId);
      const packScores = userScores.filter((record) => record.trainingPackId === assignment.trainingPackId);
      const progress = computeTrainingPackAssignmentProgress({
        db,
        assignment,
        scenarioCatalog,
        allSessions: packSessions,
        allScores: packScores,
        recentSessions: packSessions,
        recentScores: packScores
      });

      if (divisionId && progress.status === "not_started") {
        return [];
      }

      return [{
        assignmentId: assignment.id,
        trainingPackId: assignment.trainingPackId,
        trainingPackTitle: pack?.title ?? assignment.trainingPackId,
        status: progress.status,
        assignedAt: progress.assignedAt,
        startedAt: progress.startedAt,
        completedAt: progress.completedAt,
        requiredScenarioCount: progress.requiredScenarioCount,
        completedScenarioCount: progress.completedScenarioCount
      }];
    })
    .sort((left, right) => {
      const latestDelta =
        (new Date(right.completedAt ?? right.startedAt ?? right.assignedAt).getTime() || 0) -
        (new Date(left.completedAt ?? left.startedAt ?? left.assignedAt).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.trainingPackTitle.localeCompare(right.trainingPackTitle);
    });

  const attemptRows = sortDashboardAttemptHistoryRows(
    userScores.map((score) => {
      return buildDashboardAttemptHistoryRowFromScore({
        db,
        score,
        user,
        org,
        scenarioCatalog,
        trainingPackTitles,
        relatedSession: findRelatedUsageSessionForScore(userSessions, score),
        assignment: findAssignmentForUserPackActivity(db, org.id, user.id, score.trainingPackId ?? null, score.endedAt)
      });
    })
  ).slice(0, 40);

  return {
    viewer,
    user: userRow,
    coachingInsights: buildDashboardCoachingInsights({
      currentScores: recentUserScores,
      previousScores: previousUserScores
    }),
    assignments: assignmentRows,
    attempts: attemptRows,
    divisionScope: report.divisionScope
  };
}

async function buildDashboardAttemptDetail(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  attemptId: string,
  divisionId: string | null = null
): Promise<DashboardAttemptDetailResponse | null> {
  const viewer = principal.viewer;
  const score = scoreRecordAccess.getById(db, attemptId);
  if (!score || !isConclusiveSimulationScoreRecord(score) || !score.orgId || !canDashboardViewerAccessOrg(viewer, score.orgId)) {
    return null;
  }
  if (divisionId && (score.divisionId ?? null) !== divisionId) {
    return null;
  }

  const org = getOrgById(db, score.orgId);
  const user = getUserById(db, score.userId);
  if (!org || !user) {
    return null;
  }
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: new Set([org.id]),
  });
  if (!permittedUserIds.has(user.id)) {
    return null;
  }

  const scenarioCatalog = buildDashboardScenarioCatalog(db, org);
  const packs = await listTrainingPacksForDashboardOrg(org.id);
  const trainingPackTitles = buildTrainingPackTitleMap(packs);
  const scopedSessions = filterRecordsByDivision(listUsageSessions(db, { userId: score.userId, orgId: org.id }), divisionId);
  const attempt = buildDashboardAttemptDetailAttemptPayload({
    score,
    user,
    org,
    scenarioCatalog,
    trainingPackTitles,
    industryLabelById: new Map(Object.entries(INDUSTRY_LABELS)),
    relatedSession: findRelatedUsageSessionForScore(scopedSessions, score),
    assignment: findAssignmentForUserPackActivity(db, org.id, user.id, score.trainingPackId ?? null, score.endedAt)
  });

  return {
    viewer,
    attempt
  };
}

function isActivityInDashboardTrainingScope(
  entry: Pick<UsageSessionRecord, "trainingId" | "trainingPackId" | "scenarioId">,
  trainingId: string,
  attachedTrainingPackIds: ReadonlySet<string>,
  attachedScenarioIds: ReadonlySet<string>
): boolean {
  const explicitTrainingId = typeof entry.trainingId === "string" ? entry.trainingId.trim() : "";
  if (explicitTrainingId) {
    return explicitTrainingId === trainingId;
  }

  if (entry.trainingPackId && attachedTrainingPackIds.has(entry.trainingPackId)) {
    return true;
  }

  return attachedScenarioIds.has(entry.scenarioId);
}

function buildDashboardTrainingScoreInsights(
  scores: SimulationScoreRecord[]
): {
  strongestArea: DashboardTrainingWorkspaceInsightMetric | null;
  weakestArea: DashboardTrainingWorkspaceInsightMetric | null;
} {
  if (scores.length === 0) {
    return {
      strongestArea: null,
      weakestArea: null,
    };
  }

  const scoreAreas = [
    {
      label: "Persuasion",
      averageScoreLast30Days:
        scores.reduce((total, record) => total + record.persuasion, 0) / scores.length,
    },
    {
      label: "Clarity",
      averageScoreLast30Days: scores.reduce((total, record) => total + record.clarity, 0) / scores.length,
    },
    {
      label: "Empathy",
      averageScoreLast30Days: scores.reduce((total, record) => total + record.empathy, 0) / scores.length,
    },
    {
      label: "Assertiveness",
      averageScoreLast30Days:
        scores.reduce((total, record) => total + record.assertiveness, 0) / scores.length,
    },
  ]
    .map((entry) => ({
      ...entry,
      averageScoreLast30Days: Math.round(entry.averageScoreLast30Days * 10) / 10,
    }))
    .sort((left, right) => right.averageScoreLast30Days - left.averageScoreLast30Days);

  return {
    strongestArea: scoreAreas[0] ?? null,
    weakestArea: scoreAreas[scoreAreas.length - 1] ?? null,
  };
}

function buildDashboardTrainingWorkspaceUserRows(params: {
  db: ApiDatabase;
  org: EnterpriseOrg;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  sessions: UsageSessionRecord[];
  scores: SimulationScoreRecord[];
}): DashboardTrainingWorkspaceUserRow[] {
  const userIds = new Set<string>([
    ...params.sessions.map((session) => session.userId),
    ...params.scores.map((record) => record.userId),
  ]);

  return Array.from(userIds)
    .map((userId): DashboardTrainingWorkspaceUserRow | null => {
      const user = getUserById(params.db, userId);
      if (!user || user.accountType !== "enterprise" || user.orgId !== params.org.id) {
        return null;
      }

      const userSessions = params.sessions.filter((session) => session.userId === userId);
      const userScores = params.scores.filter((record) => record.userId === userId);
      const latestSession = userSessions
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];
      const latestScore = userScores
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];
      const latestActivityAt = maxIsoDate([latestSession?.endedAt ?? null, latestScore?.endedAt ?? null]);
      const latestScenarioId = latestScore?.scenarioId ?? latestSession?.scenarioId ?? null;

      return {
        userId: user.id,
        email: user.email,
        employeeId: user.employeeId ?? null,
        orgId: params.org.id,
        orgName: params.org.name,
        status: user.status,
        orgRole: user.orgRole,
        attemptsLast30Days: userSessions.length,
        averageScoreLast30Days: averageScore(userScores),
        latestActivityAt,
        latestScenarioTitle: latestScenarioId
          ? params.scenarioCatalog.get(latestScenarioId)?.title ?? latestScenarioId
          : null,
      };
    })
    .filter((entry): entry is DashboardTrainingWorkspaceUserRow => Boolean(entry))
    .sort((left, right) => {
      if (right.attemptsLast30Days !== left.attemptsLast30Days) {
        return right.attemptsLast30Days - left.attemptsLast30Days;
      }
      const latestDelta =
        (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.email.localeCompare(right.email, undefined, { sensitivity: "base" });
    });
}

function buildDashboardTrainingWorkspaceScenarioRows(params: {
  scenarioIds: Iterable<string>;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
  sessions: UsageSessionRecord[];
  scores: SimulationScoreRecord[];
}): DashboardTrainingWorkspaceScenarioRow[] {
  return Array.from(new Set(Array.from(params.scenarioIds).map((entry) => entry.trim()).filter(Boolean)))
    .map((scenarioId): DashboardTrainingWorkspaceScenarioRow => {
      const sessionRows = params.sessions.filter((session) => session.scenarioId === scenarioId);
      const scoreRows = params.scores.filter((record) => record.scenarioId === scenarioId);
      const meta = params.scenarioCatalog.get(scenarioId);

      return {
        scenarioId,
        title: meta?.title ?? scenarioId,
        segmentId: meta?.segmentId ?? "unknown",
        segmentLabel: meta?.segmentLabel ?? "Unknown",
        source: meta?.source ?? "unknown",
        attemptsLast30Days: sessionRows.length,
        averageScoreLast30Days: averageScore(scoreRows),
        latestActivityAt: maxIsoDate([
          ...sessionRows.map((session) => session.endedAt),
          ...scoreRows.map((record) => record.endedAt),
        ]),
      };
    })
    .sort((left, right) => {
      if (right.attemptsLast30Days !== left.attemptsLast30Days) {
        return right.attemptsLast30Days - left.attemptsLast30Days;
      }
      const latestDelta =
        (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    });
}

async function buildDashboardTrainingWorkspaceRowsForOrg(
  db: ApiDatabase,
  org: EnterpriseOrg,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): Promise<DashboardTrainingWorkspaceRow[]> {
  ensureOrgTrainingCollections(db);
  const normalizedOrg = ensureOrgContractFields(org);
  const scenarioCatalog = buildDashboardScenarioCatalog(db, normalizedOrg);
  const trainingPacks = await listTrainingPacksForDashboardOrg(normalizedOrg.id);
  const validTrainingPackIds = new Set(trainingPacks.map((pack) => pack.id));
  const validScenarioIds = new Set(ensureOrgCustomScenarioCollection(normalizedOrg).map((scenario) => scenario.id));
  const trainingPackById = new Map(trainingPacks.map((pack) => [pack.id, pack]));
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const recentSessions = filterOrgUsageSessions(db, normalizedOrg.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const recentScores = filterOrgScoreRecords(db, normalizedOrg.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const previousScores = filterOrgScoreRecords(
    db,
    normalizedOrg.id,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );

  const rows = buildOrgTrainingSummaries({
    db,
    orgId: normalizedOrg.id,
    validTrainingPackIds,
    validScenarioIds,
  }).map((training): DashboardTrainingWorkspaceRow => {
    const attachedTrainingPackIds = new Set(training.attachedTrainingPackIds);
    const attachedScenarioIds = new Set(training.attachedCustomScenarioIds);
    const scopedSessions = recentSessions.filter((session) =>
      isActivityInDashboardTrainingScope(session, training.id, attachedTrainingPackIds, attachedScenarioIds)
    );
    const scopedScores = recentScores.filter((record) =>
      isActivityInDashboardTrainingScope(record, training.id, attachedTrainingPackIds, attachedScenarioIds)
    );
    const scopedPreviousScores = previousScores.filter((record) =>
      isActivityInDashboardTrainingScope(record, training.id, attachedTrainingPackIds, attachedScenarioIds)
    );

    const relevantScenarioIds = new Set<string>([
      ...training.attachedCustomScenarioIds,
      ...scopedSessions.map((session) => session.scenarioId),
      ...scopedScores.map((record) => record.scenarioId),
      ...scopedPreviousScores.map((record) => record.scenarioId),
    ]);

    for (const trainingPackId of training.attachedTrainingPackIds) {
      const trainingPack = trainingPackById.get(trainingPackId);
      if (!trainingPack) {
        continue;
      }
      resolveTrainingPackRequiredScenarioIds(trainingPack, scenarioCatalog).forEach((scenarioId) =>
        relevantScenarioIds.add(scenarioId)
      );
    }

    const users = buildDashboardTrainingWorkspaceUserRows({
      db,
      org: normalizedOrg,
      scenarioCatalog,
      sessions: scopedSessions,
      scores: scopedScores,
    });
    const scenarios = buildDashboardTrainingWorkspaceScenarioRows({
      scenarioIds: relevantScenarioIds,
      scenarioCatalog,
      sessions: scopedSessions,
      scores: scopedScores,
    });
    const scoreInsights = buildDashboardTrainingScoreInsights(scopedScores);
    const mostUsedScenarioRow = scenarios.find((scenario) => scenario.attemptsLast30Days > 0) ?? null;
    const lowestPerformingScenarioRow =
      scenarios
        .filter((scenario) => scenario.averageScoreLast30Days !== null)
        .sort((left, right) => {
          if ((left.averageScoreLast30Days ?? 0) !== (right.averageScoreLast30Days ?? 0)) {
            return (left.averageScoreLast30Days ?? 0) - (right.averageScoreLast30Days ?? 0);
          }
          return right.attemptsLast30Days - left.attemptsLast30Days;
        })[0] ?? null;

    return {
      ...training,
      orgName: normalizedOrg.name,
      summary: {
        totalAttemptsLast30Days: scopedSessions.length,
        averageScoreLast30Days: averageScore(scopedScores),
        activeLearnerCountLast30Days: new Set([
          ...scopedSessions.map((session) => session.userId),
          ...scopedScores.map((record) => record.userId),
        ]).size,
        totalScenarioCount: relevantScenarioIds.size,
        latestActivityAt: maxIsoDate([
          ...scopedSessions.map((session) => session.endedAt),
          ...scopedScores.map((record) => record.endedAt),
        ]),
      },
      insights: {
        strongestArea: scoreInsights.strongestArea,
        weakestArea: scoreInsights.weakestArea,
        mostUsedScenario: mostUsedScenarioRow
          ? {
              scenarioId: mostUsedScenarioRow.scenarioId,
              title: mostUsedScenarioRow.title,
              attemptsLast30Days: mostUsedScenarioRow.attemptsLast30Days,
            }
          : null,
        lowestPerformingScenario: lowestPerformingScenarioRow
          ? {
              scenarioId: lowestPerformingScenarioRow.scenarioId,
              title: lowestPerformingScenarioRow.title,
              averageScoreLast30Days: lowestPerformingScenarioRow.averageScoreLast30Days,
            }
          : null,
      },
      users,
      scenarios,
    };
  });

  return divisionId
    ? rows.filter((training) => training.summary.totalAttemptsLast30Days > 0 || training.summary.averageScoreLast30Days !== null)
    : rows;
}

async function buildDashboardTrainingWorkspace(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  divisionId: string | null = null
): Promise<DashboardTrainingWorkspaceResponse> {
  const viewer = principal.viewer;
  const now = new Date();
  const accessibleOrgIds = new Set(listDashboardAccessibleOrgs(db, viewer).map((org) => org.id));
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: accessibleOrgIds,
  });
  const trainings = (
    await Promise.all(
      listDashboardAccessibleOrgs(db, viewer).map((org) =>
        buildDashboardTrainingWorkspaceRowsForOrg(db, org, now, divisionId, permittedUserIds)
      )
    )
  )
    .flat()
    .sort((left, right) => {
      const statusOrder: Record<OrgTrainingStatus, number> = {
        active: 0,
        draft: 1,
        archived: 2,
      };
      if (statusOrder[left.status] !== statusOrder[right.status]) {
        return statusOrder[left.status] - statusOrder[right.status];
      }

      const updatedDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (Number.isFinite(updatedDelta) && updatedDelta !== 0) {
        return updatedDelta;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

  return {
    viewer,
    generatedAt: now.toISOString(),
    trainings,
    divisionScope:
      viewer.accessType === "customer_dashboard_user" && viewer.orgId
        ? resolveDashboardDivisionFilter({
            db,
            viewer,
            requestedDivisionId: divisionId,
          }).divisionScope
        : undefined,
  };
}

async function buildDashboardCustomerInsights(
  db: ApiDatabase,
  org: EnterpriseOrg,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): Promise<DashboardCustomerInsights> {
  const normalizedOrg = ensureOrgContractFields(org);
  const now = new Date();
  const usage = buildDashboardOrgUsageSnapshot(db, normalizedOrg, now, divisionId, permittedUserIds);
  const scenarioCatalog = buildDashboardScenarioCatalog(db, normalizedOrg);
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const recentSessions = filterOrgUsageSessions(db, normalizedOrg.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const recentScores = filterOrgScoreRecords(db, normalizedOrg.id, last30DaysThreshold, nowMs, divisionId, permittedUserIds);
  const previousScores = filterOrgScoreRecords(
    db,
    normalizedOrg.id,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );

  return {
    usage: {
      periodStartAt: usage.periodStartAt,
      periodEndAt: usage.periodEndAt,
      nextRenewalAt: usage.nextRenewalAt,
      usedMinutesThisPeriod: roundMinutes(usage.usedSeconds),
      allottedMinutesThisPeriod: usage.allottedMinutes,
      usagePercentThisPeriod: Math.round(usage.usagePercent * 10) / 10
    },
    trend: buildDashboardCustomerTrend(db, normalizedOrg, now, divisionId, permittedUserIds),
    trainingPacks: await buildDashboardTrainingPackRows(db, normalizedOrg, scenarioCatalog, now, divisionId, permittedUserIds),
    users: buildDashboardCustomerUserRows(db, normalizedOrg, scenarioCatalog, now, divisionId, permittedUserIds),
    scenarios: buildDashboardCustomerScenarioRows(db, normalizedOrg, scenarioCatalog, now, divisionId, permittedUserIds),
    trainingPackAttribution: buildTrainingPackAttributionSummary({
      usageSessions: recentSessions,
      scoreRecords: recentScores
    }),
    coachingInsights: buildDashboardCoachingInsights({
      currentScores: recentScores,
      previousScores
    })
  };
}

function listDashboardAccessibleOrgs(db: ApiDatabase, viewer: DashboardViewer): EnterpriseOrg[] {
  return viewer.accessType === "super_user"
    ? db.orgs.slice().sort((left, right) => left.name.localeCompare(right.name))
    : db.orgs.filter((org) => org.id === viewer.orgId);
}

interface DashboardAdminOrgContext {
  org: EnterpriseOrg;
  capabilities: DashboardAdminCapabilities;
}

function resolveDashboardAdminOrgContext(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  requestedOrgId: string | null,
  response: Response
): DashboardAdminOrgContext | null {
  let orgId: string | null = null;
  let capabilities = principal.viewer.capabilities;

  if (principal.viewer.accessType === "super_user") {
    if (!requestedOrgId) {
      response.status(400).json({
        error: "Select an organization before using Admin.",
        code: "dashboard_scope_denied",
      });
      return null;
    }
    if (!canDashboardViewerAccessOrg(principal.viewer, requestedOrgId)) {
      response.status(404).json({ error: "Organization not found." });
      return null;
    }
    orgId = requestedOrgId;
    capabilities = buildDashboardAdminCapabilities(null, { superUserOrgContext: true });
  } else {
    orgId = principal.viewer.orgId;
    if (requestedOrgId && requestedOrgId !== orgId) {
      response.status(404).json({ error: "Organization not found." });
      return null;
    }
  }

  const org = getOrgById(db, orgId);
  if (!org || org.status !== "active") {
    response.status(404).json({ error: "Organization not found." });
    return null;
  }

  return { org, capabilities };
}

function rejectMissingDashboardAdminCapability(
  capabilities: DashboardAdminCapabilities,
  capability: keyof DashboardAdminCapabilities,
  response: Response
): boolean {
  if (capabilities[capability]) {
    return false;
  }

  response.status(403).json({
    error: "Admin access is not available for this account.",
    code: "dashboard_scope_denied",
  });
  return true;
}

const TRAINING_CONTENT_CLIENT_OWNED_FIELDS = new Set([
  "orgid",
  "organizationid",
  "actorid",
  "storageprovider",
  "bucket",
  "bucketname",
  "temporaryobjectkey",
  "finalobjectkey",
  "objectkey",
  "version",
  "assetversion",
]);

function rejectTrainingContentClientOwnedFields(body: unknown, response: Response): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const rejectedFields = Object.keys(body).filter((field) => {
    const normalized = field.toLowerCase().replace(/[_-]+/g, "");
    return TRAINING_CONTENT_CLIENT_OWNED_FIELDS.has(normalized);
  });
  if (rejectedFields.length === 0) {
    return false;
  }
  response.status(400).json({
    error: "The request contains server-owned Training Content fields.",
    code: "training_content_server_owned_field",
    fields: rejectedFields.sort(),
  });
  return true;
}

interface ResolvedTrainingContentManagementResources {
  context: TrainingContentManagementRequestContext;
  references: TrainingContentReferenceData;
  org: EnterpriseOrg;
}

async function resolveTrainingContentManagementResources(
  request: DashboardAuthRequest,
  response: Response
): Promise<ResolvedTrainingContentManagementResources | null> {
  return withFreshDatabaseRead(async (db) => {
    const adminContext = resolveDashboardAdminOrgContext(
      db,
      request.dashboard!,
      getSingleQueryParam(request.query.orgId),
      response
    );
    if (!adminContext) {
      return null;
    }
    return {
      context: {
        orgId: adminContext.org.id,
        actorId: request.dashboard!.user.id,
        capabilities: adminContext.capabilities,
        actorType: "web_user",
      },
      references: {
        users: db.users.filter(
          (user) => user.accountType === "enterprise" && user.orgId === adminContext.org.id
        ),
        focusTopics: db.orgTrainings.filter(
          (topic) => topic.orgId === adminContext.org.id
        ),
        scenarioConfig: db.config,
        scenarioOrg: adminContext.org,
      },
      org: adminContext.org,
    };
  });
}

async function resolveTrainingContentManagementContext(
  request: DashboardAuthRequest,
  response: Response
): Promise<TrainingContentManagementRequestContext | null> {
  return (await resolveTrainingContentManagementResources(request, response))?.context ?? null;
}

function respondWithTrainingContentAssetError(error: unknown, response: Response): void {
  const mapped = mapTrainingContentAssetServiceError(error);
  response.status(mapped.status).json({
    error: mapped.message,
    code: mapped.code,
    ...(mapped.details ?? {}),
  });
}

function respondWithTrainingContentManagementError(error: unknown, response: Response): void {
  const mapped = mapTrainingContentManagementServiceError(error);
  response.status(mapped.status).json({
    error: mapped.message,
    code: mapped.code,
    ...(mapped.details ?? {}),
  });
}

function canDashboardAdminEditEmployeeId(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  target: UserProfile;
}): boolean {
  if (!params.capabilities.editEmployeeIds) {
    return false;
  }
  if (params.viewer.accessType === "super_user" || params.actor.orgRole === "org_admin") {
    return true;
  }
  return params.actor.orgRole === "user_admin" && canActorManageRegularUser({
    actor: params.actor,
    viewer: params.viewer,
    target: params.target,
  });
}

function canDashboardAdminEditNames(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  target: UserProfile;
}): boolean {
  if (!params.capabilities.editUserNames) {
    return false;
  }
  if (!canActorSeeOrganizationUser({ actor: params.actor, viewer: params.viewer, target: params.target })) {
    return false;
  }
  return params.viewer.accessType === "super_user" || params.actor.orgRole === "org_admin";
}

function canDashboardAdminChangeUserRole(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  target: UserProfile;
}): boolean {
  if (!params.capabilities.manageUserRoles || params.target.id === params.actor.id) {
    return false;
  }
  if (!canOrgAdminManageRole(params.target.orgRole)) {
    return false;
  }
  return params.viewer.accessType === "super_user" || params.actor.orgRole === "org_admin";
}

function canDashboardAdminAssignManager(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  target: UserProfile;
}): boolean {
  if (!params.capabilities.assignUserManagers) {
    return false;
  }
  if (!canManagerAssignmentTargetBeManaged(params.target)) {
    return false;
  }
  return params.viewer.accessType === "super_user" || params.actor.orgRole === "org_admin";
}

function canDashboardAdminChangeUserStatus(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  target: UserProfile;
  nextStatus: UserStatus;
  orgUsers: readonly UserProfile[];
}): boolean {
  if (!params.capabilities.manageRegularOrganizationUsers || params.target.id === params.actor.id) {
    return false;
  }
  if (params.target.orgRole === "org_admin") {
    if (params.viewer.accessType !== "super_user" && params.actor.orgRole !== "org_admin") {
      return false;
    }
    const activeOrgAdminCount = params.orgUsers.filter(
      (user) => user.orgRole === "org_admin" && user.status === "active"
    ).length;
    return params.nextStatus !== "disabled" || activeOrgAdminCount > 1;
  }
  if (params.viewer.accessType === "super_user" || params.actor.orgRole === "org_admin") {
    return params.target.orgRole === "user" || params.target.orgRole === "user_admin";
  }
  return params.actor.orgRole === "user_admin" && canActorManageRegularUser({
    actor: params.actor,
    viewer: params.viewer,
    target: params.target,
  });
}

function buildDashboardAdminManagerOptions(orgUsers: readonly UserProfile[], orgId: string): DashboardAdminManagerOption[] {
  return orgUsers
    .filter((user) => isEligibleManagerUser(user, orgId))
    .map((user) => ({
      userId: user.id,
      email: user.email,
      firstName: getUserFirstName(user),
      lastName: getUserLastName(user),
      displayName: resolveStoredUserDisplayName(user),
    }))
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
        left.email.localeCompare(right.email, undefined, { sensitivity: "base" }) ||
        left.userId.localeCompare(right.userId)
    );
}

function buildDashboardAdminUserRow(params: {
  actor: UserProfile;
  viewer: DashboardViewer;
  capabilities: DashboardAdminCapabilities;
  user: UserProfile;
  orgUsers: readonly UserProfile[];
}): DashboardAdminUserRow {
  const canDeactivate = params.user.status === "active" && canDashboardAdminChangeUserStatus({
    actor: params.actor,
    viewer: params.viewer,
    capabilities: params.capabilities,
    target: params.user,
    nextStatus: "disabled",
    orgUsers: params.orgUsers,
  });
  const canReactivate = params.user.status === "disabled" && canDashboardAdminChangeUserStatus({
    actor: params.actor,
    viewer: params.viewer,
    capabilities: params.capabilities,
    target: params.user,
    nextStatus: "active",
    orgUsers: params.orgUsers,
  });
  const managerUserId = normalizeManagerUserId(params.user.managerUserId);
  const manager = managerUserId ? params.orgUsers.find((user) => user.id === managerUserId) ?? null : null;

  return {
    userId: params.user.id,
    email: params.user.email,
    firstName: getUserFirstName(params.user),
    lastName: getUserLastName(params.user),
    displayName: resolveStoredUserDisplayName(params.user),
    employeeId: params.user.employeeId ?? null,
    orgRole: params.user.orgRole,
    managerUserId,
    managerDisplayName: manager ? resolveStoredUserDisplayName(manager) : null,
    managerEmail: manager?.email ?? null,
    assignedReportCount: params.orgUsers.filter((user) => normalizeManagerUserId(user.managerUserId) === params.user.id).length,
    status: params.user.status,
    dashboardAccessEnabled: params.user.dashboardAccessEnabled === true,
    canEditEmployeeId: canDashboardAdminEditEmployeeId({
      actor: params.actor,
      viewer: params.viewer,
      capabilities: params.capabilities,
      target: params.user,
    }),
    canEditNames: canDashboardAdminEditNames({
      actor: params.actor,
      viewer: params.viewer,
      capabilities: params.capabilities,
      target: params.user,
    }),
    canChangeRole: canDashboardAdminChangeUserRole({
      actor: params.actor,
      viewer: params.viewer,
      capabilities: params.capabilities,
      target: params.user,
    }),
    canAssignManager: canDashboardAdminAssignManager({
      actor: params.actor,
      viewer: params.viewer,
      capabilities: params.capabilities,
      target: params.user,
    }),
    canDeactivate,
    canReactivate,
    isSelf: params.user.id === params.actor.id,
    createdAt: params.user.createdAt,
    updatedAt: params.user.updatedAt,
  };
}

function buildDashboardAdminAccessRequestRow(
  db: ApiDatabase,
  org: EnterpriseOrg,
  requestRecord: EnterpriseJoinRequestRecord
): DashboardAdminAccessRequestRow {
  const user = getUserById(db, requestRecord.userId);
  return {
    id: requestRecord.id,
    status: requestRecord.status,
    userId: requestRecord.userId,
    displayName: user ? resolveStoredUserDisplayName(user) : "Not provided",
    email: requestRecord.email,
    orgId: org.id,
    orgName: org.name,
    createdAt: requestRecord.createdAt,
    expiresAt: requestRecord.expiresAt,
    updatedAt: requestRecord.updatedAt,
    decidedAt: requestRecord.decidedAt,
    decisionReason: requestRecord.decisionReason,
  };
}

type OrgJoinDecisionChannel = "mobile" | "dashboard";

type OrgJoinDecisionResult =
  | { ok: true; requestRecord: EnterpriseJoinRequestRecord }
  | { ok: false; status: number; error: string };

function decideEnterpriseJoinRequest(params: {
  db: ApiDatabase;
  actor: UserProfile;
  org: EnterpriseOrg;
  requestId: string;
  action: "approve" | "reject";
  reason?: string | null;
  channel: OrgJoinDecisionChannel;
}): OrgJoinDecisionResult {
  const requestRecord = params.db.enterpriseJoinRequests.find((row) => row.id === params.requestId);
  if (!requestRecord || requestRecord.orgId !== params.org.id) {
    return { ok: false, status: 404, error: "Join request not found." };
  }

  if (requestRecord.status !== "pending") {
    return { ok: false, status: 409, error: `Join request is already ${requestRecord.status}.` };
  }

  const targetUser = getUserById(params.db, requestRecord.userId);
  if (!targetUser) {
    const nowValue = nowIso();
    requestRecord.status = "rejected";
    requestRecord.updatedAt = nowValue;
    requestRecord.decidedAt = nowValue;
    requestRecord.decidedByUserId = params.actor.id;
    requestRecord.decisionReason = "Target user no longer exists.";
    return { ok: false, status: 404, error: "Target user not found." };
  }

  const nowValue = nowIso();
  const appendDecisionAudit = (action: string, message: string, metadata: Record<string, unknown>) => {
    const input = {
      action,
      orgId: params.org.id,
      userId: targetUser.id,
      message,
      metadata,
    };
    if (params.channel === "mobile") {
      appendMobileAuditEvent(params.db, params.actor, input);
    } else {
      appendWebAuditEvent(params.db, params.actor, input);
    }
  };

  if (params.action === "approve") {
    targetUser.accountType = "enterprise";
    targetUser.tier = "enterprise";
    targetUser.orgId = params.org.id;
    targetUser.orgRole = "user";
    targetUser.managerUserId = null;
    targetUser.dashboardAccessEnabled = false;
    targetUser.mobileProfileReonboardingRequired = false;
    targetUser.status = "active";
    targetUser.updatedAt = nowValue;
    const deactivatedInvalidAssignmentCount = deactivateInvalidTrainingPackAssignmentsForUser({
      assignments: params.db.trainingPackAssignments ?? [],
      userId: targetUser.id,
      user: targetUser,
      nowIso: nowValue,
    });
    requestRecord.status = "approved";
    requestRecord.updatedAt = nowValue;
    requestRecord.decidedAt = nowValue;
    requestRecord.decidedByUserId = params.actor.id;
    requestRecord.decisionReason = params.reason?.trim() || null;
    emitMobileUpdateForUser(params.db, targetUser.id, "user");
    emitMobileUpdateForOrg(params.db, params.org.id, "org");
    appendDecisionAudit(
      params.channel === "mobile" ? "org_join.approved_by_org_admin" : "org_join.approved_by_dashboard_admin",
      `Approved org join request for ${targetUser.email}.`,
      {
        requestId: requestRecord.id,
        deactivatedInvalidTrainingPackAssignments: deactivatedInvalidAssignmentCount
      }
    );
  } else {
    requestRecord.status = "rejected";
    requestRecord.updatedAt = nowValue;
    requestRecord.decidedAt = nowValue;
    requestRecord.decidedByUserId = params.actor.id;
    requestRecord.decisionReason = params.reason?.trim() || "Rejected by organization admin.";
    emitMobileUpdateForUser(params.db, targetUser.id, "user");
    emitMobileUpdateForOrg(params.db, params.org.id, "org");
    appendDecisionAudit(
      params.channel === "mobile" ? "org_join.rejected_by_org_admin" : "org_join.rejected_by_dashboard_admin",
      `Rejected org join request for ${targetUser.email}.`,
      {
        requestId: requestRecord.id,
        reasonProvided: Boolean(requestRecord.decisionReason)
      }
    );
  }

  return { ok: true, requestRecord };
}

function findActiveOrgByJoinCode(db: ApiDatabase, joinCode: string): EnterpriseOrg | null {
  const normalizedJoinCode = normalizeJoinCode(joinCode);
  if (!normalizedJoinCode) {
    return null;
  }
  return db.orgs.find((org) => org.status === "active" && normalizeJoinCode(org.joinCode) === normalizedJoinCode) ?? null;
}

function createOrReusePendingOrgJoinRequest(params: {
  db: ApiDatabase;
  user: UserProfile;
  org: EnterpriseOrg;
  now: Date;
}): { created: boolean; request: EnterpriseJoinRequestRecord } {
  expireOrgJoinRequests(params.db, params.now);
  const existingPending = params.db.enterpriseJoinRequests.find(
    (row) => row.userId === params.user.id && row.orgId === params.org.id && row.status === "pending"
  );
  if (existingPending) {
    return { created: false, request: existingPending };
  }

  const createdAt = params.now.toISOString();
  const record: EnterpriseJoinRequestRecord = {
    id: `jr_${uuid()}`,
    userId: params.user.id,
    email: params.user.email,
    emailDomain: extractEmailDomain(params.user.email) ?? "",
    orgId: params.org.id,
    orgNameSnapshot: params.org.name,
    joinCodeSnapshot: normalizeJoinCode(params.org.joinCode),
    status: "pending",
    createdAt,
    expiresAt: new Date(params.now.getTime() + ORG_JOIN_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: createdAt,
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null
  };
  params.db.enterpriseJoinRequests.push(record);
  emitMobileUpdateForOrg(params.db, params.org.id, "org");
  return { created: true, request: record };
}

type MobileCompanyProfileCompletion = {
  ok: true;
  org: EnterpriseOrg;
  request: EnterpriseJoinRequestRecord | null;
  createdRequest: boolean;
  restoredExistingMember: boolean;
};

type MobileBasicProfileCompletion = {
  ok: true;
  restoredExistingMember: boolean;
};

type MobileProfileCompletionError = { ok: false; status: number; error: string };

function isMobileCompanyProfileCompletion(
  completion: MobileCompanyProfileCompletion | MobileBasicProfileCompletion
): completion is MobileCompanyProfileCompletion {
  return "org" in completion;
}

function completeMobileCompanyProfile(params: {
  db: ApiDatabase;
  user: UserProfile;
  firstName: string;
  lastName: string;
  joinCode: string;
  now: Date;
}): MobileCompanyProfileCompletion | MobileProfileCompletionError {
  if (params.user.status !== "active") {
    return { ok: false, status: 403, error: "Your account is deactivated. Contact your organization admin." };
  }

  const org = findActiveOrgByJoinCode(params.db, params.joinCode);
  if (!org) {
    return { ok: false, status: 404, error: "Company code not found." };
  }

  if (params.user.accountType === "enterprise" && !isSuperUser(params.user)) {
    if (params.user.orgId !== org.id) {
      return { ok: false, status: 403, error: "Company code does not match your active organization." };
    }

    params.user.firstName = params.firstName;
    params.user.lastName = params.lastName;
    params.user.mobileProfileReonboardingRequired = false;
    params.user.updatedAt = params.now.toISOString();
    emitMobileUpdateForUser(params.db, params.user.id, "user");
    return { ok: true, org, request: null, createdRequest: false, restoredExistingMember: true };
  }

  params.user.firstName = params.firstName;
  params.user.lastName = params.lastName;
  params.user.mobileProfileReonboardingRequired = false;
  params.user.updatedAt = params.now.toISOString();

  if (isSuperUser(params.user)) {
    emitMobileUpdateForUser(params.db, params.user.id, "user");
    return { ok: true, org, request: null, createdRequest: false, restoredExistingMember: false };
  }

  if (params.user.accountType === "enterprise" && params.user.orgId === org.id) {
    emitMobileUpdateForUser(params.db, params.user.id, "user");
    return { ok: true, org, request: null, createdRequest: false, restoredExistingMember: true };
  }

  const requestResult = createOrReusePendingOrgJoinRequest({
    db: params.db,
    user: params.user,
    org,
    now: params.now,
  });
  emitMobileUpdateForUser(params.db, params.user.id, "user");
  return {
    ok: true,
    org,
    request: requestResult.request,
    createdRequest: requestResult.created,
    restoredExistingMember: false,
  };
}

function completeMobileBasicProfile(params: {
  db: ApiDatabase;
  user: UserProfile;
  firstName: string;
  lastName: string;
  now: Date;
}): MobileBasicProfileCompletion | MobileProfileCompletionError {
  if (params.user.status !== "active") {
    return { ok: false, status: 403, error: "Your account is deactivated. Contact your organization admin." };
  }

  if (
    params.user.accountType === "enterprise" &&
    !isSuperUser(params.user) &&
    params.user.mobileProfileReonboardingRequired === true
  ) {
    return { ok: false, status: 400, error: "Company code is required to confirm your organization." };
  }

  params.user.firstName = params.firstName;
  params.user.lastName = params.lastName;
  params.user.mobileProfileReonboardingRequired = false;
  params.user.updatedAt = params.now.toISOString();
  emitMobileUpdateForUser(params.db, params.user.id, "user");
  return {
    ok: true,
    restoredExistingMember:
      params.user.accountType === "enterprise" && Boolean(params.user.orgId) && !isSuperUser(params.user),
  };
}

async function listDashboardAccessibleCustomers(db: ApiDatabase, viewer: DashboardViewer): Promise<DashboardCustomerSummary[]> {
  return Promise.all(listDashboardAccessibleOrgs(db, viewer).map((org) => buildDashboardCustomerSummary(db, org)));
}

async function getDashboardAccessibleCustomer(
  db: ApiDatabase,
  viewer: DashboardViewer,
  orgId: string
): Promise<DashboardCustomerSummary | null> {
  if (!canDashboardViewerAccessOrg(viewer, orgId)) {
    return null;
  }

  const org = getOrgById(db, orgId);
  if (!org) {
    return null;
  }

  return buildDashboardCustomerSummary(db, org);
}

async function buildDashboardOverview(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  divisionId: string | null = null
): Promise<DashboardOverviewResponse> {
  const viewer = principal.viewer;
  const accessibleOrgs = listDashboardAccessibleOrgs(db, viewer);
  const accessibleOrgIds = new Set(accessibleOrgs.map((org) => org.id));
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: accessibleOrgIds,
  });
  const customers = await Promise.all(
    accessibleOrgs.map((org) => buildDashboardCustomerSummary(db, org, divisionId, permittedUserIds))
  );
  const now = new Date();
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const activeCustomers = customers.filter((customer) => customer.orgStatus === "active").length;
  const activeUsers = customers.reduce((total, customer) => total + customer.activeUserCount, 0);
  const dashboardUsers = customers.reduce((total, customer) => total + customer.dashboardUserCount, 0);
  const monthlyUsageMinutes = customers.reduce((total, customer) => total + customer.usedMinutesThisPeriod, 0);
  const simulationsLast30Days = customers.reduce((total, customer) => total + customer.simulationsLast30Days, 0);
  const currentPeriodScores = accessibleOrgs.flatMap((org) => {
    const normalizedOrg = ensureOrgContractFields(org);
    const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(normalizedOrg, now), now);

    return scoreRecordAccess.listByOrgRange(db, {
      orgId: normalizedOrg.id,
      endedAtFrom: new Date(billing.periodStartAt),
      endedAtBefore: new Date(billing.periodEndAt),
      conclusiveOnly: true,
    }).filter((record) =>
      (!divisionId || (record.divisionId ?? null) === divisionId) &&
      permittedUserIds.has(record.userId)
    );
  });
  const topScenarios = (
    await Promise.all(
      customers.map(async (customer) => {
        const org = getOrgById(db, customer.orgId);
        if (!org) {
          return [];
        }

        const scenarios = buildDashboardCustomerScenarioRows(
          db,
          org,
          buildDashboardScenarioCatalog(db, org),
          now,
          divisionId,
          permittedUserIds
        ).slice(0, 5);
        return scenarios.map(
          (scenario): DashboardPortfolioScenarioSummary => ({
            ...scenario,
            orgId: customer.orgId,
            orgName: customer.orgName
          })
        );
      })
    )
  )
    .flat()
    .sort((left, right) => {
      if (right.attemptsLast30Days !== left.attemptsLast30Days) {
        return right.attemptsLast30Days - left.attemptsLast30Days;
      }
      return (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
    })
    .slice(0, 6);
  const recentSessions = filterDashboardAccessibleUsageSessions(
    db,
    accessibleOrgIds,
    last30DaysThreshold,
    nowMs,
    divisionId,
    permittedUserIds
  );
  const recentScores = filterDashboardAccessibleScoreRecords(
    db,
    accessibleOrgIds,
    last30DaysThreshold,
    nowMs,
    divisionId,
    permittedUserIds
  );
  const previousScores = filterDashboardAccessibleScoreRecords(
    db,
    accessibleOrgIds,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );

  return {
    viewer,
    summary: {
      activeCustomers,
      activeUsers,
      dashboardUsers,
      monthlyUsageMinutes: Math.round(monthlyUsageMinutes * 10) / 10,
      simulationsLast30Days,
      averageScoreThisPeriod: averageScore(currentPeriodScores),
      activeTrainingPackCount: customers.reduce((total, customer) => total + customer.activeTrainingPackCount, 0),
      customScenarioCount: customers.reduce((total, customer) => total + customer.customScenarioCount, 0)
    },
    customers,
    topScenarios,
    trainingPackAttribution: buildTrainingPackAttributionSummary({
      usageSessions: recentSessions,
      scoreRecords: recentScores
    }),
    coachingInsights: buildDashboardCoachingInsights({
      currentScores: recentScores,
      previousScores,
      includeNormalizationDiagnostics: viewer.accessType === "super_user"
    }),
    divisionScope:
      viewer.accessType === "customer_dashboard_user" && viewer.orgId
        ? resolveDashboardDivisionFilter({
            db,
            viewer,
            requestedDivisionId: divisionId,
          }).divisionScope
        : undefined,
  };
}

async function buildDashboardTrainingReport(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal
): Promise<DashboardTrainingReportResponse> {
  const viewer = principal.viewer;
  const orgs = listDashboardAccessibleOrgs(db, viewer);
  const now = new Date();
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const orgIds = new Set(orgs.map((org) => org.id));
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds,
  });
  const trainingPacks = (
    await Promise.all(
      orgs.map(async (org) => {
        const scenarioCatalog = buildDashboardScenarioCatalog(db, org);
        const rows = await buildDashboardTrainingPackRows(db, org, scenarioCatalog, now, null, permittedUserIds);
        return rows.map(
          (row): DashboardTrainingPackReportSummary => ({
            ...row,
            orgId: org.id,
            orgName: org.name
          })
        );
      })
    )
  )
    .flat()
    .sort((left, right) => {
      if (Number(right.active) !== Number(left.active)) {
        return Number(right.active) - Number(left.active);
      }
      const latestDelta =
        (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  const engagedLearnerIds = new Set<string>();
  for (const row of trainingPacks) {
    if (row.learnerCountLast30Days > 0) {
      const scopedSessions = filterOrgUsageSessions(db, row.orgId, last30DaysThreshold, nowMs).filter(
        (session) => session.trainingPackId === row.trainingPackId && permittedUserIds.has(session.userId)
      );
      const scopedScores = filterOrgScoreRecords(db, row.orgId, last30DaysThreshold, nowMs).filter(
        (record) => record.trainingPackId === row.trainingPackId && permittedUserIds.has(record.userId)
      );
      scopedSessions.forEach((session) => engagedLearnerIds.add(session.userId));
      scopedScores.forEach((record) => engagedLearnerIds.add(record.userId));
    }
  }
  const recentSessions = listUsageSessions(db).filter((session) => {
    if (!session.orgId || !orgIds.has(session.orgId)) {
      return false;
    }
    if (!permittedUserIds.has(session.userId)) {
      return false;
    }
    const startedAtMs = new Date(session.startedAt).getTime();
    return Number.isFinite(startedAtMs) && startedAtMs >= last30DaysThreshold && startedAtMs < nowMs;
  });
  const recentScores = listScoreRecords(db, { conclusiveOnly: true }).filter((record) => {
    if (!record.orgId || !orgIds.has(record.orgId)) {
      return false;
    }
    if (!permittedUserIds.has(record.userId)) {
      return false;
    }
    const endedAtMs = new Date(record.endedAt).getTime();
    return Number.isFinite(endedAtMs) && endedAtMs >= last30DaysThreshold && endedAtMs < nowMs;
  });

  return {
    viewer,
    summary: {
      visibleTrainingPackCount: trainingPacks.length,
      activeTrainingPackCount: trainingPacks.filter((pack) => pack.active).length,
      assignmentCount: trainingPacks.reduce((total, pack) => total + pack.assignedLearnerCount, 0),
      startedAssignmentCount: trainingPacks.reduce((total, pack) => total + pack.startedLearnerCount, 0),
      completedAssignmentCount: trainingPacks.reduce((total, pack) => total + pack.completedLearnerCount, 0),
      inProgressAssignmentCount: trainingPacks.reduce((total, pack) => total + pack.inProgressLearnerCount, 0),
      notStartedAssignmentCount: trainingPacks.reduce((total, pack) => total + pack.notStartedLearnerCount, 0),
      engagedLearnerCountLast30Days: engagedLearnerIds.size,
      attributedAttemptsLast30Days: trainingPacks.reduce((total, pack) => total + pack.attemptsLast30Days, 0),
      attributedScoresLast30Days: trainingPacks.reduce((total, pack) => total + pack.scoredAttemptsLast30Days, 0),
      averageScoreLast30Days: averageScore(recentScores.filter((record) => Boolean(record.trainingPackId)))
    },
    trainingPacks,
    trainingPackAttribution: buildTrainingPackAttributionSummary({
      usageSessions: recentSessions,
      scoreRecords: recentScores
    })
  };
}

async function findDashboardAccessibleTrainingPack(
  db: ApiDatabase,
  viewer: DashboardViewer,
  trainingPackId: string,
  explicitOrgId: string | null = null
): Promise<{
  org: EnterpriseOrg;
  pack: TrainingPack;
  scenarioCatalog: Map<string, DashboardScenarioCatalogEntry>;
} | null> {
  const normalizedTrainingPackId = trainingPackId.trim();
  if (!normalizedTrainingPackId) {
    return null;
  }

  const accessibleOrgs = listDashboardAccessibleOrgs(db, viewer).filter((org) => !explicitOrgId || org.id === explicitOrgId);
  if (explicitOrgId && !canDashboardViewerAccessOrg(viewer, explicitOrgId)) {
    return null;
  }

  for (const org of accessibleOrgs) {
    const packs = await listTrainingPacksForDashboardOrg(org.id);
    const pack = packs.find((entry) => entry.id === normalizedTrainingPackId);
    if (pack) {
      return {
        org,
        pack,
        scenarioCatalog: buildDashboardScenarioCatalog(db, org)
      };
    }
  }

  return null;
}

async function buildDashboardUserReport(
  db: ApiDatabase,
  principal: DashboardRequestPrincipal,
  divisionId: string | null = null
): Promise<DashboardUserReportResponse> {
  const viewer = principal.viewer;
  const orgs = listDashboardAccessibleOrgs(db, viewer);
  const orgById = new Map(orgs.map((org) => [org.id, org] as const));
  const accessibleOrgIds = new Set(orgs.map((org) => org.id));
  const permittedUserIds = getDashboardPermittedUserIds({
    db,
    actor: principal.user,
    viewer,
    orgIds: accessibleOrgIds,
  });
  const now = new Date();
  const nowMs = now.getTime();
  const last30DaysThreshold = nowMs - 30 * 24 * 60 * 60 * 1000;
  const previous30DaysThreshold = nowMs - 60 * 24 * 60 * 60 * 1000;
  const recentSessions = filterDashboardAccessibleUsageSessions(
    db,
    accessibleOrgIds,
    last30DaysThreshold,
    nowMs,
    divisionId,
    permittedUserIds
  );
  const recentScores = filterDashboardAccessibleScoreRecords(
    db,
    accessibleOrgIds,
    last30DaysThreshold,
    nowMs,
    divisionId,
    permittedUserIds
  );
  const previousScores = filterDashboardAccessibleScoreRecords(
    db,
    accessibleOrgIds,
    previous30DaysThreshold,
    last30DaysThreshold,
    divisionId,
    permittedUserIds
  );
  const scenarioCatalogByOrg = new Map<string, Map<string, DashboardScenarioCatalogEntry>>(
    orgs.map((org) => [org.id, buildDashboardScenarioCatalog(db, org)])
  );
  const trainingPackTitleByOrg = new Map<string, Map<string, string>>();
  for (const org of orgs) {
    const packMap = new Map<string, string>();
    const packs = await listTrainingPacksForDashboardOrg(org.id);
    packs.forEach((pack) => packMap.set(pack.id, pack.title));
    trainingPackTitleByOrg.set(org.id, packMap);
  }

  const users = db.users
    .filter((user) =>
      user.accountType === "enterprise" &&
      Boolean(user.orgId) &&
      accessibleOrgIds.has(user.orgId!) &&
      permittedUserIds.has(user.id)
    )
    .sort((left, right) => left.email.localeCompare(right.email))
    .map((user): DashboardUserReportRow => {
      const userSessions = recentSessions.filter((session) => session.userId === user.id);
      const userScores = recentScores.filter((record) => record.userId === user.id);
      const userPreviousScores = previousScores.filter((record) => record.userId === user.id);
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
      const latestActivityAt = maxIsoDate([latestSession?.endedAt ?? null, latestScore?.endedAt ?? null]);
      const latestScenarioId = latestScore?.scenarioId ?? latestSession?.scenarioId ?? null;
      const latestTrainingPackId = latestScore?.trainingPackId ?? latestSession?.trainingPackId ?? null;
      const orgId = user.orgId;
      const scenarioCatalog = orgId ? scenarioCatalogByOrg.get(orgId) : null;
      const trainingPackTitles = orgId ? trainingPackTitleByOrg.get(orgId) : null;
      const uniqueScenariosLast30Days = new Set<string>([
        ...userSessions.map((session) => session.scenarioId),
        ...userScores.map((record) => record.scenarioId)
      ]).size;

      return {
        userId: user.id,
        email: user.email,
        employeeId: user.employeeId ?? null,
        orgId,
        orgName: orgId ? orgById.get(orgId)?.name ?? null : null,
        status: user.status,
        orgRole: user.orgRole,
        dashboardAccessEnabled: user.dashboardAccessEnabled === true,
        simulationsLast30Days: userSessions.length,
        usedMinutesLast30Days: roundMinutes(billedSeconds),
        scoredAttemptsLast30Days: userScores.length,
        averageScoreLast30Days: averageScore(userScores),
        scoreDeltaLast30Days: averageScoreDelta(userScores, userPreviousScores),
        uniqueScenariosLast30Days,
        trainingPackAttemptsLast30Days: userSessions.filter((session) => Boolean(session.trainingPackId)).length,
        latestActivityAt,
        latestScenarioTitle: latestScenarioId ? scenarioCatalog?.get(latestScenarioId)?.title ?? latestScenarioId : null,
        latestTrainingPackTitle:
          latestTrainingPackId && trainingPackTitles ? trainingPackTitles.get(latestTrainingPackId) ?? latestTrainingPackId : null
      };
    })
    .filter((row) => !divisionId || row.simulationsLast30Days > 0 || row.scoredAttemptsLast30Days > 0)
    .sort((left, right) => {
      const latestDelta =
        (new Date(right.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.latestActivityAt ?? 0).getTime() || 0);
      if (latestDelta !== 0) {
        return latestDelta;
      }
      return left.email.localeCompare(right.email);
    });

  return {
    viewer,
    summary: {
      userCount: users.length,
      activeUserCount: users.filter((user) => user.status === "active").length,
      dashboardUserCount: users.filter((user) => user.dashboardAccessEnabled).length,
      simulationsLast30Days: users.reduce((total, user) => total + user.simulationsLast30Days, 0),
      averageScoreLast30Days: averageScore(recentScores)
    },
    users,
    divisionScope:
      viewer.accessType === "customer_dashboard_user" && viewer.orgId
        ? resolveDashboardDivisionFilter({
            db,
            viewer,
            requestedDivisionId: divisionId,
          }).divisionScope
        : undefined,
  };
}

function ensureOrgCustomScenarioCollection(org: EnterpriseOrg): OrgCustomScenario[] {
  if (!Array.isArray(org.customScenarios)) {
    org.customScenarios = [];
  }
  org.customScenarios = sortOrgCustomScenariosByTitle(
    normalizeOrgCustomScenarioList(org.customScenarios, org.id, nowIso())
  );
  return org.customScenarios;
}

function createOrgTrainingId(): string {
  return `training_${uuid()}`;
}

function createOrgTrainingPackAttachmentId(): string {
  return `training_pack_attachment_${uuid()}`;
}

function createOrgTrainingScenarioAttachmentId(): string {
  return `training_scenario_attachment_${uuid()}`;
}

function createOrgDivisionId(): string {
  return `division_${uuid()}`;
}

function createOrgStandardScenarioDivisionAssignmentId(): string {
  return `standard_scenario_division_${uuid()}`;
}

function buildOrgDivisionListPayload(db: ApiDatabase, org: EnterpriseOrg): OrgDivisionListResponse {
  ensureOrgDivisionCollections(db);
  return {
    generatedAt: nowIso(),
    org: {
      id: org.id,
      name: org.name,
      divisionsEnabled: org.divisionsEnabled === true,
    },
    divisions: listOrgDivisions(db, org.id, { includeDeleted: true }),
  };
}

function resolveDivisionSelectionForOrg(
  db: Pick<ApiDatabase, "orgDivisions">,
  orgId: string,
  divisionId: unknown
): { ok: true; divisionId: string | null } | { ok: false; error: string } {
  if (divisionId === undefined) {
    return { ok: true, divisionId: null };
  }
  if (divisionId === null) {
    return { ok: true, divisionId: null };
  }
  if (typeof divisionId !== "string") {
    return { ok: false, error: "divisionId must be a string or null." };
  }

  const normalizedDivisionId = divisionId.trim();
  if (!normalizedDivisionId) {
    return { ok: true, divisionId: null };
  }

  const division = findOrgDivisionRecord(db, orgId, normalizedDivisionId);
  if (!division || division.active !== true) {
    return { ok: false, error: "divisionId must reference an active division in this company." };
  }

  return { ok: true, divisionId: division.id };
}

function countActiveOrgDivisions(db: Pick<ApiDatabase, "orgDivisions">, orgId: string): number {
  return listOrgDivisions(db, orgId).length;
}

function buildOrgStandardScenarioDivisionListPayload(
  db: ApiDatabase,
  org: EnterpriseOrg
): OrgStandardScenarioDivisionListResponse {
  ensureOrgDivisionCollections(db);
  const visibleRows = listOrgVisibleStandardScenarios({
    config: db.config,
    org,
  });
  const visibleScenarioIds = new Set(visibleRows.map((row) => row.scenarioId));
  const rows = [
    ...visibleRows.map((row) => ({
      ...row,
      divisionId: resolveStandardScenarioActiveDivisionId(db, org.id, row.scenarioId),
    })),
    ...db.orgStandardScenarioDivisionAssignments
      .filter((entry) => entry.orgId === org.id && !visibleScenarioIds.has(entry.scenarioId))
      .map((entry) => {
        for (const segment of db.config.segments) {
          const scenario = (segment.scenarios ?? []).find((candidate) => candidate.id === entry.scenarioId);
          if (scenario) {
            return {
              scenarioId: scenario.id,
              segmentId: segment.id,
              segmentLabel: segment.label,
              title: scenario.title,
              enabled: scenario.enabled !== false,
              divisionId: resolveStandardScenarioActiveDivisionId(db, org.id, scenario.id),
            };
          }
        }
        return null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  ]
    .sort((left, right) => {
      if (left.segmentLabel !== right.segmentLabel) {
        return left.segmentLabel.localeCompare(right.segmentLabel, undefined, { sensitivity: "base" });
      }
      return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    });

  return {
    generatedAt: nowIso(),
    org: {
      id: org.id,
      name: org.name,
      divisionsEnabled: org.divisionsEnabled === true,
    },
    rows,
  };
}

function isStandardScenarioVisibleToOrg(
  db: Pick<ApiDatabase, "config">,
  org: EnterpriseOrg,
  scenarioId: string
): boolean {
  return listOrgVisibleStandardScenarios({
    config: db.config,
    org,
  }).some((row) => row.scenarioId === scenarioId);
}

async function ensureOrgTrainingWorkspace(db: ApiDatabase, org: EnterpriseOrg): Promise<void> {
  ensureOrgTrainingCollections(db);
  if (listOrgTrainingRecords(db, org.id).length > 0) {
    return;
  }

  const scenarioIds = ensureOrgCustomScenarioCollection(org).map((scenario) => scenario.id);
  let trainingPackIds: string[] = [];
  try {
    trainingPackIds = (await trainingPackStore.listTrainingPacksForOrg(org.id)).map((pack) => pack.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarnThrottled("org-trainings:backfill", `[org-trainings] failed to inspect training packs for ${org.id}: ${message}`);
  }

  seedLegacyOrgTraining({
    db,
    orgId: org.id,
    trainingPackIds,
    scenarioIds,
    now: nowIso(),
    createTrainingId: createOrgTrainingId,
    createPackAttachmentId: createOrgTrainingPackAttachmentId,
    createScenarioAttachmentId: createOrgTrainingScenarioAttachmentId,
  });
}

function getMobileReadyOrgTrainings(
  db: ApiDatabase,
  org: EnterpriseOrg,
  config: AppConfig,
): OrgTrainingSummary[] {
  ensureOrgTrainingCollections(db);
  const mobileScenarioIds = new Set(getMobileReadyOrgCustomScenarios(org, config).map((scenario) => scenario.id));

  return buildOrgTrainingSummaries({
    db,
    orgId: org.id,
    validScenarioIds: mobileScenarioIds,
  })
    .filter((training) => training.status === "active" && training.attachedCustomScenarioIds.length > 0)
    .map((training) => ({
      ...training,
      attachedCustomScenarioCount: training.attachedCustomScenarioIds.length,
      attachedTrainingPackCount: training.attachedTrainingPackIds.length,
    }));
}

function touchOrgTrainingRecord(training: OrgTrainingRecord, now: string): void {
  training.updatedAt = now;
}

function buildOrgTrainingSummaryForResponse(
  db: ApiDatabase,
  orgId: string,
  trainingId: string,
  options?: { validTrainingPackIds?: Iterable<string>; validScenarioIds?: Iterable<string> },
): OrgTrainingSummary | null {
  return (
    buildOrgTrainingSummaries({
      db,
      orgId,
      validTrainingPackIds: options?.validTrainingPackIds,
      validScenarioIds: options?.validScenarioIds,
    }).find((entry) => entry.id === trainingId) ?? null
  );
}

function getConfigSegmentById(config: AppConfig, segmentId: string): SegmentDefinition | undefined {
  return config.segments.find((segment) => segment.id === segmentId);
}

function getConfigScenarioById(
  config: AppConfig,
  scenarioId: string,
): { segment: SegmentDefinition; scenario: Scenario } | null {
  for (const segment of config.segments) {
    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId);
    if (scenario) {
      return { segment, scenario };
    }
  }
  return null;
}

function buildRuntimeScenarioFromOrgCustomScenario(
  customScenario: OrgCustomScenario,
  traineeSegmentLabel: string,
): Scenario {
  const rawAiRole = customScenario.aiRole?.trim() || "a realistic conversation partner";
  const safeAiRole = aiRoleMatchesTraineeRole(rawAiRole, traineeSegmentLabel)
    ? `a realistic counterpart who is interacting with a ${traineeSegmentLabel}`
    : rawAiRole;
  const reinforcedAiRole = `${safeAiRole}. Counterpart rule: you are speaking with a ${traineeSegmentLabel}; do not act as ${traineeSegmentLabel}.`;

  return {
    id: customScenario.id,
    segmentId: customScenario.segmentId,
    title: customScenario.title,
    summary: customScenario.summary ?? buildScenarioSummary(customScenario.description),
    description: customScenario.description,
    desiredOutcome: customScenario.desiredOutcome,
    aiRole: reinforcedAiRole,
    enabled: customScenario.enabled === true,
  };
}

function getMobileReadyOrgCustomScenarios(
  org: EnterpriseOrg,
  config: AppConfig,
): OrgCustomScenario[] {
  const raw = normalizeOrgCustomScenarioList(org.customScenarios, org.id, nowIso());
  if (raw.length === 0) {
    return [];
  }

  const enabledIndustryIds = new Set((config.industries ?? []).filter((entry) => entry.enabled).map((entry) => entry.id));
  const enabledSegmentIds = new Set(config.segments.filter((segment) => segment.enabled).map((segment) => segment.id));

  const filtered = raw
    .filter((scenario) => scenario.enabled === true && enabledSegmentIds.has(scenario.segmentId))
    .map((scenario) => {
      const applicableIndustryIds = uniqueStrings(scenario.applicableIndustryIds, enabledIndustryIds);
      if (applicableIndustryIds.length === 0) {
        return null;
      }

      return {
        ...scenario,
        applicableIndustryIds: applicableIndustryIds as IndustryId[],
      };
    })
    .filter((scenario): scenario is OrgCustomScenario => Boolean(scenario));

  return sortOrgCustomScenariosByTitle(filtered);
}

interface ResolvedMobileScenarioContext {
  source: "standard" | "custom";
  segment: SegmentDefinition;
  scenario: Scenario;
  allowedIndustryIds: IndustryId[];
  scoringGuidance: string | null;
}

function resolveMobileScenarioForUser(
  configForUser: AppConfig,
  scenarioId: string,
  trainingId?: string | null,
): ResolvedMobileScenarioContext | null {
  for (const segment of configForUser.segments) {
    if (segment.enabled !== true) {
      continue;
    }

    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId && entry.enabled !== false);
    if (!scenario) {
      continue;
    }

    const allowedIndustryIds = uniqueStrings(
      (configForUser.roleIndustries ?? [])
        .filter((entry) => entry.active && entry.roleId === segment.id)
        .map((entry) => entry.industryId),
    ) as IndustryId[];

    return {
      source: "standard",
      segment,
      scenario,
      allowedIndustryIds,
      scoringGuidance: null,
    };
  }

  const customScenario = (configForUser.orgCustomScenarios ?? []).find(
    (entry) => entry.id === scenarioId && entry.enabled === true,
  );
  if (!customScenario) {
    return null;
  }

  const activeTrainings = configForUser.orgTrainings ?? [];
  const normalizedTrainingId = typeof trainingId === "string" ? trainingId.trim() : "";
  if (normalizedTrainingId) {
    const selectedTraining = activeTrainings.find((entry) => entry.id === normalizedTrainingId);
    if (!selectedTraining || !selectedTraining.attachedCustomScenarioIds.includes(customScenario.id)) {
      return null;
    }
  } else if (
    !activeTrainings.some((entry) => entry.attachedCustomScenarioIds.includes(customScenario.id))
  ) {
    return null;
  }

  const segment = configForUser.segments.find(
    (entry) => entry.id === customScenario.segmentId && entry.enabled === true,
  );
  if (!segment) {
    return null;
  }

  return {
    source: "custom",
    segment,
    scenario: buildRuntimeScenarioFromOrgCustomScenario(customScenario, segment.label),
    allowedIndustryIds: uniqueStrings(customScenario.applicableIndustryIds) as IndustryId[],
    scoringGuidance: customScenario.scoringGuidance?.trim() || null,
  };
}

function buildScoringIndustryContextsForIds(configForUser: AppConfig, industryIds: readonly string[]): Array<{
  id: string;
  label: string;
  aiBaseline: string;
  standardScoringGuidance: string;
}> {
  return uniqueStrings([...industryIds]).map((industryId) => {
    const industry = (configForUser.industries ?? []).find((entry) => entry.id === industryId);
    return {
      id: industryId,
      label: industry?.label ?? industryId,
      aiBaseline: industry?.aiBaseline ?? "",
      standardScoringGuidance: industry?.standardScoringGuidance ?? ""
    };
  });
}

function resolveScenarioScoringGuidanceForEvaluation(
  configForUser: AppConfig,
  resolvedScenario: ResolvedMobileScenarioContext,
  selectedIndustryId: string | null
): string | null {
  const allowedIndustryIds = uniqueStrings(resolvedScenario.allowedIndustryIds);
  const selectedIndustryIdTrimmed = typeof selectedIndustryId === "string" ? selectedIndustryId.trim() : "";
  const scopedIndustryIds =
    selectedIndustryIdTrimmed && allowedIndustryIds.includes(selectedIndustryIdTrimmed)
      ? [selectedIndustryIdTrimmed]
      : allowedIndustryIds;
  const industryContexts = buildScoringIndustryContextsForIds(configForUser, scopedIndustryIds);

  const standardGuidance = buildDefaultScoringGuidance({
    scenarioTitle: resolvedScenario.scenario.title,
    segmentLabel: resolvedScenario.segment.label,
    industryContexts
  });

  return buildAdditiveEvaluationScoringGuidance({
    standardGuidance,
    customGuidance: resolvedScenario.source === "custom" ? resolvedScenario.scoringGuidance : null
  });
}

function resolveRoleplayCounterpartBehaviorGuidance(resolvedScenario: ResolvedMobileScenarioContext): string | null {
  if (resolvedScenario.source !== "custom") {
    return null;
  }

  const guidance = resolvedScenario.scoringGuidance?.trim() ?? "";
  if (!guidance) {
    return null;
  }

  return guidance.slice(0, MAX_ROLEPLAY_BEHAVIOR_GUIDANCE_PROMPT_CHARS);
}

function resolveSimulationDivisionIdForContext(params: {
  db: ApiDatabase;
  user: UserProfile;
  org: EnterpriseOrg | null;
  trainingId?: string | null;
  resolvedScenario: ResolvedMobileScenarioContext;
}): string | null {
  if (!params.org) {
    return null;
  }

  return resolveLiveDivisionAttribution({
    db: params.db,
    orgId: params.org.id,
    user: params.user,
    trainingId: params.trainingId ?? null,
    scenarioSource: params.resolvedScenario.source,
    scenarioId: params.resolvedScenario.scenario.id,
    divisionsEnabled: params.org.divisionsEnabled === true,
  });
}

async function resolveAnchoredSimulationDivisionId(params: {
  simulationSessionId: string | null;
  userId: string;
  orgId: string | null;
  scenarioId: string;
  trainingId: string | null;
  fallbackDivisionId: string | null;
}): Promise<string | null> {
  if (!params.simulationSessionId) {
    return params.fallbackDivisionId ?? null;
  }

  try {
    const recognizedSession = await simulationSessionStore.getById(params.simulationSessionId);
    return resolvePreferredSimulationDivisionId({
      recognizedSession,
      userId: params.userId,
      orgId: params.orgId,
      scenarioId: params.scenarioId,
      trainingId: params.trainingId,
      fallbackDivisionId: params.fallbackDivisionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarnThrottled(
      "simulation-division-anchor",
      `[simulation-division-anchor] failed to load recognized session ${params.simulationSessionId}: ${message}`
    );
    return params.fallbackDivisionId ?? null;
  }
}

function buildCustomScenarioGenerationPromptPreview(input: {
  org: EnterpriseOrg;
  segment: SegmentDefinition;
  industries: IndustryDefinition[];
  sourceMode: OrgCustomScenarioSourceMode;
  base?: { segment: SegmentDefinition; scenario: Scenario } | null;
  draft: { title?: string; description?: string; desiredOutcome?: string; aiRole?: string; scoringGuidance?: string };
  generationInputs: OrgCustomScenarioGenerationInputs | null;
}): string {
  const industrySummary = input.industries
    .map((industry) => {
      const baseline = (industry.aiBaseline ?? "").trim();
      return baseline
        ? `- ${industry.label} (${industry.id}) baseline: ${baseline}`
        : `- ${industry.label} (${industry.id}) baseline: (none provided)`;
    })
    .join("\n");

  const baseSummary = input.base
    ? [
        `Base Role: ${input.base.segment.label} (${input.base.segment.id})`,
        `Base Scenario Title: ${input.base.scenario.title}`,
        `Base Scenario Description: ${input.base.scenario.description}`,
        `Base Scenario Desired Outcome: ${input.base.scenario.desiredOutcome?.trim() || "(blank)"}`,
        `Base Scenario AI Role: ${input.base.scenario.aiRole}`,
      ].join("\n")
    : "No base scenario selected (scratch mode).";

  const customizationLines: string[] = [];
  const params = input.generationInputs;
  if (params) {
    if (params.companyName) {
      customizationLines.push(`Company Name: ${params.companyName}`);
    }
    if (params.productOrService) {
      customizationLines.push(`Product/Service: ${params.productOrService}`);
    }
    if (params.targetPersona) {
      customizationLines.push(`Target Persona: ${params.targetPersona}`);
    }
    if (params.keyObjections && params.keyObjections.length > 0) {
      customizationLines.push(`Key Objections: ${params.keyObjections.join("; ")}`);
    }
    if (params.tone) {
      customizationLines.push(`Tone: ${params.tone}`);
    }
    if (params.difficulty) {
      customizationLines.push(`Difficulty: ${params.difficulty}`);
    }
    if (params.mustInclude) {
      customizationLines.push(`Must Include: ${params.mustInclude}`);
    }
    if (params.mustAvoid) {
      customizationLines.push(`Must Avoid: ${params.mustAvoid}`);
    }
    if (params.complianceConstraints) {
      customizationLines.push(`Compliance Constraints: ${params.complianceConstraints}`);
    }
    if (params.specialInstructions) {
      customizationLines.push(`Special Instructions: ${params.specialInstructions}`);
    }
  }

  const draftLines = [
    `Draft Title (optional): ${(input.draft.title ?? "").trim() || "(blank)"}`,
    `Draft Description (optional): ${(input.draft.description ?? "").trim() || "(blank)"}`,
    `Draft Desired Outcome (optional): ${(input.draft.desiredOutcome ?? "").trim() || "(blank)"}`,
    `Draft AI Role (optional): ${(input.draft.aiRole ?? "").trim() || "(blank)"}`,
    `Draft Scoring Guidance (optional): ${(input.draft.scoringGuidance ?? "").trim() || "(blank)"}`,
  ];

  return [
    `Org: ${input.org.name} (${input.org.id})`,
    `Target Role: ${input.segment.label} (${input.segment.id})`,
    `Source Mode: ${input.sourceMode}`,
    "",
    "Selected Industries:",
    industrySummary || "- (none)",
    "",
    "Base Scenario Context:",
    baseSummary,
    "",
    "Customization Inputs:",
    customizationLines.length > 0 ? customizationLines.map((line) => `- ${line}`).join("\n") : "- (none)",
    "",
    "Current Draft Inputs:",
    draftLines.map((line) => `- ${line}`).join("\n"),
    "",
    "Output Requirements:",
    "- Return JSON only (no markdown).",
    '- Keys: "title", "description", "desiredOutcome", "aiRole", "scoringGuidance".',
    `- The user/trainee plays the target role (${input.segment.label}); aiRole must be the COUNTERPART the user practices against.`,
    `- Never set aiRole to the trainee role (${input.segment.label}) or a synonym of it.`,
    "- Write description as scenario context/objective, not as instructions for the AI role to become the trainee.",
    "- desiredOutcome should describe the concrete end state or resolution the trainee should try to achieve.",
    "- Keep the scenario applicable to the selected role and selected industries.",
    "- Do not invent regulated claims, guarantees, or unsupported product details.",
    "- Scoring guidance should focus on what the client wants measured and what good performance looks like.",
  ].join("\n");
}

function extractFirstJsonObject(rawText: string): Record<string, unknown> | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  const direct = (() => {
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();
  if (direct) {
    return direct;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim()) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore and fall through
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = text.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function toMultilineText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, Math.max(1, maxChars));
}

function normalizeRoleIdentityText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aiRoleMatchesTraineeRole(aiRole: string, traineeSegmentLabel: string): boolean {
  const normalizedAiRole = normalizeRoleIdentityText(aiRole);
  const normalizedTrainee = normalizeRoleIdentityText(traineeSegmentLabel);
  if (!normalizedAiRole || !normalizedTrainee) {
    return false;
  }

  if (normalizedAiRole.includes(normalizedTrainee) || normalizedTrainee.includes(normalizedAiRole)) {
    return true;
  }

  const traineeTokens = normalizedTrainee.split(" ").filter((token) => token.length > 2);
  if (traineeTokens.length === 0) {
    return false;
  }

  return traineeTokens.every((token) => normalizedAiRole.includes(token));
}

function computeUserUsage(db: ApiDatabase, user: UserProfile, now: Date, timezone: string) {
  return usageSessionAccess.computeUserUsageSnapshot(db, {
    userId: user.id,
    now,
    timeZone: timezone
  });
}

function computeOrgBilledToday(db: ApiDatabase, orgId: string, now: Date, timezone: string): number {
  return usageSessionAccess.computeOrgBilledToday(db, {
    orgId,
    now,
    timeZone: timezone
  });
}

function resolveTierDefinition(db: ApiDatabase, tierId: string): TierDefinition {
  return (
    getTierById(db.config.tiers, tierId as TierDefinition["id"]) ??
    DEFAULT_TIER_DEFINITIONS.find((tier) => tier.id === "free")!
  );
}

function computeEntitlements(
  db: ApiDatabase,
  user: UserProfile,
  now: Date,
  options?: { allowDuringActiveSimulation?: boolean; actingOrgId?: string | null }
): UserEntitlementsResponse {
  const timezone = materializeUserTimezone(user, now);
  const tierDefinition = resolveTierDefinition(db, user.tier);
  const usage = computeUserUsage(db, user, now, timezone);
  const org = getOrgById(db, isSuperUser(user) ? options?.actingOrgId ?? null : user.orgId);

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
  let userDailyOverageMode: TemporaryDailyOverageMode | null = null;
  let userDailyOverageExtraSecondsGranted: number | null = null;
  let userDailyOverageExtraSecondsConsumed: number | null = null;
  let userDailyOverageExtraSecondsRemaining: number | null = null;
  let nextRenewalAt = computeNextRenewalAt(user.planAnchorAt, now);
  let lockReason: string | null = null;
  let lockCode: UserEntitlementsResponse["lockCode"] = null;
  const organizationAccess = resolveMobilePaidAiOrganizationAccess({
    accountType: user.accountType,
    userOrgId: user.orgId,
    isSuperUser: isSuperUser(user),
    actingOrg: org,
  });

  if (!organizationAccess.allowed) {
    dailySecondsRemaining = 0;
    lockReason = organizationAccess.reason;
    lockCode = organizationAccess.code;
    clearSimulationOrgMonthlyOverrunGrace(user.id);
  } else if (isSuperUser(user)) {
    dailySecondsLimit = null;
    if (!org) {
      lockReason = "Select an enterprise account environment.";
      dailySecondsRemaining = 0;
    } else {
      const orgUsage = resolveOrgUsageForCurrentBillingCycle(db, org, now);
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
      clearSimulationOrgMonthlyOverrunGrace(user.id);
    } else {
      orgDailySecondsQuota = org.dailySecondsQuota + org.manualBonusSeconds;
      const effectiveOrgPerUserDailySecondsCap = resolveEffectiveOrgPerUserDailySecondsCap(org, now);
      const userDailyCapBase =
        user.dailySecondsCapOverride !== null
          ? clampNonNegativeInteger(user.dailySecondsCapOverride, effectiveOrgPerUserDailySecondsCap)
          : effectiveOrgPerUserDailySecondsCap;
      perUserDailySecondsCap = Math.max(0, userDailyCapBase + user.manualBonusSeconds);
      maxSimulationMinutes = normalizeMaxSimulationMinutes(org.maxSimulationMinutes);
      const orgUsage = resolveOrgUsageForCurrentBillingCycle(db, org, now);
      orgMonthlySecondsAllotted = orgUsage.allottedSeconds;
      orgBillingPeriodStartAt = orgUsage.periodStartAt;
      orgBillingPeriodEndAt = orgUsage.periodEndAt;
      orgUsedSecondsThisPeriod = orgUsage.usedSeconds;
      orgAllottedSecondsThisPeriod = orgUsage.allottedSeconds;
      orgRemainingSecondsThisPeriod = orgUsage.remainingSeconds;
      orgUsagePercentThisPeriod = orgUsage.usagePercent;
      nextRenewalAt = orgUsage.nextRenewalAt;

      const dailyOverageAllowance = resolveUserDailyOverageAllowance(db, user, now);
      userDailyOverageAllowed = dailyOverageAllowance.active;
      userDailyOverageMode = dailyOverageAllowance.mode;
      userDailyOverageExtraSecondsGranted = dailyOverageAllowance.extraSecondsGranted;
      userDailyOverageExtraSecondsConsumed = dailyOverageAllowance.extraSecondsConsumed;
      userDailyOverageExtraSecondsRemaining = dailyOverageAllowance.extraSecondsRemaining;
      const dailyQuota = resolveEnterpriseDailyQuota({
        billedSecondsToday: usage.billedSecondsToday,
        effectiveDailySecondsCap: perUserDailySecondsCap,
        overageMode: userDailyOverageAllowed ? userDailyOverageMode : null,
        finiteExtraSecondsRemaining: userDailyOverageExtraSecondsRemaining,
      });
      dailySecondsRemaining = dailyQuota.remainingSeconds;
      const quotaLockReason = resolveEnterpriseQuotaLockReason({
        dailyCapExceeded: dailyQuota.exceeded,
        orgMonthlySecondsRemaining: orgUsage.remainingSeconds,
      });
      if (quotaLockReason) {
        const nowMs = now.getTime();
        const allowGrace =
          options?.allowDuringActiveSimulation === true && hasActiveSimulationAiBudgetGrace(user.id, nowMs);
        if (allowGrace) {
          const graceExpiresAtMs = ensureSimulationOrgMonthlyOverrunGrace(user.id, nowMs);
          if (graceExpiresAtMs <= nowMs) {
            lockReason = quotaLockReason;
          }
        } else {
          clearSimulationOrgMonthlyOverrunGrace(user.id);
          lockReason = quotaLockReason;
        }
      } else {
        clearSimulationOrgMonthlyOverrunGrace(user.id);
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
    lockCode = null;
    dailySecondsRemaining = 0;
    clearSimulationOrgMonthlyOverrunGrace(user.id);
  }

  if (user.status !== "active") {
    lockReason = "User account is disabled.";
    lockCode = null;
    dailySecondsRemaining = 0;
    clearSimulationOrgMonthlyOverrunGrace(user.id);
  }

  return {
    userId: user.id,
    tier: user.tier,
    accountType: user.accountType,
    status: user.status,
    features: {
      support: isSuperUser(user) || tierDefinition.supportIncluded || user.accountType === "enterprise",
      customScenarioBuilder:
        isSuperUser(user) || (db.config.featureFlags.customScenarioBuilder && tierDefinition.canCreateCustomScenarios)
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
      userDailyOverageMode,
      userDailyOverageExtraSecondsGranted,
      userDailyOverageExtraSecondsConsumed,
      userDailyOverageExtraSecondsRemaining,
      timezoneUsed: timezone,
      nextDailyResetLabel: humanDailyResetLabel(timezone),
      nextRenewalAt
    },
    canStartSimulation: user.status === "active" && !lockReason,
    lockReason,
    lockCode,
  };
}

function respondWithEntitlementDenial(response: Response, entitlements: UserEntitlementsResponse): void {
  response.status(403).json({
    error: entitlements.lockReason ?? "Simulation unavailable.",
    ...(entitlements.lockCode ? { code: entitlements.lockCode } : {}),
  });
}

function pruneExpiredSimulationAiBudgetGrace(nowMs = Date.now()): void {
  for (const [userId, expiresAtMs] of simulationAiBudgetGraceByUserId.entries()) {
    if (expiresAtMs <= nowMs) {
      simulationAiBudgetGraceByUserId.delete(userId);
    }
  }
}

function hasActiveSimulationAiBudgetGrace(userId: string, nowMs = Date.now()): boolean {
  pruneExpiredSimulationAiBudgetGrace(nowMs);
  const expiresAtMs = simulationAiBudgetGraceByUserId.get(userId);
  return typeof expiresAtMs === "number" && expiresAtMs > nowMs;
}

function activateSimulationAiBudgetGrace(userId: string, maxSimulationMinutes: number | null): void {
  const nowMs = Date.now();
  pruneExpiredSimulationAiBudgetGrace(nowMs);
  const baseMinutes = clampNonNegativeInteger(maxSimulationMinutes, SIMULATION_AI_BUDGET_GRACE_FALLBACK_MINUTES);
  const graceMinutes = Math.min(
    SIMULATION_AI_BUDGET_GRACE_MAX_MINUTES,
    Math.max(1, baseMinutes + SIMULATION_AI_BUDGET_GRACE_BUFFER_MINUTES)
  );
  simulationAiBudgetGraceByUserId.set(userId, nowMs + graceMinutes * 60 * 1000);
}

export function setSimulationAiBudgetGraceForTest(userId: string, expiresAtMs: number): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setSimulationAiBudgetGraceForTest is only available in test.");
  }
  simulationAiBudgetGraceByUserId.set(userId, expiresAtMs);
}

function clearSimulationAiBudgetGrace(userId: string): void {
  simulationAiBudgetGraceByUserId.delete(userId);
}

function clearSimulationOrgMonthlyOverrunGrace(userId: string): void {
  simulationOrgMonthlyOverrunGraceByUserId.delete(userId);
}

function ensureSimulationOrgMonthlyOverrunGrace(userId: string, nowMs = Date.now()): number {
  const existing = simulationOrgMonthlyOverrunGraceByUserId.get(userId);
  if (typeof existing === "number") {
    return existing;
  }

  const expiresAtMs = nowMs + SIMULATION_ORG_MONTHLY_OVERRUN_GRACE_MINUTES * 60 * 1000;
  simulationOrgMonthlyOverrunGraceByUserId.set(userId, expiresAtMs);
  return expiresAtMs;
}

function resolveEffectiveOrgPerUserDailySecondsCap(org: EnterpriseOrg, now: Date): number {
  const pendingCap = clampNonNegativeInteger(org.pendingPerUserDailySecondsCap, -1);
  const pendingEffectiveAt = parseIsoDateOrNull(org.pendingPerUserDailySecondsCapEffectiveAt);
  if (pendingCap >= 0 && pendingEffectiveAt && pendingEffectiveAt.getTime() <= now.getTime()) {
    return pendingCap;
  }
  return clampNonNegativeInteger(org.perUserDailySecondsCap, 0);
}

function clearUserDailyOverage(user: UserProfile): void {
  user.allowDailyOverageThisCycle = false;
  user.dailyOverageExpiresAt = null;
  user.dailyOverageMode = null;
  user.dailyOverageStartedAt = null;
  user.dailyOverageBaseSecondsCap = null;
  user.dailyOverageExtraSecondsGranted = null;
}

type TemporaryDailyOveragePatch = {
  allowDailyOverageThisCycle?: unknown;
  dailyOverageMode?: unknown;
  dailyOverageDurationDays?: unknown;
  dailyOverageExtraMinutes?: unknown;
};

function buildTemporaryDailyOverageGrant(params: {
  patch: TemporaryDailyOveragePatch;
  user: UserProfile;
  org: EnterpriseOrg;
  now: Date;
}):
  | { ok: true; values: Pick<UserProfile,
      "allowDailyOverageThisCycle" | "dailyOverageExpiresAt" | "dailyOverageMode" |
      "dailyOverageStartedAt" | "dailyOverageBaseSecondsCap" | "dailyOverageExtraSecondsGranted"> }
  | { ok: false; error: string } {
  if (params.patch.allowDailyOverageThisCycle !== true) {
    return {
      ok: true,
      values: {
        allowDailyOverageThisCycle: false,
        dailyOverageExpiresAt: null,
        dailyOverageMode: null,
        dailyOverageStartedAt: null,
        dailyOverageBaseSecondsCap: null,
        dailyOverageExtraSecondsGranted: null,
      },
    };
  }

  const durationDays = params.patch.dailyOverageDurationDays;
  if (!Number.isInteger(durationDays) || Number(durationDays) <= 0 || Number(durationDays) > 3650) {
    return { ok: false, error: "Temporary overage duration must be an integer from 1 to 3650 days." };
  }
  const mode = params.patch.dailyOverageMode;
  if (mode !== "unlimited" && mode !== "finite") {
    return { ok: false, error: "Temporary overage mode must be unlimited or finite." };
  }

  let extraSecondsGranted: number | null = null;
  if (mode === "finite") {
    const extraMinutes = params.patch.dailyOverageExtraMinutes;
    if (!Number.isInteger(extraMinutes) || Number(extraMinutes) <= 0 || Number(extraMinutes) > 1_000_000) {
      return { ok: false, error: "Temporary extra minutes must be an integer from 1 to 1000000." };
    }
    extraSecondsGranted = Number(extraMinutes) * 60;
  }

  const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(params.org, params.now), params.now);
  const expiresAt = resolveTemporaryDailyOverageExpiration({
    now: params.now,
    durationDays: Number(durationDays),
    nextRenewalAt: billing.nextRenewalAt,
  });
  const effectiveDailySecondsCap = Math.max(
    0,
    (params.user.dailySecondsCapOverride ?? resolveEffectiveOrgPerUserDailySecondsCap(params.org, params.now))
      + params.user.manualBonusSeconds,
  );
  const finiteSnapshot = mode === "finite"
    ? resolveFiniteDailyOverageGrantSnapshot({
        allowed: params.user.allowDailyOverageThisCycle,
        mode: params.user.dailyOverageMode,
        expiresAt: params.user.dailyOverageExpiresAt,
        startedAt: params.user.dailyOverageStartedAt,
        baseDailySecondsCap: params.user.dailyOverageBaseSecondsCap,
        extraSecondsGranted: params.user.dailyOverageExtraSecondsGranted,
        now: params.now,
        currentEffectiveDailySecondsCap: effectiveDailySecondsCap,
      })
    : null;
  return {
    ok: true,
    values: {
      allowDailyOverageThisCycle: true,
      dailyOverageExpiresAt: expiresAt,
      dailyOverageMode: mode,
      dailyOverageStartedAt: finiteSnapshot?.startedAt ?? params.now.toISOString(),
      dailyOverageBaseSecondsCap: finiteSnapshot?.baseDailySecondsCap ?? null,
      dailyOverageExtraSecondsGranted: extraSecondsGranted,
    },
  };
}

function resolveUserDailyOverageAllowance(db: ApiDatabase, user: UserProfile, now: Date): {
  active: boolean;
  expiresAt: string | null;
  mode: TemporaryDailyOverageMode | null;
  extraSecondsGranted: number | null;
  extraSecondsConsumed: number | null;
  extraSecondsRemaining: number | null;
} {
  const window = resolveTemporaryDailyOverageWindow({
    allowed: user.allowDailyOverageThisCycle,
    expiresAt: user.dailyOverageExpiresAt,
    now,
  });
  if (!window.active || !window.expiresAt) {
    clearUserDailyOverage(user);
    return {
      active: false,
      expiresAt: null,
      mode: null,
      extraSecondsGranted: null,
      extraSecondsConsumed: null,
      extraSecondsRemaining: null,
    };
  }
  const expiresAt = new Date(window.expiresAt);

  const mode = resolveStoredDailyOverageMode({ allowed: true, mode: user.dailyOverageMode });
  if (mode !== "finite") {
    return {
      active: true,
      expiresAt: expiresAt.toISOString(),
      mode: "unlimited",
      extraSecondsGranted: null,
      extraSecondsConsumed: null,
      extraSecondsRemaining: null,
    };
  }

  const startedAt = parseIsoDateOrNull(user.dailyOverageStartedAt);
  const baseDailySecondsCap = normalizeOptionalSecondsCap(user.dailyOverageBaseSecondsCap);
  const extraSecondsGranted = normalizeOptionalSecondsCap(user.dailyOverageExtraSecondsGranted);
  if (!startedAt || startedAt.getTime() >= expiresAt.getTime() || baseDailySecondsCap === null || !extraSecondsGranted) {
    clearUserDailyOverage(user);
    return {
      active: false,
      expiresAt: null,
      mode: null,
      extraSecondsGranted: null,
      extraSecondsConsumed: null,
      extraSecondsRemaining: null,
    };
  }

  const finiteUsage = calculateFiniteDailyOverageUsage({
    sessions: listUsageSessions(db, { userId: user.id }),
    userId: user.id,
    timeZone: materializeUserTimezone(user, now),
    grantStartedAt: startedAt.toISOString(),
    effectiveEndAt: now.toISOString(),
    baseDailySecondsCap,
    extraSecondsGranted,
  });
  return {
    active: true,
    expiresAt: expiresAt.toISOString(),
    mode,
    ...finiteUsage,
  };
}

function resolveOrgUsageForCurrentBillingCycle(
  db: ApiDatabase,
  org: EnterpriseOrg,
  now: Date
): {
  periodStartAt: string;
  periodEndAt: string;
  nextRenewalAt: string;
  usedSeconds: number;
  allottedSeconds: number;
  remainingSeconds: number;
  usagePercent: number;
} {
  const snapshot = buildOrgUsageSnapshot(db, org, now);
  const remainingSeconds = Math.max(0, snapshot.allottedSeconds - snapshot.usedSeconds);
  const usagePercent = snapshot.allottedSeconds > 0 ? (snapshot.usedSeconds / snapshot.allottedSeconds) * 100 : 0;
  return {
    periodStartAt: snapshot.periodStartAt,
    periodEndAt: snapshot.periodEndAt,
    nextRenewalAt: snapshot.nextRenewalAt,
    usedSeconds: snapshot.usedSeconds,
    allottedSeconds: snapshot.allottedSeconds,
    remainingSeconds,
    usagePercent
  };
}

function isQuotaLockReason(lockReason: string | null | undefined): boolean {
  if (!lockReason) {
    return false;
  }
  const normalized = lockReason.toLowerCase();
  return (
    normalized.includes("allotment") ||
    normalized.includes("quota") ||
    normalized.includes("daily") ||
    normalized.includes("monthly")
  );
}

type AiBudgetSubject = Pick<UserProfile, "id" | "accountType" | "timezone">;

interface AiProviderBudgetContext {
  user: AiBudgetSubject;
  orgId: string | null;
  divisionId?: string | null;
  segmentId?: string | null;
  scenarioId?: string | null;
  allowDuringActiveSimulation?: boolean;
}

interface AiProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

class AiBudgetLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiBudgetLimitError";
  }
}

function getAiBudgetLimitMessage(
  limitCode: "user_calls" | "user_tokens" | "global_calls" | "global_tokens"
): string {
  switch (limitCode) {
    case "user_calls":
      return "Daily AI request limit reached for this account.";
    case "user_tokens":
      return "Daily AI token limit reached for this account.";
    case "global_calls":
      return "Daily AI request limit reached for this environment.";
    case "global_tokens":
      return "Daily AI token limit reached for this environment.";
  }
}

function resolveAiBudgetLimits(
  user: AiBudgetSubject,
  now: Date,
  options?: { allowDuringActiveSimulation?: boolean }
) {
  const skipPerUserLimits =
    user.accountType === "enterprise"
    || (options?.allowDuringActiveSimulation === true && hasActiveSimulationAiBudgetGrace(user.id, now.getTime()));
  return {
    userCalls: skipPerUserLimits ? null : OPENAI_MAX_DAILY_CALLS_PER_USER,
    userTokens: skipPerUserLimits ? null : OPENAI_MAX_DAILY_TOKENS_PER_USER,
    globalCalls: OPENAI_MAX_DAILY_CALLS_GLOBAL,
    globalTokens: OPENAI_MAX_DAILY_TOKENS_GLOBAL,
  };
}

function estimateCompletionReservationTokens(
  messages: Array<{ content: string }>,
  maxOutputTokens: number
): number {
  const promptBytes = messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0);
  return Math.max(0, promptBytes + Math.max(0, Math.floor(maxOutputTokens)));
}

async function invokeAiProviderWithBudget<T>(params: {
  context: AiProviderBudgetContext;
  kind: AiUsageEventKind;
  model: string;
  promptVersion: string;
  rubricVersion: string | null;
  estimatedTokens: number;
  invoke: () => Promise<T>;
  resolveUsage?: (value: T) => AiProviderTokenUsage;
}): Promise<{ value: T; usageEventId: string }> {
  const now = new Date();
  const usageEventId = `ai_${uuid()}`;
  const reservationEvent: AiUsageEvent = {
    id: usageEventId,
    kind: params.kind,
    userId: params.context.user.id,
    orgId: params.context.orgId,
    divisionId: params.context.divisionId ?? null,
    segmentId: params.context.segmentId ?? null,
    scenarioId: params.context.scenarioId ?? null,
    model: params.model,
    promptVersion: params.promptVersion,
    rubricVersion: params.rubricVersion,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: Math.max(0, Math.floor(params.estimatedTokens)),
    createdAt: now.toISOString(),
  };
  const reservation = await aiUsageEventAccess.reserveBudget({
    event: reservationEvent,
    userTimeZone: resolveTimeZone(params.context.user.timezone),
    limits: resolveAiBudgetLimits(params.context.user, now, {
      allowDuringActiveSimulation: params.context.allowDuringActiveSimulation,
    }),
    now,
  });
  if (!reservation.reserved) {
    throw new AiBudgetLimitError(getAiBudgetLimitMessage(reservation.limitCode));
  }

  try {
    const value = await params.invoke();
    const usage = params.resolveUsage?.(value) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    try {
      await aiUsageEventAccess.append({
        ...reservationEvent,
        inputTokens: toUsageEventToken(usage.inputTokens),
        outputTokens: toUsageEventToken(usage.outputTokens),
        totalTokens: toUsageEventToken(usage.totalTokens),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarnThrottled(
        "ai-budget:finalize",
        `[ai-budget] failed to finalize provider reservation ${usageEventId}; conservative reservation retained: ${message}`
      );
    }
    return { value, usageEventId };
  } catch (error) {
    try {
      await aiUsageEventAccess.deleteEvent(usageEventId);
    } catch (releaseError) {
      const message = releaseError instanceof Error ? releaseError.message : String(releaseError);
      logWarnThrottled(
        "ai-budget:release",
        `[ai-budget] failed to release provider reservation ${usageEventId}: ${message}`
      );
    }
    throw error;
  }
}

async function resolveAiBudgetLimitError(
  user: UserProfile,
  now: Date,
  options?: { allowDuringActiveSimulation?: boolean }
): Promise<string | null> {
  const budget = await aiUsageEventAccess.computeBudgetSnapshot({
    userId: user.id,
    now,
    userTimeZone: materializeUserTimezone(user, now)
  });
  const limits = resolveAiBudgetLimits(user, now, options);

  if (
    limits.userCalls !== null &&
    limits.userCalls >= 0 &&
    budget.userCallsToday >= limits.userCalls
  ) {
    return "Daily AI request limit reached for this account.";
  }

  if (
    limits.userTokens !== null &&
    limits.userTokens >= 0 &&
    budget.userTokensToday >= limits.userTokens
  ) {
    return "Daily AI token limit reached for this account.";
  }

  if (
    limits.globalCalls !== null &&
    limits.globalCalls >= 0 &&
    budget.globalCallsToday >= limits.globalCalls
  ) {
    return "Daily AI request limit reached for this environment.";
  }

  if (
    limits.globalTokens !== null &&
    limits.globalTokens >= 0 &&
    budget.globalTokensToday >= limits.globalTokens
  ) {
    return "Daily AI token limit reached for this environment.";
  }

  return null;
}

function resolveConfigForUser(db: ApiDatabase, user: UserProfile, actingOrgId?: string | null): AppConfig {
  const resolvedOrgId = isSuperUser(user) ? actingOrgId ?? null : user.orgId;

  if (!resolvedOrgId) {
    return db.config;
  }

  const org = getOrgById(db, resolvedOrgId);
  if (!org || (!isSuperUser(user) && org.status !== "active")) {
    return db.config;
  }

  const enabledIndustryIds = new Set(
    (db.config.industries ?? []).filter((entry) => entry.enabled).map((entry) => entry.id)
  );
  const scopedIndustryIds = normalizeIndustryIds(
    org.activeIndustries,
    getConfiguredActiveIndustryIds(db.config),
    enabledIndustryIds
  );
  const scopedIndustryIdSet = new Set(scopedIndustryIds);
  const divisionsEnabled = org.divisionsEnabled === true;
  const userDivisionId = divisionsEnabled ? resolveUserActiveDivisionId(db, org.id, user) : null;
  const mobileCustomScenarios = getMobileReadyOrgCustomScenarios(org, db.config);
  const mobileTrainings = getMobileReadyOrgTrainings(db, org, db.config).filter((training) =>
    isDivisionVisibleToUser({
      divisionsEnabled,
      userDivisionId,
      contentDivisionId: divisionsEnabled ? resolveTrainingActiveDivisionId(db, org.id, training.id) : null,
    })
  );
  const mobileTrainingScenarioIdSet = new Set(
    mobileTrainings.flatMap((training) => training.attachedCustomScenarioIds)
  );
  const trainingScopedCustomScenarios = mobileCustomScenarios.filter((scenario) =>
    mobileTrainingScenarioIdSet.has(scenario.id)
  );
  const customIndustryIdSet = new Set(
    trainingScopedCustomScenarios.flatMap((scenario) => scenario.applicableIndustryIds ?? []),
  );
  const allowedRoleSegmentIds = new Set(
    getRoleSegmentIdsForIndustries(scopedIndustryIds, db.config.roleIndustries)
  );
  for (const customScenario of trainingScopedCustomScenarios) {
    allowedRoleSegmentIds.add(customScenario.segmentId);
  }
  const filteredSegments = db.config.segments
    .filter((segment) => allowedRoleSegmentIds.has(segment.id))
    .map((segment) => {
      if (!divisionsEnabled) {
        return segment;
      }
      return {
        ...segment,
        scenarios: (segment.scenarios ?? []).filter((scenario) =>
          isDivisionVisibleToUser({
            divisionsEnabled,
            userDivisionId,
            contentDivisionId: resolveStandardScenarioActiveDivisionId(db, org.id, scenario.id),
          })
        ),
      };
    });
  const filteredIndustries = (db.config.industries ?? []).filter(
    (entry) => entry.enabled && (scopedIndustryIdSet.has(entry.id) || customIndustryIdSet.has(entry.id))
  );
  const filteredRoleIndustries = (db.config.roleIndustries ?? []).filter(
    (entry) =>
      entry.active &&
      scopedIndustryIdSet.has(entry.industryId) &&
      allowedRoleSegmentIds.has(entry.roleId)
  );

  if (filteredSegments.length === 0) {
    return {
      ...db.config,
      industries: filteredIndustries,
      roleIndustries: filteredRoleIndustries,
      segments: [],
      orgCustomScenarios: trainingScopedCustomScenarios,
      orgTrainings: mobileTrainings,
    };
  }

  const hasActiveSegment = filteredSegments.some(
    (segment) => segment.id === db.config.activeSegmentId && segment.enabled
  );
  const fallbackSegment = filteredSegments.find((segment) => segment.enabled) ?? filteredSegments[0];

  return {
    ...db.config,
    industries: filteredIndustries,
    roleIndustries: filteredRoleIndustries,
    activeSegmentId: hasActiveSegment ? db.config.activeSegmentId : fallbackSegment.id,
    segments: filteredSegments,
    orgCustomScenarios: trainingScopedCustomScenarios,
    orgTrainings: mobileTrainings,
  };
}

function normalizeAiIndustryBaselineForPrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_AI_INDUSTRY_BASELINE_PROMPT_CHARS);
}

function resolveAiIndustryPromptContextForAllowedIndustries(
  configForUser: AppConfig,
  allowedIndustryIdsInput: Iterable<string>,
  selectedIndustryIdRaw: unknown,
  selectedIndustryBaselineRaw: unknown,
  options?: {
    preferClientBaselineSnapshot?: boolean;
    canonicalIndustryDefinitions?: IndustryDefinition[];
  }
): {
  industryId: string | null;
  industryLabel: string | null;
  industryBaseline: string | null;
} {
  const activeLinkedIndustryIds = new Set(uniqueStrings(Array.from(allowedIndustryIdsInput)));
  const linkedIndustries = (configForUser.industries ?? []).filter(
    (industry) => industry.enabled && activeLinkedIndustryIds.has(industry.id)
  );

  let selectedIndustry: IndustryDefinition | null = null;
  if (typeof selectedIndustryIdRaw === "string" && selectedIndustryIdRaw.trim()) {
    const requestedIndustryId = selectedIndustryIdRaw.trim();
    selectedIndustry = linkedIndustries.find((industry) => industry.id === requestedIndustryId) ?? null;
  } else if (linkedIndustries.length === 1) {
    selectedIndustry = linkedIndustries[0] ?? null;
  }

  if (!selectedIndustry) {
    return {
      industryId: null,
      industryLabel: null,
      industryBaseline: null
    };
  }

  const configuredBaseline = normalizeAiIndustryBaselineForPrompt(selectedIndustry.aiBaseline);
  const preferClientBaselineSnapshot = options?.preferClientBaselineSnapshot ?? true;
  if (!preferClientBaselineSnapshot) {
    const canonicalIndustry = (options?.canonicalIndustryDefinitions ?? []).find(
      (industry) => industry.id === selectedIndustry.id
    );
    const canonicalServerBaseline = normalizeAiIndustryBaselineForPrompt(canonicalIndustry?.aiBaseline);
    const defaultIndustryBaseline = normalizeAiIndustryBaselineForPrompt(
      DEFAULT_INDUSTRIES.find((industry) => industry.id === selectedIndustry.id)?.aiBaseline
    );
    const serverAuthoritativeBaseline =
      configuredBaseline ??
      canonicalServerBaseline ??
      defaultIndustryBaseline ??
      null;

    return {
      industryId: selectedIndustry.id,
      industryLabel: selectedIndustry.label,
      industryBaseline: serverAuthoritativeBaseline
    };
  }

  const cachedBaseline = normalizeAiIndustryBaselineForPrompt(selectedIndustryBaselineRaw);
  const resolvedBaseline = cachedBaseline ?? configuredBaseline;

  return {
    industryId: selectedIndustry.id,
    industryLabel: selectedIndustry.label,
    industryBaseline: resolvedBaseline
  };
}

function resolveAiIndustryPromptContext(
  configForUser: AppConfig,
  segment: SegmentDefinition,
  selectedIndustryIdRaw: unknown,
  selectedIndustryBaselineRaw: unknown,
  options?: {
    preferClientBaselineSnapshot?: boolean;
  }
): {
  industryId: string | null;
  industryLabel: string | null;
  industryBaseline: string | null;
} {
  const activeLinkedIndustryIds = (configForUser.roleIndustries ?? [])
    .filter((entry) => entry.active && entry.roleId === segment.id)
    .map((entry) => entry.industryId);

  return resolveAiIndustryPromptContextForAllowedIndustries(
    configForUser,
    activeLinkedIndustryIds,
    selectedIndustryIdRaw,
    selectedIndustryBaselineRaw,
    options,
  );
}

function sanitizeConfigPatch(current: AppConfig, patch: UpdateConfigRequest): AppConfig {
  const nextSegments = normalizeSegmentDefinitions(
    patch.segments ?? current.segments,
    current.segments ?? DEFAULT_SEGMENTS
  );
  const nextIndustries = normalizeIndustryDefinitions(
    patch.industries ?? current.industries,
    current.industries ?? DEFAULT_INDUSTRIES
  );
  const nextRoleIndustries = normalizeRoleIndustryDefinitions(
    patch.roleIndustries ?? current.roleIndustries,
    nextIndustries,
    nextSegments,
    current.roleIndustries ?? DEFAULT_ROLE_INDUSTRIES,
    patch.roleIndustries !== undefined
  );

  const merged: AppConfig = {
    ...current,
    activeSegmentId: patch.activeSegmentId ?? current.activeSegmentId,
    defaultDifficulty: patch.defaultDifficulty ?? current.defaultDifficulty,
    industries: nextIndustries,
    roleIndustries: nextRoleIndustries,
    segments: nextSegments,
    tiers: patch.tiers ?? current.tiers,
    enterprise: patch.enterprise ? { ...current.enterprise, ...patch.enterprise } : current.enterprise,
    updatedAt: nowIso()
  };

  if (!merged.segments.some((segment) => segment.id === merged.activeSegmentId && segment.enabled)) {
    const fallback = merged.segments.find((segment) => segment.enabled);
    if (fallback) {
      merged.activeSegmentId = fallback.id;
    }
  }

  return merged;
}

interface ContentDeleteValidationIssue {
  field: "industry" | "role" | "scenario";
  ids: string[];
  reason: string;
}

function toEpochMs(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function validateContentDeletes(
  db: ApiDatabase,
  current: AppConfig,
  next: AppConfig
): ContentDeleteValidationIssue[] {
  const issues: ContentDeleteValidationIssue[] = [];
  const cutoffMs = Date.now() - CONTENT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const currentRoleIds = new Set(current.segments.map((segment) => segment.id));
  const nextRoleIds = new Set(next.segments.map((segment) => segment.id));
  const removedRoleIds = Array.from(currentRoleIds).filter((id) => !nextRoleIds.has(id));

  const currentScenarioIds = new Set(
    current.segments.flatMap((segment) => (segment.scenarios ?? []).map((scenario) => scenario.id))
  );
  const nextScenarioIds = new Set(
    next.segments.flatMap((segment) => (segment.scenarios ?? []).map((scenario) => scenario.id))
  );
  const removedScenarioIds = Array.from(currentScenarioIds).filter((id) => !nextScenarioIds.has(id));

  const currentIndustryIds = new Set((current.industries ?? []).map((industry) => industry.id));
  const nextIndustryIds = new Set((next.industries ?? []).map((industry) => industry.id));
  const removedIndustryIds = Array.from(currentIndustryIds).filter((id) => !nextIndustryIds.has(id));

  const removedRoleIdSet = new Set(removedRoleIds);
  const removedScenarioIdSet = new Set(removedScenarioIds);
  const removedIndustryIdSet = new Set(removedIndustryIds);
  const currentRoleByIndustry = new Map<string, Set<string>>();
  for (const mapping of current.roleIndustries ?? []) {
    const roleIds = currentRoleByIndustry.get(mapping.industryId) ?? new Set<string>();
    roleIds.add(mapping.roleId);
    currentRoleByIndustry.set(mapping.industryId, roleIds);
  }

  if (removedRoleIdSet.size > 0 || removedScenarioIdSet.size > 0 || removedIndustryIdSet.size > 0) {
    const recentUsageHits = new Set<string>();
    const recentScoreHits = new Set<string>();
    const allRecords = [
      ...usageSessionAccess.listRecentActivityReferences(db, { since: new Date(cutoffMs) }),
      ...scoreRecordAccess.listRecentActivityReferences(db, { since: new Date(cutoffMs) })
    ];

    for (const row of allRecords) {
      const endedAtMs = toEpochMs(row.endedAt);
      if (endedAtMs === null || endedAtMs < cutoffMs) {
        continue;
      }

      if (removedRoleIdSet.has(row.segmentId)) {
        recentUsageHits.add(row.segmentId);
      }
      if (removedScenarioIdSet.has(row.scenarioId)) {
        recentScoreHits.add(row.scenarioId);
      }
      if (removedIndustryIdSet.size > 0) {
        for (const industryId of removedIndustryIdSet) {
          const roleIds = currentRoleByIndustry.get(industryId);
          if (roleIds && roleIds.has(row.segmentId)) {
            recentUsageHits.add(industryId);
          }
        }
      }
    }

    if (removedRoleIds.length > 0) {
      const blocked = removedRoleIds.filter((id) => recentUsageHits.has(id));
      if (blocked.length > 0) {
        issues.push({
          field: "role",
          ids: blocked,
          reason: `Cannot delete roles used in the last ${CONTENT_DELETE_RETENTION_DAYS} days. Deactivate instead.`
        });
      }
    }

    if (removedScenarioIds.length > 0) {
      const blocked = removedScenarioIds.filter((id) => recentScoreHits.has(id));
      if (blocked.length > 0) {
        issues.push({
          field: "scenario",
          ids: blocked,
          reason: `Cannot delete scenarios used in the last ${CONTENT_DELETE_RETENTION_DAYS} days. Deactivate instead.`
        });
      }
    }

    if (removedIndustryIds.length > 0) {
      const blockedByUsage = removedIndustryIds.filter((id) => recentUsageHits.has(id));
      const blockedByOrg = removedIndustryIds.filter((industryId) =>
        db.orgs.some((org) => (org.activeIndustries ?? []).includes(industryId))
      );
      const blocked = Array.from(new Set([...blockedByUsage, ...blockedByOrg]));
      if (blocked.length > 0) {
        issues.push({
          field: "industry",
          ids: blocked,
          reason:
            `Cannot delete industries still in use or used in the last ${CONTENT_DELETE_RETENTION_DAYS} days. ` +
            "Deactivate instead."
        });
      }
    }
  }

  return issues;
}

interface OrgUsageSnapshot {
  periodStartAt: string;
  periodEndAt: string;
  nextRenewalAt: string;
  usedSeconds: number;
  usedMinutes: number;
  allottedMinutes: number;
  allottedSeconds: number;
  remainingMinutes: number;
  usagePercent: number;
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

function buildOrgUsageSnapshot(db: ApiDatabase, org: EnterpriseOrg, now: Date): OrgUsageSnapshot {
  return usageSessionAccess.buildOrgUsageSnapshot(db, {
    orgId: org.id,
    billingAnchorAt: resolveOrgBillingAnchorAt(org, now),
    allottedMinutes: normalizeMonthlyMinutesAllotted(
      org.monthlyMinutesAllotted,
      deriveDefaultMonthlyMinutesAllotted(org)
    ),
    now
  });
}

function buildDashboardOrgUsageSnapshot(
  db: ApiDatabase,
  org: EnterpriseOrg,
  now: Date,
  divisionId: string | null = null,
  permittedUserIds: ReadonlySet<string> | null = null
): OrgUsageSnapshot {
  const baseSnapshot = buildOrgUsageSnapshot(db, org, now);
  if (!divisionId && !permittedUserIds) {
    return baseSnapshot;
  }

  const filteredSessions = filterOrgUsageSessions(
    db,
    org.id,
    new Date(baseSnapshot.periodStartAt).getTime(),
    new Date(baseSnapshot.periodEndAt).getTime(),
    divisionId,
    permittedUserIds
  );
  const usedSeconds = usageSessionAccess.sumBilledSeconds(filteredSessions);
  const usedMinutes = usedSeconds / 60;
  const usagePercent = baseSnapshot.allottedSeconds > 0 ? (usedSeconds / baseSnapshot.allottedSeconds) * 100 : 0;
  const remainingMinutes = Math.max(0, baseSnapshot.allottedMinutes - usedMinutes);

  return {
    ...baseSnapshot,
    usedSeconds,
    usedMinutes,
    usagePercent,
    remainingMinutes,
  };
}

function getOrgAdmins(db: ApiDatabase, orgId: string): Array<{ id: string; email: string; status: UserStatus }> {
  return db.users
    .filter((user) => user.accountType === "enterprise" && user.orgId === orgId && user.orgRole === "org_admin")
    .map((user) => ({
      id: user.id,
      email: user.email,
      status: user.status
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function findSoftLimitNotificationAudit(
  db: ApiDatabase,
  orgId: string,
  thresholdPercent: number,
  periodStartAt: string
): Promise<string | null> {
  const pendingMatch = getPendingAuditEvents(db).find((event) => {
    if (event.action !== "org.soft_limit.threshold_reached" || event.orgId !== orgId) {
      return false;
    }

    const metadata = event.metadata as Record<string, unknown> | null;
    const threshold = Number(metadata?.thresholdPercent ?? NaN);
    const periodStart = typeof metadata?.periodStartAt === "string" ? metadata.periodStartAt : "";
    return Number.isFinite(threshold) && threshold === thresholdPercent && periodStart === periodStartAt;
  });

  if (pendingMatch) {
    return pendingMatch.createdAt;
  }

  const queryFrom = parseIsoDateOrNull(periodStartAt);
  const persistedEvents = await auditEventStore.listEvents({
    orgId,
    action: "org.soft_limit.threshold_reached",
    from: queryFrom,
    limit: 200
  });
  const persistedMatch = persistedEvents.find((event) => {
    const metadata = event.metadata as Record<string, unknown> | null;
    const threshold = Number(metadata?.thresholdPercent ?? NaN);
    const periodStart = typeof metadata?.periodStartAt === "string" ? metadata.periodStartAt : "";
    return Number.isFinite(threshold) && threshold === thresholdPercent && periodStart === periodStartAt;
  });

  return persistedMatch?.createdAt ?? null;
}

async function ensureSoftLimitNotificationAudit(
  db: ApiDatabase,
  org: EnterpriseOrg,
  thresholdPercent: number,
  usage: OrgUsageSnapshot,
  orgAdminEmails: string[]
): Promise<string> {
  const existingCreatedAt = await findSoftLimitNotificationAudit(db, org.id, thresholdPercent, usage.periodStartAt);
  if (existingCreatedAt) {
    return existingCreatedAt;
  }

  const now = nowIso();
  appendPlatformAuditEvent(db, {
    action: "org.soft_limit.threshold_reached",
    orgId: org.id,
    message:
      `Soft limit ${thresholdPercent}% reached for ${org.name}. ` +
      (orgAdminEmails.length > 0
        ? `Notification target: ${orgAdminEmails.join(", ")}.`
        : "No org admin email target available."),
    metadata: {
      thresholdPercent,
      usagePercent: Math.round(usage.usagePercent * 10) / 10,
      periodStartAt: usage.periodStartAt,
      periodEndAt: usage.periodEndAt,
      nextRenewalAt: usage.nextRenewalAt,
      orgAdminEmails
    }
  });
  return now;
}

function getActiveIndustryLabelsForOrg(org: EnterpriseOrg, config: AppConfig): string[] {
  const labelById = new Map((config.industries ?? []).map((industry) => [industry.id, industry.label]));
  return (org.activeIndustries ?? []).map((id) => labelById.get(id) ?? id);
}

type MobileUpdateReason = "user" | "org" | "config" | "resync" | "unknown";

interface MobileUpdatesResponse {
  cursor: number;
  changed: boolean;
  reason: MobileUpdateReason | null;
  generatedAt: string;
  user?: UserProfile;
  config?: AppConfig;
  entitlements?: UserEntitlementsResponse;
}

interface MobileUpdateWaiter {
  since: number;
  resolved: boolean;
  response: Response;
  timeoutHandle: NodeJS.Timeout;
}

const mobileUpdateCursorByUserId = new Map<string, number>();
const mobileUpdateReasonByUserId = new Map<string, MobileUpdateReason>();
const mobileUpdatePayloadByUserId = new Map<string, MobileUpdatesResponse>();
const mobileUpdateWaitersByUserId = new Map<string, Set<MobileUpdateWaiter>>();

function getMobileUpdateCursor(userId: string): number {
  return mobileUpdateCursorByUserId.get(userId) ?? 0;
}

function bumpMobileUpdateCursor(userId: string, reason: MobileUpdateReason): number {
  const nextCursor = getMobileUpdateCursor(userId) + 1;
  mobileUpdateCursorByUserId.set(userId, nextCursor);
  mobileUpdateReasonByUserId.set(userId, reason);
  return nextCursor;
}

function buildMobileUpdatesPayload(
  db: ApiDatabase,
  user: UserProfile,
  cursor: number,
  reason: MobileUpdateReason,
): MobileUpdatesResponse {
  const now = new Date();
  materializeUserTimezone(user, now);
  return {
    cursor,
    changed: true,
    reason,
    generatedAt: now.toISOString(),
    user,
    config: resolveConfigForUser(db, user),
    entitlements: computeEntitlements(db, user, now),
  };
}

function resolveMobileWaitersSet(userId: string): Set<MobileUpdateWaiter> {
  const existing = mobileUpdateWaitersByUserId.get(userId);
  if (existing) {
    return existing;
  }
  const created = new Set<MobileUpdateWaiter>();
  mobileUpdateWaitersByUserId.set(userId, created);
  return created;
}

function cleanupWaiter(userId: string, waiter: MobileUpdateWaiter): void {
  const set = mobileUpdateWaitersByUserId.get(userId);
  if (!set) {
    return;
  }

  set.delete(waiter);
  if (set.size === 0) {
    mobileUpdateWaitersByUserId.delete(userId);
  }
}

function resolveWaiter(userId: string, waiter: MobileUpdateWaiter, payload: MobileUpdatesResponse): void {
  if (waiter.resolved) {
    return;
  }

  waiter.resolved = true;
  clearTimeout(waiter.timeoutHandle);
  cleanupWaiter(userId, waiter);

  try {
    waiter.response.setHeader("Cache-Control", "no-store");
    waiter.response.json(payload);
  } catch {
    // Ignore broken pipe / disconnected clients.
  }
}

function revokeMobileAccessForUser(db: ApiDatabase, userId: string, reason: string): void {
  db.mobileAuthTokens = db.mobileAuthTokens.filter((record) => record.userId !== userId);

  const waiters = mobileUpdateWaitersByUserId.get(userId);
  if (waiters && waiters.size > 0) {
    for (const waiter of Array.from(waiters)) {
      if (waiter.resolved) {
        continue;
      }
      waiter.resolved = true;
      clearTimeout(waiter.timeoutHandle);
      try {
        waiter.response.status(410).json({ error: reason });
      } catch {
        // Ignore disconnected clients.
      }
    }
  }

  mobileUpdateWaitersByUserId.delete(userId);
  mobileUpdatePayloadByUserId.delete(userId);
  mobileUpdateCursorByUserId.delete(userId);
  mobileUpdateReasonByUserId.delete(userId);
}

function revokeEnterpriseOrgUserAccess(db: ApiDatabase, orgId: string, reason: string): string[] {
  const revokedUserIds: string[] = [];
  for (const user of db.users.filter((entry) => entry.accountType === "enterprise" && entry.orgId === orgId)) {
    revokedUserIds.push(user.id);
    db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
    revokeMobileAccessForUser(db, user.id, reason);
  }

  return revokedUserIds;
}

function emitMobileUpdateForUser(db: ApiDatabase, userId: string, reason: MobileUpdateReason): void {
  const user = getUserById(db, userId);
  if (!user) {
    return;
  }

  const cursor = bumpMobileUpdateCursor(userId, reason);
  const payload = buildMobileUpdatesPayload(db, user, cursor, reason);
  mobileUpdatePayloadByUserId.set(userId, payload);

  const waiters = mobileUpdateWaitersByUserId.get(userId);
  if (!waiters || waiters.size === 0) {
    return;
  }

  for (const waiter of Array.from(waiters)) {
    if (cursor > waiter.since) {
      resolveWaiter(userId, waiter, payload);
    }
  }
}

function emitMobileUpdateForOrg(db: ApiDatabase, orgId: string, reason: MobileUpdateReason): void {
  const users = db.users.filter((user) => user.accountType === "enterprise" && user.orgId === orgId);
  for (const user of users) {
    emitMobileUpdateForUser(db, user.id, reason);
  }
}

function emitMobileUpdateForAllUsers(db: ApiDatabase, reason: MobileUpdateReason): void {
  for (const user of db.users) {
    emitMobileUpdateForUser(db, user.id, reason);
  }
}

function getSupportedTimezones(): string[] {
  const fromIntl = (() => {
    try {
      const list = Intl.supportedValuesOf?.("timeZone");
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
      return [];
    } catch {
      return [];
    }
  })();

  if (fromIntl.length > 0) {
    return fromIntl;
  }

  return COMMON_TIMEZONES;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // A 15s compressed audio clip should be well under this; keeps memory bounded.
    // Busboy reports LIMIT_FILE_SIZE when bytes reach the configured value, so
    // use max + 1 to retain an inclusive 12 MB application-level boundary.
    fileSize: (12 * 1024 * 1024) + 1,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
    headerPairs: 100,
  }
});

const authenticatedMobileAiUserIds = new WeakMap<Request, string>();

async function requireMobileAiAuthentication(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  if (rejectIfRateLimitAlreadyExhausted(unauthenticatedAiRateLimitOptions, request, response)) {
    return;
  }

  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    if (!consumeRateLimit(unauthenticatedAiRateLimitOptions, request, response)) {
      return;
    }
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId?.trim();
  if (!userId) {
    if (!consumeRateLimit(unauthenticatedAiRateLimitOptions, request, response)) {
      return;
    }
    response.status(401).json({ error: "Invalid mobile token." });
    return;
  }

  const authenticatedUserId = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    return user && hasValidMobileTokenForUser(db, user.id, authToken) ? user.id : null;
  });
  if (!authenticatedUserId) {
    if (!consumeRateLimit(unauthenticatedAiRateLimitOptions, request, response)) {
      return;
    }
    response.status(401).json({ error: "Invalid mobile token." });
    return;
  }

  authenticatedMobileAiUserIds.set(request, authenticatedUserId);
  next();
}

const authLoginRateLimiter = createRateLimiter({
  name: "auth-login",
  windowMs: 15 * 60 * 1000,
  max: 12
});

const webAuthRequestCodeRateLimiter = createRateLimiter({
  name: "web-auth-request-code",
  windowMs: 15 * 60 * 1000,
  max: 12,
  onLimitExceeded: logDashboardWebAuthRequestRateLimited
});

const webAuthVerifyCodeRateLimiter = createRateLimiter({
  name: "web-auth-verify-code",
  windowMs: 15 * 60 * 1000,
  max: 20
});

const mobileOnboardRateLimiter = createRateLimiter({
  name: "mobile-onboard",
  windowMs: 15 * 60 * 1000,
  max: 30
});

const mobileOnboardAccountRateLimiter = createRateLimiter({
  name: "mobile-onboard-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keySelector: (request) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "unknown";
    return crypto.createHash("sha256").update(email || "unknown").digest("hex");
  }
});

const mobileVerificationRateLimiter = createRateLimiter({
  name: "mobile-verify-email",
  windowMs: 15 * 60 * 1000,
  max: 20,
  keySelector: (request) => {
    const bodyUserId = ((request.body as { userId?: unknown } | undefined)?.userId ?? "").toString().trim();
    return `${getClientIp(request)}:${bodyUserId || "unknown"}`;
  }
});

const mobileReviewerVerificationRateLimitOptions: RateLimiterOptions = {
  name: "mobile-reviewer-verify-email",
  windowMs: 15 * 60 * 1000,
  max: 20,
};

const mobileOrgJoinRequestRateLimiter = createRateLimiter({
  name: "mobile-org-join-request",
  windowMs: 15 * 60 * 1000,
  max: 20,
  keySelector: (request) => `${getClientIp(request)}:${request.params.userId || "unknown"}`
});

const mobilePublicErrorReportRateLimiter = createRateLimiter({
  name: "mobile-public-error-report",
  windowMs: 60 * 60 * 1000,
  max: 30
});

const unauthenticatedAiRateLimitOptions: RateLimiterOptions = {
  name: "mobile-ai-unauthenticated",
  windowMs: 15 * 60 * 1000,
  max: 120,
  keySelector: (request) => getClientIp(request)
};

const authenticatedAiRateLimitOptions: RateLimiterOptions = {
  name: "mobile-ai-authenticated",
  windowMs: 15 * 60 * 1000,
  max: 120,
};

const aiRouteRateLimiter = (request: Request, response: Response, next: NextFunction): void => {
  const authenticatedUserId = authenticatedMobileAiUserIds.get(request);
  if (!authenticatedUserId) {
    response.status(401).json({ error: "Invalid mobile token." });
    return;
  }

  if (consumeRateLimit(authenticatedAiRateLimitOptions, request, response, authenticatedUserId)) {
    next();
  }
};

const trainingContentStorageRateLimiter = createRateLimiter({
  name: "training-content-storage",
  windowMs: 15 * 60 * 1000,
  max: 120
});

function isRemoteAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // Native mobile and server-to-server requests often omit Origin.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (ALLOW_ALL_BROWSER_ORIGINS || CORS_ALLOWED_ORIGINS.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin is not allowed: ${origin}`));
    }
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, now: nowIso() });
});

app.get("/ready", (_request, response) => {
  if (isDatabaseReady) {
    response.json({
      ok: true,
      now: nowIso(),
      checkedAt: databaseReadyCheckedAt,
      consecutiveFailures: databaseReadyConsecutiveFailures
    });
    return;
  }

  response.status(503).json({
    ok: false,
    now: nowIso(),
    checkedAt: databaseReadyCheckedAt,
    error: databaseReadyError || "Database is not ready.",
    consecutiveFailures: databaseReadyConsecutiveFailures,
    failureThreshold: READINESS_FAILURE_THRESHOLD
  });
});

app.get("/ready/training-content-storage", (_request, response) => {
  const status = trainingContentStorageReadiness.getStatus();
  response.status(status.enabled && !status.available ? 503 : 200).json(status);
});

app.get("/version", (_request, response) => {
  if (!ENABLE_INTERNAL_DEBUG_ENDPOINTS) {
    response.status(404).json({ error: "Not found." });
    return;
  }

  response.json({
    gitSha: GIT_SHA || "unknown",
    buildTimestamp: BUILD_TIMESTAMP || "unknown",
    processStartedAt: PROCESS_STARTED_AT,
    models: {
      chatModel: OPENAI_CHAT_MODEL || "unknown",
      simulationModel: OPENAI_SIMULATION_MODEL || "unknown",
      transcriptionModel: OPENAI_TRANSCRIPTION_MODEL || "unknown"
    }
  });
});

app.get("/meta/environment", (_request, response) => {
  response.json({
    PERITIO_ENV: runtimeConfig.deploymentEnvironment,
    NODE_ENV: runtimeConfig.nodeEnv,
    gitSha: GIT_SHA || "unknown",
    buildTimestamp: BUILD_TIMESTAMP || "unknown",
    processStartedAt: PROCESS_STARTED_AT
  });
});

app.get("/meta/timezones", (_request, response) => {
  response.json({ items: getSupportedTimezones() });
});

app.post("/mobile/public/support/errors", mobilePublicErrorReportRateLimiter, async (request: Request, response: Response) => {
  const body = request.body as {
    message?: unknown;
    context?: unknown;
    screen?: unknown;
    platform?: unknown;
    appVersion?: unknown;
    details?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    response.status(400).json({ error: "message is required." });
    return;
  }

  if (!message.toUpperCase().startsWith("[AUTO-ERROR]")) {
    response.status(400).json({ error: "message must start with [AUTO-ERROR]." });
    return;
  }

  const context = typeof body.context === "string" ? body.context.trim().slice(0, 120) : "";
  const screen = typeof body.screen === "string" ? body.screen.trim().slice(0, 120) : "";
  const platform = typeof body.platform === "string" ? body.platform.trim().slice(0, 80) : "";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 80) : "";
  const detailsText = (() => {
    if (!body.details || typeof body.details !== "object") {
      return "";
    }

    try {
      return JSON.stringify(body.details).slice(0, 800);
    } catch {
      return "";
    }
  })();

  const supplementalLines = [
    context ? `Context: ${context}` : "",
    screen ? `Screen: ${screen}` : "",
    platform ? `Platform: ${platform}` : "",
    appVersion ? `App Version: ${appVersion}` : "",
    detailsText ? `Details: ${detailsText}` : ""
  ].filter(Boolean);

  const formattedMessage = [message, ...supplementalLines].join("\n").slice(0, SUPPORT_MESSAGE_MAX_LENGTH);
  const now = nowIso();

  await withDatabase(async (db) => {
    const record: SupportCaseRecord = {
      id: `case_${uuid()}`,
      status: "open",
      userId: "public_mobile_reporter",
      orgId: null,
      segmentId: null,
      scenarioId: null,
      message: formattedMessage,
      transcriptEncrypted: null,
      transcriptExpiresAt: null,
      transcriptFileName: null,
      transcriptMeta: null,
      createdAt: now,
      updatedAt: now
    };

    await supportCaseStore.saveCase(record, { now: new Date(now) });
    appendAuditEvent(db, {
      actorType: "system",
      actorId: null,
      action: "support.public_auto_error_created",
      orgId: null,
      userId: null,
      message: "Captured public mobile auto-error report.",
      metadata: {
        caseId: record.id,
        context: context || null,
        screen: screen || null,
        platform: platform || null
      }
    });

    response.status(201).json({ caseId: record.id });
  });
});

app.use((request: Request, response: Response, next: NextFunction) => {
  if (request.method === "OPTIONS") {
    next();
    return;
  }
  next();
});

app.post("/auth/login", authLoginRateLimiter, async (request: Request, response: Response) => {
  const body = request.body as { password?: string };
  const password = body.password?.trim();

  if (!password) {
    response.status(400).json({ error: "Password is required." });
    return;
  }

  await withDatabase(async (db) => {
    const valid = db.admin.passwordHash
      ? verifyScryptPassword(password, db.admin.passwordHash)
      : password === ADMIN_BOOTSTRAP_PASSWORD;

    if (!valid) {
      response.status(401).json({ error: "Invalid admin password." });
      return;
    }

    const expiresAtMs = Date.now() + ADMIN_TOKEN_TTL_MINUTES * 60 * 1000;
    const sid = `adm_${uuid()}`;
    addActiveAdminSession(db, sid);
    const token = signAdminToken({ role: "admin", exp: expiresAtMs, sid });

    response.json({ token, expiresAt: new Date(expiresAtMs).toISOString() });
  });
});

app.post("/auth/logout", requireAdmin, async (request: AdminAuthRequest, response: Response) => {
  const sid = request.admin?.sid;
  if (!sid) {
    response.status(400).json({ error: "Admin session not found." });
    return;
  }

  await withDatabase(async (db) => {
    removeActiveAdminSession(db, sid);
    appendPlatformAuditEvent(db, {
      action: "admin.logout",
      message: "Platform admin session signed out.",
      metadata: {
        sid
      }
    });
    response.json({ ok: true });
  });
});

app.post("/auth/change-password", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as ChangeAdminPasswordRequest;
  const currentPassword = body.currentPassword?.trim();
  const newPassword = body.newPassword?.trim();

  if (!currentPassword || !newPassword) {
    response.status(400).json({ error: "Current and new password are required." });
    return;
  }

  if (newPassword.length < 8) {
    response.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }

  await withDatabase(async (db) => {
    const valid = db.admin.passwordHash
      ? verifyScryptPassword(currentPassword, db.admin.passwordHash)
      : currentPassword === ADMIN_BOOTSTRAP_PASSWORD;

    if (!valid) {
      response.status(401).json({ error: "Current password is incorrect." });
      return;
    }

    db.admin.passwordHash = hashScryptPassword(newPassword);
    appendPlatformAuditEvent(db, {
      action: "admin.password_changed",
      message: "Platform admin password was changed."
    });
    response.json({ ok: true });
  });
});

app.post("/web/auth/request-code", webAuthRequestCodeRateLimiter, async (request: Request, response: Response) => {
  const body = request.body as WebAuthRequestCodeRequest;
  const email = body.email?.trim().toLowerCase();

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }

  await withDatabase(async (db) => {
    const result = await handleDashboardWebAuthCodeRequest({
      db,
      email,
      now: new Date(),
      issueSignInCode: async (user, now) => {
        const challenge = webAuthService.issueSignInChallenge(db, user, EMAIL_VERIFICATION_TTL_MINUTES, now);
        return {
          expiresAt: challenge.expiresAt,
          delivery: await authCodeDelivery.sendWebSignInCode({
            email: user.email,
            code: challenge.code,
            expiresAt: challenge.expiresAt
          })
        };
      },
      issueEmailVerificationCode: async (user, now) => issueEmailVerification(db, user, now, "dashboard"),
    });

    if (result.outcome === "issued") {
      appendWebAuditEvent(db, result.user, {
        action: "web_auth.code_requested",
        orgId: result.user.orgId,
        userId: result.user.id,
        message: `Issued ${result.challengeType} code for ${result.user.email}.`,
        metadata: {
          challengeType: result.challengeType,
          expiresAt: result.expiresAt,
          delivery: result.delivery,
        }
      });
      response.json(result.response);
    } else if (result.outcome === "delivery_failed") {
      logWarnThrottled(
        `web-auth-request:delivery-failed:${result.user.id}`,
        `[web-auth][request-code] ${result.reason} for ${result.user.email}: ${result.error.message}`,
        60 * 1000
      );
      appendWebAuditEvent(db, result.user, {
        action: "web_auth.code_request_failed",
        orgId: result.user.orgId,
        userId: result.user.id,
        message: `Failed to issue dashboard auth code for ${result.user.email}.`,
        metadata: {
          reason: result.reason,
          error: result.error.message,
        }
      });
      response.json(result.response);
    } else {
      logDashboardWebAuthRequestIgnored(email, result.reason);
      response.json(result.response);
    }
  });
});

app.post("/web/auth/verify-code", webAuthVerifyCodeRateLimiter, async (request: Request, response: Response) => {
  const body = request.body as WebAuthVerifyCodeRequest;
  const email = body.email?.trim().toLowerCase();
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!email || !isEmailLike(email) || !/^\d{6}$/.test(code)) {
    response.status(400).json({ error: "Email and 6-digit code are required." });
    return;
  }

  await withDatabase(async (db) => {
    const user = db.users.find((entry) => entry.email.toLowerCase() === email);
    if (!user) {
      response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
      return;
    }

    const dashboardEligibility = resolveDashboardAccessEligibility(db, user);
    if (!dashboardEligibility.eligible) {
      response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
      return;
    }

    const now = new Date();
    let challengeType: WebAuthChallengeType;
    if (user.emailVerifiedAt) {
      const result = webAuthService.verifyLatestSignInChallenge(db, user, code, now);
      if (result === "missing") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }
      if (result === "expired") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }
      if (result === "invalid") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }

      challengeType = "sign_in";
    } else {
      const result = verifyLatestEmailVerification({
        db,
        user,
        code,
        now,
        codeSecret: MOBILE_TOKEN_SECRET,
      });
      if (result === "missing") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }
      if (result === "expired") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }
      if (result === "invalid") {
        response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
        return;
      }

      const nowIsoValue = now.toISOString();
      user.emailVerifiedAt = nowIsoValue;
      user.updatedAt = nowIsoValue;
      emitMobileUpdateForUser(db, user.id, "user");
      appendWebAuditEvent(db, user, {
        action: "web_auth.email_verified",
        userId: user.id,
        message: `Email verified via shared web auth for ${user.email}.`
      });
      challengeType = "email_verification";
    }

    const viewer = resolveDashboardViewer(db, user);
    if (!viewer) {
      response.status(400).json({ error: DASHBOARD_WEB_AUTH_VERIFY_FAILURE_MESSAGE });
      return;
    }

    const sessionRequestMetadata = buildWebAuthSessionRequestMetadata(request);
    const { record, token, expiresAt, sessionId } = webAuthService.issueSession(
      user,
      DASHBOARD_WEB_AUTH_SESSION_TTL_MINUTES,
      now,
      {
        accessType: viewer.accessType,
        orgId: viewer.orgId,
        userAgent: sessionRequestMetadata.userAgent,
        ipAddress: sessionRequestMetadata.ipAddress
      }
    );
    appendWebAuditEvent(db, user, {
      action: "web_auth.session_created",
      orgId: user.orgId,
      userId: user.id,
      message: `Created shared web session for ${user.email}.`,
      metadata: {
        challengeType,
        sessionId,
        expiresAt,
        accessType: viewer.accessType,
        dashboardOrgId: viewer.orgId,
        clientIp: sessionRequestMetadata.ipAddress,
        userAgent: sessionRequestMetadata.userAgent
      }
    });
    await webAuthSessionStore.saveSession(record);

    const payload: WebAuthVerifyCodeResponse = {
      token,
      expiresAt,
      session: buildWebAuthSessionUser(user),
      dashboardViewer: viewer
    };
    response.json(payload);
  });
});

app.get("/web/auth/session", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  response.json({
    session: buildWebAuthSessionUser(request.dashboard!.user),
    dashboardViewer: request.dashboard!.viewer
  });
});

app.post("/web/auth/logout", requireWebAuth, async (request: WebAuthRequest, response: Response) => {
  await revokeWebAuthSessionById(request.webAuth!.sessionId);
  await withDatabase(async (db) => {
    appendWebAuditEvent(db, request.webAuth!.user, {
      action: "web_auth.logout",
      orgId: request.webAuth!.user.orgId,
      userId: request.webAuth!.user.id,
      message: `Signed out shared web session for ${request.webAuth!.user.email}.`,
      metadata: {
        sessionId: request.webAuth!.sessionId
      }
    });
    response.json({ ok: true });
  });
});

app.get("/dashboard/overview", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const payload = await buildDashboardOverview(db, request.dashboard!, divisionFilter.appliedDivisionId);
    response.json(payload);
  });
});

app.get("/dashboard/reporting/trainings", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingWrite(async (db) => {
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    for (const org of listDashboardAccessibleOrgs(db, request.dashboard!.viewer)) {
      await ensureOrgTrainingWorkspace(db, org);
    }
    const payload = await buildDashboardTrainingWorkspace(db, request.dashboard!, divisionFilter.appliedDivisionId);
    response.json(payload);
  });
});

app.get("/dashboard/customers", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  if (!canDashboardViewerAccessCustomerDirectory(request.dashboard!.viewer)) {
    response.status(403).json({
      error: "Customer directory is only available to super users.",
      code: "dashboard_scope_denied",
    });
    return;
  }

  await withFreshReportingRead(async (db) => {
    const payload: DashboardCustomerListResponse = {
      viewer: request.dashboard!.viewer,
      customers: await listDashboardAccessibleCustomers(db, request.dashboard!.viewer)
    };
    response.json(payload);
  });
});

app.get("/dashboard/customers/:orgId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  if (!canDashboardViewerAccessCustomerDirectory(request.dashboard!.viewer)) {
    response.status(403).json({
      error: "Customer directory is only available to super users.",
      code: "dashboard_scope_denied",
    });
    return;
  }

  await withFreshReportingRead(async (db) => {
    const orgId = request.params.orgId;
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Customer account not found." });
      return;
    }

    if (!canDashboardViewerAccessOrg(request.dashboard!.viewer, orgId)) {
      response.status(403).json({
        error: "You do not have access to this customer account.",
        code: "dashboard_scope_denied",
      });
      return;
    }

    const customer = await getDashboardAccessibleCustomer(db, request.dashboard!.viewer, orgId);
    if (!customer) {
      response.status(404).json({ error: "Customer account not found." });
      return;
    }

    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }

    const payload: DashboardCustomerDetailResponse = {
      viewer: request.dashboard!.viewer,
      customer: await buildDashboardCustomerSummary(db, org, divisionFilter.appliedDivisionId),
      insights: await buildDashboardCustomerInsights(db, org, divisionFilter.appliedDivisionId),
      divisionScope: divisionFilter.divisionScope,
    };
    response.json(payload);
  });
});

app.get("/dashboard/training", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const payload = await buildDashboardTrainingReport(db, request.dashboard!);
    response.json(payload);
  });
});

app.get("/dashboard/training/:trainingPackId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const viewer = request.dashboard!.viewer;
    const requestedOrgId = getSingleQueryParam(request.query.orgId);
    if (viewer.accessType === "super_user" && !requestedOrgId) {
      response.status(400).json({ error: "Select an organization before opening training detail." });
      return;
    }
    if (requestedOrgId && !canDashboardViewerAccessOrg(viewer, requestedOrgId)) {
      response.status(404).json({ error: "Training pack not found." });
      return;
    }
    const explicitOrgId = requestedOrgId ?? viewer.orgId ?? null;
    const located = await findDashboardAccessibleTrainingPack(db, viewer, request.params.trainingPackId, explicitOrgId);
    if (!located) {
      response.status(404).json({ error: "Training pack not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer,
      explicitOrgId: located.org.id,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const payload = await buildDashboardTrainingPackDetail(
      db,
      request.dashboard!,
      request.params.trainingPackId,
      divisionFilter.appliedDivisionId,
      located.org.id
    );
    if (!payload) {
      response.status(404).json({ error: "Training pack not found." });
      return;
    }

    response.json(payload);
  });
});

app.get(
  "/dashboard/training/:trainingPackId/assignments/:assignmentId",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    await withFreshReportingRead(async (db) => {
      const viewer = request.dashboard!.viewer;
      const requestedOrgId = getSingleQueryParam(request.query.orgId);
      if (viewer.accessType === "super_user" && !requestedOrgId) {
        response.status(400).json({ error: "Select an organization before opening training detail." });
        return;
      }
      if (requestedOrgId && !canDashboardViewerAccessOrg(viewer, requestedOrgId)) {
        response.status(404).json({ error: "Training pack assignment not found." });
        return;
      }
      const explicitOrgId = requestedOrgId ?? viewer.orgId ?? null;
      const located = await findDashboardAccessibleTrainingPack(db, viewer, request.params.trainingPackId, explicitOrgId);
      if (!located) {
        response.status(404).json({ error: "Training pack assignment not found." });
        return;
      }
      const divisionFilter = resolveDashboardDivisionFilter({
        db,
        viewer,
        explicitOrgId: located.org.id,
        requestedDivisionId: getSingleQueryParam(request.query.divisionId),
      });
      if (divisionFilter.error) {
        response.status(400).json({ error: divisionFilter.error });
        return;
      }
      const payload = await buildDashboardTrainingPackAssignmentDetail(
        db,
        request.dashboard!,
        request.params.trainingPackId,
        request.params.assignmentId,
        divisionFilter.appliedDivisionId,
        located.org.id
      );
      if (!payload) {
        response.status(404).json({ error: "Training pack assignment not found." });
        return;
      }

      response.json(payload);
    });
  }
);

app.get("/dashboard/users", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const payload = await buildDashboardUserReport(db, request.dashboard!, divisionFilter.appliedDivisionId);
    response.json(payload);
  });
});

app.get("/dashboard/users/:userId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }

    const payload = await buildDashboardUserDetail(
      db,
      request.dashboard!,
      request.params.userId,
      divisionFilter.appliedDivisionId
    );
    if (!payload) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }

    response.json(payload);
  });
});

app.get(
  "/dashboard/admin/training-content-targets/users",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const targets = await trainingContentManagementService.listUserTargets({
        context: resources.context,
        references: resources.references,
        query: getSingleQueryParam(request.query.q),
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        targets,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content-targets/managers",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const targets = await trainingContentManagementService.listManagerTargets({
        context: resources.context,
        references: resources.references,
        query: getSingleQueryParam(request.query.q),
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        targets,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content-targets/focus-topics",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const focusTopics = await trainingContentManagementService.listFocusTopics({
        context: resources.context,
        references: resources.references,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        focusTopics,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content-targets/scenarios",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const scenarios = await trainingContentManagementService.listScenarioOptions({
        context: resources.context,
        references: resources.references,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        scenarios,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.listContent({
        context: resources.context,
        references: resources.references,
        filters: {
          query: getSingleQueryParam(request.query.q),
          categoryId: getSingleQueryParam(request.query.categoryId),
          focusTopicId: getSingleQueryParam(request.query.focusTopicId),
          contentType: getSingleQueryParam(request.query.contentType),
          publicationState: getSingleQueryParam(request.query.status),
          sort: getSingleQueryParam(request.query.sort),
          page: getSingleQueryParam(request.query.page),
          pageSize: getSingleQueryParam(request.query.pageSize),
        },
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
        fileLimitsBytes: trainingContentManagementService.getFileLimits(),
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.post(
  "/dashboard/admin/training-content",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const item = await trainingContentManagementService.createContent({
        context: resources.context,
        references: resources.references,
        input: request.body as CreateDashboardTrainingContentRequest,
      });
      response.status(201).json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        item,
        fileLimitsBytes: trainingContentManagementService.getFileLimits(),
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content/categories",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.listCategories({
        context: resources.context,
        includeArchived: getSingleQueryParam(request.query.includeArchived),
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.post(
  "/dashboard/admin/training-content/categories",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.createCategory({
        context: resources.context,
        input: request.body as CreateDashboardTrainingContentCategoryRequest,
      });
      response.status(201).json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.patch(
  "/dashboard/admin/training-content/categories/:categoryId",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.updateCategory({
        context: resources.context,
        categoryId: request.params.categoryId,
        input: request.body as UpdateDashboardTrainingContentCategoryRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.post(
  "/dashboard/admin/training-content/categories/:categoryId/archive",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.archiveCategory({
        context: resources.context,
        categoryId: request.params.categoryId,
        input: request.body as ArchiveDashboardTrainingContentCategoryRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.put(
  "/dashboard/admin/training-content/categories/reorder",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.reorderCategories({
        context: resources.context,
        input: request.body as ReorderDashboardTrainingContentCategoriesRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content/reorder",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.getContentOrder({
        context: resources.context,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.put(
  "/dashboard/admin/training-content/reorder",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const result = await trainingContentManagementService.reorderContent({
        context: resources.context,
        input: request.body as ReorderDashboardTrainingContentRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        ...result,
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content/:contentId",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const item = await trainingContentManagementService.getContent({
        context: resources.context,
        references: resources.references,
        contentId: request.params.contentId,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        item,
        fileLimitsBytes: trainingContentManagementService.getFileLimits(),
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.patch(
  "/dashboard/admin/training-content/:contentId",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const item = await trainingContentManagementService.updateContent({
        context: resources.context,
        references: resources.references,
        contentId: request.params.contentId,
        input: request.body as UpdateDashboardTrainingContentRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        item,
        fileLimitsBytes: trainingContentManagementService.getFileLimits(),
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

app.put(
  "/dashboard/admin/training-content/:contentId/assignments",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const resources = await resolveTrainingContentManagementResources(request, response);
    if (!resources) {
      return;
    }
    try {
      const item = await trainingContentManagementService.updateAssignments({
        context: resources.context,
        references: resources.references,
        contentId: request.params.contentId,
        input: request.body as UpdateDashboardTrainingContentAssignmentsRequest,
      });
      response.json({
        viewer: {
          ...request.dashboard!.viewer,
          capabilities: resources.context.capabilities,
        },
        org: { id: resources.org.id, name: resources.org.name },
        generatedAt: nowIso(),
        item,
        fileLimitsBytes: trainingContentManagementService.getFileLimits(),
      });
    } catch (error) {
      respondWithTrainingContentManagementError(error, response);
    }
  }
);

for (const action of ["publish", "unpublish", "archive"] as const) {
  app.post(
    `/dashboard/admin/training-content/:contentId/${action}`,
    requireDashboardAuth,
    async (request: DashboardAuthRequest, response: Response) => {
      if (rejectTrainingContentClientOwnedFields(request.body, response)) {
        return;
      }
      const resources = await resolveTrainingContentManagementResources(request, response);
      if (!resources) {
        return;
      }
      try {
        const item = await trainingContentManagementService.transitionContent({
          context: resources.context,
          references: resources.references,
          contentId: request.params.contentId,
          action,
          input: request.body as DashboardTrainingContentLifecycleRequest,
        });
        response.json({
          viewer: {
            ...request.dashboard!.viewer,
            capabilities: resources.context.capabilities,
          },
          org: { id: resources.org.id, name: resources.org.name },
          generatedAt: nowIso(),
          item,
          fileLimitsBytes: trainingContentManagementService.getFileLimits(),
        });
      } catch (error) {
        respondWithTrainingContentManagementError(error, response);
      }
    }
  );
}

app.post(
  "/dashboard/admin/training-content/:contentId/assets/uploads",
  trainingContentStorageRateLimiter,
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const body = request.body as {
      assetRole?: unknown;
      originalFilename?: unknown;
      declaredMimeType?: unknown;
      declaredByteSize?: unknown;
      replacementAssetId?: unknown;
    };
    const context = await resolveTrainingContentManagementContext(request, response);
    if (!context) {
      return;
    }
    try {
      const result = await trainingContentAssetService.initiateUpload({
        context,
        contentId: request.params.contentId,
        assetRole: body?.assetRole,
        originalFilename: body?.originalFilename,
        declaredMimeType: body?.declaredMimeType,
        declaredByteSize: body?.declaredByteSize,
        replacementAssetId: body?.replacementAssetId,
      });
      response.status(201).json(result);
    } catch (error) {
      respondWithTrainingContentAssetError(error, response);
    }
  }
);

app.post(
  "/dashboard/admin/training-content/:contentId/assets/:assetId/finalize",
  trainingContentStorageRateLimiter,
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const context = await resolveTrainingContentManagementContext(request, response);
    if (!context) {
      return;
    }
    try {
      const result = await trainingContentAssetService.finalizeUpload({
        context,
        contentId: request.params.contentId,
        assetId: request.params.assetId,
      });
      response.status(result.asset.uploadState === "processing" ? 202 : 200).json(result);
    } catch (error) {
      respondWithTrainingContentAssetError(error, response);
    }
  }
);

app.get(
  "/dashboard/admin/training-content/:contentId/assets/:assetId",
  trainingContentStorageRateLimiter,
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const context = await resolveTrainingContentManagementContext(request, response);
    if (!context) {
      return;
    }
    try {
      response.json(await trainingContentAssetService.getUploadStatus({
        context,
        contentId: request.params.contentId,
        assetId: request.params.assetId,
      }));
    } catch (error) {
      respondWithTrainingContentAssetError(error, response);
    }
  }
);

app.post(
  "/dashboard/admin/training-content/:contentId/assets/:assetId/access",
  trainingContentStorageRateLimiter,
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    if (rejectTrainingContentClientOwnedFields(request.body, response)) {
      return;
    }
    const context = await resolveTrainingContentManagementContext(request, response);
    if (!context) {
      return;
    }
    try {
      response.json(await trainingContentAssetService.createAdminPreviewAccess({
        context,
        contentId: request.params.contentId,
        assetId: request.params.assetId,
      }));
    } catch (error) {
      respondWithTrainingContentAssetError(error, response);
    }
  }
);

app.get("/dashboard/admin/users", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withDatabaseRead(async (db) => {
    const adminContext = resolveDashboardAdminOrgContext(
      db,
      request.dashboard!,
      getSingleQueryParam(request.query.orgId),
      response
    );
    if (!adminContext) {
      return;
    }
    if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "viewOrganizationUsers", response)) {
      return;
    }

    const users = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === adminContext.org.id)
      .sort((left, right) => left.email.localeCompare(right.email, undefined, { sensitivity: "base" }));
    const visibleUsers = listVisibleOrganizationUsers({
      users,
      actor: request.dashboard!.user,
      viewer: request.dashboard!.viewer,
      orgId: adminContext.org.id,
    }).sort((left, right) => left.email.localeCompare(right.email, undefined, { sensitivity: "base" }));
    const rows = visibleUsers.map((user) => buildDashboardAdminUserRow({
      actor: request.dashboard!.user,
      viewer: request.dashboard!.viewer,
      capabilities: adminContext.capabilities,
      user,
      orgUsers: users,
    }));

    const payload: DashboardAdminUsersResponse = {
      viewer: {
        ...request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
      },
      generatedAt: nowIso(),
      org: {
        id: adminContext.org.id,
        name: adminContext.org.name,
      },
      users: rows,
      managerOptions: adminContext.capabilities.assignUserManagers
        ? buildDashboardAdminManagerOptions(users, adminContext.org.id)
        : [],
    };
    response.json(payload);
  });
});

app.get("/dashboard/admin/users/export", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withDatabaseRead(async (db) => {
    const adminContext = resolveDashboardAdminOrgContext(
      db,
      request.dashboard!,
      getSingleQueryParam(request.query.orgId),
      response
    );
    if (!adminContext) {
      return;
    }
    if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "viewOrganizationUsers", response)) {
      return;
    }

    const orgUsers = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === adminContext.org.id)
      .sort((left, right) => left.email.localeCompare(right.email, undefined, { sensitivity: "base" }));
    const visibleUsers = listVisibleOrganizationUsers({
      users: orgUsers,
      actor: request.dashboard!.user,
      viewer: request.dashboard!.viewer,
      orgId: adminContext.org.id,
    }).sort((left, right) => left.email.localeCompare(right.email, undefined, { sensitivity: "base" }));
    const rows = visibleUsers
      .map((user) => ({
        employeeId: user.employeeId ?? "",
        firstName: getUserFirstName(user) ?? "",
        lastName: getUserLastName(user) ?? "",
        email: user.email,
        role: ORG_USER_ROLE_LABELS[user.orgRole] ?? user.orgRole,
        manager: (() => {
          const managerUserId = normalizeManagerUserId(user.managerUserId);
          const manager = managerUserId ? orgUsers.find((entry) => entry.id === managerUserId) ?? null : null;
          return manager ? resolveStoredUserDisplayName(manager) : "";
        })(),
        status: user.status,
      }));

    const payload: DashboardAdminUsersExportResponse = {
      generatedAt: nowIso(),
      org: {
        id: adminContext.org.id,
        name: adminContext.org.name,
      },
      rows,
    };
    response.json(payload);
  });
});

app.patch("/dashboard/admin/users/:userId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as DashboardAdminUpdateUserRequest;
  const hasFirstNamePatch = Object.prototype.hasOwnProperty.call(body ?? {}, "firstName");
  const hasLastNamePatch = Object.prototype.hasOwnProperty.call(body ?? {}, "lastName");
  const hasEmployeeIdPatch = Object.prototype.hasOwnProperty.call(body ?? {}, "employeeId");
  const hasStatusPatch = Object.prototype.hasOwnProperty.call(body ?? {}, "status");
  const hasRolePatch = Object.prototype.hasOwnProperty.call(body ?? {}, "orgRole");
  const hasManagerPatch = Object.prototype.hasOwnProperty.call(body ?? {}, "managerUserId");
  if (!hasFirstNamePatch && !hasLastNamePatch && !hasEmployeeIdPatch && !hasStatusPatch && !hasRolePatch && !hasManagerPatch) {
    response.status(400).json({ error: "Provide firstName, lastName, employeeId, status, orgRole, or managerUserId." });
    return;
  }

  await withDatabase(async (db) => {
    const adminContext = resolveDashboardAdminOrgContext(
      db,
      request.dashboard!,
      getSingleQueryParam(request.query.orgId),
      response
    );
    if (!adminContext) {
      return;
    }

    const orgUsers = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === adminContext.org.id)
      .sort((left, right) => left.email.localeCompare(right.email, undefined, { sensitivity: "base" }));
    const target = orgUsers.find((user) => user.id === request.params.userId);
    if (!target) {
      response.status(404).json({ error: "User not found." });
      return;
    }
    if (!canActorSeeOrganizationUser({
      actor: request.dashboard!.user,
      viewer: request.dashboard!.viewer,
      target,
    })) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const beforeFirstName = getUserFirstName(target);
    const beforeLastName = getUserLastName(target);
    const beforeEmployeeId = target.employeeId ?? null;
    const beforeStatus = target.status;
    const beforeOrgRole = target.orgRole;
    const beforeManagerUserId = normalizeManagerUserId(target.managerUserId);
    const beforeDashboardAccessEnabled = target.dashboardAccessEnabled === true;
    let nextFirstName = beforeFirstName;
    let nextLastName = beforeLastName;
    let nextEmployeeId = beforeEmployeeId;
    let nextStatus = beforeStatus;
    let nextOrgRole = beforeOrgRole;
    let nextManagerUserId = beforeManagerUserId;
    let nextDashboardAccessEnabled = beforeDashboardAccessEnabled;

    if (hasFirstNamePatch || hasLastNamePatch) {
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "editUserNames", response)) {
        return;
      }
      if (!canDashboardAdminEditNames({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        target,
      })) {
        response.status(403).json({
          error: "You cannot edit names for this user.",
          code: "dashboard_scope_denied",
        });
        return;
      }
      if (hasFirstNamePatch) {
        const normalizedFirstName = normalizeRequiredUserNameInput(body.firstName, "firstName");
        if (!normalizedFirstName.ok) {
          response.status(400).json({ error: normalizedFirstName.error, code: normalizedFirstName.code });
          return;
        }
        nextFirstName = normalizedFirstName.value;
      }
      if (hasLastNamePatch) {
        const normalizedLastName = normalizeRequiredUserNameInput(body.lastName, "lastName");
        if (!normalizedLastName.ok) {
          response.status(400).json({ error: normalizedLastName.error, code: normalizedLastName.code });
          return;
        }
        nextLastName = normalizedLastName.value;
      }
    }

    if (hasEmployeeIdPatch) {
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "editEmployeeIds", response)) {
        return;
      }
      if (!canDashboardAdminEditEmployeeId({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        target,
      })) {
        response.status(403).json({
          error: "You cannot edit Employee ID for this user.",
          code: "dashboard_scope_denied",
        });
        return;
      }
      const normalizedEmployeeId = normalizeEmployeeIdInput(body.employeeId);
      if (!normalizedEmployeeId.ok) {
        response.status(400).json({ error: normalizedEmployeeId.error, code: normalizedEmployeeId.code });
        return;
      }
      const employeeIdConflict = findEmployeeIdConflict({
        users: db.users,
        orgId: adminContext.org.id,
        employeeId: normalizedEmployeeId.value,
        exceptUserId: target.id,
      });
      if (employeeIdConflict) {
        response.status(409).json({
          error: "Employee ID is already assigned within this organization.",
          code: employeeIdConflict.code,
        });
        return;
      }
      nextEmployeeId = normalizedEmployeeId.value;
    }

    if (hasRolePatch) {
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "manageUserRoles", response)) {
        return;
      }
      const requestedOrgRole = body.orgRole;
      if (typeof requestedOrgRole !== "string" || !isOrgUserRole(requestedOrgRole) || !canOrgAdminManageRole(requestedOrgRole)) {
        response.status(400).json({ error: "Role can only be changed between user and user admin." });
        return;
      }
      if (!canDashboardAdminChangeUserRole({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        target,
      })) {
        response.status(403).json({
          error: "You cannot change role for this user.",
          code: "dashboard_scope_denied",
        });
        return;
      }
      nextOrgRole = requestedOrgRole;
      if (nextOrgRole === "user_admin") {
        nextManagerUserId = null;
        nextDashboardAccessEnabled = true;
      } else if (beforeOrgRole === "user_admin") {
        nextManagerUserId = null;
        nextDashboardAccessEnabled = false;
      }
    }

    if (hasManagerPatch) {
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "assignUserManagers", response)) {
        return;
      }
      const requestedManagerUserId = normalizeManagerUserId(body.managerUserId);
      const managerTarget: UserProfile = {
        ...target,
        orgRole: nextOrgRole,
        managerUserId: requestedManagerUserId,
      };
      if (!canDashboardAdminAssignManager({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        target: managerTarget,
      })) {
        response.status(403).json({
          error: "You cannot assign a manager for this user.",
          code: "dashboard_scope_denied",
        });
        return;
      }
      const managerValidation = validateManagerAssignment({
        orgUsers,
        target: managerTarget,
        managerUserId: requestedManagerUserId,
      });
      if (!managerValidation.ok) {
        response.status(400).json({ error: managerValidation.error, code: managerValidation.code });
        return;
      }
      nextManagerUserId = managerValidation.manager?.id ?? null;
    }

    if (hasStatusPatch) {
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "manageRegularOrganizationUsers", response)) {
        return;
      }
      if (!body.status || !isUserStatus(body.status)) {
        response.status(400).json({ error: "Valid status is required." });
        return;
      }
      nextStatus = body.status;
      if (!canDashboardAdminChangeUserStatus({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        target,
        nextStatus,
        orgUsers,
      })) {
        response.status(403).json({
          error: "You cannot change status for this user.",
          code: "dashboard_scope_denied",
        });
        return;
      }
    }

    if (nextOrgRole !== "user") {
      nextManagerUserId = null;
    }

    const now = nowIso();
    const clearedAssignmentUserIds = new Set<string>();
    const shouldClearManagerAssignments =
      beforeOrgRole === "user_admin" && (nextOrgRole !== "user_admin" || nextStatus !== "active");
    if (shouldClearManagerAssignments) {
      clearAssignmentsForManager({
        users: db.users,
        managerUserId: target.id,
        updatedAt: now,
      }).forEach((userId) => clearedAssignmentUserIds.add(userId));
    }

    const shouldRevokeDashboardSessions =
      nextStatus !== "active" ||
      (beforeOrgRole === "user_admin" && nextOrgRole !== "user_admin") ||
      (beforeDashboardAccessEnabled && !nextDashboardAccessEnabled);

    target.firstName = nextFirstName;
    target.lastName = nextLastName;
    target.employeeId = nextEmployeeId;
    target.orgRole = nextOrgRole;
    target.managerUserId = nextManagerUserId;
    target.dashboardAccessEnabled = nextDashboardAccessEnabled;
    target.status = nextStatus;

    if (hasStatusPatch) {
      if (nextStatus !== "active") {
        revokeMobileAccessForUser(db, target.id, "User access was disabled.");
        db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== target.id);
      } else {
        emitMobileUpdateForUser(db, target.id, "user");
      }
    }
    if (shouldRevokeDashboardSessions) {
      db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== target.id);
      queueDatabasePostCommitEffect(db, {
        category: "security_cleanup",
        description: `Revoke dashboard sessions for updated dashboard user ${target.id}.`,
        run: async () => {
          await revokeWebAuthSessionsForUserId(target.id);
        }
      });
    }
    emitMobileUpdateForUser(db, target.id, "user");
    for (const userId of clearedAssignmentUserIds) {
      emitMobileUpdateForUser(db, userId, "user");
    }

    target.updatedAt = now;
    if (beforeFirstName !== (target.firstName ?? null) || beforeLastName !== (target.lastName ?? null)) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: "org_user.name.changed",
        orgId: adminContext.org.id,
        userId: target.id,
        message: "Updated organization user name.",
        metadata: {
          firstNameChanged: beforeFirstName !== (target.firstName ?? null),
          lastNameChanged: beforeLastName !== (target.lastName ?? null),
        }
      });
    }
    if (beforeEmployeeId !== (target.employeeId ?? null)) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: "org_user.employee_id.changed",
        orgId: adminContext.org.id,
        userId: target.id,
        message: "Updated Employee ID for organization user.",
        metadata: {
          employeeIdChanged: true,
          previousEmployeeIdPresent: Boolean(beforeEmployeeId),
          newEmployeeIdPresent: Boolean(target.employeeId)
        }
      });
    }
    if (beforeOrgRole !== target.orgRole) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: "org_user.role.changed",
        orgId: adminContext.org.id,
        userId: target.id,
        message: "Changed organization user role.",
        metadata: {
          previousRole: beforeOrgRole,
          nextRole: target.orgRole,
          dashboardAccessRevoked: beforeDashboardAccessEnabled && target.dashboardAccessEnabled !== true,
          clearedAssignedReportCount: clearedAssignmentUserIds.size,
        }
      });
    }
    if (beforeManagerUserId !== normalizeManagerUserId(target.managerUserId)) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: target.managerUserId ? "org_user.manager.assigned" : "org_user.manager.cleared",
        orgId: adminContext.org.id,
        userId: target.id,
        message: target.managerUserId ? "Assigned organization user manager." : "Cleared organization user manager.",
        metadata: {
          previousManagerPresent: Boolean(beforeManagerUserId),
          nextManagerPresent: Boolean(target.managerUserId),
        }
      });
    }
    if (beforeStatus !== target.status) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: target.status === "active" ? "org_user.reactivated" : "org_user.deactivated",
        orgId: adminContext.org.id,
        userId: target.id,
        message: `${target.status === "active" ? "Reactivated" : "Deactivated"} ${target.email}.`,
        metadata: {
          previousStatus: beforeStatus,
          nextStatus: target.status,
        }
      });
    }
    if (clearedAssignmentUserIds.size > 0) {
      appendWebAuditEvent(db, request.dashboard!.user, {
        action: "org_user.manager_assignments.cleared",
        orgId: adminContext.org.id,
        userId: target.id,
        message: "Cleared manager assignments for changed user admin.",
        metadata: {
          clearedAssignedReportCount: clearedAssignmentUserIds.size,
          roleChanged: beforeOrgRole !== target.orgRole,
          statusChanged: beforeStatus !== target.status,
        }
      });
    }

    const nextOrgUsers = db.users.filter((user) => user.accountType === "enterprise" && user.orgId === adminContext.org.id);
    const payload: DashboardAdminUpdateUserResponse = {
      ok: true,
      user: buildDashboardAdminUserRow({
        actor: request.dashboard!.user,
        viewer: request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
        user: target,
        orgUsers: nextOrgUsers,
      }),
    };
    response.json(payload);
  });
});

app.get("/dashboard/admin/access-requests", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withDatabase(async (db) => {
    const adminContext = resolveDashboardAdminOrgContext(
      db,
      request.dashboard!,
      getSingleQueryParam(request.query.orgId),
      response
    );
    if (!adminContext) {
      return;
    }
    if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "approveRejectAccessRequests", response)) {
      return;
    }

    expireOrgJoinRequests(db, new Date());
    const requests = db.enterpriseJoinRequests
      .filter((row) => row.orgId === adminContext.org.id)
      .slice()
      .sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") {
          return -1;
        }
        if (a.status !== "pending" && b.status === "pending") {
          return 1;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .map((row) => buildDashboardAdminAccessRequestRow(db, adminContext.org, row));

    const payload: DashboardAdminAccessRequestsResponse = {
      viewer: {
        ...request.dashboard!.viewer,
        capabilities: adminContext.capabilities,
      },
      generatedAt: nowIso(),
      org: {
        id: adminContext.org.id,
        name: adminContext.org.name,
      },
      requests,
    };
    response.json(payload);
  });
});

app.patch(
  "/dashboard/admin/access-requests/:requestId",
  requireDashboardAuth,
  async (request: DashboardAuthRequest, response: Response) => {
    const body = request.body as DashboardAdminDecideAccessRequest;
    if (body.action !== "approve" && body.action !== "reject") {
      response.status(400).json({ error: "action must be approve or reject." });
      return;
    }

    await withDatabase(async (db) => {
      const adminContext = resolveDashboardAdminOrgContext(
        db,
        request.dashboard!,
        getSingleQueryParam(request.query.orgId),
        response
      );
      if (!adminContext) {
        return;
      }
      if (rejectMissingDashboardAdminCapability(adminContext.capabilities, "approveRejectAccessRequests", response)) {
        return;
      }

      expireOrgJoinRequests(db, new Date());
      const decision = decideEnterpriseJoinRequest({
        db,
        actor: request.dashboard!.user,
        org: adminContext.org,
        requestId: request.params.requestId,
        action: body.action,
        reason: body.reason,
        channel: "dashboard",
      });
      if (!decision.ok) {
        response.status(decision.status).json({ error: decision.error });
        return;
      }

      const payload: DashboardAdminDecideAccessRequestResponse = {
        ok: true,
        request: buildDashboardAdminAccessRequestRow(db, adminContext.org, decision.requestRecord),
      };
      response.json(payload);
    });
  }
);

app.get("/dashboard/attempts/:attemptId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const attemptScore = scoreRecordAccess.getById(db, request.params.attemptId);
    if (!attemptScore || !isConclusiveSimulationScoreRecord(attemptScore) || !attemptScore.orgId) {
      response.status(404).json({ error: "Attempt detail not found." });
      return;
    }
    if (!canDashboardViewerAccessOrg(request.dashboard!.viewer, attemptScore.orgId)) {
      response.status(404).json({ error: "Attempt detail not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: attemptScore.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const payload = await buildDashboardAttemptDetail(
      db,
      request.dashboard!,
      request.params.attemptId,
      divisionFilter.appliedDivisionId
    );
    if (!payload) {
      response.status(404).json({ error: "Attempt detail not found." });
      return;
    }

    response.json(payload);
  });
});

app.get("/dashboard/performance", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingWrite(async (db) => {
    const requestedOrgId = getSingleQueryParam(request.query.orgId);
    if (requestedOrgId && !canDashboardViewerAccessOrg(request.dashboard!.viewer, requestedOrgId)) {
      response.status(404).json({ error: "Performance workspace not found." });
      return;
    }
    if (request.dashboard!.viewer.accessType === "super_user" && !requestedOrgId) {
      const orgs = listDashboardAccessibleOrgs(db, request.dashboard!.viewer);
      const organizationSummaries = [];
      for (const org of orgs) {
        const users = await listDashboardPerformanceUserContexts(db, request.dashboard!, null, org.id);
        const visibleUserIds = new Set(users.map((user) => user.userId));
        const orgPayload = await buildDashboardPerformanceWorkspaceResponse({
          store: performancePlanStore,
          viewer: request.dashboard!.viewer,
          users,
          usageSessions: listUsageSessions(db).filter((session) => session.orgId === org.id && visibleUserIds.has(session.userId)),
          scoreRecords: listScoreRecords(db, { conclusiveOnly: true }).filter(
            (record) => record.orgId === org.id && visibleUserIds.has(record.userId)
          ),
          now: new Date(),
          selectedOrg: { orgId: org.id, orgName: org.name },
          canManageUser: (userContext) => {
            const target = getUserById(db, userContext.userId);
            return Boolean(target && canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target));
          }
        });
        organizationSummaries.push({
          orgId: org.id,
          orgName: org.name,
          activePlanCount: orgPayload.summary.activePlanCount,
          activeNeedsAttentionCount: orgPayload.summary.activeNeedsAttentionCount,
          visibleUserCount: orgPayload.summary.visibleUserCount
        });
      }
      const payload: DashboardPerformanceWorkspaceResponse = await buildDashboardPerformanceWorkspaceResponse({
        store: performancePlanStore,
        viewer: request.dashboard!.viewer,
        users: [],
        organizationSummaries,
        scopeMode: "portfolio",
        selectedOrg: null,
        usageSessions: [],
        scoreRecords: [],
        now: new Date(),
        canManageUser: () => false
      });
      response.json(payload);
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: requestedOrgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const orgIds = new Set(
      listDashboardAccessibleOrgs(db, request.dashboard!.viewer)
        .filter((org) => !requestedOrgId || org.id === requestedOrgId)
        .map((org) => org.id)
    );
    const users = await listDashboardPerformanceUserContexts(
      db,
      request.dashboard!,
      divisionFilter.appliedDivisionId,
      requestedOrgId
    );
    const visibleUserIds = new Set(users.map((user) => user.userId));
    const payload: DashboardPerformanceWorkspaceResponse = await buildDashboardPerformanceWorkspaceResponse({
      store: performancePlanStore,
      viewer: request.dashboard!.viewer,
      users,
      usageSessions: listUsageSessions(db).filter(
        (session) => session.orgId && orgIds.has(session.orgId) && visibleUserIds.has(session.userId)
      ),
      scoreRecords: listScoreRecords(db, { conclusiveOnly: true }).filter(
        (record) => record.orgId && orgIds.has(record.orgId) && visibleUserIds.has(record.userId)
      ),
      now: new Date(),
      scopeMode: "organization",
      selectedOrg: requestedOrgId
        ? (() => {
            const org = getOrgById(db, requestedOrgId);
            return org ? { orgId: org.id, orgName: org.name } : null;
          })()
        : request.dashboard!.viewer.orgId && request.dashboard!.viewer.orgName
          ? { orgId: request.dashboard!.viewer.orgId, orgName: request.dashboard!.viewer.orgName }
          : null,
      divisionScope: divisionFilter.divisionScope,
      canManageUser: (userContext) => {
        const target = getUserById(db, userContext.userId);
        return Boolean(target && canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target));
      }
    });
    response.json(payload);
  });
});

app.post("/dashboard/performance/preview", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as PerformancePlanPreviewRequest;
  if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
    response.status(400).json({ error: "userId is required." });
    return;
  }

  await withFreshReportingWrite(async (db) => {
    const target = getUserById(db, body.userId);
    if (!target || !target.orgId || target.accountType !== "enterprise") {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    const requestedOrgId = typeof body.orgId === "string" && body.orgId.trim() ? body.orgId.trim() : target.orgId;
    if (requestedOrgId !== target.orgId || !canDashboardViewerAccessOrg(request.dashboard!.viewer, requestedOrgId)) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: requestedOrgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    if (!canDashboardViewerAccessPerformanceTarget(
      db,
      request.dashboard!,
      target,
      requestedOrgId,
      divisionFilter.appliedDivisionId
    )) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    if (!canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target)) {
      response.status(403).json({
        error: "Performance goal management requires org admin or user admin access.",
        code: "dashboard_scope_denied"
      });
      return;
    }
    if (target.status !== "active") {
      response.status(400).json({
        error: "Performance goals can only be assigned to active users.",
        errors: ["Performance goals can only be assigned to active users."]
      });
      return;
    }
    const userContext = await getDashboardPerformanceUserContext(
      db,
      request.dashboard!,
      body.userId,
      requestedOrgId,
      divisionFilter.appliedDivisionId
    );
    if (!userContext) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    try {
      const payload = previewPerformancePlan({
        orgId: userContext.orgId,
        userId: userContext.userId,
        input: { ...body, orgId: userContext.orgId, userId: userContext.userId },
        candidates: userContext.candidates,
        usageSessions: listUsageSessions(db, { orgId: userContext.orgId, userId: userContext.userId }),
        scoreRecords: listScoreRecords(db, { orgId: userContext.orgId, userId: userContext.userId, conclusiveOnly: true }),
        now: new Date()
      });
      if (!payload.valid) {
        response.status(400).json({
          error: payload.errors[0] ?? "Performance goal input is invalid.",
          errors: payload.errors,
          preview: payload
        });
        return;
      }
      response.json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      throw error;
    }
  });
});

app.post("/dashboard/performance/plans", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as CreatePerformancePlanRequest;
  if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
    response.status(400).json({ error: "userId is required." });
    return;
  }

  await withFreshReportingWrite(async (db) => {
    const target = getUserById(db, body.userId);
    if (!target || !target.orgId || target.accountType !== "enterprise") {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    const requestedOrgId = typeof body.orgId === "string" && body.orgId.trim() ? body.orgId.trim() : target.orgId;
    if (requestedOrgId !== target.orgId || !canDashboardViewerAccessOrg(request.dashboard!.viewer, requestedOrgId)) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: requestedOrgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    if (!canDashboardViewerAccessPerformanceTarget(
      db,
      request.dashboard!,
      target,
      requestedOrgId,
      divisionFilter.appliedDivisionId
    )) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    if (!canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target)) {
      response.status(403).json({
        error: "Performance goal management requires org admin or user admin access.",
        code: "dashboard_scope_denied"
      });
      return;
    }
    if (target.status !== "active") {
      response.status(400).json({
        error: "Performance goals can only be assigned to active users.",
        errors: ["Performance goals can only be assigned to active users."]
      });
      return;
    }
    const userContext = await getDashboardPerformanceUserContext(
      db,
      request.dashboard!,
      body.userId,
      requestedOrgId,
      divisionFilter.appliedDivisionId
    );
    if (!userContext) {
      response.status(404).json({ error: "Dashboard user not found." });
      return;
    }
    try {
      const now = new Date();
      const usageSessions = listUsageSessions(db, { orgId: userContext.orgId, userId: userContext.userId });
      const scoreRecords = listScoreRecords(db, { orgId: userContext.orgId, userId: userContext.userId, conclusiveOnly: true });
      const input = { ...body, orgId: userContext.orgId, userId: userContext.userId };
      const validationPreview = previewPerformancePlan({
        orgId: userContext.orgId,
        userId: userContext.userId,
        input,
        candidates: userContext.candidates,
        usageSessions,
        scoreRecords,
        now
      });
      if (!validationPreview.valid) {
        response.status(400).json({
          error: validationPreview.errors[0] ?? "Performance goal input is invalid.",
          errors: validationPreview.errors,
          preview: validationPreview
        });
        return;
      }
      await finalizeOpenPerformancePlansForUserIfNeeded({
        store: performancePlanStore,
        orgId: userContext.orgId,
        userId: userContext.userId,
        usageSessions,
        scoreRecords,
        now
      });
      const payload = await createPerformancePlanFromInput({
        store: performancePlanStore,
        orgId: userContext.orgId,
        userId: userContext.userId,
        input,
        candidates: userContext.candidates,
        usageSessions,
        scoreRecords,
        now,
        actorType: resolvePerformanceDashboardAuditActorType(request.dashboard!.viewer),
        actorId: request.dashboard!.viewer.userId
      });
      response.status(201).json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      if (isDuplicatePerformancePlanError(error)) {
        response.status(409).json({ error: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_MESSAGE, code: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_CODE });
        return;
      }
      throw error;
    }
  });
});

app.patch("/dashboard/performance/plans/:planId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as UpdatePerformancePlanRequest;
  await withFreshReportingWrite(async (db) => {
    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || !canDashboardViewerAccessOrg(request.dashboard!.viewer, loaded.plan.orgId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: loaded.plan.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const rowContext = getPerformancePlanRowContext(db, loaded.plan);
    if (!rowContext || (divisionFilter.appliedDivisionId && rowContext.divisionId !== divisionFilter.appliedDivisionId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const target = getUserById(db, loaded.plan.userId);
    if (
      !target ||
      !canDashboardViewerAccessPerformanceTarget(db, request.dashboard!, target, loaded.plan.orgId, divisionFilter.appliedDivisionId)
    ) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    if (!canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target)) {
      response.status(403).json({
        error: "Performance goal management requires org admin or user admin access.",
        code: "dashboard_scope_denied"
      });
      return;
    }
    if (target.status !== "active") {
      response.status(400).json({
        error: "Performance goals can only be assigned to active users.",
        errors: ["Performance goals can only be assigned to active users."]
      });
      return;
    }
    const userContext = await getDashboardPerformanceUserContext(
      db,
      request.dashboard!,
      loaded.plan.userId,
      loaded.plan.orgId,
      divisionFilter.appliedDivisionId
    );
    if (!userContext) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    try {
      const now = new Date();
      const usageSessions = listUsageSessions(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId });
      const scoreRecords = listScoreRecords(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId, conclusiveOnly: true });
      await finalizeOpenPerformancePlansForUserIfNeeded({
        store: performancePlanStore,
        orgId: loaded.plan.orgId,
        userId: loaded.plan.userId,
        usageSessions,
        scoreRecords,
        now
      });
      const refreshed = await performancePlanStore.getPlanById(loaded.plan.id);
      if (!refreshed || refreshed.plan.status !== "active") {
        response.status(409).json({ error: "Only active Performance goals can be edited." });
        return;
      }
      const bodyObject = isPlainRequestBody(body) ? body : {};
      const input = { ...bodyObject, orgId: userContext.orgId, userId: userContext.userId } as UpdatePerformancePlanRequest;
      if (isPlainRequestBody(body)) {
        const requestedUserId = typeof body.userId === "string" ? body.userId.trim() : null;
        const requestedOrgId = typeof body.orgId === "string" ? body.orgId.trim() : null;
        if ((requestedUserId && requestedUserId !== userContext.userId) || (requestedOrgId && requestedOrgId !== userContext.orgId)) {
          response.status(400).json({
            error: "Performance goal target user cannot be changed.",
            errors: ["Performance goal target user cannot be changed."]
          });
          return;
        }
      }
      const payload = await updatePerformancePlanFromInput({
        store: performancePlanStore,
        orgId: userContext.orgId,
        userId: userContext.userId,
        input,
        existingPlan: refreshed.plan,
        candidates: userContext.candidates,
        usageSessions,
        scoreRecords,
        now,
        actorType: resolvePerformanceDashboardAuditActorType(request.dashboard!.viewer),
        actorId: request.dashboard!.viewer.userId
      });
      response.json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      if (isDuplicatePerformancePlanError(error)) {
        response.status(409).json({ error: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_MESSAGE, code: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_CODE });
        return;
      }
      throw error;
    }
  });
});

app.get("/dashboard/performance/plans/:planId", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingWrite(async (db) => {
    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || !canDashboardViewerAccessOrg(request.dashboard!.viewer, loaded.plan.orgId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: loaded.plan.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const rowContext = getPerformancePlanRowContext(db, loaded.plan);
    if (!rowContext || (divisionFilter.appliedDivisionId && rowContext.divisionId !== divisionFilter.appliedDivisionId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const target = getUserById(db, loaded.plan.userId);
    if (
      !target ||
      !canDashboardViewerAccessPerformanceTarget(db, request.dashboard!, target, loaded.plan.orgId, divisionFilter.appliedDivisionId)
    ) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const detail = await buildPerformancePlanDetailResponse({
      store: performancePlanStore,
      planId: loaded.plan.id,
      usageSessions: listUsageSessions(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId }),
      scoreRecords: listScoreRecords(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId, conclusiveOnly: true }),
      now: new Date(),
      auditDisplayContext: {
        viewer: request.dashboard!.viewer.accessType === "super_user" ? "platform_admin" : "tenant_manager",
        currentUserId: request.dashboard!.viewer.userId,
        planOrgId: loaded.plan.orgId,
        users: db.users
      }
    });
    if (!detail) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const canCancel =
      detail.plan.status === "active" &&
      Boolean(target && canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target));
    const payload: DashboardPerformancePlanDetailResponse = buildDashboardPerformancePlanDetailResponse({
      viewer: request.dashboard!.viewer,
      detail,
      canCancel,
      rowContext
    });
    response.json(payload);
  });
});

app.get("/dashboard/performance/plans/:planId/updates", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  await withFreshReportingWrite(async (db) => {
    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || !canDashboardViewerAccessOrg(request.dashboard!.viewer, loaded.plan.orgId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: loaded.plan.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const rowContext = getPerformancePlanRowContext(db, loaded.plan);
    if (!rowContext || (divisionFilter.appliedDivisionId && rowContext.divisionId !== divisionFilter.appliedDivisionId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const target = getUserById(db, loaded.plan.userId);
    if (
      !target ||
      !canDashboardViewerAccessPerformanceTarget(db, request.dashboard!, target, loaded.plan.orgId, divisionFilter.appliedDivisionId)
    ) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const payload = await buildPerformancePlanUpdatesResponse({
      store: performancePlanStore,
      planId: loaded.plan.id,
      users: db.users,
      now: new Date()
    });
    response.json(payload);
  });
});

app.post("/dashboard/performance/plans/:planId/updates", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as CreatePerformancePlanUpdateRequest;
  await withFreshReportingWrite(async (db) => {
    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || !canDashboardViewerAccessOrg(request.dashboard!.viewer, loaded.plan.orgId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: loaded.plan.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const rowContext = getPerformancePlanRowContext(db, loaded.plan);
    if (!rowContext || (divisionFilter.appliedDivisionId && rowContext.divisionId !== divisionFilter.appliedDivisionId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const target = getUserById(db, loaded.plan.userId);
    if (
      !target ||
      !canDashboardViewerAccessPerformanceTarget(db, request.dashboard!, target, loaded.plan.orgId, divisionFilter.appliedDivisionId)
    ) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    if (!canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target)) {
      response.status(403).json({
        error: "Performance goal management requires org admin or user admin access.",
        code: "dashboard_scope_denied"
      });
      return;
    }
    const now = new Date();
    const materialized = await finalizePerformancePlanIfEnded({
      store: performancePlanStore,
      plan: loaded.plan,
      usageSessions: listUsageSessions(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId }),
      scoreRecords: listScoreRecords(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId, conclusiveOnly: true }),
      now,
      actorId: request.dashboard!.viewer.userId
    });
    if (!materialized || materialized.plan.status !== "active") {
      response.status(409).json({
        error: "Updates can only be posted to active or scheduled Performance goals.",
        code: "performance_plan_updates_terminal"
      });
      return;
    }
    try {
      const payload = await createPerformancePlanUpdateForPlan({
        store: performancePlanStore,
        plan: materialized.plan,
        body: body?.body,
        actorType: resolvePerformanceDashboardAuditActorType(request.dashboard!.viewer),
        actorId: request.dashboard!.viewer.userId,
        now,
        users: db.users
      });
      response.status(201).json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanUpdateInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      if (error instanceof PerformancePlanUpdateConflictError) {
        response.status(409).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  });
});

app.post("/dashboard/performance/plans/:planId/cancel", requireDashboardAuth, async (request: DashboardAuthRequest, response: Response) => {
  const body = request.body as CancelPerformancePlanRequest;
  await withFreshReportingWrite(async (db) => {
    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || !canDashboardViewerAccessOrg(request.dashboard!.viewer, loaded.plan.orgId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const divisionFilter = resolveDashboardDivisionFilter({
      db,
      viewer: request.dashboard!.viewer,
      explicitOrgId: loaded.plan.orgId,
      requestedDivisionId: getSingleQueryParam(request.query.divisionId),
    });
    if (divisionFilter.error) {
      response.status(400).json({ error: divisionFilter.error });
      return;
    }
    const rowContext = getPerformancePlanRowContext(db, loaded.plan);
    if (!rowContext || (divisionFilter.appliedDivisionId && rowContext.divisionId !== divisionFilter.appliedDivisionId)) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    const target = getUserById(db, loaded.plan.userId);
    if (
      !target ||
      !canDashboardViewerAccessPerformanceTarget(db, request.dashboard!, target, loaded.plan.orgId, divisionFilter.appliedDivisionId)
    ) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    if (!canManagePerformancePlanForUser(request.dashboard!.user, request.dashboard!.viewer, target)) {
      response.status(403).json({
        error: "Performance goal management requires org admin or user admin access.",
        code: "dashboard_scope_denied"
      });
      return;
    }
    const payload = await cancelPerformancePlanWithBoundaryRule({
      store: performancePlanStore,
      planId: loaded.plan.id,
      usageSessions: listUsageSessions(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId }),
      scoreRecords: listScoreRecords(db, { orgId: loaded.plan.orgId, userId: loaded.plan.userId, conclusiveOnly: true }),
      now: new Date(),
      actorType: resolvePerformanceDashboardAuditActorType(request.dashboard!.viewer),
      actorId: request.dashboard!.viewer.userId,
      reason: normalizeCancelReason(body)
    });
    if (!payload) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }
    response.json(payload);
  });
});

app.get("/config", async (_request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    response.json(db.config);
  });
});

app.patch("/config", requireAdmin, async (request: Request, response: Response) => {
  const patch = request.body as UpdateConfigRequest;

  await withDatabase(async (db) => {
    const nextConfig = sanitizeConfigPatch(db.config, patch);
    const deleteIssues = validateContentDeletes(db, db.config, nextConfig);
    if (deleteIssues.length > 0) {
      response.status(409).json({
        error: deleteIssues[0]?.reason ?? "Content delete blocked.",
        details: deleteIssues
      });
      return;
    }

    db.config = nextConfig;
    emitMobileUpdateForAllUsers(db, "config");
    appendPlatformAuditEvent(db, {
      action: "config.updated",
      message: "Platform configuration updated.",
      metadata: {
        fields: Object.keys(patch ?? {}).slice(0, 25)
      }
    });
    response.json(db.config);
  });
});

app.get("/orgs", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    response.json(db.orgs);
  });
});

app.get("/orgs/:orgId/modules", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId.trim();
  const orgExists = await withDatabaseRead(async (db) => db.orgs.some((entry) => entry.id === orgId));
  if (!orgExists) {
    response.status(404).json({ error: "Organization not found." });
    return;
  }

  response.json(await buildOrgModuleEntitlementsResponse(orgModuleEntitlementStore, orgId));
});

app.patch("/orgs/:orgId/modules/training-content", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId.trim();
  const body = request.body as { enabled?: unknown };
  if (typeof body?.enabled !== "boolean") {
    response.status(400).json({
      error: "enabled must be a boolean.",
      code: "module_entitlement_invalid",
    });
    return;
  }

  const orgExists = await withDatabaseRead(async (db) => db.orgs.some((entry) => entry.id === orgId));
  if (!orgExists) {
    response.status(404).json({ error: "Organization not found." });
    return;
  }

  const changedAt = new Date();
  const change = await orgModuleEntitlementStore.setOrgModuleEntitlement({
    orgId,
    moduleKey: "training_content",
    enabled: body.enabled,
    updatedByActorId: PLATFORM_ADMIN_ACTOR_ID,
    updatedAt: changedAt,
    auditEvent: {
      id: `audit_${uuid()}`,
      actorType: "platform_admin",
      actorId: PLATFORM_ADMIN_ACTOR_ID,
      action: "org_module_entitlement_changed",
      orgId,
      userId: null,
      message: "Changed an organization module entitlement.",
      metadata: {
        orgId,
        moduleKey: "training_content",
        actorId: PLATFORM_ADMIN_ACTOR_ID,
      },
      createdAt: changedAt.toISOString(),
    },
  });

  const modules = await buildOrgModuleEntitlementsResponse(orgModuleEntitlementStore, orgId);
  response.json({
    ...modules,
    changed: change.changed,
  });
});

app.post("/orgs", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as {
    name?: string;
    contactName?: string;
    contactEmail?: string;
    joinCode?: string;
    dailySecondsQuota?: number;
    perUserDailySecondsCap?: number;
    activeIndustries?: IndustryId[];
    contractSignedAt?: string;
    monthlyMinutesAllotted?: number;
    renewalTotalUsd?: number;
    softLimitPercentTriggers?: number[];
    maxSimulationMinutes?: number;
  };
  const name = body.name?.trim();

  if (!name) {
    response.status(400).json({ error: "Organization name is required." });
    return;
  }

  await withDatabase(async (db) => {
    const allowedIndustryIds = new Set(getConfiguredIndustryIds(db.config));
    const fallbackIndustryIds = getConfiguredActiveIndustryIds(db.config);
    const contactEmail = normalizeContactEmail(body.contactEmail);
    const existingCodes = new Set(db.orgs.map((org) => normalizeJoinCode(org.joinCode)).filter(Boolean));
    const requestedJoinCode = normalizeJoinCode(body.joinCode);
    if (requestedJoinCode && existingCodes.has(requestedJoinCode)) {
      response.status(409).json({ error: "Join code already in use by another organization." });
      return;
    }

    const joinCode = requestedJoinCode || generateUniqueJoinCode(existingCodes, name);
    const now = nowIso();
    const dailySecondsQuota = clampNonNegativeInteger(
      body.dailySecondsQuota,
      db.config.enterprise.defaultOrgDailySecondsQuota
    );
    const perUserDailySecondsCap = clampNonNegativeInteger(
      body.perUserDailySecondsCap,
      db.config.enterprise.defaultPerUserDailySecondsCap
    );
    const monthlyMinutesFallback = Math.floor((dailySecondsQuota * 30) / 60);
    const org: EnterpriseOrg = {
      id: `org_${uuid()}`,
      name,
      status: "active",
      contactName: normalizeContactName(body.contactName),
      contactEmail,
      emailDomain: null,
      joinCode,
      activeIndustries: normalizeIndustryIds(body.activeIndustries, fallbackIndustryIds, allowedIndustryIds),
      dailySecondsQuota,
      perUserDailySecondsCap,
      pendingPerUserDailySecondsCap: null,
      pendingPerUserDailySecondsCapEffectiveAt: null,
      manualBonusSeconds: 0,
      contractSignedAt: normalizeContractSignedAt(body.contractSignedAt, now),
      monthlyMinutesAllotted: normalizeMonthlyMinutesAllotted(body.monthlyMinutesAllotted, monthlyMinutesFallback),
      renewalTotalUsd: normalizeRenewalTotalUsd(body.renewalTotalUsd, 0),
      softLimitPercentTriggers: normalizeSoftLimitPercentTriggers(body.softLimitPercentTriggers, [75, 90]),
      maxSimulationMinutes: normalizeMaxSimulationMinutes(body.maxSimulationMinutes),
      divisionsEnabled: false,
      customScenarios: [],
      createdAt: now,
      updatedAt: now
    };

    db.orgs.push(org);
    appendPlatformAuditEvent(db, {
      action: "org.created",
      orgId: org.id,
      message: `Created organization ${org.name}.`,
      metadata: {
        orgName: org.name,
        emailDomain: org.emailDomain,
        joinCode: org.joinCode
      }
    });
    response.status(201).json(org);
  });
});

app.patch("/orgs/:orgId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const patch = request.body as Partial<EnterpriseOrg> & {
    applyPerUserDailySecondsCapNextCycle?: unknown;
    clearPendingPerUserDailySecondsCap?: unknown;
  };
  const applyPerUserDailySecondsCapNextCycle = patch.applyPerUserDailySecondsCapNextCycle === true;
  const clearPendingPerUserDailySecondsCap = patch.clearPendingPerUserDailySecondsCap === true;
  await withDatabase(async (db) => {
    const allowedIndustryIds = new Set(getConfiguredIndustryIds(db.config));
    const fallbackIndustryIds = getConfiguredActiveIndustryIds(db.config);
    const org = db.orgs.find((entry) => entry.id === orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }
    const previousStatus = org.status;

    if (typeof patch.name === "string" && patch.name.trim()) {
      org.name = patch.name.trim();
    }

    if (typeof patch.contactName === "string") {
      org.contactName = normalizeContactName(patch.contactName);
    }

    if (typeof patch.contactEmail === "string") {
      org.contactEmail = normalizeContactEmail(patch.contactEmail);
    }

    if (typeof patch.joinCode === "string") {
      const requestedJoinCode = normalizeJoinCode(patch.joinCode);
      const existingCodes = new Set(
        db.orgs
          .filter((entry) => entry.id !== org.id)
          .map((entry) => normalizeJoinCode(entry.joinCode))
          .filter(Boolean)
      );

      if (requestedJoinCode) {
        if (existingCodes.has(requestedJoinCode)) {
          response.status(409).json({ error: "Join code already in use by another organization." });
          return;
        }
        org.joinCode = requestedJoinCode;
      } else {
        org.joinCode = generateUniqueJoinCode(existingCodes, org.name);
      }
    }

    if (typeof patch.status === "string" && (patch.status === "active" || patch.status === "disabled")) {
      org.status = patch.status;
    }

    if (patch.activeIndustries !== undefined) {
      org.activeIndustries = normalizeIndustryIds(patch.activeIndustries, fallbackIndustryIds, allowedIndustryIds);
    }

    if (patch.dailySecondsQuota !== undefined) {
      org.dailySecondsQuota = clampNonNegativeInteger(patch.dailySecondsQuota, org.dailySecondsQuota);
    }

    if (patch.perUserDailySecondsCap !== undefined) {
      const normalizedPerUserDailySecondsCap = clampNonNegativeInteger(
        patch.perUserDailySecondsCap,
        org.perUserDailySecondsCap
      );
      if (applyPerUserDailySecondsCapNextCycle) {
        const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(org, new Date()), new Date());
        org.pendingPerUserDailySecondsCap = normalizedPerUserDailySecondsCap;
        org.pendingPerUserDailySecondsCapEffectiveAt = billing.nextRenewalAt;
      } else {
        org.perUserDailySecondsCap = normalizedPerUserDailySecondsCap;
        org.pendingPerUserDailySecondsCap = null;
        org.pendingPerUserDailySecondsCapEffectiveAt = null;
      }
    }

    if (clearPendingPerUserDailySecondsCap) {
      org.pendingPerUserDailySecondsCap = null;
      org.pendingPerUserDailySecondsCapEffectiveAt = null;
    }

    if (patch.manualBonusSeconds !== undefined) {
      org.manualBonusSeconds = clampNonNegativeInteger(patch.manualBonusSeconds, org.manualBonusSeconds);
    }

    if (patch.contractSignedAt !== undefined) {
      org.contractSignedAt = normalizeContractSignedAt(patch.contractSignedAt, org.contractSignedAt || org.createdAt);
    }

    if (patch.monthlyMinutesAllotted !== undefined) {
      org.monthlyMinutesAllotted = normalizeMonthlyMinutesAllotted(
        patch.monthlyMinutesAllotted,
        org.monthlyMinutesAllotted
      );
    }

    if (patch.renewalTotalUsd !== undefined) {
      org.renewalTotalUsd = normalizeRenewalTotalUsd(patch.renewalTotalUsd, org.renewalTotalUsd);
    }

    if (patch.softLimitPercentTriggers !== undefined) {
      org.softLimitPercentTriggers = normalizeSoftLimitPercentTriggers(
        patch.softLimitPercentTriggers,
        org.softLimitPercentTriggers
      );
    }

    if (patch.maxSimulationMinutes !== undefined) {
      org.maxSimulationMinutes = normalizeMaxSimulationMinutes(
        patch.maxSimulationMinutes,
        org.maxSimulationMinutes
      );
    }

    if (!normalizeJoinCode(org.joinCode)) {
      const existingCodes = new Set(
        db.orgs
          .filter((entry) => entry.id !== org.id)
          .map((entry) => normalizeJoinCode(entry.joinCode))
          .filter(Boolean)
      );
      org.joinCode = generateUniqueJoinCode(existingCodes, org.name);
    }

    if (previousStatus !== org.status && org.status === "disabled") {
      const revokedDashboardUserIds = revokeEnterpriseOrgUserAccess(
        db,
        org.id,
        "Enterprise account access was deactivated."
      );
      if (revokedDashboardUserIds.length > 0) {
        queueDatabasePostCommitEffect(db, {
          category: "security_cleanup",
          description: `Revoke dashboard sessions for disabled organization ${org.id}.`,
          run: async () => {
            await revokeWebAuthSessionsForUserIds(revokedDashboardUserIds);
          }
        });
      }
    }

    org.updatedAt = nowIso();
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.updated",
      orgId: org.id,
      message: `Updated organization ${org.name}.`,
      metadata: {
        fields: Object.keys(patch ?? {}).slice(0, 25),
        status: org.status,
        emailDomain: org.emailDomain,
        joinCode: org.joinCode
      }
    });
    response.json(org);
  });
});

app.get("/orgs/:orgId/divisions", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabaseRead(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    response.json(buildOrgDivisionListPayload(db, org));
  });
});

app.patch("/orgs/:orgId/divisions/settings", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const body = request.body as UpdateOrgDivisionSettingsRequest;

  if (typeof body.divisionsEnabled !== "boolean") {
    response.status(400).json({ error: "divisionsEnabled must be a boolean." });
    return;
  }

  await withDatabase(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    if (body.divisionsEnabled && countActiveOrgDivisions(db, org.id) === 0) {
      response.status(400).json({ error: "Create at least one active division before enabling divisions." });
      return;
    }

    org.divisionsEnabled = body.divisionsEnabled;
    org.updatedAt = nowIso();
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.divisions.settings.updated",
      orgId: org.id,
      message: `${body.divisionsEnabled ? "Enabled" : "Disabled"} divisions for ${org.name}.`,
      metadata: {
        divisionsEnabled: body.divisionsEnabled,
        activeDivisionCount: countActiveOrgDivisions(db, org.id),
      },
    });

    response.json(buildOrgDivisionListPayload(db, org));
  });
});

app.post("/orgs/:orgId/divisions", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const body = request.body as CreateOrgDivisionRequest;

  await withDatabase(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const name = sanitizeOrgDivisionName(body.name);
    if (!name) {
      response.status(400).json({ error: "name is required." });
      return;
    }

    const duplicate = db.orgDivisions.find(
      (entry) => entry.orgId === org.id && entry.active && entry.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0
    );
    if (duplicate) {
      response.status(409).json({ error: "An active division with this name already exists." });
      return;
    }

    const now = nowIso();
    db.orgDivisions.push({
      id: createOrgDivisionId(),
      orgId: org.id,
      name,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    org.updatedAt = now;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.divisions.created",
      orgId: org.id,
      message: `Created division "${name}" for ${org.name}.`,
      metadata: { divisionName: name },
    });

    response.status(201).json(buildOrgDivisionListPayload(db, org));
  });
});

app.patch("/orgs/:orgId/divisions/:divisionId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const divisionId = request.params.divisionId?.trim();
  const body = request.body as UpdateOrgDivisionRequest;

  if (!divisionId) {
    response.status(400).json({ error: "divisionId is required." });
    return;
  }

  await withDatabase(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const division = findOrgDivisionRecord(db, org.id, divisionId);
    if (!division) {
      response.status(404).json({ error: "Division not found." });
      return;
    }

    const name = sanitizeOrgDivisionName(body.name);
    if (!name) {
      response.status(400).json({ error: "name is required." });
      return;
    }

    const duplicate = db.orgDivisions.find(
      (entry) =>
        entry.orgId === org.id &&
        entry.id !== division.id &&
        entry.active &&
        entry.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0
    );
    if (duplicate) {
      response.status(409).json({ error: "An active division with this name already exists." });
      return;
    }

    division.name = name;
    division.updatedAt = nowIso();
    org.updatedAt = division.updatedAt;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.divisions.updated",
      orgId: org.id,
      message: `Updated division "${division.name}" for ${org.name}.`,
      metadata: { divisionId: division.id, active: division.active },
    });

    response.json(buildOrgDivisionListPayload(db, org));
  });
});

app.delete("/orgs/:orgId/divisions/:divisionId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const divisionId = request.params.divisionId?.trim();

  if (!divisionId) {
    response.status(400).json({ error: "divisionId is required." });
    return;
  }

  await withDatabase(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const division = findOrgDivisionRecord(db, org.id, divisionId);
    if (!division || division.active !== true) {
      response.status(404).json({ error: "Active division not found." });
      return;
    }

    if (org.divisionsEnabled === true && countActiveOrgDivisions(db, org.id) <= 1) {
      response.status(409).json({
        error: "Disable divisions first or create another active division before deleting the last active division.",
      });
      return;
    }

    const now = nowIso();
    division.active = false;
    division.deletedAt = now;
    division.updatedAt = now;
    const cleared = clearDivisionAssignmentsForDeletedDivision({
      db,
      orgId: org.id,
      divisionId: division.id,
    });
    org.updatedAt = now;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.divisions.deleted",
      orgId: org.id,
      message: `Deleted division "${division.name}" for ${org.name}.`,
      metadata: {
        divisionId: division.id,
        clearedUserCount: cleared.clearedUserCount,
        clearedTrainingCount: cleared.clearedTrainingCount,
        clearedStandardScenarioAssignmentCount: cleared.clearedStandardScenarioAssignmentCount,
      },
    });

    response.json(buildOrgDivisionListPayload(db, org));
  });
});

app.get("/orgs/:orgId/standard-scenarios/divisions", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabaseRead(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    response.json(buildOrgStandardScenarioDivisionListPayload(db, org));
  });
});

app.put("/orgs/:orgId/standard-scenarios/:scenarioId/division", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const scenarioId = request.params.scenarioId?.trim();
  const body = request.body as SetOrgStandardScenarioDivisionRequest;

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  await withDatabase(async (db) => {
    ensureOrgDivisionCollections(db);
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    if (!getConfigScenarioById(db.config, scenarioId)) {
      response.status(404).json({ error: "Standard scenario not found." });
      return;
    }

    const existing = findOrgStandardScenarioDivisionAssignmentRecord(db, org.id, scenarioId);
    const selection = resolveDivisionSelectionForOrg(db, org.id, body.divisionId);
    if (!selection.ok) {
      response.status(400).json({ error: selection.error });
      return;
    }

    if (
      selection.divisionId !== null &&
      !isStandardScenarioVisibleToOrg(db, org, scenarioId) &&
      !existing
    ) {
      response.status(400).json({ error: "Standard scenario is not available to this company." });
      return;
    }

    const now = nowIso();
    if (selection.divisionId === null) {
      db.orgStandardScenarioDivisionAssignments = db.orgStandardScenarioDivisionAssignments.filter(
        (entry) => !(entry.orgId === org.id && entry.scenarioId === scenarioId)
      );
    } else if (existing) {
      existing.divisionId = selection.divisionId;
      existing.updatedAt = now;
    } else {
      const assignment: OrgStandardScenarioDivisionAssignmentRecord = {
        id: createOrgStandardScenarioDivisionAssignmentId(),
        orgId: org.id,
        scenarioId,
        divisionId: selection.divisionId,
        createdAt: now,
        updatedAt: now,
      };
      db.orgStandardScenarioDivisionAssignments.push(assignment);
    }

    org.updatedAt = now;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.standard_scenario_division.updated",
      orgId: org.id,
      message: `Updated division routing for standard scenario ${scenarioId} in ${org.name}.`,
      metadata: {
        scenarioId,
        divisionId: selection.divisionId,
      },
    });

    response.json({
      scenarioId,
      divisionId: selection.divisionId,
    });
  });
});

app.get("/orgs/:orgId/training-packs", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  await withDatabaseRead(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const packs = await trainingPackStore.listTrainingPacksForOrg(org.id);
      response.json({
        generatedAt: nowIso(),
        orgId: org.id,
        packs
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load training packs.";
      response.status(503).json({ error: message });
    }
  });
});

app.get("/orgs/:orgId/training-packs/:trainingPackId/assignments", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingPackId = request.params.trainingPackId?.trim();
  if (!trainingPackId) {
    response.status(400).json({ error: "trainingPackId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const packs = await trainingPackStore.listTrainingPacksForOrg(org.id);
      const pack = packs.find((entry) => entry.id === trainingPackId);
      if (!pack) {
        response.status(404).json({ error: "Training pack not found." });
        return;
      }

      const deactivatedInvalidAssignmentCount = deactivateInvalidTrainingPackAssignments({
        db,
        nowIso: nowIso(),
        orgId: org.id,
        trainingPackId,
      });
      const assignments = listTrainingPackAssignments(db, org.id, trainingPackId)
        .map((assignment) => projectTrainingPackAssignmentLifecycle(db, assignment))
        .sort((left, right) => left.assignedAt.localeCompare(right.assignedAt));
      const payload: AdminTrainingPackAssignmentsResponse = {
        generatedAt: nowIso(),
        orgId: org.id,
        trainingPackId,
        assignments,
        deactivatedInvalidAssignmentCount,
      };
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load training pack assignments.";
      response.status(503).json({ error: message });
    }
  });
});

app.put("/orgs/:orgId/training-packs/:trainingPackId/assignments", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingPackId = request.params.trainingPackId?.trim();
  const body = request.body as SetTrainingPackAssignmentsRequest;
  if (!trainingPackId) {
    response.status(400).json({ error: "trainingPackId is required." });
    return;
  }
  if (!Array.isArray(body.userIds)) {
    response.status(400).json({ error: "userIds must be a string array." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const packs = await trainingPackStore.listTrainingPacksForOrg(org.id);
      const pack = packs.find((entry) => entry.id === trainingPackId);
      if (!pack) {
        response.status(404).json({ error: "Training pack not found." });
        return;
      }

      const now = nowIso();
      const deactivatedInvalidAssignmentCount = deactivateInvalidTrainingPackAssignments({
        db,
        nowIso: now,
        orgId: org.id,
        trainingPackId,
      });
      const normalizedUserIds = Array.from(
        new Set(
          body.userIds
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      );
      const eligibleUsers = listTrainingPackAssignmentEligibleUsers(db.users, org.id);
      const eligibleUserIds = new Set(eligibleUsers.map((user) => user.id));
      const invalidUserId = normalizedUserIds.find((userId) => !eligibleUserIds.has(userId));
      if (invalidUserId) {
        response.status(400).json({ error: `User ${invalidUserId} is not eligible for this organization's training pack.` });
        return;
      }

      const scenarioCatalog = buildDashboardScenarioCatalog(db, org);
      const requiredScenarioIds = resolveTrainingPackRequiredScenarioIds(pack, scenarioCatalog);
      const activeAssignments = listTrainingPackAssignments(db, org.id, trainingPackId);
      const nextUserIdSet = new Set(normalizedUserIds);

      for (const assignment of activeAssignments) {
        if (!nextUserIdSet.has(assignment.userId)) {
          assignment.active = false;
          assignment.updatedAt = now;
        }
      }

      for (const userId of normalizedUserIds) {
        const existing = activeAssignments.find((assignment) => assignment.userId === userId);
        if (existing) {
          syncTrainingPackAssignmentLifecycle(db, existing);
          continue;
        }

        db.trainingPackAssignments.push({
          id: `tpa_${uuid()}`,
          trainingPackId,
          orgId: org.id,
          userId,
          active: true,
          assignedAt: now,
          assignedByUserId: null,
          requiredScenarioIds: requiredScenarioIds.slice(),
          completionRule: "scored_required_scenarios_v1",
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now
        });
      }

      const assignments = listTrainingPackAssignments(db, org.id, trainingPackId)
        .map((assignment) => projectTrainingPackAssignmentLifecycle(db, assignment))
        .sort((left, right) => left.assignedAt.localeCompare(right.assignedAt));

      appendPlatformAuditEvent(db, {
        action: "org.training_pack.assignments.updated",
        orgId: org.id,
        message: `Updated training pack assignments for "${pack.title}" in ${org.name}.`,
        metadata: {
          trainingPackId,
          assignedUserCount: assignments.length,
          deactivatedInvalidAssignments: deactivatedInvalidAssignmentCount
        }
      });

      const payload: AdminTrainingPackAssignmentsResponse = {
        generatedAt: nowIso(),
        orgId: org.id,
        trainingPackId,
        assignments,
        deactivatedInvalidAssignmentCount,
      };
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update training pack assignments.";
      response.status(503).json({ error: message });
    }
  });
});

app.post("/orgs/:orgId/training-packs", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const body = request.body as {
    title?: unknown;
    trainingPackBrief?: unknown;
    trainingTopic?: unknown;
    requiredBehavioralTriggers?: unknown;
    active?: unknown;
  };

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const trainingPackBriefInput =
    typeof body.trainingPackBrief === "string"
      ? body.trainingPackBrief
      : (typeof body.trainingTopic === "string" ? body.trainingTopic : "");
  const trainingPackBrief = trainingPackBriefInput.trim();
  if (!title) {
    response.status(400).json({ error: "title is required." });
    return;
  }
  if (!trainingPackBrief) {
    response.status(400).json({ error: "trainingPackBrief is required." });
    return;
  }
  if (body.requiredBehavioralTriggers !== undefined && !Array.isArray(body.requiredBehavioralTriggers)) {
    response.status(400).json({ error: "requiredBehavioralTriggers must be a string array." });
    return;
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    response.status(400).json({ error: "active must be a boolean." });
    return;
  }

  const requiredBehavioralTriggers = normalizeTrainingPackTriggers(body.requiredBehavioralTriggers);
  const active = body.active === true;

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const created = await trainingPackStore.createTrainingPackForOrg(org.id, {
        title,
        trainingTopic: trainingPackBrief,
        requiredBehavioralTriggers,
        active
      });

      appendPlatformAuditEvent(db, {
        action: "org.training_pack.created",
        orgId: org.id,
        message: `Created training pack "${created.title}" for ${org.name}.`,
        metadata: {
          trainingPackId: created.id,
          active: created.active,
          requiredBehavioralTriggers: created.requiredBehavioralTriggers
        }
      });

      response.status(201).json(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create training pack.";
      response.status(503).json({ error: message });
    }
  });
});

app.patch("/orgs/:orgId/training-packs/:trainingPackId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingPackId = request.params.trainingPackId?.trim();
  const body = request.body as {
    title?: unknown;
    trainingPackBrief?: unknown;
    trainingTopic?: unknown;
    requiredBehavioralTriggers?: unknown;
    active?: unknown;
  };

  if (!trainingPackId) {
    response.status(400).json({ error: "trainingPackId is required." });
    return;
  }

  const patch: {
    title?: string;
    trainingTopic?: string;
    requiredBehavioralTriggers?: string[];
    active?: boolean;
  } = {};
  const hasTitle = body.title !== undefined;
  const hasBrief = body.trainingPackBrief !== undefined || body.trainingTopic !== undefined;
  const hasTriggers = body.requiredBehavioralTriggers !== undefined;
  const hasActive = body.active !== undefined;

  if (hasTitle) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      response.status(400).json({ error: "title must be a non-empty string." });
      return;
    }
    patch.title = body.title.trim();
  }

  if (hasBrief) {
    const briefInput =
      typeof body.trainingPackBrief === "string"
        ? body.trainingPackBrief
        : (typeof body.trainingTopic === "string" ? body.trainingTopic : "");
    const trainingPackBrief = briefInput.trim();
    if (!trainingPackBrief) {
      response.status(400).json({ error: "trainingPackBrief must be a non-empty string." });
      return;
    }
    patch.trainingTopic = trainingPackBrief;
  }

  if (hasTriggers) {
    if (!Array.isArray(body.requiredBehavioralTriggers)) {
      response.status(400).json({ error: "requiredBehavioralTriggers must be a string array." });
      return;
    }
    patch.requiredBehavioralTriggers = normalizeTrainingPackTriggers(body.requiredBehavioralTriggers);
  }

  if (hasActive) {
    if (typeof body.active !== "boolean") {
      response.status(400).json({ error: "active must be a boolean." });
      return;
    }
    patch.active = body.active;
  }

  if (!hasTitle && !hasBrief && !hasTriggers && !hasActive) {
    response.status(400).json({ error: "At least one patch field is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const updated = await trainingPackStore.updateTrainingPackForOrg(org.id, trainingPackId, patch);
      if (!updated) {
        response.status(404).json({ error: "Training pack not found." });
        return;
      }

      appendPlatformAuditEvent(db, {
        action: "org.training_pack.updated",
        orgId: org.id,
        message: `Updated training pack "${updated.title}" for ${org.name}.`,
        metadata: {
          trainingPackId: updated.id,
          active: updated.active,
          fields: Object.keys(patch)
        }
      });

      response.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update training pack.";
      response.status(503).json({ error: message });
    }
  });
});

app.delete("/orgs/:orgId/training-packs/:trainingPackId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingPackId = request.params.trainingPackId?.trim();
  if (!trainingPackId) {
    response.status(400).json({ error: "trainingPackId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    try {
      const deleted = await trainingPackStore.deleteTrainingPackForOrg(org.id, trainingPackId);
      if (!deleted) {
        response.status(404).json({ error: "Training pack not found." });
        return;
      }
      ensureOrgTrainingCollections(db);
      db.orgTrainingPackAttachments = db.orgTrainingPackAttachments.filter(
        (entry) => !(entry.orgId === org.id && entry.trainingPackId === trainingPackId)
      );
      const now = nowIso();
      for (const assignment of listTrainingPackAssignments(db, org.id, trainingPackId)) {
        assignment.active = false;
        assignment.updatedAt = now;
      }

      appendPlatformAuditEvent(db, {
        action: "org.training_pack.deleted",
        orgId: org.id,
        message: `Deleted training pack ${trainingPackId} for ${org.name}.`,
        metadata: {
          trainingPackId
        }
      });

      response.json({ deleted: true, trainingPackId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete training pack.";
      response.status(503).json({ error: message });
    }
  });
});

app.get("/orgs/:orgId/custom-scenarios", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    response.json({
      generatedAt: nowIso(),
      orgId: org.id,
      scenarios: ensureOrgCustomScenarioCollection(org),
    });
  });
});

app.post("/orgs/:orgId/custom-scenarios/generate", requireAdmin, async (request: Request, response: Response) => {
  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const orgId = request.params.orgId;
  const body = request.body as GenerateOrgCustomScenarioRequest;
  const sourceMode: OrgCustomScenarioSourceMode = isOrgCustomScenarioSourceMode(body.sourceMode)
    ? body.sourceMode
    : "scratch";

  const context = await withDatabaseRead(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return null;
    }

    const allowedIndustryMap = new Map((db.config.industries ?? []).map((industry) => [industry.id, industry]));
    const requestedIndustryIds = uniqueStrings(Array.isArray(body.applicableIndustryIds) ? body.applicableIndustryIds : []);
    const selectedIndustries = requestedIndustryIds
      .map((id) => allowedIndustryMap.get(id))
      .filter((entry): entry is IndustryDefinition => Boolean(entry));
    if (selectedIndustries.length === 0) {
      response.status(400).json({ error: "Select at least one valid applicable industry." });
      return null;
    }

    let base: { segment: SegmentDefinition; scenario: Scenario } | null = null;
    if (sourceMode === "standard_base") {
      const baseScenarioId = typeof body.baseScenarioId === "string" ? body.baseScenarioId.trim() : "";
      if (!baseScenarioId) {
        response.status(400).json({ error: "baseScenarioId is required when using a standard scenario as base." });
        return null;
      }
      base = getConfigScenarioById(db.config, baseScenarioId);
      if (!base) {
        response.status(404).json({ error: "Base scenario not found in the standard content catalog." });
        return null;
      }
    }

    const requestedSegmentId = typeof body.segmentId === "string" ? body.segmentId.trim() : "";
    const segmentId = requestedSegmentId || base?.segment.id || "";
    if (!segmentId) {
      response.status(400).json({ error: "A role is required before generating a custom scenario." });
      return null;
    }

    const segment = getConfigSegmentById(db.config, segmentId);
    if (!segment) {
      response.status(400).json({ error: "Selected role is not valid." });
      return null;
    }

    const generationInputs = normalizeOrgCustomScenarioGenerationInputs(body.generationInputs) ?? null;
    const draft = {
      title: sanitizeOptionalText(body.draft?.title, 300),
      description: sanitizeOptionalText(body.draft?.description, 8_000),
      desiredOutcome: sanitizeOptionalText(body.draft?.desiredOutcome, 8_000),
      aiRole: sanitizeOptionalText(body.draft?.aiRole, 8_000),
      scoringGuidance: sanitizeOptionalText(body.draft?.scoringGuidance, 8_000),
    };

    return {
      org,
      configUpdatedAt: db.config.updatedAt,
      segment,
      base,
      sourceMode,
      selectedIndustries,
      generationInputs,
      draft,
    };
  });

  if (!context) {
    return;
  }

  const promptPreview = buildCustomScenarioGenerationPromptPreview({
    org: context.org,
    segment: context.segment,
    industries: context.selectedIndustries,
    sourceMode: context.sourceMode,
    base: context.base,
    draft: context.draft,
    generationInputs: context.generationInputs,
  });

  const systemPrompt = [
    "You are a training-scenario content writer for enterprise roleplay simulations.",
    "Return ONLY valid JSON with keys: title, description, desiredOutcome, aiRole, scoringGuidance.",
    "Do not wrap the JSON in markdown fences.",
    "Keep the scenario realistic, role-appropriate, and suitable for spoken simulation practice.",
    `The USER is the trainee in the target role (${context.segment.label}).`,
    "aiRole must be the opposing/conversation counterpart, never the trainee role.",
    "desiredOutcome should capture the concrete result the trainee should try to achieve by the end of the scenario.",
    "Avoid illegal/defamatory claims, guarantees, fabricated product specs, or compliance violations.",
    "If draft content is supplied, improve and adapt it rather than discarding useful details.",
  ].join(" ");
  const customScenarioMaxOutputTokens = OPENAI_MODEL_CONFIG.scoring.maxOutputTokens;

  try {
    const budgetedCompletion = await invokeAiProviderWithBudget({
      context: {
        user: {
          id: "platform_admin",
          accountType: "enterprise",
          timezone: "UTC",
        },
        orgId: context.org.id,
      },
      kind: "custom_scenario",
      model: OPENAI_CHAT_MODEL,
      promptVersion: AI_PROMPT_VERSION,
      rubricVersion: null,
      estimatedTokens: estimateCompletionReservationTokens([
        { content: systemPrompt },
        { content: promptPreview },
      ], customScenarioMaxOutputTokens),
      invoke: async () => await requestCompletion({
        apiFamily: OPENAI_MODEL_CONFIG.chat.apiFamily,
        model: OPENAI_CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: promptPreview },
        ],
        maxOutputTokens: customScenarioMaxOutputTokens,
        temperature: 0.4,
        reasoningEffort: OPENAI_MODEL_CONFIG.chat.reasoningEffort,
      }),
      resolveUsage: (completion) => completion.usage,
    });
    const completion = budgetedCompletion.value;

    const parsed = extractFirstJsonObject(completion.text);
    if (!parsed) {
      response.status(502).json({ error: "AI response could not be parsed into JSON. Please retry." });
      return;
    }

    const fallbackTitle = context.draft.title ?? context.base?.scenario.title ?? `${context.org.name} Custom Scenario`;
    const fallbackDescription =
      context.draft.description ??
      context.base?.scenario.description ??
      `Create a roleplay scenario for ${context.segment.label} at ${context.org.name}.`;
    const fallbackDesiredOutcome =
      context.draft.desiredOutcome ??
      context.base?.scenario.desiredOutcome ??
      "";
    const fallbackAiRole =
      context.draft.aiRole ??
      context.base?.scenario.aiRole ??
      `a realistic counterpart who is interacting with a ${context.segment.label}`;
    const fallbackScoring =
      context.draft.scoringGuidance ??
      buildDefaultScoringGuidance({
        scenarioTitle: fallbackTitle,
        segmentLabel: context.segment.label,
        industryContexts: context.selectedIndustries.map((industry) => ({
          id: industry.id,
          label: industry.label,
          aiBaseline: industry.aiBaseline ?? "",
          standardScoringGuidance: industry.standardScoringGuidance ?? ""
        }))
      });

    const generatedTitle = toMultilineText(parsed.title, 300) || fallbackTitle;
    const generatedDescription = toMultilineText(parsed.description, 8_000) || fallbackDescription;
    const generatedDesiredOutcome = toMultilineText(parsed.desiredOutcome, 8_000) || fallbackDesiredOutcome;
    const parsedAiRole = toMultilineText(parsed.aiRole, 8_000);
    const safeFallbackAiRole = aiRoleMatchesTraineeRole(fallbackAiRole, context.segment.label)
      ? `a realistic counterpart with objections and constraints for a ${context.segment.label}`
      : fallbackAiRole;
    let generatedAiRole = parsedAiRole || safeFallbackAiRole;
    if (aiRoleMatchesTraineeRole(generatedAiRole, context.segment.label)) {
      generatedAiRole = safeFallbackAiRole;
    }
    const generatedScoringGuidance = toMultilineText(parsed.scoringGuidance, 8_000) || fallbackScoring;

    const payload: GenerateOrgCustomScenarioResponse = {
      generated: {
        title: generatedTitle,
        description: generatedDescription,
        desiredOutcome: generatedDesiredOutcome || undefined,
        aiRole: generatedAiRole,
        scoringGuidance: generatedScoringGuidance,
        summary: buildScenarioSummary(generatedDescription),
      },
      source: {
        sourceMode: context.sourceMode,
        creationMethod: "ai",
        baseScenarioId: context.base?.scenario.id ?? null,
        baseScenarioTitle: context.base?.scenario.title ?? null,
        baseScenarioSegmentId: context.base?.segment.id ?? null,
        baseScenarioVersion: context.base ? context.configUpdatedAt || null : null,
      },
      promptPreview,
      model: completion.model,
      usage: {
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        totalTokens: completion.usage.totalTokens,
      },
    };

    response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.post("/orgs/:orgId/custom-scenarios", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const body = request.body as CreateOrgCustomScenarioRequest;

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const desiredOutcome = normalizeDesiredOutcomeText(body.desiredOutcome);
    const aiRole = typeof body.aiRole === "string" ? body.aiRole.trim() : "";
    const scoringGuidance = typeof body.scoringGuidance === "string" ? body.scoringGuidance.trim() : "";
    const segmentId = typeof body.segmentId === "string" ? body.segmentId.trim() : "";
    if (!title || !description || !aiRole || !scoringGuidance || !segmentId) {
      response.status(400).json({
        error: "title, description, aiRole, scoringGuidance, and segmentId are required.",
      });
      return;
    }

    const segment = getConfigSegmentById(db.config, segmentId);
    if (!segment) {
      response.status(400).json({ error: "Selected role is not valid." });
      return;
    }

    const allowedIndustryIds = new Set((db.config.industries ?? []).map((industry) => industry.id));
    const applicableIndustryIds = uniqueStrings(
      Array.isArray(body.applicableIndustryIds) ? body.applicableIndustryIds : [],
      allowedIndustryIds,
    ) as IndustryId[];
    if (applicableIndustryIds.length === 0) {
      response.status(400).json({ error: "Select at least one valid applicable industry." });
      return;
    }

    const requestedProvenance = body.provenance ?? {};
    const sourceMode: OrgCustomScenarioSourceMode = isOrgCustomScenarioSourceMode(requestedProvenance.sourceMode)
      ? requestedProvenance.sourceMode
      : "scratch";

    let resolvedBase: { segment: SegmentDefinition; scenario: Scenario } | null = null;
    const requestedBaseScenarioId =
      typeof requestedProvenance.baseScenarioId === "string" ? requestedProvenance.baseScenarioId.trim() : "";
    if (sourceMode === "standard_base") {
      if (!requestedBaseScenarioId) {
        response.status(400).json({ error: "Base scenario is required when source mode is standard_base." });
        return;
      }
      resolvedBase = getConfigScenarioById(db.config, requestedBaseScenarioId);
      if (!resolvedBase) {
        response.status(404).json({ error: "Base scenario not found in the standard content catalog." });
        return;
      }
    }

    const scenarios = ensureOrgCustomScenarioCollection(org);
    const existingIds = new Set(scenarios.map((entry) => entry.id));
    let id = normalizeIdentifier(title, `${segmentId}_custom_scenario`);
    if (existingIds.has(id)) {
      let attempt = 2;
      while (existingIds.has(`${id}_${attempt}`)) {
        attempt += 1;
      }
      id = `${id}_${attempt}`;
    }

    const now = nowIso();
    const provenance = normalizeOrgCustomScenarioProvenance(requestedProvenance, {
      sourceMode,
      creationMethod: isOrgCustomScenarioCreationMethod(requestedProvenance.creationMethod)
        ? requestedProvenance.creationMethod
        : "manual",
      baseScenarioId: resolvedBase?.scenario.id ?? null,
      baseScenarioTitle: resolvedBase?.scenario.title ?? null,
      baseScenarioSegmentId: resolvedBase?.segment.id ?? null,
      baseScenarioVersion: resolvedBase ? db.config.updatedAt : null,
    });

    const customScenario: OrgCustomScenario = {
      id,
      orgId: org.id,
      segmentId,
      title,
      summary: buildScenarioSummary(description),
      description,
      desiredOutcome,
      aiRole,
      scoringGuidance,
      applicableIndustryIds,
      enabled: body.enabled === true,
      provenance,
      createdBy: PLATFORM_ADMIN_ACTOR_ID,
      createdAt: now,
      updatedAt: now,
    };

    scenarios.push(customScenario);
    org.customScenarios = sortOrgCustomScenariosByTitle(scenarios);
    org.updatedAt = now;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.custom_scenario.created",
      orgId: org.id,
      message: `Created custom scenario "${customScenario.title}" for ${org.name}.`,
      metadata: {
        customScenarioId: customScenario.id,
        segmentId: customScenario.segmentId,
        industries: customScenario.applicableIndustryIds,
        enabled: customScenario.enabled === true,
        sourceMode: customScenario.provenance.sourceMode,
        creationMethod: customScenario.provenance.creationMethod,
      },
    });

    response.status(201).json(customScenario);
  });
});

app.patch("/orgs/:orgId/custom-scenarios/:scenarioId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const scenarioId = request.params.scenarioId?.trim();
  const patch = request.body as UpdateOrgCustomScenarioRequest;

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const scenarios = ensureOrgCustomScenarioCollection(org);
    const current = scenarios.find((entry) => entry.id === scenarioId);
    if (!current) {
      response.status(404).json({ error: "Custom scenario not found." });
      return;
    }

    if (patch.segmentId !== undefined) {
      const nextSegmentId = typeof patch.segmentId === "string" ? patch.segmentId.trim() : "";
      if (!nextSegmentId || !getConfigSegmentById(db.config, nextSegmentId)) {
        response.status(400).json({ error: "Selected role is not valid." });
        return;
      }
      current.segmentId = nextSegmentId;
    }

    if (patch.applicableIndustryIds !== undefined) {
      const allowedIndustryIds = new Set((db.config.industries ?? []).map((industry) => industry.id));
      const nextIndustryIds = uniqueStrings(
        Array.isArray(patch.applicableIndustryIds) ? patch.applicableIndustryIds : [],
        allowedIndustryIds,
      ) as IndustryId[];
      if (nextIndustryIds.length === 0) {
        response.status(400).json({ error: "Select at least one valid applicable industry." });
        return;
      }
      current.applicableIndustryIds = nextIndustryIds;
    }

    if (patch.title !== undefined) {
      const nextTitle = typeof patch.title === "string" ? patch.title.trim() : "";
      if (!nextTitle) {
        response.status(400).json({ error: "title cannot be empty." });
        return;
      }
      current.title = nextTitle;
    }

    if (patch.description !== undefined) {
      const nextDescription = typeof patch.description === "string" ? patch.description.trim() : "";
      if (!nextDescription) {
        response.status(400).json({ error: "description cannot be empty." });
        return;
      }
      current.description = nextDescription;
    }

    if (patch.desiredOutcome !== undefined) {
      const nextDesiredOutcome = normalizeDesiredOutcomeText(patch.desiredOutcome);
      current.desiredOutcome = nextDesiredOutcome;
    }

    if (patch.aiRole !== undefined) {
      const nextAiRole = typeof patch.aiRole === "string" ? patch.aiRole.trim() : "";
      if (!nextAiRole) {
        response.status(400).json({ error: "aiRole cannot be empty." });
        return;
      }
      current.aiRole = nextAiRole;
    }

    if (patch.scoringGuidance !== undefined) {
      const nextScoringGuidance = typeof patch.scoringGuidance === "string" ? patch.scoringGuidance.trim() : "";
      if (!nextScoringGuidance) {
        response.status(400).json({ error: "scoringGuidance cannot be empty." });
        return;
      }
      current.scoringGuidance = nextScoringGuidance;
    }

    if (typeof patch.enabled === "boolean") {
      current.enabled = patch.enabled;
    }

    if (patch.provenance !== undefined) {
      const incoming = patch.provenance ?? {};
      const nextSourceMode = isOrgCustomScenarioSourceMode(incoming.sourceMode)
        ? incoming.sourceMode
        : current.provenance.sourceMode;

      let resolvedBase: { segment: SegmentDefinition; scenario: Scenario } | null = null;
      const explicitBaseScenarioId =
        typeof incoming.baseScenarioId === "string" ? incoming.baseScenarioId.trim() : undefined;
      const effectiveBaseScenarioId =
        explicitBaseScenarioId !== undefined ? explicitBaseScenarioId : (current.provenance.baseScenarioId ?? "");

      if (nextSourceMode === "standard_base") {
        if (!effectiveBaseScenarioId) {
          response.status(400).json({ error: "Base scenario is required when source mode is standard_base." });
          return;
        }
        resolvedBase = getConfigScenarioById(db.config, effectiveBaseScenarioId);
        if (!resolvedBase) {
          response.status(404).json({ error: "Base scenario not found in the standard content catalog." });
          return;
        }
      }

      const fallbackForProvenance =
        nextSourceMode === "scratch"
          ? {
              ...current.provenance,
              sourceMode: "scratch" as OrgCustomScenarioSourceMode,
              baseScenarioId: null,
              baseScenarioTitle: null,
              baseScenarioSegmentId: null,
              baseScenarioVersion: null,
            }
          : {
              ...current.provenance,
              sourceMode: nextSourceMode,
              baseScenarioId: resolvedBase?.scenario.id ?? current.provenance.baseScenarioId ?? null,
              baseScenarioTitle: resolvedBase?.scenario.title ?? current.provenance.baseScenarioTitle ?? null,
              baseScenarioSegmentId: resolvedBase?.segment.id ?? current.provenance.baseScenarioSegmentId ?? null,
              baseScenarioVersion: resolvedBase ? db.config.updatedAt : current.provenance.baseScenarioVersion ?? null,
            };

      current.provenance = normalizeOrgCustomScenarioProvenance(incoming, fallbackForProvenance);
    }

    current.summary = buildScenarioSummary(current.description);
    current.orgId = org.id;
    current.updatedAt = nowIso();
    org.customScenarios = sortOrgCustomScenariosByTitle(scenarios);
    org.updatedAt = current.updatedAt;
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.custom_scenario.updated",
      orgId: org.id,
      message: `Updated custom scenario "${current.title}" for ${org.name}.`,
      metadata: {
        customScenarioId: current.id,
        enabled: current.enabled === true,
        fields: Object.keys(patch ?? {}).slice(0, 25),
      },
    });

    response.json(current);
  });
});

app.delete("/orgs/:orgId/custom-scenarios/:scenarioId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const scenarioId = request.params.scenarioId?.trim();
  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const scenarios = ensureOrgCustomScenarioCollection(org);
    const existing = scenarios.find((entry) => entry.id === scenarioId);
    if (!existing) {
      response.status(404).json({ error: "Custom scenario not found." });
      return;
    }

    org.customScenarios = scenarios.filter((entry) => entry.id !== scenarioId);
    ensureOrgTrainingCollections(db);
    db.orgTrainingScenarioAttachments = db.orgTrainingScenarioAttachments.filter(
      (entry) => !(entry.orgId === org.id && entry.scenarioId === scenarioId)
    );
    org.updatedAt = nowIso();
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.custom_scenario.deleted",
      orgId: org.id,
      message: `Deleted custom scenario "${existing.title}" from ${org.name}.`,
      metadata: {
        customScenarioId: existing.id,
        title: existing.title,
      },
    });

    response.json({
      deleted: true,
      id: existing.id,
      title: existing.title,
    });
  });
});

app.get("/orgs/:orgId/trainings", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    await ensureOrgTrainingWorkspace(db, org);
    const scenarioIds = new Set(ensureOrgCustomScenarioCollection(org).map((scenario) => scenario.id));
    const payload: OrgTrainingListResponse = {
      generatedAt: nowIso(),
      orgId: org.id,
      trainings: buildOrgTrainingSummaries({
        db,
        orgId: org.id,
        validScenarioIds: scenarioIds,
      }),
    };
    response.json(payload);
  });
});

app.post("/orgs/:orgId/trainings", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const body = request.body as CreateOrgTrainingRequest;

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    await ensureOrgTrainingWorkspace(db, org);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      response.status(400).json({ error: "name is required." });
      return;
    }
    const divisionSelection = resolveDivisionSelectionForOrg(db, org.id, body.divisionId);
    if (!divisionSelection.ok) {
      response.status(400).json({ error: divisionSelection.error });
      return;
    }

    const now = nowIso();
    const training: OrgTrainingRecord = {
      id: createOrgTrainingId(),
      orgId: org.id,
      name: name.slice(0, 160),
      status: normalizeOrgTrainingStatus(body.status, "draft"),
      description: typeof body.description === "string" ? body.description.trim().slice(0, 4_000) : "",
      divisionId: divisionSelection.divisionId,
      createdAt: now,
      updatedAt: now,
    };
    db.orgTrainings.push(training);
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.training.created",
      orgId: org.id,
      message: `Created training "${training.name}" for ${org.name}.`,
      metadata: {
        trainingId: training.id,
        status: training.status,
      },
    });

    response.status(201).json(
      buildOrgTrainingSummaryForResponse(db, org.id, training.id) ?? {
        ...training,
        attachedTrainingPackIds: [],
        attachedCustomScenarioIds: [],
        attachedTrainingPackCount: 0,
        attachedCustomScenarioCount: 0,
      },
    );
  });
});

app.patch("/orgs/:orgId/trainings/:trainingId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingId = request.params.trainingId?.trim();
  const patch = request.body as UpdateOrgTrainingRequest;

  if (!trainingId) {
    response.status(400).json({ error: "trainingId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    await ensureOrgTrainingWorkspace(db, org);
    const training = findOrgTrainingRecord(db, org.id, trainingId);
    if (!training) {
      response.status(404).json({ error: "Training not found." });
      return;
    }

    if (patch.name === undefined && patch.description === undefined && patch.status === undefined && patch.divisionId === undefined) {
      response.status(400).json({ error: "At least one patch field is required." });
      return;
    }

    if (patch.name !== undefined) {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : "";
      if (!nextName) {
        response.status(400).json({ error: "name must be a non-empty string." });
        return;
      }
      training.name = nextName.slice(0, 160);
    }
    if (patch.description !== undefined) {
      if (patch.description !== null && typeof patch.description !== "string") {
        response.status(400).json({ error: "description must be a string." });
        return;
      }
      training.description = typeof patch.description === "string" ? patch.description.trim().slice(0, 4_000) : "";
    }
    if (patch.status !== undefined) {
      training.status = normalizeOrgTrainingStatus(patch.status, training.status);
    }
    if (patch.divisionId !== undefined) {
      const divisionSelection = resolveDivisionSelectionForOrg(db, org.id, patch.divisionId);
      if (!divisionSelection.ok) {
        response.status(400).json({ error: divisionSelection.error });
        return;
      }
      training.divisionId = divisionSelection.divisionId;
    } else if (!isDivisionActive(db, org.id, training.divisionId)) {
      training.divisionId = null;
    }

    touchOrgTrainingRecord(training, nowIso());
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.training.updated",
      orgId: org.id,
      message: `Updated training "${training.name}" for ${org.name}.`,
      metadata: {
        trainingId: training.id,
        status: training.status,
        fields: Object.keys(patch ?? {}).slice(0, 25),
      },
    });

    response.json(buildOrgTrainingSummaryForResponse(db, org.id, training.id));
  });
});

app.delete("/orgs/:orgId/trainings/:trainingId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingId = request.params.trainingId?.trim();

  if (!trainingId) {
    response.status(400).json({ error: "trainingId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    await ensureOrgTrainingWorkspace(db, org);
    const training = findOrgTrainingRecord(db, org.id, trainingId);
    if (!training) {
      response.status(404).json({ error: "Training not found." });
      return;
    }
    const attachedTrainingPackCount = db.orgTrainingPackAttachments.filter(
      (entry) => entry.orgId === org.id && entry.trainingId === training.id
    ).length;
    const attachedScenarioCount = db.orgTrainingScenarioAttachments.filter(
      (entry) => entry.orgId === org.id && entry.trainingId === training.id
    ).length;
    if (attachedTrainingPackCount > 0 || attachedScenarioCount > 0) {
      response.status(400).json({
        error: "Remove or delete the training's packs and custom scenarios before deleting the training.",
      });
      return;
    }

    db.orgTrainings = db.orgTrainings.filter((entry) => !(entry.orgId === org.id && entry.id === trainingId));
    db.orgTrainingPackAttachments = db.orgTrainingPackAttachments.filter(
      (entry) => !(entry.orgId === org.id && entry.trainingId === trainingId)
    );
    db.orgTrainingScenarioAttachments = db.orgTrainingScenarioAttachments.filter(
      (entry) => !(entry.orgId === org.id && entry.trainingId === trainingId)
    );
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.training.deleted",
      orgId: org.id,
      message: `Deleted training "${training.name}" from ${org.name}.`,
      metadata: {
        trainingId: training.id,
      },
    });

    response.json({ deleted: true, trainingId: training.id });
  });
});

app.put("/orgs/:orgId/trainings/:trainingId/training-packs", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const trainingId = request.params.trainingId?.trim();
  const body = request.body as SetOrgTrainingPackAttachmentsRequest;

  if (!trainingId) {
    response.status(400).json({ error: "trainingId is required." });
    return;
  }
  if (!Array.isArray(body.trainingPackIds)) {
    response.status(400).json({ error: "trainingPackIds must be a string array." });
    return;
  }

  await withDatabase(async (db) => {
    const org = getOrgById(db, orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    await ensureOrgTrainingWorkspace(db, org);
    const training = findOrgTrainingRecord(db, org.id, trainingId);
    if (!training) {
      response.status(404).json({ error: "Training not found." });
      return;
    }

    let packs: TrainingPack[] = [];
    try {
      packs = await trainingPackStore.listTrainingPacksForOrg(org.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load training packs.";
      response.status(503).json({ error: message });
      return;
    }
    const requestedPackIds = Array.from(
      new Set(
        body.trainingPackIds
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
    const validPackIds = new Set(packs.map((pack) => pack.id));
    const invalidPackId = requestedPackIds.find((packId) => !validPackIds.has(packId));
    if (invalidPackId) {
      response.status(400).json({ error: `Training pack ${invalidPackId} is not available for this account.` });
      return;
    }

    replaceOrgTrainingPackAttachments({
      db,
      orgId: org.id,
      trainingId: training.id,
      trainingPackIds: requestedPackIds,
      now: nowIso(),
      createAttachmentId: createOrgTrainingPackAttachmentId,
    });
    touchOrgTrainingRecord(training, nowIso());
    emitMobileUpdateForOrg(db, org.id, "org");
    appendPlatformAuditEvent(db, {
      action: "org.training.pack_attachments.updated",
      orgId: org.id,
      message: `Updated attached training packs for "${training.name}" in ${org.name}.`,
      metadata: {
        trainingId: training.id,
        attachedTrainingPackCount: requestedPackIds.length,
      },
    });

    response.json(
      buildOrgTrainingSummaryForResponse(db, org.id, training.id, {
        validTrainingPackIds: validPackIds,
      })
    );
  });
});

app.put(
  "/orgs/:orgId/trainings/:trainingId/custom-scenarios",
  requireAdmin,
  async (request: Request, response: Response) => {
    const orgId = request.params.orgId;
    const trainingId = request.params.trainingId?.trim();
    const body = request.body as SetOrgTrainingScenarioAttachmentsRequest;

    if (!trainingId) {
      response.status(400).json({ error: "trainingId is required." });
      return;
    }
    if (!Array.isArray(body.scenarioIds)) {
      response.status(400).json({ error: "scenarioIds must be a string array." });
      return;
    }

    await withDatabase(async (db) => {
      const org = getOrgById(db, orgId);
      if (!org) {
        response.status(404).json({ error: "Organization not found." });
        return;
      }

      await ensureOrgTrainingWorkspace(db, org);
      const training = findOrgTrainingRecord(db, org.id, trainingId);
      if (!training) {
        response.status(404).json({ error: "Training not found." });
        return;
      }

      const scenarios = ensureOrgCustomScenarioCollection(org);
      const requestedScenarioIds = Array.from(
        new Set(
          body.scenarioIds
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      );
      const validScenarioIds = new Set(scenarios.map((scenario) => scenario.id));
      const invalidScenarioId = requestedScenarioIds.find((scenarioId) => !validScenarioIds.has(scenarioId));
      if (invalidScenarioId) {
        response.status(400).json({ error: `Custom scenario ${invalidScenarioId} is not available for this account.` });
        return;
      }

      replaceOrgTrainingScenarioAttachments({
        db,
        orgId: org.id,
        trainingId: training.id,
        scenarioIds: requestedScenarioIds,
        now: nowIso(),
        createAttachmentId: createOrgTrainingScenarioAttachmentId,
      });
      touchOrgTrainingRecord(training, nowIso());
      emitMobileUpdateForOrg(db, org.id, "org");
      appendPlatformAuditEvent(db, {
        action: "org.training.scenario_attachments.updated",
        orgId: org.id,
        message: `Updated attached custom scenarios for "${training.name}" in ${org.name}.`,
        metadata: {
          trainingId: training.id,
          attachedScenarioCount: requestedScenarioIds.length,
        },
      });

      response.json(
        buildOrgTrainingSummaryForResponse(db, org.id, training.id, {
          validScenarioIds,
        })
      );
    });
  }
);

app.get("/orgs/:orgId/dashboard", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabaseRead(async (db) => {
    const org = db.orgs.find((entry) => entry.id === orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }
    const normalizedOrg = ensureOrgContractFields(org);

    const now = new Date();
    const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(normalizedOrg, now), now);
    const periodStartMs = new Date(billing.periodStartAt).getTime();
    const periodEndMs = new Date(billing.periodEndAt).getTime();
    const usageSnapshot = buildOrgUsageSnapshot(db, normalizedOrg, now);
    const effectiveOrgPerUserDailySecondsCap = resolveEffectiveOrgPerUserDailySecondsCap(normalizedOrg, now);

    const orgUsers = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === normalizedOrg.id)
      .sort((a, b) => a.email.localeCompare(b.email));

    const sessionsForOrg = listUsageSessions(db, { orgId: normalizedOrg.id });

    const users = orgUsers.map((user) => {
      const sessionsInPeriod = sessionsForOrg.filter((session) => {
        if (session.userId !== user.id) {
          return false;
        }

        const startedAtMs = new Date(session.startedAt).getTime();
        if (Number.isNaN(startedAtMs)) {
          return false;
        }

        return startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
      });

      const rawSecondsThisPeriod = sumRawSeconds(sessionsInPeriod);
      const billedSecondsThisPeriod = sessionsInPeriod.reduce(
        (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
        0
      );

      const dailyOverage = resolveUserDailyOverageAllowance(db, user, now);

      return {
        userId: user.id,
        email: user.email,
        status: user.status,
        orgRole: user.orgRole,
        divisionId: user.divisionId ?? null,
        dashboardAccessEnabled: user.dashboardAccessEnabled === true,
        dailySecondsCapOverride: user.dailySecondsCapOverride,
        effectiveDailySecondsCap:
          (user.dailySecondsCapOverride ?? effectiveOrgPerUserDailySecondsCap) + user.manualBonusSeconds,
        allowDailyOverageThisCycle: dailyOverage.active,
        dailyOverageExpiresAt: dailyOverage.expiresAt,
        dailyOverageMode: dailyOverage.mode,
        dailyOverageExtraSecondsGranted: dailyOverage.extraSecondsGranted,
        dailyOverageExtraSecondsConsumed: dailyOverage.extraSecondsConsumed,
        dailyOverageExtraSecondsRemaining: dailyOverage.extraSecondsRemaining,
        rawSecondsThisPeriod,
        billedSecondsThisPeriod
      };
    });

    const daysInBillingPeriod = Math.max(1, Math.round((periodEndMs - periodStartMs) / (24 * 60 * 60 * 1000)));
    const activeUsers = users.filter((entry) => entry.status === "active");
    const projectedAllocatedUserSecondsThisPeriod = activeUsers.reduce(
      (total, entry) => total + Math.max(0, entry.effectiveDailySecondsCap) * daysInBillingPeriod,
      0
    );
    const projectedAllocatedUserMinutesThisPeriod = projectedAllocatedUserSecondsThisPeriod / 60;
    const monthlyAllottedSeconds = usageSnapshot.allottedSeconds;
    const projectedAllocatedUtilizationPercent =
      monthlyAllottedSeconds > 0 ? (projectedAllocatedUserSecondsThisPeriod / monthlyAllottedSeconds) * 100 : 0;

    response.json({
      generatedAt: now.toISOString(),
      org: normalizedOrg,
      billingPeriod: {
        periodStartAt: billing.periodStartAt,
        periodEndAt: billing.periodEndAt,
        nextRenewalAt: billing.nextRenewalAt
      },
      usage: {
        usedSecondsThisPeriod: usageSnapshot.usedSeconds,
        allottedSecondsThisPeriod: usageSnapshot.allottedSeconds,
        remainingSecondsThisPeriod: Math.max(0, usageSnapshot.allottedSeconds - usageSnapshot.usedSeconds),
        usagePercentThisPeriod: usageSnapshot.usagePercent,
        activeUserCount: activeUsers.length,
        projectedAllocatedUserSecondsThisPeriod,
        projectedAllocatedUserMinutesThisPeriod,
        projectedAllocatedUtilizationPercent
      },
      users
    });
  });
});

app.get("/orgs/:orgId/usage-billing", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabase(async (db) => {
    const org = db.orgs.find((entry) => entry.id === orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const normalized = ensureOrgContractFields(org);
    Object.assign(org, normalized);

    const now = new Date();
    const usage = buildOrgUsageSnapshot(db, org, now);
    const orgAdmins = getOrgAdmins(db, org.id);
    const orgAdminEmails = orgAdmins.map((entry) => entry.email);
    const thresholds = normalizeSoftLimitPercentTriggers(org.softLimitPercentTriggers);
    const softLimits = [];
    for (const thresholdPercent of thresholds) {
      const reached = usage.usagePercent >= thresholdPercent;
      const notifiedAt = reached
        ? await ensureSoftLimitNotificationAudit(db, org, thresholdPercent, usage, orgAdminEmails)
        : await findSoftLimitNotificationAudit(db, org.id, thresholdPercent, usage.periodStartAt);

      softLimits.push({
        thresholdPercent,
        reached,
        notifiedAt
      });
    }

    const payload: OrgUsageBillingResponse = {
      generatedAt: now.toISOString(),
      org,
      orgAdmins,
      billingPeriod: {
        periodStartAt: usage.periodStartAt,
        periodEndAt: usage.periodEndAt,
        nextRenewalAt: usage.nextRenewalAt
      },
      usage: {
        usedSeconds: usage.usedSeconds,
        usedMinutes: Math.round(usage.usedMinutes * 10) / 10,
        allottedMinutes: usage.allottedMinutes,
        allottedSeconds: usage.allottedSeconds,
        remainingMinutes: Math.round(usage.remainingMinutes * 10) / 10,
        usagePercent: Math.round(usage.usagePercent * 10) / 10
      },
      softLimits,
      requestPolicy: {
        maxTriggersAllowed: 2,
        selectedTriggers: thresholds.length
      }
    };

    response.json(payload);
  });
});

app.get("/orgs/accounts-export", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    const now = new Date();

    const rows: OrgAccountsExportRow[] = db.orgs
      .map((org) => ensureOrgContractFields(org))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((org) => {
        const usage = buildOrgUsageSnapshot(db, org, now);
        const orgAdmins = getOrgAdmins(db, org.id)
          .map((entry) => entry.email)
          .join("; ");
        const activeSegments = getActiveIndustryLabelsForOrg(org, db.config).join(", ");
        return {
          orgId: org.id,
          companyName: org.name,
          dateEstablished: org.createdAt,
          contractSignedAt: org.contractSignedAt,
          nextRenewalAt: usage.nextRenewalAt,
          companyContact: org.contactName,
          contactEmail: org.contactEmail,
          orgAdmins,
          activeSegments,
          currentUsageMinutes: Math.round(usage.usedMinutes * 10) / 10,
          monthlyAllotmentMinutes: org.monthlyMinutesAllotted,
          renewalTotalUsd: Math.round(org.renewalTotalUsd * 100) / 100
        };
      });

    const payload: OrgAccountsExportResponse = {
      generatedAt: now.toISOString(),
      rows
    };
    response.json(payload);
  });
});

app.get("/admin/settings/superusers", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    const rows: SuperUserSummary[] = db.users
      .filter((user) => user.isSuperUser === true)
      .slice()
      .sort((left, right) => left.email.localeCompare(right.email))
      .map((user) => ({
        userId: user.id,
        email: user.email,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));

    const payload: SuperUserListResponse = {
      generatedAt: nowIso(),
      rows,
    };
    response.json(payload);
  });
});

app.post("/admin/settings/superusers", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as CreateSuperUserRequest;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }

  await withDatabase(async (db) => {
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      if (existing.accountType === "enterprise") {
        response.status(409).json({
          error: "A user with this email address already exists in an enterprise account.",
        });
        return;
      }

      if (existing.isSuperUser === true) {
        response.status(409).json({ error: "This super user already exists." });
        return;
      }

      response.status(409).json({ error: "Email already exists." });
      return;
    }

    const now = nowIso();
    const user: UserProfile = {
      id: `usr_${uuid()}`,
      email,
      firstName: null,
      lastName: null,
      employeeId: null,
      managerUserId: null,
      emailVerifiedAt: null,
      isPlatformAdmin: false,
      isSuperUser: true,
      dashboardAccessEnabled: false,
      mobileProfileReonboardingRequired: false,
      accountType: "individual",
      tier: "free",
      status: "active",
      orgId: null,
      orgRole: "user",
      timezone: "UTC",
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      dailySecondsCapOverride: null,
      allowDailyOverageThisCycle: false,
      dailyOverageExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };

    db.users.push(user);
    appendPlatformAuditEvent(db, {
      action: "settings.super_user.created",
      userId: user.id,
      message: `Created super user ${user.email}.`,
      metadata: {
        email: user.email,
      },
    });

    const payload: SuperUserSummary = {
      userId: user.id,
      email: user.email,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    response.status(201).json(payload);
  });
});

app.delete("/admin/settings/superusers/:userId", requireAdmin, async (request: Request, response: Response) => {
  const userId = request.params.userId?.trim();
  if (!userId) {
    response.status(400).json({ error: "userId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user || user.isSuperUser !== true) {
      response.status(404).json({ error: "Super user not found." });
      return;
    }

    revokeMobileAccessForUser(db, user.id, "Super user access was removed.");
    db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
    db.emailVerifications = db.emailVerifications.filter((record) => record.userId !== user.id);
    db.users = db.users.filter((entry) => entry.id !== user.id);
    queueDatabasePostCommitEffect(db, {
      category: "security_cleanup",
      description: `Revoke dashboard sessions for removed super user ${user.id}.`,
      run: async () => {
        await revokeWebAuthSessionsForUserId(user.id);
      }
    });

    appendPlatformAuditEvent(db, {
      action: "settings.super_user.deleted",
      userId: user.id,
      message: `Removed super user ${user.email}.`,
      metadata: {
        email: user.email,
      },
    });

    response.json({
      deleted: true,
      userId: user.id,
      email: user.email,
    });
  });
});

app.get("/users", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    response.json(db.users);
  });
});

app.get("/users/:userId", requireAdmin, async (request: Request, response: Response) => {
  await withDatabaseRead(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    response.json(user);
  });
});

app.post("/users", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as CreateUserRequest;
  const email = body.email?.trim().toLowerCase();

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }

  if (!isTierId(body.tier)) {
    response.status(400).json({ error: "Valid tier is required." });
    return;
  }

  if (!isAccountType(body.accountType)) {
    response.status(400).json({ error: "Valid account type is required." });
    return;
  }

  const timezone = resolveTimeZone(body.timezone);

  await withDatabase(async (db) => {
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      response.status(409).json({ error: "Email already exists." });
      return;
    }

    const orgId = body.accountType === "enterprise" ? body.orgId ?? null : null;
    if (body.accountType === "enterprise") {
      if (!orgId) {
        response.status(400).json({ error: "Enterprise users require an organization." });
        return;
      }

      const org = getOrgById(db, orgId);
      if (!org || org.status !== "active") {
        response.status(400).json({ error: "Enterprise users must belong to an active organization." });
        return;
      }
    }

    const employeeIdResult =
      body.accountType === "enterprise" ? normalizeEmployeeIdInput(body.employeeId) : { ok: true as const, value: null };
    if (!employeeIdResult.ok) {
      response.status(400).json({ error: employeeIdResult.error, code: employeeIdResult.code });
      return;
    }
    const employeeIdConflict = findEmployeeIdConflict({
      users: db.users,
      orgId,
      employeeId: employeeIdResult.value,
    });
    if (employeeIdConflict) {
      response.status(409).json({
        error: "Employee ID is already assigned within this organization.",
        code: employeeIdConflict.code,
      });
      return;
    }

    const now = nowIso();
    const user: UserProfile = {
      id: `usr_${uuid()}`,
      email,
      firstName: null,
      lastName: null,
      employeeId: employeeIdResult.value,
      managerUserId: null,
      emailVerifiedAt: now,
      isPlatformAdmin: body.isPlatformAdmin === true,
      dashboardAccessEnabled: body.accountType === "enterprise" && body.dashboardAccessEnabled === true,
      mobileProfileReonboardingRequired: false,
      accountType: body.accountType,
      tier: body.tier,
      status: "active",
      orgId,
      orgRole: body.accountType === "enterprise" ? normalizeOrgUserRole(body.orgRole) : "user",
      divisionId: null,
      timezone,
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      dailySecondsCapOverride: null,
      allowDailyOverageThisCycle: false,
      dailyOverageExpiresAt: null,
      createdAt: now,
      updatedAt: now
    };

    db.users.push(user);
    appendPlatformAuditEvent(db, {
      action: "user.created",
      orgId: user.orgId,
      userId: user.id,
      message: `Created user ${user.email}.`,
      metadata: {
        email: user.email,
        employeeIdPresent: Boolean(user.employeeId),
        dashboardAccessEnabled: user.dashboardAccessEnabled === true,
        accountType: user.accountType,
        tier: user.tier,
        orgRole: user.orgRole
      }
    });
    response.status(201).json(user);
  });
});

app.patch("/users/:userId", requireAdmin, async (request: Request, response: Response) => {
  const userId = request.params.userId;
  const patch = request.body as UpdateUserRequest;

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const beforeDashboardViewer = resolveDashboardViewer(db, user);
    const beforeEmployeeId = user.employeeId ?? null;
    const before = {
      email: user.email,
      employeeIdPresent: Boolean(beforeEmployeeId),
      isPlatformAdmin: user.isPlatformAdmin === true,
      dashboardAccessEnabled: user.dashboardAccessEnabled === true,
      tier: user.tier,
      accountType: user.accountType,
      status: user.status,
      orgId: user.orgId,
      orgRole: user.orgRole,
      divisionId: user.divisionId ?? null,
      manualBonusSeconds: user.manualBonusSeconds,
      dailySecondsCapOverride: user.dailySecondsCapOverride,
      allowDailyOverageThisCycle: user.allowDailyOverageThisCycle,
      dailyOverageExpiresAt: user.dailyOverageExpiresAt,
      dailyOverageMode: user.dailyOverageMode ?? null,
      dailyOverageStartedAt: user.dailyOverageStartedAt ?? null,
      dailyOverageBaseSecondsCap: user.dailyOverageBaseSecondsCap ?? null,
      dailyOverageExtraSecondsGranted: user.dailyOverageExtraSecondsGranted ?? null,
      timezone: user.timezone
    };
    const now = new Date();
    materializeUserTimezone(user, now);
    let emailChanged = false;
    let revokeDashboardSessions = false;

    if (typeof patch.email === "string") {
      const email = patch.email.trim().toLowerCase();
      if (!isEmailLike(email)) {
        response.status(400).json({ error: "Invalid email format." });
        return;
      }

      const duplicate = db.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.id !== user.id);
      if (duplicate) {
        response.status(409).json({ error: "Email already exists." });
        return;
      }

      if (email !== user.email) {
        user.email = email;
        user.emailVerifiedAt = null;
        revokeDashboardSessions = true;
        db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
        db.emailVerifications = db.emailVerifications.filter((record) => record.userId !== user.id);
        emailChanged = true;
      }
    }

    if (patch.tier) {
      if (!isTierId(patch.tier)) {
        response.status(400).json({ error: "Invalid tier." });
        return;
      }

      user.tier = patch.tier;
    }

    if (patch.isPlatformAdmin !== undefined) {
      user.isPlatformAdmin = patch.isPlatformAdmin === true;
    }

    if (patch.dashboardAccessEnabled !== undefined) {
      user.dashboardAccessEnabled = patch.dashboardAccessEnabled === true;
    }

    let nextAccountType = user.accountType;
    if (patch.accountType) {
      if (!isAccountType(patch.accountType)) {
        response.status(400).json({ error: "Invalid account type." });
        return;
      }

      nextAccountType = patch.accountType;
    }

    if (patch.status) {
      if (!isUserStatus(patch.status)) {
        response.status(400).json({ error: "Invalid status." });
        return;
      }

      user.status = patch.status;
      if (user.status !== "active") {
        revokeDashboardSessions = true;
        revokeMobileAccessForUser(db, user.id, "User access was disabled.");
      }
    }

    let nextOrgId = patch.orgId !== undefined ? patch.orgId : user.orgId;
    if (patch.employeeId !== undefined && patch.orgId !== undefined && patch.orgId !== user.orgId) {
      response.status(400).json({ error: "Employee ID updates cannot change the user's organization." });
      return;
    }
    if (nextAccountType === "enterprise") {
      if (!nextOrgId) {
        response.status(400).json({ error: "Enterprise users require an organization." });
        return;
      }

      const org = getOrgById(db, nextOrgId);
      if (!org || org.status !== "active") {
        response.status(400).json({ error: "Enterprise users must belong to an active organization." });
        return;
      }
    } else {
      nextOrgId = null;
    }

    const employeeIdPatch = patch.employeeId !== undefined
      ? normalizeEmployeeIdInput(patch.employeeId)
      : { ok: true as const, value: user.employeeId ?? null };
    if (!employeeIdPatch.ok) {
      response.status(400).json({ error: employeeIdPatch.error, code: employeeIdPatch.code });
      return;
    }
    if (nextAccountType !== "enterprise" && employeeIdPatch.value) {
      response.status(400).json({ error: "Employee ID applies only to enterprise users." });
      return;
    }
    const employeeIdConflict = findEmployeeIdConflict({
      users: db.users,
      orgId: nextOrgId,
      employeeId: employeeIdPatch.value,
      exceptUserId: user.id,
    });
    if (employeeIdConflict) {
      response.status(409).json({
        error: "Employee ID is already assigned within this organization.",
        code: employeeIdConflict.code,
      });
      return;
    }

    user.accountType = nextAccountType;
    user.orgId = nextOrgId;
    user.employeeId = nextAccountType === "enterprise" ? employeeIdPatch.value : null;

    if (nextAccountType === "enterprise") {
      if (patch.orgRole !== undefined) {
        user.orgRole = normalizeOrgUserRole(patch.orgRole);
      } else {
        user.orgRole = normalizeOrgUserRole(user.orgRole);
      }
    } else {
      user.orgRole = "user";
      user.divisionId = null;
      user.managerUserId = null;
      user.dashboardAccessEnabled = false;
      user.dailySecondsCapOverride = null;
      user.allowDailyOverageThisCycle = false;
      user.dailyOverageExpiresAt = null;
      user.dailyOverageMode = null;
      user.dailyOverageStartedAt = null;
      user.dailyOverageBaseSecondsCap = null;
      user.dailyOverageExtraSecondsGranted = null;
    }

    if (user.accountType === "enterprise" && user.orgId) {
      if (!canManagerAssignmentTargetBeManaged(user)) {
        user.managerUserId = null;
      } else {
        const orgUsers = db.users.filter((entry) => entry.accountType === "enterprise" && entry.orgId === user.orgId);
        const managerValidation = validateManagerAssignment({
          orgUsers,
          target: user,
          managerUserId: normalizeManagerUserId(user.managerUserId),
        });
        user.managerUserId = managerValidation.ok ? managerValidation.manager?.id ?? null : null;
      }
    }

    if (user.accountType === "enterprise" && user.orgId) {
      if (patch.divisionId !== undefined) {
        const divisionSelection = resolveDivisionSelectionForOrg(db, user.orgId, patch.divisionId);
        if (!divisionSelection.ok) {
          response.status(400).json({ error: divisionSelection.error });
          return;
        }
        user.divisionId = divisionSelection.divisionId;
      } else if (!isDivisionActive(db, user.orgId, user.divisionId)) {
        user.divisionId = null;
      }
    }

    if (patch.manualBonusSeconds !== undefined) {
      user.manualBonusSeconds = clampNonNegativeInteger(patch.manualBonusSeconds, user.manualBonusSeconds);
    }

    if (patch.dailySecondsCapOverride !== undefined) {
      if (
        patch.dailySecondsCapOverride !== null &&
        (!Number.isSafeInteger(patch.dailySecondsCapOverride) || Number(patch.dailySecondsCapOverride) < 0)
      ) {
        response.status(400).json({ error: "Daily seconds override must be null or a non-negative integer." });
        return;
      }
      user.dailySecondsCapOverride = normalizeOptionalSecondsCap(patch.dailySecondsCapOverride);
    }

    if (patch.allowDailyOverageThisCycle !== undefined) {
      if (user.accountType !== "enterprise" || !user.orgId) {
        response.status(400).json({ error: "Daily overage applies only to enterprise users." });
        return;
      }

      const org = getOrgById(db, user.orgId);
      if (!org || org.status !== "active") {
        response.status(400).json({ error: "Enterprise users must belong to an active organization." });
        return;
      }
      const grant = buildTemporaryDailyOverageGrant({ patch, user, org, now });
      if (!grant.ok) {
        response.status(400).json({ error: grant.error });
        return;
      }
      Object.assign(user, grant.values);
    }

    if (typeof patch.timezone === "string") {
      const timezone = resolveTimeZone(patch.timezone);
      if (timezone !== user.timezone) {
        user.pendingTimezone = timezone;
        user.pendingTimezoneEffectiveAt = computeNextRenewalAt(user.planAnchorAt, now);
      }
    }

    const deactivatedInvalidAssignmentCount = deactivateInvalidTrainingPackAssignmentsForUser({
      assignments: db.trainingPackAssignments ?? [],
      userId: user.id,
      user,
      nowIso: now.toISOString(),
    });

    const afterDashboardViewer = resolveDashboardViewer(db, user);
    const dashboardScopeChanged =
      (beforeDashboardViewer?.accessType ?? null) !== (afterDashboardViewer?.accessType ?? null)
      || (beforeDashboardViewer?.orgId ?? null) !== (afterDashboardViewer?.orgId ?? null);
    if (beforeDashboardViewer && (!afterDashboardViewer || dashboardScopeChanged)) {
      revokeDashboardSessions = true;
      db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
    }
    if (revokeDashboardSessions) {
      queueDatabasePostCommitEffect(db, {
        category: "security_cleanup",
        description: `Revoke dashboard sessions for updated user ${user.id}.`,
        run: async () => {
          await revokeWebAuthSessionsForUserId(user.id);
        }
      });
    }

    user.updatedAt = now.toISOString();
    emitMobileUpdateForUser(db, user.id, "user");
    appendPlatformAuditEvent(db, {
      action: "user.updated",
      orgId: user.orgId,
      userId: user.id,
      message: `Updated user ${user.email}.`,
      metadata: {
        before,
        after: {
          email: user.email,
          isPlatformAdmin: user.isPlatformAdmin === true,
          dashboardAccessEnabled: user.dashboardAccessEnabled === true,
          tier: user.tier,
          accountType: user.accountType,
          status: user.status,
          orgId: user.orgId,
          orgRole: user.orgRole,
          divisionId: user.divisionId ?? null,
          manualBonusSeconds: user.manualBonusSeconds,
          dailySecondsCapOverride: user.dailySecondsCapOverride,
          allowDailyOverageThisCycle: user.allowDailyOverageThisCycle,
          dailyOverageExpiresAt: user.dailyOverageExpiresAt,
          dailyOverageMode: user.dailyOverageMode ?? null,
          dailyOverageStartedAt: user.dailyOverageStartedAt ?? null,
          dailyOverageBaseSecondsCap: user.dailyOverageBaseSecondsCap ?? null,
          dailyOverageExtraSecondsGranted: user.dailyOverageExtraSecondsGranted ?? null,
          employeeIdPresent: Boolean(user.employeeId),
          timezone: user.timezone,
          deactivatedInvalidTrainingPackAssignments: deactivatedInvalidAssignmentCount
        }
      }
    });
    if (beforeEmployeeId !== (user.employeeId ?? null)) {
      appendPlatformAuditEvent(db, {
        action: "user.employee_id.changed",
        orgId: user.orgId,
        userId: user.id,
        message: "Updated Employee ID for user.",
        metadata: {
          employeeIdChanged: true,
          previousEmployeeIdPresent: Boolean(beforeEmployeeId),
          newEmployeeIdPresent: Boolean(user.employeeId)
        }
      });
    }
    response.json(user);
  });
});

app.delete("/users/:userId", requireAdmin, async (request: Request, response: Response) => {
  const userId = request.params.userId;

  await withDatabase(async (db) => {
    const userIndex = db.users.findIndex((entry) => entry.id === userId);
    if (userIndex === -1) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const user = db.users[userIndex];
    const now = nowIso();
    const deactivatedAssignmentCount = deactivateTrainingPackAssignmentsForUser(
      db.trainingPackAssignments ?? [],
      user.id,
      now
    );
    const deletedUsageSessionCount = await usageSessionAccess.deleteForUser(db, user.id);
    const deletedScoreRecordCount = await scoreRecordAccess.deleteForUser(db, user.id);
    const deletedAiUsageEventCount = await aiUsageEventAccess.deleteForUser(user.id);
    const deletedSupportCaseCount = await supportCaseStore.deleteCasesForUser(user.id);

    db.users.splice(userIndex, 1);
    db.mobileAuthTokens = db.mobileAuthTokens.filter((record) => record.userId !== user.id);
    db.emailVerifications = db.emailVerifications.filter((record) => record.userId !== user.id);
    db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
    db.enterpriseJoinRequests = db.enterpriseJoinRequests
      .filter((record) => record.userId !== user.id)
      .map((record) => (record.decidedByUserId === user.id ? { ...record, decidedByUserId: null } : record));
    queueDatabasePostCommitEffect(db, {
      category: "security_cleanup",
      description: `Revoke dashboard sessions for deleted user ${user.id}.`,
      run: async () => {
        await revokeWebAuthSessionsForUserId(user.id);
      }
    });
    queueDatabasePostCommitEffect(db, {
      category: "post_commit_cleanup",
      description: `Delete recognized simulation sessions for removed user ${user.id}.`,
      run: async () => {
        await simulationSessionStore.deleteSessionsForUser(user.id);
      }
    });

    const waiters = mobileUpdateWaitersByUserId.get(user.id);
    if (waiters && waiters.size > 0) {
      for (const waiter of Array.from(waiters)) {
        if (waiter.resolved) {
          continue;
        }
        waiter.resolved = true;
        clearTimeout(waiter.timeoutHandle);
        try {
          waiter.response.status(410).json({ error: "User account deleted." });
        } catch {
          // Ignore disconnected clients.
        }
      }
    }

    mobileUpdateWaitersByUserId.delete(user.id);
    mobileUpdatePayloadByUserId.delete(user.id);
    mobileUpdateCursorByUserId.delete(user.id);
    mobileUpdateReasonByUserId.delete(user.id);

    appendPlatformAuditEvent(db, {
      action: "user.deleted",
      orgId: user.orgId,
      userId: user.id,
      message: `Deleted ${user.accountType} user ${user.email}.`,
      metadata: {
        email: user.email,
        orgRole: user.orgRole,
        accountType: user.accountType,
        deactivatedTrainingPackAssignments: deactivatedAssignmentCount,
        deletedUsageSessions: deletedUsageSessionCount,
        deletedScoreRecords: deletedScoreRecordCount,
        deletedAiUsageEvents: deletedAiUsageEventCount,
        deletedSupportCases: deletedSupportCaseCount
      }
    });

    response.json({
      deleted: true,
      userId: user.id,
      email: user.email
    });
  });
});

app.post(
  "/mobile/onboard",
  mobileOnboardRateLimiter,
  mobileOnboardAccountRateLimiter,
  async (request: Request, response: Response) => {
  const body = request.body as MobileOnboardRequest;
  const email = body.email?.trim().toLowerCase();
  const firstName = normalizeRequiredUserNameInput(body.firstName, "firstName");
  const lastName = normalizeRequiredUserNameInput(body.lastName, "lastName");
  const joinCode = normalizeJoinCode(body.joinCode);

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }
  if (!firstName.ok) {
    response.status(400).json({ error: firstName.error, code: firstName.code });
    return;
  }
  if (!lastName.ok) {
    response.status(400).json({ error: lastName.error, code: lastName.code });
    return;
  }
  const timezone = resolveTimeZone(body.timezone);

  await withDatabase(async (db) => {
    const requestedOrg = joinCode ? findActiveOrgByJoinCode(db, joinCode) : null;
    if (joinCode && !requestedOrg) {
      response.status(404).json({ error: "Company code not found." });
      return;
    }
    const domainMatch = buildDomainMatchForEmail(db, email);
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      if (existing.status !== "active") {
        response.status(403).json({ error: "Your account is deactivated. Contact your organization admin." });
        return;
      }

      if (existing.accountType === "enterprise" && !isSuperUser(existing)) {
        const existingOrg = getOrgById(db, existing.orgId);
        if (!existingOrg || existingOrg.status !== "active") {
          response.status(403).json({ error: "Enterprise account is not active." });
          return;
        }

        if (existing.mobileProfileReonboardingRequired === true && !joinCode) {
          response.status(400).json({ error: "Company code is required to confirm your organization." });
          return;
        }

        if (requestedOrg && existingOrg.id !== requestedOrg.id) {
          response.status(403).json({ error: "Company code does not match your active organization." });
          return;
        }
      }

      const issuedAt = nowIso();
      const verification = await issueEmailVerification(db, existing, new Date(issuedAt), "mobile");
      const authToken = createExistingMobileOnboardingToken({
        purpose: "existing_mobile_onboarding",
        version: 1,
        userId: existing.id,
        email: existing.email.trim().toLowerCase(),
        firstName: firstName.value,
        lastName: lastName.value,
        timezone,
        joinCode,
        expiresAt: verification.expiresAt
      });
      const payload: MobileOnboardResponse = {
        user: existing,
        authToken,
        verificationRequired: true,
        verificationExpiresAt: verification.expiresAt,
        domainMatch
      };
      appendMobileAuditEvent(db, existing, {
        action: "mobile.onboard",
        userId: existing.id,
        message: `Mobile onboarding requested email verification for ${existing.email}.`,
        metadata: {
          verificationRequired: true,
          verificationExpiresAt: verification.expiresAt
        }
      });
      response.json(payload);
      return;
    }

    const now = nowIso();
    const user: UserProfile = {
      id: `usr_${uuid()}`,
      email,
      firstName: null,
      lastName: null,
      employeeId: null,
      managerUserId: null,
      emailVerifiedAt: null,
      mobileProfileReonboardingRequired: false,
      accountType: "individual",
      tier: "free",
      status: "active",
      orgId: null,
      orgRole: "user",
      timezone,
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      dailySecondsCapOverride: null,
      allowDailyOverageThisCycle: false,
      dailyOverageExpiresAt: null,
      createdAt: now,
      updatedAt: now
    };

    db.users.push(user);
    const authToken = upsertMobileAuthToken(db, user.id, now);
    const verification = await issueEmailVerification(db, user, new Date(now), "mobile");
    appendMobileAuditEvent(db, user, {
      action: "mobile.user_created",
      userId: user.id,
      message: `Created user from mobile onboarding (${user.email}).`,
      metadata: {
        verificationExpiresAt: verification.expiresAt,
        companyCodeValidated: Boolean(joinCode),
      }
    });
    const payload: MobileOnboardResponse = {
      user,
      authToken,
      verificationRequired: true,
      verificationExpiresAt: verification.expiresAt,
      domainMatch
    };
    response.status(201).json(payload);
  });
});

app.post("/mobile/onboard/resend-verification", mobileVerificationRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const body = request.body as MobileResendVerificationRequest;
  const userId = body.userId?.trim();
  if (!userId) {
    response.status(400).json({ error: "userId is required." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const now = new Date();
    const onboardingToken = isExistingMobileOnboardingTokenForUser(authToken, user, now);
    if (!onboardingToken && !hasValidMobileTokenForUser(db, user.id, authToken, {
      allowReonboardingToken: true,
      allowIncompleteProfile: true,
    })) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (user.status !== "active") {
      response.status(403).json({ error: "This account has been deactivated." });
      return;
    }

    if (!onboardingToken && user.emailVerifiedAt && user.mobileProfileReonboardingRequired !== true) {
      response.status(409).json({ error: "Email already verified." });
      return;
    }

    const verification = await issueEmailVerification(db, user, now, "mobile");
    appendMobileAuditEvent(db, user, {
      action: "mobile.verification_resent",
      userId: user.id,
      message: `Resent verification code to ${user.email}.`,
      metadata: {
        verificationExpiresAt: verification.expiresAt
      }
    });
    response.json({
      ok: true,
      verificationExpiresAt: verification.expiresAt
    });
  });
});

app.post("/mobile/onboard/verify-email", mobileVerificationRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const body = request.body as MobileVerifyEmailRequest;
  const userId = body.userId?.trim();
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!userId || !code) {
    response.status(400).json({ error: "userId and code are required." });
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    response.status(400).json({ error: "Enter the 6-digit email verification code (numbers only)." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (
      APP_REVIEW_CREDENTIAL
      && normalizeEmailForExactMatch(user.email) === APP_REVIEW_CREDENTIAL.email
      && !consumeRateLimit(mobileReviewerVerificationRateLimitOptions, request, response, user.id)
    ) {
      return;
    }

    const now = new Date();
    const onboardingToken = isExistingMobileOnboardingTokenForUser(authToken, user, now);
    if (!onboardingToken && !hasValidMobileTokenForUser(db, user.id, authToken, {
      allowReonboardingToken: true,
      allowIncompleteProfile: true,
    })) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const needsCodeVerification = Boolean(onboardingToken) || !user.emailVerifiedAt || user.mobileProfileReonboardingRequired === true;
    const profileProvided =
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.joinCode !== undefined;

    if (!needsCodeVerification && !profileProvided && hasCompleteUserName(user)) {
      const payload: MobileOnboardResponse = {
        user,
        authToken,
        verificationRequired: false,
        verificationExpiresAt: null,
        domainMatch: buildDomainMatchForEmail(db, user.email)
      };
      response.json(payload);
      return;
    }

    const firstName = normalizeRequiredUserNameInput(onboardingToken?.firstName ?? body.firstName, "firstName");
    if (!firstName.ok) {
      response.status(400).json({ error: firstName.error, code: firstName.code });
      return;
    }
    const lastName = normalizeRequiredUserNameInput(onboardingToken?.lastName ?? body.lastName, "lastName");
    if (!lastName.ok) {
      response.status(400).json({ error: lastName.error, code: lastName.code });
      return;
    }
    const joinCode = normalizeJoinCode(onboardingToken?.joinCode ?? body.joinCode);
    const wasReonboarding = user.mobileProfileReonboardingRequired === true;

    if (wasReonboarding && user.accountType === "enterprise" && !isSuperUser(user) && !joinCode) {
      response.status(400).json({ error: "Company code is required to confirm your organization." });
      return;
    }

    if (joinCode) {
      const requestedOrg = findActiveOrgByJoinCode(db, joinCode);
      if (!requestedOrg) {
        response.status(404).json({ error: "Company code not found." });
        return;
      }
      if (user.accountType === "enterprise" && !isSuperUser(user) && user.orgId !== requestedOrg.id) {
        response.status(403).json({ error: "Company code does not match your active organization." });
        return;
      }
    }

    if (needsCodeVerification) {
      const verificationResult = verifyLatestEmailVerification({
        db,
        user,
        code,
        now,
        codeSecret: MOBILE_TOKEN_SECRET,
        appReviewCredential: APP_REVIEW_CREDENTIAL,
      });
      if (verificationResult === "missing") {
        response.status(400).json({ error: "No pending verification code. Please resend verification email." });
        return;
      }
      if (verificationResult === "expired") {
        response.status(400).json({ error: "Verification code expired. Please request a new code." });
        return;
      }
      if (verificationResult === "invalid") {
        response.status(400).json({ error: "Invalid verification code." });
        return;
      }

      const nowIsoValue = now.toISOString();
      user.emailVerifiedAt = nowIsoValue;
      user.updatedAt = nowIsoValue;
      appendMobileAuditEvent(db, user, {
        action: "mobile.email_verified",
        userId: user.id,
        message: `Email verified for ${user.email}.`
      });
    }

    if (onboardingToken) {
      user.timezone = resolveTimeZone(onboardingToken.timezone);
      user.updatedAt = now.toISOString();
    }

    const completion = joinCode
      ? completeMobileCompanyProfile({
          db,
          user,
          firstName: firstName.value,
          lastName: lastName.value,
          joinCode,
          now,
        })
      : completeMobileBasicProfile({
          db,
          user,
          firstName: firstName.value,
          lastName: lastName.value,
          now,
        });
    if (!completion.ok) {
      response.status(completion.status).json({ error: completion.error });
      return;
    }
    appendMobileAuditEvent(db, user, {
      action: wasReonboarding ? "mobile.profile_reonboarding_completed" : "mobile.profile_completed",
      orgId: isMobileCompanyProfileCompletion(completion) ? completion.org.id : user.orgId,
      userId: user.id,
      message: wasReonboarding ? "Completed required mobile profile re-onboarding." : "Completed mobile profile setup.",
      metadata: {
        restoredExistingMember: completion.restoredExistingMember,
        joinRequestCreated: isMobileCompanyProfileCompletion(completion) ? completion.createdRequest : false,
        joinRequestReused: isMobileCompanyProfileCompletion(completion)
          ? Boolean(completion.request && !completion.createdRequest)
          : false,
      }
    });
    if (isMobileCompanyProfileCompletion(completion) && completion.request) {
      appendMobileAuditEvent(db, user, {
        action: completion.createdRequest ? "org_join.request_created" : "org_join.request_reused",
        orgId: completion.org.id,
        userId: user.id,
        message: completion.createdRequest
          ? `Submitted org join request for ${completion.org.name}.`
          : `Existing org join request reused for ${completion.org.name}.`,
        metadata: {
          requestId: completion.request.id
        }
      });
    }

    const responseAuthToken = needsCodeVerification || wasReonboarding
      ? upsertMobileAuthToken(db, user.id, now.toISOString())
      : authToken;
    const payload: MobileOnboardResponse = {
      user,
      authToken: responseAuthToken,
      verificationRequired: false,
      verificationExpiresAt: null,
      domainMatch: buildDomainMatchForEmail(db, user.email)
    };
    response.json(payload);
  });
});

app.get("/mobile/users/:userId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken, {
      allowReonboardingToken: true,
      allowIncompleteProfile: true,
    })) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    materializeUserTimezone(user, new Date());
    response.json(user);
  });
});

app.delete("/mobile/users/:userId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const requestedUserId = (request.params.userId ?? "").trim();
  const outcome = await withIsolatedDatabaseWrite(async (db) => {
    const now = new Date();
    const authenticatedUserId = findAuthenticatedMobileUserId(db, authToken);
    if (!authenticatedUserId) {
      if (hasMatchingAccountDeletionReceipt(db, authToken, requestedUserId, now)) {
        return { status: 200, body: { deleted: true, alreadyDeleted: true } } as const;
      }
      return { status: 401, body: { error: "Invalid mobile token." } } as const;
    }
    if (authenticatedUserId !== requestedUserId) {
      return { status: 403, body: { error: "You can only delete your own account." } } as const;
    }

    const user = getUserById(db, requestedUserId);
    if (!user || !hasValidMobileTokenForUser(db, requestedUserId, authToken, {
      allowReonboardingToken: true,
      allowIncompleteProfile: true,
    })) {
      return { status: 401, body: { error: "Invalid mobile token." } } as const;
    }
    if (mobileAccountDeletionFailureForTest) {
      throw mobileAccountDeletionFailureForTest;
    }

    const tokenHashes = db.mobileAuthTokens
      .filter((record) => record.userId === user.id)
      .map((record) => record.tokenHash);
    const userIdHash = hashDeletedAccountUserId(user.id);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ACCOUNT_DELETION_RECEIPT_TTL_MS).toISOString();

    const deidentifiedUsageSessions = await usageSessionStore.deidentifyRecordsForUser(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deidentifiedSimulationSessions = await simulationSessionStore.deidentifySessionsForUser(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deidentifiedScoreRecords = await scoreRecordStore.deidentifyRecordsForUser(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deidentifiedAiUsageEvents = await aiUsageEventStore.deidentifyEventsForUser(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deletedSupportCases = await supportCaseStore.deleteCasesForUser(user.id);
    const deletedPerformancePlans = await performancePlanStore.deletePlansForUser(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const trainingContentIdentityCleanup = await trainingContentStore.deleteUserAssignmentsAndDeidentifyRecords(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deidentifiedModuleEntitlements = await orgModuleEntitlementStore.deidentifyActor(
      user.id,
      DEIDENTIFIED_ACCOUNT_USER_ID
    );
    const deletedAuditEvents = await auditEventStore.deleteEventsForUser(user.id);
    await revokeWebAuthSessionsForUserId(user.id);

    db.users = db.users
      .filter((entry) => entry.id !== user.id)
      .map((entry) => entry.managerUserId === user.id
        ? { ...entry, managerUserId: null, updatedAt: createdAt }
        : entry);
    db.orgs = db.orgs.map((org) => ({
      ...org,
      customScenarios: (org.customScenarios ?? []).map((scenario) => (
        scenario.createdBy === user.id
          ? { ...scenario, createdBy: DEIDENTIFIED_ACCOUNT_USER_ID }
          : scenario
      )),
    }));
    db.trainingPackAssignments = (db.trainingPackAssignments ?? [])
      .filter((assignment) => assignment.userId !== user.id)
      .map((assignment) => assignment.assignedByUserId === user.id
        ? { ...assignment, assignedByUserId: null, updatedAt: createdAt }
        : assignment);
    db.mobileAuthTokens = db.mobileAuthTokens.filter((record) => record.userId !== user.id);
    db.emailVerifications = db.emailVerifications.filter((record) => record.userId !== user.id);
    db.webAuthChallenges = (db.webAuthChallenges ?? []).filter((record) => record.userId !== user.id);
    if (db.webAuthSessions) {
      db.webAuthSessions = db.webAuthSessions.filter((record) => record.userId !== user.id);
    }
    db.enterpriseJoinRequests = db.enterpriseJoinRequests
      .filter((record) => record.userId !== user.id)
      .map((record) => record.decidedByUserId === user.id
        ? { ...record, decidedByUserId: null, decisionReason: null }
        : record);
    if (db.supportCases) {
      db.supportCases = db.supportCases.filter((record) => record.userId !== user.id);
    }
    if (db.auditEvents) {
      db.auditEvents = db.auditEvents.filter((event) => event.userId !== user.id && event.actorId !== user.id);
    }
    if (db.usageSessions) {
      db.usageSessions = db.usageSessions.map((record) => record.userId === user.id
        ? { ...record, userId: DEIDENTIFIED_ACCOUNT_USER_ID }
        : record);
    }
    if (db.scoreRecords) {
      db.scoreRecords = db.scoreRecords.map((record) => record.userId === user.id
        ? {
            ...record,
            userId: DEIDENTIFIED_ACCOUNT_USER_ID,
            summary: undefined,
            coachingArtifact: null,
            normalizedCoachingThemes: null,
          }
        : record);
    }
    if (db.aiUsageEvents) {
      db.aiUsageEvents = db.aiUsageEvents.map((event) => event.userId === user.id
        ? { ...event, userId: DEIDENTIFIED_ACCOUNT_USER_ID }
        : event);
    }
    db.accountDeletionReceipts = [
      ...(db.accountDeletionReceipts ?? []).filter((receipt) => new Date(receipt.expiresAt).getTime() > now.getTime()),
      ...tokenHashes.map((tokenHash): AccountDeletionReceipt => ({ tokenHash, userIdHash, createdAt, expiresAt })),
    ];

    appendAuditEvent(db, {
      actorType: "system",
      actorId: null,
      action: "mobile.account_deleted",
      orgId: user.orgId,
      userId: null,
      message: "A mobile user account was self-deleted.",
      metadata: {
        deidentifiedUsageSessions,
        deidentifiedSimulationSessions,
        deidentifiedScoreRecords,
        deidentifiedAiUsageEvents,
        deletedSupportCases,
        deletedPerformancePlans,
        trainingContentIdentityCleanup,
        deidentifiedModuleEntitlements,
        deletedAuditEvents,
      },
    });

    return { status: 200, body: { deleted: true, alreadyDeleted: false }, deletedUserId: user.id } as const;
  });

  if ("deletedUserId" in outcome && outcome.deletedUserId) {
    const deletedUserId = outcome.deletedUserId;
    const waiters = mobileUpdateWaitersByUserId.get(deletedUserId);
    if (waiters) {
      for (const waiter of Array.from(waiters)) {
        if (!waiter.resolved) {
          waiter.resolved = true;
          clearTimeout(waiter.timeoutHandle);
          try {
            waiter.response.status(410).json({ error: "User account deleted." });
          } catch {
            // Ignore disconnected clients.
          }
        }
      }
    }
    mobileUpdateWaitersByUserId.delete(deletedUserId);
    mobileUpdatePayloadByUserId.delete(deletedUserId);
    mobileUpdateCursorByUserId.delete(deletedUserId);
    mobileUpdateReasonByUserId.delete(deletedUserId);
  }

  response.status(outcome.status).json(outcome.body);
});

app.get("/mobile/users/:userId/modules", async (request: Request, response: Response) => {
  try {
    const result = await withMobileTrainingContentContext(request, response, (context) =>
      trainingContentMobileService.getModules(context)
    );
    if (result) {
      response.json(result);
    }
  } catch (error) {
    respondWithTrainingContentMobileError(error, response);
  }
});

app.get(
  "/mobile/users/:userId/training-content/categories",
  async (request: Request, response: Response) => {
    try {
      const result = await withMobileTrainingContentContext(request, response, (context) =>
        trainingContentMobileService.getCategories(context)
      );
      if (result) {
        response.json(result);
      }
    } catch (error) {
      respondWithTrainingContentMobileError(error, response);
    }
  }
);

app.get(
  "/mobile/users/:userId/training-content",
  async (request: Request, response: Response) => {
    try {
      const result = await withMobileTrainingContentContext(request, response, (context) =>
        trainingContentMobileService.getLibrary(context)
      );
      if (result) {
        response.json(result);
      }
    } catch (error) {
      respondWithTrainingContentMobileError(error, response);
    }
  }
);

app.get(
  "/mobile/users/:userId/scenarios/:scenarioId/training-content",
  async (request: Request, response: Response) => {
    try {
      const trainingId = typeof request.query.trainingId === "string"
        ? request.query.trainingId
        : null;
      const result = await withMobileTrainingContentContext(request, response, (context) =>
        trainingContentMobileService.getRelatedForScenario(
          context,
          request.params.scenarioId,
          trainingId
        )
      );
      if (result) {
        response.json(result);
      }
    } catch (error) {
      respondWithTrainingContentMobileError(error, response);
    }
  }
);

app.get(
  "/mobile/users/:userId/training-content/:contentId",
  async (request: Request, response: Response) => {
    try {
      const result = await withMobileTrainingContentContext(request, response, (context) =>
        trainingContentMobileService.getDetail(context, request.params.contentId)
      );
      if (result) {
        response.json(result);
      }
    } catch (error) {
      respondWithTrainingContentMobileError(error, response);
    }
  }
);

app.post(
  "/mobile/users/:userId/training-content/:contentId/asset-access",
  trainingContentStorageRateLimiter,
  async (request: Request, response: Response) => {
    try {
      const result = await withMobileTrainingContentContext(request, response, (context) =>
        trainingContentMobileService.createAssetAccess(
          context,
          request.params.contentId
        )
      );
      if (result) {
        response.json(result);
      }
    } catch (error) {
      respondWithTrainingContentMobileError(error, response);
    }
  }
);

app.get("/mobile/users/:userId/superuser/orgs", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabaseRead(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (!isSuperUser(user)) {
      response.status(403).json({ error: "Super user access is required." });
      return;
    }

    const payload: SuperUserOrgOptionsResponse = {
      generatedAt: nowIso(),
      orgs: db.orgs
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((org) => ({
          orgId: org.id,
          orgName: org.name,
          orgStatus: org.status,
        })),
    };
    response.json(payload);
  });
});

app.get("/mobile/users/:userId/config", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }

    if (accessContext.actingOrg) {
      await ensureOrgTrainingWorkspace(db, accessContext.actingOrg);
    }

    response.json(resolveConfigForUser(db, user, accessContext.actingOrgId));
  });
});

app.get("/mobile/users/:userId/org-access-requests", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    expireOrgJoinRequests(db, new Date());
    const orgById = new Map(db.orgs.map((org) => [org.id, org]));
    const requests = db.enterpriseJoinRequests
      .filter((row) => row.userId === user.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((row) => ({
        id: row.id,
        status: row.status,
        email: row.email,
        emailDomain: row.emailDomain,
        orgId: row.orgId,
        orgName: orgById.get(row.orgId)?.name ?? row.orgNameSnapshot,
        joinCodeHint: row.joinCodeSnapshot.slice(0, 2) + "****",
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt,
        decisionReason: row.decisionReason
      }));

    response.json({
      generatedAt: nowIso(),
      requests
    });
  });
});

app.post("/mobile/users/:userId/org-access-requests", mobileOrgJoinRequestRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const body = request.body as MobileSubmitOrgJoinRequest;
  const joinCode = normalizeJoinCode(body.joinCode);
  if (!joinCode) {
    response.status(400).json({ error: "Join code is required." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (user.status !== "active") {
      response.status(403).json({ error: "Your account is deactivated. Contact your organization admin." });
      return;
    }

    if (!user.emailVerifiedAt) {
      response.status(403).json({ error: "Verify your email before requesting enterprise access." });
      return;
    }

    const org = findActiveOrgByJoinCode(db, joinCode);
    if (!org) {
      response.status(404).json({ error: "Join code not found." });
      return;
    }

    if (user.accountType === "enterprise" && user.orgId === org.id) {
      response.status(409).json({ error: "You are already a member of this organization." });
      return;
    }
    if (user.accountType === "enterprise") {
      response.status(403).json({ error: "Company code does not match your active organization." });
      return;
    }

    const requestResult = createOrReusePendingOrgJoinRequest({
      db,
      user,
      org,
      now: new Date(),
    });
    const record = requestResult.request;
    appendMobileAuditEvent(db, user, {
      action: requestResult.created ? "org_join.request_created" : "org_join.request_reused",
      orgId: org.id,
      userId: user.id,
      message: requestResult.created
        ? `Submitted org join request for ${org.name}.`
        : `Existing org join request reused for ${org.name}.`,
      metadata: {
        requestId: record.id
      }
    });

    response.status(requestResult.created ? 201 : 200).json({
      created: requestResult.created,
      request: {
        id: record.id,
        status: record.status,
        orgId: record.orgId,
        orgName: org.name,
        emailDomain: record.emailDomain,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        updatedAt: record.updatedAt
      }
    });
  });
});

app.get("/mobile/users/:userId/admin/org/access-requests", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const actor = getUserById(db, request.params.userId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise access required." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    expireOrgJoinRequests(db, new Date());
    const requests = db.enterpriseJoinRequests
      .filter((row) => row.orgId === org.id)
      .slice()
      .sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") {
          return -1;
        }
        if (a.status !== "pending" && b.status === "pending") {
          return 1;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .map((row) => ({
        id: row.id,
        status: row.status,
        userId: row.userId,
        email: row.email,
        emailDomain: row.emailDomain,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt,
        decisionReason: row.decisionReason
      }));

    response.json({
      generatedAt: nowIso(),
      org: {
        id: org.id,
        name: org.name,
        emailDomain: org.emailDomain,
        joinCode: org.joinCode
      },
      requests
    });
  });
});

app.patch("/mobile/users/:userId/admin/org/access-requests/:requestId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const body = request.body as { action?: "approve" | "reject"; reason?: string };
  if (body.action !== "approve" && body.action !== "reject") {
    response.status(400).json({ error: "action must be approve or reject." });
    return;
  }
  const action = body.action;

  await withDatabase(async (db) => {
    const actor = getUserById(db, request.params.userId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise access required." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    expireOrgJoinRequests(db, new Date());
    const decision = decideEnterpriseJoinRequest({
      db,
      actor,
      org,
      requestId: request.params.requestId,
      action,
      reason: body.reason,
      channel: "mobile",
    });
    if (!decision.ok) {
      response.status(decision.status).json({ error: decision.error });
      return;
    }

    response.json({
      ok: true,
      request: {
        id: decision.requestRecord.id,
        status: decision.requestRecord.status,
        userId: decision.requestRecord.userId,
        email: decision.requestRecord.email,
        orgId: decision.requestRecord.orgId,
        createdAt: decision.requestRecord.createdAt,
        expiresAt: decision.requestRecord.expiresAt,
        updatedAt: decision.requestRecord.updatedAt,
        decidedAt: decision.requestRecord.decidedAt,
        decisionReason: decision.requestRecord.decisionReason
      }
    });
  });
});

app.post("/mobile/users/:userId/support/cases", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as {
    message?: unknown;
    includeTranscript?: unknown;
    transcript?: unknown;
    source?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    response.status(400).json({ error: "Feedback message is required." });
    return;
  }

  const includeTranscript = Boolean(body.includeTranscript);
  const requestedSource = normalizeSupportCaseOrigin(body.source);
  const transcriptCandidate = body.transcript as
    | {
        text?: unknown;
        fileName?: unknown;
        meta?: unknown;
      }
    | undefined;

  const transcriptText =
    includeTranscript && typeof transcriptCandidate?.text === "string"
      ? transcriptCandidate.text.trim()
      : "";

  if (includeTranscript && !transcriptText) {
    response.status(400).json({ error: "Transcript text is required when consent is enabled." });
    return;
  }

  if (transcriptText.length > 200_000) {
    response.status(400).json({ error: "Transcript is too large." });
    return;
  }

  const transcriptFileName =
    includeTranscript && typeof transcriptCandidate?.fileName === "string" && transcriptCandidate.fileName.trim()
      ? transcriptCandidate.fileName.trim().slice(0, 140)
      : null;

  const safeMeta = (() => {
    const meta = transcriptCandidate?.meta;
    if (!includeTranscript || !meta || typeof meta !== "object") {
      return null;
    }

    const getString = (value: unknown, maxLen: number): string | null => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, maxLen) : null;
    };

    const candidate = meta as Record<string, unknown>;
    const difficulty = isDifficulty(candidate.difficulty) ? candidate.difficulty : null;
    const personaStyle = isPersonaStyle(candidate.personaStyle) ? candidate.personaStyle : null;

    return {
      scenarioTitle: getString(candidate.scenarioTitle, 160),
      segmentLabel: getString(candidate.segmentLabel, 120),
      difficulty,
      personaStyle,
      startedAt: getString(candidate.startedAt, 64),
      endedAt: getString(candidate.endedAt, 64),
      model: getString(candidate.model, 80),
      promptVersion: getString(candidate.promptVersion, 80),
      rubricVersion: getString(candidate.rubricVersion, 80)
    };
  })();

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const source = authorizeSupportCaseOrigin(requestedSource, user);
    const now = nowIso();
    const record: SupportCaseRecord = {
      id: `case_${uuid()}`,
      status: "open",
      userId: user.id,
      orgId: user.orgId,
      segmentId: null,
      scenarioId: null,
      message: encodeSupportCaseMessage(message, source).slice(0, SUPPORT_MESSAGE_MAX_LENGTH),
      transcriptEncrypted: includeTranscript ? encryptSupportTranscript(transcriptText) : null,
      transcriptExpiresAt: includeTranscript
        ? new Date(Date.now() + SUPPORT_TRANSCRIPT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null,
      transcriptFileName: includeTranscript ? transcriptFileName ?? `transcript-${user.id}-${Date.now()}.txt` : null,
      transcriptMeta: safeMeta,
      createdAt: now,
      updatedAt: now
    };

    // Link scenario metadata if provided and known to this user.
    if (safeMeta?.scenarioTitle) {
      const configForUser = resolveConfigForUser(db, user);
      const segment = configForUser.segments.find(
        (entry) =>
          entry.enabled &&
          (entry.scenarios ?? []).some((scenario) => scenario.title === safeMeta.scenarioTitle),
      );
      if (segment) {
        record.segmentId = segment.id;
        const scenario = (segment.scenarios ?? []).find((entry) => entry.title === safeMeta.scenarioTitle);
        if (scenario) {
          record.scenarioId = scenario.id;
        }
      }
    }

    await supportCaseStore.saveCase(record, { now: new Date(now) });
    appendMobileAuditEvent(db, user, {
      action: "support.case_created",
      userId: user.id,
      message: "Submitted support case.",
      metadata: {
        caseId: record.id,
        includeTranscript,
        source
      }
    });
    response.status(201).json({
      caseId: record.id,
      transcriptRetainedUntil: record.transcriptExpiresAt
    });
  });
});

app.get("/mobile/users/:userId/updates", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const timeoutMs = Math.max(1_000, Math.min(30_000, clampNonNegativeInteger(request.query.timeoutMs, 25_000)));
  const since = Math.max(0, clampNonNegativeInteger(request.query.cursor, 0));

  const waitContext = await withDatabaseRead(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const currentCursor = getMobileUpdateCursor(user.id);
    const hasCachedPayload = mobileUpdatePayloadByUserId.has(user.id);

    if (since > currentCursor || (since === 0 && currentCursor === 0 && !hasCachedPayload)) {
      const resyncCursor = bumpMobileUpdateCursor(user.id, "resync");
      const payload = buildMobileUpdatesPayload(db, user, resyncCursor, "resync");
      mobileUpdatePayloadByUserId.set(user.id, payload);
      response.setHeader("Cache-Control", "no-store");
      response.json(payload);
      return null;
    }

    if (currentCursor > since) {
      const cached = mobileUpdatePayloadByUserId.get(user.id);
      const reason = mobileUpdateReasonByUserId.get(user.id) ?? "unknown";
      response.setHeader("Cache-Control", "no-store");
      response.json(
        cached && cached.cursor === currentCursor
          ? cached
          : buildMobileUpdatesPayload(db, user, currentCursor, reason),
      );
      return null;
    }

    return { userId: user.id };
  });

  if (!waitContext) {
    return;
  }

  const waiter: MobileUpdateWaiter = {
    since,
    resolved: false,
    response,
    timeoutHandle: setTimeout(() => {
      const cursor = getMobileUpdateCursor(waitContext.userId);
      resolveWaiter(waitContext.userId, waiter, {
        cursor,
        changed: false,
        reason: null,
        generatedAt: nowIso(),
      });
    }, timeoutMs),
  };

  resolveMobileWaitersSet(waitContext.userId).add(waiter);

  request.on("close", () => {
    if (waiter.resolved) {
      return;
    }

    waiter.resolved = true;
    clearTimeout(waiter.timeoutHandle);
    cleanupWaiter(waitContext.userId, waiter);
  });
});

app.patch("/mobile/users/:userId/settings", async (request: Request, response: Response) => {
  const patch = request.body as MobileUpdateSettingsRequest;
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (typeof patch.email === "string") {
      const email = patch.email.trim().toLowerCase();
      if (!isEmailLike(email)) {
        response.status(400).json({ error: "Invalid email format." });
        return;
      }

      if (email !== user.email.trim().toLowerCase()) {
        response.status(409).json({
          error: "Mobile email changes are temporarily unavailable. Contact support or an administrator.",
          code: "mobile_email_change_disabled"
        });
        return;
      }
    }

    const now = new Date();
    materializeUserTimezone(user, now);

    if (typeof patch.timezone === "string") {
      const timezone = resolveTimeZone(patch.timezone);
      if (timezone !== user.timezone) {
        user.pendingTimezone = timezone;
        user.pendingTimezoneEffectiveAt = computeNextRenewalAt(user.planAnchorAt, now);
      }
    }

    user.updatedAt = now.toISOString();
    appendMobileAuditEvent(db, user, {
      action: "mobile.settings_updated",
      userId: user.id,
      message: `Updated profile settings for ${user.email}.`,
      metadata: {
        emailChanged: false,
        timezoneChanged: typeof patch.timezone === "string" && resolveTimeZone(patch.timezone) !== user.timezone
      }
    });
    response.json(user);
  });
});

app.get("/users/:userId/entitlements", requireAdmin, async (request: Request, response: Response) => {
  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    response.json(entitlements);
  });
});

app.get("/mobile/users/:userId/entitlements", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      actingOrgId: accessContext.actingOrgId,
    });
    response.json(entitlements);
  });
});

app.post(
  "/mobile/users/:userId/ai/transcribe",
  requireMobileAiAuthentication,
  aiRouteRateLimiter,
  upload.single("file"),
  async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  const transcriptionStartedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=transcribe userId=${userId} correlationId=${correlationId}`);
  const file = (request as unknown as { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
  if (!file?.buffer) {
    response.status(400).json({ error: "Audio file is required." });
    return;
  }

  const context = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      allowDuringActiveSimulation: true,
      actingOrgId: accessContext.actingOrgId
    });
    if (!entitlements.canStartSimulation) {
      respondWithEntitlementDenial(response, entitlements);
      return null;
    }

    const aiBudgetError = await resolveAiBudgetLimitError(user, new Date(), {
      allowDuringActiveSimulation: true
    });
    if (aiBudgetError) {
      response.status(429).json({ error: aiBudgetError });
      return null;
    }

    return {
      user,
      isSuperUser: accessContext.isSuperUser,
      actingOrgId: accessContext.actingOrgId,
    };
  });

  if (!context) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "transcribe",
    correlationId,
    stage: "context_ready",
    elapsedMs: Math.max(0, Date.now() - transcriptionStartedAtMs),
    bytes: file.buffer.byteLength,
    mimeType: file.mimetype || "audio/m4a",
  });

  try {
    const transcription = await transcribeSimulationAudioFile({
      file,
      route: "transcribe",
      correlationId,
      budgetContext: {
        user: context.user,
        orgId: context.actingOrgId,
        allowDuringActiveSimulation: true,
      },
    });
    const text = transcription.text;
    // eslint-disable-next-line no-console
    console.log(
      `[ai-transcription] ${JSON.stringify({
        event: "ai-transcription",
        correlationId,
        userId,
        durationMs: transcription.durationMs,
        bytes: transcription.bytes,
        mimeType: transcription.mimeType,
        textLength: text.trim().length
      })}`
    );
    if (!text.trim()) {
      // eslint-disable-next-line no-console
      console.warn("[simulation-transcribe-empty]", {
        correlationId,
        userId,
        bytes: file.buffer.byteLength,
        mimeType: file.mimetype || "audio/m4a",
        fileName: file.originalname || "voice-input.m4a",
        suspiciouslyTinyAudio: file.buffer.byteLength <= 4_096,
      });
    }

    response.setHeader("X-Correlation-Id", correlationId);
    response.json({ text });
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
        route: "transcribe",
        correlationId,
        stage: "response_sent",
        elapsedMs: Math.max(0, Date.now() - transcriptionStartedAtMs),
        bytes: transcription.bytes,
        mimeType: transcription.mimeType,
        textLength: text.trim().length,
      });

    if (!context.isSuperUser) {
      runSimulationPostResponseTask(async () => {
        await withDatabaseWrite(async (db) => {
          const user = getUserById(db, context.user.id);
          if (!user) {
            return;
          }

          const event: AiUsageEvent = {
            id: transcription.usageEventId,
            kind: "transcribe",
            userId: user.id,
            orgId: context.actingOrgId,
            divisionId: null,
            segmentId: null,
            scenarioId: null,
            model: OPENAI_TRANSCRIPTION_MODEL,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            createdAt: nowIso()
          };

          await aiUsageEventAccess.append(event);
        });
      }, {
        logKey: "ai-usage:transcribe",
        description: "failed to persist transcribe event"
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "transcribe",
      correlationId,
      stage: "error",
      elapsedMs: Math.max(0, Date.now() - transcriptionStartedAtMs),
      bytes: file.buffer.byteLength,
      mimeType: file.mimetype || "audio/m4a",
      error: message,
    });
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.post(
  "/mobile/users/:userId/ai/submit-turn",
  requireMobileAiAuthentication,
  aiRouteRateLimiter,
  upload.single("file"),
  async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const file = (request as unknown as { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
  if (!file?.buffer) {
    response.status(400).json({ error: "Audio file is required." });
    return;
  }

  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  const routeStartedAtMs = Date.now();
  const rawPayload = typeof request.body?.payload === "string" ? request.body.payload.trim() : "";
  if (!rawPayload) {
    response.status(400).json({ error: "payload is required." });
    return;
  }

  let parsedPayload: {
    scenarioId?: string;
    trainingId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    industryId?: unknown;
    industryBaseline?: unknown;
    trainingPackId?: unknown;
    speechPrefetch?: unknown;
    responseMode?: unknown;
    history?: unknown;
    simulationSessionId?: unknown;
    sessionId?: unknown;
  };
  try {
    parsedPayload = JSON.parse(rawPayload) as typeof parsedPayload;
  } catch {
    response.status(400).json({ error: "payload must be valid JSON." });
    return;
  }

  const payloadRecord = parsedPayload as Record<string, unknown>;
  const simulationSessionId = resolveRecognizedSimulationSessionId(request, payloadRecord);
  const scenarioId = parsedPayload.scenarioId?.trim();
  const trainingId =
    typeof parsedPayload.trainingId === "string" && parsedPayload.trainingId.trim()
      ? parsedPayload.trainingId.trim()
      : null;
  const difficulty = isDifficulty(parsedPayload.difficulty) ? parsedPayload.difficulty : null;
  const personaStyle = isPersonaStyle(parsedPayload.personaStyle) ? parsedPayload.personaStyle : null;
  const submittedTrainingPackId =
    typeof parsedPayload.trainingPackId === "string" && parsedPayload.trainingPackId.trim()
      ? parsedPayload.trainingPackId.trim()
      : null;
  const requestedSpeechPrefetch = parseSimulationSpeechPrefetchRequest(parsedPayload.speechPrefetch);
  const responseMode = parsedPayload.responseMode === "transcript_first_v1" ? "transcript_first_v1" : "complete";
  const history = normalizeDialogueHistory(parsedPayload.history, { maxTurns: 24 });

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=submit-turn userId=${userId} correlationId=${correlationId}`);

  const accessContext = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const resolvedAccessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!resolvedAccessContext) {
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      allowDuringActiveSimulation: true,
      actingOrgId: resolvedAccessContext.actingOrgId,
    });
    if (!entitlements.canStartSimulation) {
      respondWithEntitlementDenial(response, entitlements);
      return null;
    }

    const aiBudgetError = await resolveAiBudgetLimitError(user, new Date(), {
      allowDuringActiveSimulation: true,
    });
    if (aiBudgetError) {
      response.status(429).json({ error: aiBudgetError });
      return null;
    }

    return {
      userId: user.id,
      user,
      actingOrgId: resolvedAccessContext.actingOrgId,
      isSuperUser: resolvedAccessContext.isSuperUser,
      maxSimulationMinutes: entitlements.limits.maxSimulationMinutes,
    };
  });

  if (!accessContext) {
    return;
  }

  const loadUnifiedRuntime = async (
    allowTrainingWorkspaceBootstrap: boolean,
  ): Promise<SimulationRuntimeBundle | { bootstrapOrgId: string } | null> => {
    return await withDatabaseRead(async (db) => {
      const user = getUserById(db, accessContext.userId);
      if (!user) {
        response.status(404).json({ error: "User not found." });
        return null;
      }

      const org = accessContext.actingOrgId ? getOrgById(db, accessContext.actingOrgId) ?? null : null;
      const runtime = await resolveSimulationRuntimeBundle({
        db,
        user,
        org,
        actingOrgId: accessContext.actingOrgId,
        scenarioId,
        trainingId,
        difficulty,
        personaStyle,
        requestedIndustryId: parsedPayload.industryId,
        requestedIndustryBaseline: parsedPayload.industryBaseline,
        submittedTrainingPackId,
        simulationSessionId,
        response,
      });

      if (!runtime || "bootstrapOrgId" in runtime) {
        const bootstrapRuntime =
          runtime && "bootstrapOrgId" in runtime
            ? runtime
            : null;
        if (bootstrapRuntime) {
          return bootstrapRuntime;
        }
        return null;
      }

      return runtime;
    });
  };

  const transcriptionPromise = transcribeSimulationAudioFile({
    file,
    route: "submit-turn",
    correlationId,
    budgetContext: {
      user: accessContext.user,
      orgId: accessContext.actingOrgId,
      allowDuringActiveSimulation: true,
    },
  }).then(
    (transcription) => ({ ok: true as const, transcription }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  let runtimePromise = loadUnifiedRuntime(false);
  let runtime = await runtimePromise;
  const bootstrapRuntime =
    runtime && "bootstrapOrgId" in runtime
      ? runtime
      : null;
  if (bootstrapRuntime) {
    await withDatabaseWrite(async (db) => {
      const org = getOrgById(db, bootstrapRuntime.bootstrapOrgId);
      if (org) {
        await ensureOrgTrainingWorkspace(db, org);
      }
    });
    runtimePromise = loadUnifiedRuntime(true);
    runtime = await runtimePromise;
  }

  const transcriptionResult = await transcriptionPromise;
  if (!runtime || "bootstrapOrgId" in runtime) {
    return;
  }

  if (!transcriptionResult.ok) {
    const message = transcriptionResult.error instanceof Error ? transcriptionResult.error.message : "Transcription failed.";
    const pendingError = transcriptionResult.error instanceof Error ? transcriptionResult.error : new Error(message);
    // eslint-disable-next-line no-console
    console.warn("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: "transcription_error",
      elapsedMs: Date.now() - routeStartedAtMs,
      bytes: file.buffer.byteLength,
      mimeType: file.mimetype || "audio/m4a",
      error: message,
    });

    if (responseMode === "transcript_first_v1") {
      registerPendingUnifiedSubmitTurn({
        correlationId,
        userId: accessContext.userId,
        resultPromise: Promise.reject(pendingError),
      });
    }

    response.setHeader("X-Correlation-Id", correlationId);
    response.status(transcriptionResult.error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
    return;
  }

  const transcription = transcriptionResult.transcription;

  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "submit-turn",
    correlationId,
    stage: "context_ready",
    elapsedMs: Date.now() - routeStartedAtMs,
    cacheStatus: runtime.cacheStatus,
    cacheReason: runtime.cacheReason,
    contextBuildMs: runtime.contextBuildMs,
    trainingPackLookupMs: runtime.trainingPackLookupMs,
    historyCount: history.length,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[ai-transcription] ${JSON.stringify({
      event: "ai-transcription",
      correlationId,
      userId,
      durationMs: transcription.durationMs,
      bytes: transcription.bytes,
      mimeType: transcription.mimeType,
      textLength: transcription.text.trim().length,
      route: "submit-turn",
    })}`,
  );

  let transcriptText = transcription.text.trim();
  let noClearSpeechReason: "empty_transcript" | "assistant_echo" | null = null;
  if (!isUsableSimulationTranscriptText(transcriptText)) {
    if (transcriptText) {
      // eslint-disable-next-line no-console
      console.warn("[simulation-transcript-guard]", {
        route: "submit-turn",
        correlationId,
        stage: "unusable_transcript",
        transcriptChars: transcriptText.length,
        reason: "too_short_or_non_english_like",
      });
    }
    transcriptText = "";
    noClearSpeechReason = "empty_transcript";
  } else if (appearsToEchoAssistantHistory(transcriptText, history)) {
    transcriptText = "";
    noClearSpeechReason = "assistant_echo";
  }

  const buildUnifiedRuntimeBase = () => ({
    path: "unified_submit" as const,
    transcriptionMs: transcription.durationMs,
    cacheStatus: runtime.cacheStatus,
    cacheReason: runtime.cacheReason,
    contextBuildMs: runtime.contextBuildMs,
    trainingPackLookupMs: runtime.trainingPackLookupMs,
  });

  if (noClearSpeechReason) {
    const noClearPayload: PendingUnifiedSubmitTurnResult = {
      outcome: "no_clear_speech",
      transcriptText: "",
      noClearSpeechReason,
      runtime: {
        ...buildUnifiedRuntimeBase(),
        routeElapsedMs: Date.now() - routeStartedAtMs,
      },
    };
    if (responseMode === "transcript_first_v1") {
      registerPendingUnifiedSubmitTurn({
        correlationId,
        userId: accessContext.userId,
        resultPromise: Promise.resolve(noClearPayload),
      });
    }
    response.setHeader("X-Correlation-Id", correlationId);
    response.json(noClearPayload);
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: "response_sent",
      elapsedMs: Date.now() - routeStartedAtMs,
      outcome: "no_clear_speech",
      noClearSpeechReason,
      cacheStatus: runtime.cacheStatus,
      transcriptionMs: transcription.durationMs,
    });

    if (!accessContext.isSuperUser) {
      runSimulationPostResponseTask(async () => {
        const anchoredDivisionId = await resolveAnchoredSimulationDivisionId({
          simulationSessionId,
          userId: accessContext.userId,
          orgId: accessContext.actingOrgId,
          scenarioId: runtime.scenario.id,
          trainingId,
          fallbackDivisionId: runtime.divisionId,
        });
        await withDatabaseWrite(async (db) => {
          const user = getUserById(db, accessContext.userId);
          if (!user) {
            return;
          }

          const event: AiUsageEvent = {
            id: transcription.usageEventId,
            kind: "transcribe",
            userId: user.id,
            orgId: accessContext.actingOrgId,
            divisionId: anchoredDivisionId,
            segmentId: null,
            scenarioId: null,
            model: OPENAI_TRANSCRIPTION_MODEL,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            createdAt: nowIso(),
          };

          await aiUsageEventAccess.append(event);
        });
      }, {
        logKey: "ai-usage:submit-turn-no-clear",
        description: "failed to persist unified-submit transcribe event",
      });
    }
    return;
  }

  const turnHistory = [...history, { role: "user" as const, content: transcriptText }];

  const assistantResultPromise = (async (): Promise<PendingUnifiedSubmitTurnResult> => {
    const turnResult = await generateSimulationTurnReply({
      correlationId,
      history: turnHistory,
      runtime,
      requestedSpeechPrefetch,
      budgetContext: {
        user: accessContext.user,
        orgId: accessContext.actingOrgId,
        divisionId: runtime.divisionId,
        segmentId: runtime.segment.id,
        scenarioId: runtime.scenario.id,
        allowDuringActiveSimulation: true,
      },
    });

    const assistantPayload: PendingUnifiedSubmitTurnResult = {
      outcome: "assistant_reply",
      transcriptText,
      assistantText: turnResult.assistantText,
      usage: turnResult.completion.usage,
      model: turnResult.completion.model,
      promptVersion: AI_PROMPT_VERSION,
      speechPrefetch: turnResult.speechPrefetch,
      runtime: {
        ...buildUnifiedRuntimeBase(),
        modelLatencyMs: turnResult.modelLatencyMs,
        speechPrefetchTtsLatencyMs: turnResult.speechPrefetch?.ttsLatencyMs ?? null,
        routeElapsedMs: Date.now() - routeStartedAtMs,
      },
    };

    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: "assistant_payload_resolved",
      elapsedMs: Date.now() - routeStartedAtMs,
      speechPrefetchRequested: Boolean(requestedSpeechPrefetch),
      speechPrefetchAvailable: Boolean(turnResult.speechPrefetch),
      speechPrefetchTtsLatencyMs: turnResult.speechPrefetch?.ttsLatencyMs ?? null,
    });

    activateSimulationAiBudgetGrace(accessContext.userId, accessContext.maxSimulationMinutes);
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: responseMode === "transcript_first_v1" ? "assistant_ready" : "response_sent",
      elapsedMs: Date.now() - routeStartedAtMs,
      cacheStatus: runtime.cacheStatus,
      cacheReason: runtime.cacheReason,
      contextBuildMs: runtime.contextBuildMs,
      trainingPackLookupMs: runtime.trainingPackLookupMs,
      transcriptionMs: transcription.durationMs,
      modelLatencyMs: turnResult.modelLatencyMs,
      historyCount: turnHistory.length,
      historyChars: turnResult.historyChars,
      promptChars: turnResult.promptChars,
      systemPromptChars: runtime.systemPrompt.length,
      speechPrefetchRequested: Boolean(requestedSpeechPrefetch),
      speechPrefetchAvailable: Boolean(turnResult.speechPrefetch),
      speechPrefetchChunkCount: turnResult.speechPrefetch?.chunkCount ?? null,
      speechPrefetchTtsLatencyMs: turnResult.speechPrefetch?.ttsLatencyMs ?? null,
      speechPrefetchBytes: turnResult.speechPrefetch ? Buffer.byteLength(turnResult.speechPrefetch.audioBase64, "base64") : null,
    });

    if (!accessContext.isSuperUser) {
      runSimulationPostResponseTask(async () => {
        const anchoredDivisionId = await resolveAnchoredSimulationDivisionId({
          simulationSessionId,
          userId: accessContext.userId,
          orgId: accessContext.actingOrgId,
          scenarioId: runtime.scenario.id,
          trainingId,
          fallbackDivisionId: runtime.divisionId,
        });
        await withDatabaseWrite(async (db) => {
          const user = getUserById(db, accessContext.userId);
          if (!user) {
            return;
          }

          const turnAiDetails = buildPersistedSimulationAiDetails({
            requestedModel: OPENAI_SIMULATION_MODEL,
            responseModel: turnResult.completion.model,
            usage: turnResult.completion.usage,
            latencyMs: turnResult.modelLatencyMs,
          });

          const transcribeEvent: AiUsageEvent = {
            id: transcription.usageEventId,
            kind: "transcribe",
            userId: user.id,
            orgId: accessContext.actingOrgId,
            divisionId: anchoredDivisionId,
            segmentId: null,
            scenarioId: null,
            model: OPENAI_TRANSCRIPTION_MODEL,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            createdAt: nowIso(),
          };

          const turnEvent: AiUsageEvent = {
            id: turnResult.usageEventId,
            kind: "turn",
            userId: user.id,
            orgId: accessContext.actingOrgId,
            divisionId: anchoredDivisionId,
            segmentId: runtime.segment.id,
            scenarioId: runtime.scenario.id,
            model: turnAiDetails.responseModel,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: toUsageEventToken(turnAiDetails.tokenUsage.inputTokens),
            outputTokens: toUsageEventToken(turnAiDetails.tokenUsage.outputTokens),
            totalTokens: toUsageEventToken(turnAiDetails.tokenUsage.totalTokens),
            createdAt: nowIso(),
          };

          await aiUsageEventAccess.append(transcribeEvent);
          await aiUsageEventAccess.append(turnEvent);
          appendMobileAuditEvent(db, user, {
            action: "ai.simulation.turn.details",
            userId: user.id,
            orgId: accessContext.actingOrgId,
            message: "Stored AI details for unified simulation turn.",
            metadata: {
              route: "submit-turn",
              sessionId: simulationSessionId ?? resolveSimulationSessionId(request, payloadRecord),
              segmentId: runtime.segment.id,
              scenarioId: runtime.scenario.id,
              aiDetails: turnAiDetails,
            },
          });
        });
      }, {
        logKey: "ai-usage:submit-turn",
        description: "failed to persist unified-submit ai events",
      });
    }

    runSimulationPostResponseTask(async () => {
      await touchRecognizedSimulationSessionBestEffort({
        simulationSessionId,
        trainingPackId: runtime.activeTrainingPack?.id ?? null,
        logKey: "simulation-session:submit-turn",
      });
    }, {
      logKey: "simulation-session:submit-turn",
      description: "failed to touch recognized session after unified submit turn",
    });

    return assistantPayload;
  })();

  if (responseMode === "transcript_first_v1") {
    registerPendingUnifiedSubmitTurn({
      correlationId,
      userId: accessContext.userId,
      resultPromise: assistantResultPromise,
    });
    response.setHeader("X-Correlation-Id", correlationId);
    response.json({
      outcome: "transcript_ready",
      transcriptText,
      runtime: {
        ...buildUnifiedRuntimeBase(),
        routeElapsedMs: Date.now() - routeStartedAtMs,
      },
    });
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: "transcript_ready_sent",
      elapsedMs: Date.now() - routeStartedAtMs,
      cacheStatus: runtime.cacheStatus,
      cacheReason: runtime.cacheReason,
      contextBuildMs: runtime.contextBuildMs,
      trainingPackLookupMs: runtime.trainingPackLookupMs,
      transcriptionMs: transcription.durationMs,
      historyCount: turnHistory.length,
    });
    return;
  }

  try {
    const assistantPayload = await assistantResultPromise;
    if (assistantPayload.outcome !== "assistant_reply") {
      throw new Error(assistantPayload.outcome === "error" ? assistantPayload.error : "Unified simulation turn failed.");
    }
    response.setHeader("X-Correlation-Id", correlationId);
    response.json(assistantPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "submit-turn",
      correlationId,
      stage: "error",
      elapsedMs: Date.now() - routeStartedAtMs,
      cacheStatus: runtime.cacheStatus,
      historyCount: turnHistory.length,
      error: message,
    });
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.get("/mobile/users/:userId/ai/submit-turn-await/:correlationId", requireMobileAiAuthentication, aiRouteRateLimiter, async (request: Request, response: Response) => {
  const authToken = request.headers.authorization?.replace("Bearer ", "").trim();
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const requestedCorrelationId =
    typeof request.params.correlationId === "string" ? request.params.correlationId.trim().slice(0, 80) : "";
  if (!requestedCorrelationId) {
    response.status(400).json({ error: "correlationId is required." });
    return;
  }
  const routeStartedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=submit-turn-await userId=${userId} correlationId=${requestedCorrelationId}`);

  const authenticatedUserId = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const resolvedAccessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!resolvedAccessContext) {
      return null;
    }
    return user.id;
  });

  if (!authenticatedUserId) {
    return;
  }

  const waitOutcome = await waitForPendingUnifiedSubmitTurn({
    correlationId: requestedCorrelationId,
    userId: authenticatedUserId,
    timeoutMs: 75_000,
  });
  const result = waitOutcome.result;

  if (!result) {
    logPendingUnifiedSubmitTurnCleanupSkipped({
      correlationId: requestedCorrelationId,
      reason:
        waitOutcome.timeoutKind === "unsettled"
          ? "await_timeout_unsettled"
          : waitOutcome.timeoutKind === "expired"
            ? "already_cleaned"
            : "await_timeout_no_entry",
    });
    if (waitOutcome.timeoutKind === "expired") {
      // eslint-disable-next-line no-console
      console.warn("[simulation-route]", {
        route: "submit-turn-await",
        correlationId: requestedCorrelationId,
        stage: "expired",
        elapsedMs: Date.now() - routeStartedAtMs,
      });
      response.status(410).json({ error: "Simulation assistant reply is no longer pending for this correlationId." });
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[simulation-route]", {
      route: "submit-turn-await",
      correlationId: requestedCorrelationId,
      stage: "timeout",
      elapsedMs: Date.now() - routeStartedAtMs,
      timeoutKind: waitOutcome.timeoutKind ?? "unknown",
    });
    response.status(504).json({ error: "Timed out waiting for simulation assistant reply." });
    return;
  }

  response.setHeader("X-Correlation-Id", requestedCorrelationId);
  if (result.outcome === "error") {
    // eslint-disable-next-line no-console
    console.warn("[simulation-route]", {
      route: "submit-turn-await",
      correlationId: requestedCorrelationId,
      stage: "error",
      elapsedMs: Date.now() - routeStartedAtMs,
    });
    response.status(503).json({ error: result.error });
    cleanupPendingUnifiedSubmitTurn({
      correlationId: requestedCorrelationId,
      userId: authenticatedUserId,
      reason: "after_reject",
    });
    return;
  }
  response.json(result);
  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "submit-turn-await",
    correlationId: requestedCorrelationId,
    stage: "response_sent",
    elapsedMs: Date.now() - routeStartedAtMs,
    outcome: result.outcome,
  });
  // Keep the resolved, user-bound result available briefly so a mobile client
  // interrupted after submitting can safely repeat the await request on resume.
  console.log("[simulation-route]", {
    route: "submit-turn-await",
    correlationId: requestedCorrelationId,
    stage: "pending_turn_retained_for_recovery",
    retentionMs: PENDING_UNIFIED_TURN_TTL_MS,
  });
});

app.post("/mobile/users/:userId/ai/tts", requireMobileAiAuthentication, aiRouteRateLimiter, async (request: Request, response: Response) => {
  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  const routeStartedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=tts userId=${userId} correlationId=${correlationId}`);

  const respondWithTtsError = (params: {
    status: number;
    message: string;
    code?: string | null;
    type?: string | null;
    openaiStatus?: number;
    openaiMessage?: string;
  }) => {
    const payload: {
      userId: string;
      status: number;
      code: string | null;
      type: string | null;
      message: string;
      route: "tts";
      correlationId: string;
      openaiStatus?: number;
      openaiMessage?: string;
    } = {
      userId,
      status: params.status,
      code: params.code ?? null,
      type: params.type ?? null,
      message: params.message,
      route: "tts",
      correlationId
    };
    if (typeof params.openaiStatus === "number") {
      payload.openaiStatus = params.openaiStatus;
    }
    if (typeof params.openaiMessage === "string" && params.openaiMessage.trim()) {
      payload.openaiMessage = params.openaiMessage.trim();
    }
    // eslint-disable-next-line no-console
    console.error("[tts-error]", payload);
    response.status(params.status).json({
      error: params.message,
      ...(params.code ? { code: params.code } : {}),
    });
  };

  if (!ENABLE_REMOTE_TTS) {
    respondWithTtsError({
      status: 501,
      message: "Remote TTS is disabled for this environment."
    });
    return;
  }

  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    respondWithTtsError({
      status: 401,
      message: "Missing mobile token."
    });
    return;
  }

  if (!isRemoteAiConfigured()) {
    respondWithTtsError({
      status: 503,
      message: "Remote AI is disabled for this environment."
    });
    return;
  }

  const body = request.body as { text?: unknown; preset?: unknown };
  const preset = parseTtsPreset(body.preset);
  const text = typeof body.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";

  if (!preset) {
    respondWithTtsError({
      status: 400,
      message:
        'preset must be one of: "male-balanced"|"male-warm"|"male-bright"|"female-balanced"|"female-warm"|"female-bright".'
    });
    return;
  }

  if (!text) {
    respondWithTtsError({
      status: 400,
      message: "text is required."
    });
    return;
  }

  if (text.length > TTS_TEXT_MAX_CHARS) {
    respondWithTtsError({
      status: 400,
      message: `text must be ${TTS_TEXT_MAX_CHARS} characters or fewer.`
    });
    return;
  }

  const context = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      respondWithTtsError({
        status: 404,
        message: "User not found."
      });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      respondWithTtsError({
        status: 401,
        message: "Invalid mobile token."
      });
      return null;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      allowDuringActiveSimulation: true,
      actingOrgId: accessContext.actingOrgId
    });
    if (!entitlements.canStartSimulation) {
      respondWithTtsError({
        status: 403,
        message: entitlements.lockReason ?? "Simulation unavailable.",
        code: entitlements.lockCode,
      });
      return null;
    }

    const aiBudgetError = await resolveAiBudgetLimitError(user, new Date(), {
      allowDuringActiveSimulation: true
    });
    if (aiBudgetError) {
      respondWithTtsError({
        status: 429,
        message: aiBudgetError
      });
      return null;
    }

    return {
      user,
      isSuperUser: accessContext.isSuperUser,
      actingOrgId: accessContext.actingOrgId,
    };
  });

  if (!context) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "tts",
    correlationId,
    stage: "context_ready",
    elapsedMs: Math.max(0, Date.now() - routeStartedAtMs),
    textChars: text.length,
    preset,
  });

  const { config: ttsConfig, request: speechRequest } = buildTtsSpeechRequest({
    preset,
    model: OPENAI_TTS_MODEL,
    text,
  });
  let ttsCallStartedAtMs: number | null = null;
  try {
    ttsCallStartedAtMs = Date.now();
    // eslint-disable-next-line no-console
    console.log("[tts-call]", {
      route: "tts",
      correlationId,
      userId,
      preset,
      provider: "openai",
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
      stage: "start",
      startedAtMs: ttsCallStartedAtMs
    });
    const budgetedTts = await invokeAiProviderWithBudget({
      context: {
        user: context.user,
        orgId: context.actingOrgId,
        allowDuringActiveSimulation: true,
      },
      kind: "tts",
      model: ttsConfig.model,
      promptVersion: AI_PROMPT_VERSION,
      rubricVersion: null,
      estimatedTokens: 0,
      invoke: async () => await requestSpeechSynthesis(speechRequest),
    });
    const ttsResult = budgetedTts.value;
    const ttsCallEndedAtMs = Date.now();
    // eslint-disable-next-line no-console
    console.log("[tts-call]", {
      route: "tts",
      correlationId,
      userId,
      preset,
      provider: "openai",
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
      stage: "end",
      endedAtMs: ttsCallEndedAtMs,
      durationMs: ttsCallEndedAtMs - ttsCallStartedAtMs
    });
    const durationEstimateSec = estimateTtsDurationSeconds(text);
    // eslint-disable-next-line no-console
    console.log(
      `[ai-tts] correlationId=${correlationId} preset=${preset} bytes=${ttsResult.audioBuffer.byteLength} durationEstimateSec=${durationEstimateSec}`
    );

    response.setHeader("X-Correlation-Id", correlationId);
    response.setHeader("Content-Type", "audio/mpeg");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).send(ttsResult.audioBuffer);
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "tts",
      correlationId,
      stage: "response_sent",
      elapsedMs: Math.max(0, Date.now() - routeStartedAtMs),
      bytes: ttsResult.audioBuffer.byteLength,
      textChars: text.length,
      preset,
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
    });
  } catch (error) {
    if (typeof ttsCallStartedAtMs === "number") {
      const ttsCallEndedAtMs = Date.now();
      // eslint-disable-next-line no-console
      console.log("[tts-call]", {
        route: "tts",
        correlationId,
        userId,
        preset,
        provider: "openai",
        model: ttsConfig.model,
        voice: ttsConfig.voice,
        speed: ttsConfig.speed,
        instructionsIncluded: ttsConfig.instructionsIncluded,
        responseFormat: ttsConfig.responseFormat,
        stage: "error",
        endedAtMs: ttsCallEndedAtMs,
        durationMs: ttsCallEndedAtMs - ttsCallStartedAtMs
      });
    }
    const message = error instanceof Error ? error.message : "Text-to-speech failed.";
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "tts",
      correlationId,
      stage: "error",
      elapsedMs: Math.max(0, Date.now() - routeStartedAtMs),
      textChars: text.length,
      preset,
      model: ttsConfig.model,
      voice: ttsConfig.voice,
      speed: ttsConfig.speed,
      instructionsIncluded: ttsConfig.instructionsIncluded,
      responseFormat: ttsConfig.responseFormat,
      error: message,
    });
    if (error instanceof OpenAiSpeechRequestError) {
      respondWithTtsError({
        status: 503,
        code: error.errorCode ?? null,
        type: error.errorType ?? null,
        message,
        openaiStatus: error.statusCode,
        openaiMessage: error.errorMessage
      });
      return;
    }

    if (error instanceof AiBudgetLimitError) {
      respondWithTtsError({
        status: 429,
        message
      });
      return;
    }

    respondWithTtsError({
      status: 503,
      message
    });
  }
});

app.get("/internal/ai/debug-prompt", async (request: Request, response: Response) => {
  if (!ENABLE_INTERNAL_DEBUG_ENDPOINTS) {
    response.status(404).json({ error: "Not found." });
    return;
  }

  const userId = getSingleQueryParam(request.query.userId);
  const scenarioId = getSingleQueryParam(request.query.scenarioId);
  const industryId = getSingleQueryParam(request.query.industryId);
  const difficultyRaw = getSingleQueryParam(request.query.difficulty);
  const personaStyleQuery = getSingleQueryParam(request.query.personaStyle);
  const personaIdQuery = getSingleQueryParam(request.query.personaId);
  const clientIndustryBaselineSnapshot = getSingleQueryParam(request.query.industryBaseline);
  const includeFull = parseBooleanQueryFlag(getSingleQueryParam(request.query.includeFull));
  const warnings: string[] = [];

  if (!userId) {
    response.status(400).json({ error: "userId is required." });
    return;
  }

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  if (!industryId) {
    response.status(400).json({ error: "industryId is required." });
    return;
  }

  if (!difficultyRaw || !isDifficulty(difficultyRaw)) {
    response.status(400).json({ error: "difficulty must be one of: easy, medium, hard." });
    return;
  }

  const requestedPersonaStyleRaw = personaStyleQuery ?? personaIdQuery;
  const requestedPersonaStyle = requestedPersonaStyleRaw && isPersonaStyle(requestedPersonaStyleRaw)
    ? requestedPersonaStyleRaw
    : null;
  if (requestedPersonaStyleRaw && !requestedPersonaStyle) {
    warnings.push(`Ignoring unsupported persona style "${requestedPersonaStyleRaw}". Falling back to user default.`);
  }

  const context = await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    const configForUser = resolveConfigForUser(db, user);
    const resolvedScenario = resolveMobileScenarioForUser(configForUser, scenarioId);
    if (!resolvedScenario) {
      response.status(400).json({ error: "Invalid scenario for this account." });
      return null;
    }

    const org = getOrgById(db, user.orgId);
    const orgFlag = org?.enableModularPromptArchitecture === true;
    const useModularPromptArchitecture = USE_MODULAR_PROMPT_ARCHITECTURE_ENV && orgFlag;

    if (useModularPromptArchitecture && clientIndustryBaselineSnapshot) {
      warnings.push("Ignoring client-provided industry baseline snapshot because modular prompt architecture is enabled.");
    }

    const industryPromptContext = resolveAiIndustryPromptContextForAllowedIndustries(
      configForUser,
      resolvedScenario.allowedIndustryIds,
      industryId,
      clientIndustryBaselineSnapshot,
      {
        preferClientBaselineSnapshot: !useModularPromptArchitecture,
        canonicalIndustryDefinitions: db.config.industries
      }
    );

    if (!industryPromptContext.industryId) {
      warnings.push(`Industry "${industryId}" is not available for this scenario/user context.`);
    }

    const scoringGuidance = resolveScenarioScoringGuidanceForEvaluation(
      configForUser,
      resolvedScenario,
      industryPromptContext.industryId
    );

    return {
      user,
      scenario: resolvedScenario.scenario,
      scenarioSource: resolvedScenario.source,
      segmentLabel: resolvedScenario.segment.label,
      difficulty: difficultyRaw,
      personaStyle: requestedPersonaStyle ?? configForUser.defaultPersonaStyle,
      industryId: industryPromptContext.industryId,
      industryLabel: industryPromptContext.industryLabel,
      industryBaseline: industryPromptContext.industryBaseline,
      scoringGuidance,
      counterpartBehaviorGuidance: resolveRoleplayCounterpartBehaviorGuidance(resolvedScenario),
      orgFlag,
      useModularPromptArchitecture
    };
  });

  if (!context) {
    return;
  }

  const resolvedOrgId = typeof context.user.orgId === "string" ? context.user.orgId.trim() : "";
  const requestedScenarioIdForGate = context.scenario.id?.trim().toLowerCase() || null;
  const rawSqlOrgIdPassedToGetActiveTrainingPackForOrg = resolvedOrgId || null;
  let directStoreActivePack: {
    id: string;
    organizationId: string;
    active: boolean;
    requiredBehavioralTriggersLength: number;
  } | null = null;
  let directStoreActivePackTriggers: string[] = [];
  let packsReturnedByListCount: number | null = null;
  let trainingPackStoreDiagnosticsError: string | null = null;

  if (INCLUDE_INTERNAL_DEBUG_DIAGNOSTICS && rawSqlOrgIdPassedToGetActiveTrainingPackForOrg) {
    try {
      const storeActivePack = await trainingPackStore.getActiveTrainingPackForOrg(
        rawSqlOrgIdPassedToGetActiveTrainingPackForOrg
      );
      if (storeActivePack) {
        directStoreActivePackTriggers = storeActivePack.requiredBehavioralTriggers ?? [];
        directStoreActivePack = {
          id: storeActivePack.id,
          organizationId: storeActivePack.organizationId,
          active: storeActivePack.active === true,
          requiredBehavioralTriggersLength: directStoreActivePackTriggers.length
        };
      }

      const packsForOrg = await trainingPackStore.listTrainingPacksForOrg(rawSqlOrgIdPassedToGetActiveTrainingPackForOrg);
      packsReturnedByListCount = packsForOrg.length;
    } catch (error) {
      trainingPackStoreDiagnosticsError = error instanceof Error ? error.message : String(error);
    }
  }

  const scopedScenarioIdsForGate = Array.from(
    new Set(
      directStoreActivePackTriggers
        .map((entry) => entry.trim())
        .filter((entry) => entry.toLowerCase().startsWith(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX))
        .map((entry) => entry.slice(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX.length).trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const useModularPromptArchitectureForDebug =
    context.useModularPromptArchitecture || directStoreActivePack !== null;

  const activeTrainingPack = await getActiveTrainingPackForOrg(
    rawSqlOrgIdPassedToGetActiveTrainingPackForOrg,
    useModularPromptArchitectureForDebug,
    {
    scenarioId: requestedScenarioIdForGate,
    onSkip: (message) => warnings.push(message)
  });
  if (useModularPromptArchitectureForDebug && !activeTrainingPack) {
    warnings.push("No active training pack is available for this org. Orchestrator is running without training-pack additions.");
  }

  const roleplayConfig = useModularPromptArchitectureForDebug
      ? buildRoleplayPromptsWithOrchestrator({
        scenario: context.scenario,
        difficulty: context.difficulty,
        segmentLabel: context.segmentLabel,
        personaStyle: context.personaStyle,
        industryLabel: context.industryLabel,
        industryBaseline: context.industryBaseline,
        counterpartBehaviorGuidance: context.counterpartBehaviorGuidance,
        trainingPack: activeTrainingPack
      })
    : {
        systemPrompt: buildRoleplaySystemPrompt({
          scenario: context.scenario,
          difficulty: context.difficulty,
          segmentLabel: context.segmentLabel,
          personaStyle: context.personaStyle,
          industryLabel: context.industryLabel,
          industryBaseline: context.industryBaseline,
          counterpartBehaviorGuidance: context.counterpartBehaviorGuidance
        }),
        openingPrompt: buildOpeningPrompt(context.scenario)
      };

  const evaluationConfig = useModularPromptArchitectureForDebug
    ? buildEvaluationPromptWithOrchestrator({
        scenario: context.scenario,
        difficulty: context.difficulty,
        segmentLabel: context.segmentLabel,
        personaStyle: context.personaStyle,
        industryLabel: context.industryLabel,
        industryBaseline: context.industryBaseline,
        scoringGuidance: context.scoringGuidance,
        trainingPack: activeTrainingPack,
        logger: (message) => warnings.push(message)
      })
    : null;
  const evaluationPrompt =
    evaluationConfig?.evaluationPrompt ??
    buildEvaluationSystemPrompt({
      scenario: context.scenario,
      difficulty: context.difficulty,
      segmentLabel: context.segmentLabel,
      personaStyle: context.personaStyle,
      industryLabel: context.industryLabel,
      industryBaseline: context.industryBaseline,
      scoringGuidance: context.scoringGuidance,
    });

  const roleplaySections = ["Base Roleplay System Prompt"];
  if (useModularPromptArchitectureForDebug && activeTrainingPack) {
    roleplaySections.push("Training Pack Brief");
    if ((activeTrainingPack.requiredBehavioralTriggers ?? []).length > 0) {
      roleplaySections.push("Required Behavioral Triggers");
    }
  }

  const roleplaySystemPromptPreview = (() => {
    const preview = roleplayConfig.systemPrompt.slice(0, 1200);
    if (!activeTrainingPack) {
      return preview;
    }

    const brief = activeTrainingPack.trainingTopic?.trim() ?? "";
    if (!brief) {
      return preview;
    }

    if (preview.toLowerCase().includes(brief.toLowerCase())) {
      return preview;
    }

    return `${preview}\n\n[Training Pack Brief Snippet]\n${brief.slice(0, 300)}`;
  })();

  const baselineSource: "client" | "server" =
    !useModularPromptArchitectureForDebug && clientIndustryBaselineSnapshot !== null
      ? "client"
      : "server";
  const warningsForResponse = runtimeConfig.isProduction
    ? warnings.map((entry) => (entry.startsWith("[training-pack]") ? "[training-pack] skipped for current scenario." : entry))
    : warnings;

  response.json({
    effectiveFlags: {
      envFlag: USE_MODULAR_PROMPT_ARCHITECTURE_ENV,
      orgFlag: context.orgFlag,
      useModularPromptArchitecture: useModularPromptArchitectureForDebug,
      debugEnabled: ENABLE_INTERNAL_DEBUG_ENDPOINTS
    },
    resolvedScenario: {
      source: context.scenarioSource,
      scenarioId: context.scenario.id,
      title: context.scenario.title
    },
    resolvedIndustry: {
      industryId: context.industryId,
      label: context.industryLabel,
      baselineSource,
      baselinePreview: (context.industryBaseline ?? "").slice(0, 300),
      ...(includeFull ? { baseline: context.industryBaseline ?? "" } : {})
    },
    trainingPack: activeTrainingPack && useModularPromptArchitectureForDebug
      ? {
          applied: true,
          id: activeTrainingPack.id,
          title: activeTrainingPack.title
        }
      : { applied: false },
    ...(INCLUDE_INTERNAL_DEBUG_DIAGNOSTICS
      ? {
          trainingPackDiagnostics: {
            resolvedOrgId: resolvedOrgId || null,
            rawSqlOrgIdPassedToGetActiveTrainingPackForOrg,
            storeGetActiveTrainingPackForOrgResult: directStoreActivePack,
            listTrainingPacksForOrgCount: packsReturnedByListCount,
            requestedScenarioIdUsedByGate: requestedScenarioIdForGate,
            scopedScenarioIdsComputedFromTriggers: scopedScenarioIdsForGate,
            gateReturned: activeTrainingPack ? "pack" : "null",
            ...(trainingPackStoreDiagnosticsError ? { error: trainingPackStoreDiagnosticsError } : {})
          }
        }
      : {}),
    roleplayPrompt: {
      systemPromptPreview: roleplaySystemPromptPreview,
      includedSections: roleplaySections,
      ...(includeFull
        ? {
            systemPrompt: roleplayConfig.systemPrompt,
            openingPrompt: roleplayConfig.openingPrompt
          }
        : {})
    },
    evaluationPrompt: {
      systemPromptPreview: evaluationPrompt.slice(0, 1200),
      ...(evaluationConfig
        ? {
            scoringWeights: evaluationConfig.scoringWeights,
            usesOverrides: evaluationConfig.usesTrainingPackScoringOverrides
          }
        : { usesOverrides: false }),
      ...(includeFull ? { systemPrompt: evaluationPrompt } : {})
    },
    warnings: warningsForResponse
  });
});

app.post("/mobile/users/:userId/ai/opening", requireMobileAiAuthentication, aiRouteRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  const routeStartedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=opening userId=${userId} correlationId=${correlationId}`);
  const body = request.body as {
    scenarioId?: string;
    trainingId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    industryId?: unknown;
    industryBaseline?: unknown;
    speechPrefetch?: unknown;
    simulationSessionId?: unknown;
    sessionId?: unknown;
  };
  const requestBodyRecord = body as Record<string, unknown>;
  const simulationSessionId = resolveRecognizedSimulationSessionId(request, requestBodyRecord);
  const scenarioId = body.scenarioId?.trim();
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;
  const requestedSpeechPrefetch = parseSimulationSpeechPrefetchRequest(body.speechPrefetch);

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  const loadOpeningContext = async (
    allowTrainingWorkspaceBootstrap: boolean,
  ): Promise<
    | {
        bootstrapOrgId: string;
      }
    | {
        user: UserProfile;
        actingOrgId: string | null;
        isSuperUser: boolean;
        maxSimulationMinutes: number | null;
        runtime: SimulationRuntimeBundle;
        workspaceBootstrapPerformed: boolean;
      }
    | null
  > => {
    return await withDatabaseRead(async (db) => {
      const user = getUserById(db, userId);
      if (!user) {
        response.status(404).json({ error: "User not found." });
        return null;
      }

      if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
        response.status(401).json({ error: "Invalid mobile token." });
        return null;
      }

      const accessContext = resolveMobileAccessContext(db, user, request, response, {
        requireSuperUserOrgSelection: true,
      });
      if (!accessContext) {
        return null;
      }

      const entitlements = computeEntitlements(db, user, new Date(), {
        actingOrgId: accessContext.actingOrgId,
      });
      if (!entitlements.canStartSimulation) {
        respondWithEntitlementDenial(response, entitlements);
        return null;
      }

      const aiBudgetError = await resolveAiBudgetLimitError(user, new Date());
      if (aiBudgetError) {
        response.status(429).json({ error: aiBudgetError });
        return null;
      }

      const org = accessContext.actingOrg;
      const runtime = await resolveSimulationRuntimeBundle({
        db,
        user,
        org,
        actingOrgId: accessContext.actingOrgId,
        scenarioId,
        trainingId,
        difficulty,
        personaStyle,
        requestedIndustryId: body.industryId,
        requestedIndustryBaseline: body.industryBaseline,
        simulationSessionId,
        response,
      });
      if (!runtime || "bootstrapOrgId" in runtime) {
        return runtime;
      }
      return {
        user,
        actingOrgId: accessContext.actingOrgId,
        isSuperUser: accessContext.isSuperUser,
        maxSimulationMinutes: entitlements.limits.maxSimulationMinutes,
        runtime,
        workspaceBootstrapPerformed: allowTrainingWorkspaceBootstrap,
      };
    });
  };

  let contextResult = await loadOpeningContext(false);
  if (contextResult && "bootstrapOrgId" in contextResult) {
    const bootstrapOrgId = contextResult.bootstrapOrgId;
    await withDatabaseWrite(async (db) => {
      const org = getOrgById(db, bootstrapOrgId);
      if (org) {
        await ensureOrgTrainingWorkspace(db, org);
      }
    });
    contextResult = await loadOpeningContext(true);
  }

  if (!contextResult || "bootstrapOrgId" in contextResult) {
    return;
  }
  const context = contextResult;

  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "opening",
    correlationId,
    stage: "context_ready",
    elapsedMs: Date.now() - routeStartedAtMs,
    workspaceBootstrapPerformed: context.workspaceBootstrapPerformed,
    useModularPromptArchitecture: context.runtime.useModularPromptArchitecture,
    cacheStatus: context.runtime.cacheStatus,
    cacheReason: context.runtime.cacheReason,
    contextBuildMs: context.runtime.contextBuildMs,
    trainingPackLookupMs: context.runtime.trainingPackLookupMs,
  });

  try {
    const promptMessages = [
      { role: "system" as const, content: context.runtime.systemPrompt },
      { role: "user" as const, content: context.runtime.openingPrompt }
    ];
    const promptChars = promptMessages.reduce((total, message) => total + message.content.length, 0);
    const { completion, latencyMs, usageEventId } = await requestSimulationCompletion({
      route: "opening",
      messages: promptMessages,
      temperature: 0.8,
      correlationId,
      budgetContext: {
        user: context.user,
        orgId: context.actingOrgId,
        divisionId: context.runtime.divisionId,
        segmentId: context.runtime.segment.id,
        scenarioId: context.runtime.scenario.id,
      },
    });
    const assistantText = completion.text.trim();
    const speechPrefetchPromise = maybeBuildSimulationSpeechPrefetch({
      route: "opening",
      correlationId,
      text: assistantText,
      request: requestedSpeechPrefetch,
      budgetContext: {
        user: context.user,
        orgId: context.actingOrgId,
        divisionId: context.runtime.divisionId,
        segmentId: context.runtime.segment.id,
        scenarioId: context.runtime.scenario.id,
        allowDuringActiveSimulation: true,
      },
    });
    const speechPrefetch = await resolveSpeechPrefetchForAssistantPayload({
      route: "opening",
      correlationId,
      promise: speechPrefetchPromise,
    });

    response.setHeader("X-Correlation-Id", correlationId);
    response.json({
      assistantText,
      usage: completion.usage,
      model: completion.model,
      promptVersion: AI_PROMPT_VERSION,
      speechPrefetch,
      trainingPack: context.runtime.activeTrainingPack
        ? {
            applied: true,
            id: context.runtime.activeTrainingPack.id,
            title: context.runtime.activeTrainingPack.title
          }
        : {
            applied: false
          }
    });
    activateSimulationAiBudgetGrace(context.user.id, context.maxSimulationMinutes);
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "opening",
      correlationId,
      stage: "response_sent",
      elapsedMs: Date.now() - routeStartedAtMs,
      modelLatencyMs: latencyMs,
      workspaceBootstrapPerformed: context.workspaceBootstrapPerformed,
      promptChars,
      systemPromptChars: context.runtime.systemPrompt.length,
      openingPromptChars: context.runtime.openingPrompt.length,
      trainingPackLookupMs: context.runtime.trainingPackLookupMs,
      maxOutputTokens: OPENAI_MODEL_CONFIG.simulation.routes.opening.maxOutputTokens,
      cacheStatus: context.runtime.cacheStatus,
      cacheReason: context.runtime.cacheReason,
      contextBuildMs: context.runtime.contextBuildMs,
      speechPrefetchRequested: Boolean(requestedSpeechPrefetch),
      speechPrefetchAvailable: Boolean(speechPrefetch),
      speechPrefetchChunkCount: speechPrefetch?.chunkCount ?? null,
      speechPrefetchTtsLatencyMs: speechPrefetch?.ttsLatencyMs ?? null,
      speechPrefetchBytes: speechPrefetch ? Buffer.byteLength(speechPrefetch.audioBase64, "base64") : null,
    });

    if (!context.isSuperUser) {
      runSimulationPostResponseTask(async () => {
        const anchoredDivisionId = await resolveAnchoredSimulationDivisionId({
          simulationSessionId,
          userId: context.user.id,
          orgId: context.actingOrgId,
          scenarioId: context.runtime.scenario.id,
          trainingId,
          fallbackDivisionId: context.runtime.divisionId,
        });
        await withDatabaseWrite(async (db) => {
          const user = getUserById(db, context.user.id);
          if (!user) {
            return;
          }

          const aiDetails = buildPersistedSimulationAiDetails({
            requestedModel: OPENAI_SIMULATION_MODEL,
            responseModel: completion.model,
            usage: completion.usage,
            latencyMs
          });

          const event: AiUsageEvent = {
            id: usageEventId,
            kind: "opening",
            userId: user.id,
            orgId: context.actingOrgId,
            divisionId: anchoredDivisionId,
            segmentId: context.runtime.segment.id,
            scenarioId: context.runtime.scenario.id,
            model: aiDetails.responseModel,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: toUsageEventToken(aiDetails.tokenUsage.inputTokens),
            outputTokens: toUsageEventToken(aiDetails.tokenUsage.outputTokens),
            totalTokens: toUsageEventToken(aiDetails.tokenUsage.totalTokens),
            createdAt: nowIso()
          };

          await aiUsageEventAccess.append(event);
          appendMobileAuditEvent(db, user, {
            action: "ai.simulation.opening.details",
            userId: user.id,
            orgId: context.actingOrgId,
            message: "Stored AI details for simulation opening step.",
            metadata: {
              route: "opening",
              segmentId: context.runtime.segment.id,
              scenarioId: context.runtime.scenario.id,
              aiDetails
            }
          });
        });
      }, {
        logKey: "ai-usage:opening",
        description: "failed to persist opening event"
      });
    }

    runSimulationPostResponseTask(async () => {
      await touchRecognizedSimulationSessionBestEffort({
        simulationSessionId,
        trainingPackId: context.runtime.activeTrainingPack?.id ?? null,
        logKey: "simulation-session:opening"
      });
    }, {
      logKey: "simulation-session:opening",
      description: "failed to touch recognized session after opening"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "opening",
      correlationId,
      stage: "error",
      elapsedMs: Date.now() - routeStartedAtMs,
      error: message,
    });
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/ai/turn", requireMobileAiAuthentication, aiRouteRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  const routeStartedAtMs = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=turn userId=${userId} correlationId=${correlationId}`);
  const body = request.body as {
    scenarioId?: string;
    trainingId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    industryId?: unknown;
    industryBaseline?: unknown;
    trainingPackId?: unknown;
    speechPrefetch?: unknown;
    history?: unknown;
    sessionId?: unknown;
    transcript?: unknown;
    audio?: unknown;
    audioUri?: unknown;
    audioBase64?: unknown;
    text?: unknown;
  };

  const scenarioId = body.scenarioId?.trim();
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;
  const submittedTrainingPackId =
    typeof body.trainingPackId === "string" && body.trainingPackId.trim() ? body.trainingPackId.trim() : null;
  const requestedSpeechPrefetch = parseSimulationSpeechPrefetchRequest(body.speechPrefetch);
  const history = normalizeDialogueHistory(body.history, { maxTurns: 24 });
  const requestBodyRecord = body as Record<string, unknown>;
  const sessionId = resolveSimulationSessionId(request, requestBodyRecord);
  const recognizedSessionId = resolveRecognizedSimulationSessionId(request, requestBodyRecord);
  const latestUserText = getLatestUserTextFromHistory(history);
  const placeholderDetected = hasPlaceholderOrMissingUserText(latestUserText);
  const payloadType = detectSimulationPayloadType(request, requestBodyRecord);

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  if (history.length === 0) {
    response.status(400).json({ error: "history is required." });
    return;
  }

  logSimulationUserTextDiagnostics({
    route: "turn",
    sessionId,
    userText: latestUserText,
    placeholderDetected,
    payloadType
  });

  if (placeholderDetected) {
    // eslint-disable-next-line no-console
    console.warn("[simulation-no-transcript]", {
      route: "turn",
      correlationId,
      sessionId,
      payloadMode: payloadType.mode,
      payloadFlags: payloadType,
      placeholderDetected,
    });
    response.status(422).json({
      error: "No transcribed user text received. Transcription may have failed or client is sending placeholder.",
      hint: "Run transcription first and send real user transcript text in history. Do not send placeholder text like 'Voice input captured ...'."
    });
    return;
  }

  const loadTurnContext = async (
    allowTrainingWorkspaceBootstrap: boolean,
  ): Promise<
    | {
        bootstrapOrgId: string;
      }
    | {
        user: UserProfile;
        actingOrgId: string | null;
        isSuperUser: boolean;
        maxSimulationMinutes: number | null;
        runtime: SimulationRuntimeBundle;
        workspaceBootstrapPerformed: boolean;
      }
    | null
  > => {
    return await withDatabaseRead(async (db) => {
      const user = getUserById(db, userId);
      if (!user) {
        response.status(404).json({ error: "User not found." });
        return null;
      }

      if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
        response.status(401).json({ error: "Invalid mobile token." });
        return null;
      }

      const accessContext = resolveMobileAccessContext(db, user, request, response, {
        requireSuperUserOrgSelection: true,
      });
      if (!accessContext) {
        return null;
      }

      const entitlements = computeEntitlements(db, user, new Date(), {
        allowDuringActiveSimulation: true,
        actingOrgId: accessContext.actingOrgId
      });
      if (!entitlements.canStartSimulation) {
        respondWithEntitlementDenial(response, entitlements);
        return null;
      }

      const aiBudgetError = await resolveAiBudgetLimitError(user, new Date(), {
        allowDuringActiveSimulation: true
      });
      if (aiBudgetError) {
        response.status(429).json({ error: aiBudgetError });
        return null;
      }

      const org = accessContext.actingOrg;
      const runtime = await resolveSimulationRuntimeBundle({
        db,
        user,
        org,
        actingOrgId: accessContext.actingOrgId,
        scenarioId,
        trainingId,
        difficulty,
        personaStyle,
        requestedIndustryId: body.industryId,
        requestedIndustryBaseline: body.industryBaseline,
        submittedTrainingPackId,
        simulationSessionId: recognizedSessionId,
        response,
      });
      if (!runtime || "bootstrapOrgId" in runtime) {
        return runtime;
      }
      return {
        user,
        actingOrgId: accessContext.actingOrgId,
        isSuperUser: accessContext.isSuperUser,
        maxSimulationMinutes: entitlements.limits.maxSimulationMinutes,
        runtime,
        workspaceBootstrapPerformed: allowTrainingWorkspaceBootstrap,
      };
    });
  };

  let contextResult = await loadTurnContext(false);
  if (contextResult && "bootstrapOrgId" in contextResult) {
    const bootstrapOrgId = contextResult.bootstrapOrgId;
    await withDatabaseWrite(async (db) => {
      const org = getOrgById(db, bootstrapOrgId);
      if (org) {
        await ensureOrgTrainingWorkspace(db, org);
      }
    });
    contextResult = await loadTurnContext(true);
  }

  if (!contextResult || "bootstrapOrgId" in contextResult) {
    return;
  }
  const context = contextResult;

  // eslint-disable-next-line no-console
  console.log("[simulation-route]", {
    route: "turn",
    correlationId,
    stage: "context_ready",
    elapsedMs: Date.now() - routeStartedAtMs,
    workspaceBootstrapPerformed: context.workspaceBootstrapPerformed,
    historyCount: history.length,
    useModularPromptArchitecture: context.runtime.useModularPromptArchitecture,
    cacheStatus: context.runtime.cacheStatus,
    cacheReason: context.runtime.cacheReason,
    contextBuildMs: context.runtime.contextBuildMs,
    trainingPackLookupMs: context.runtime.trainingPackLookupMs,
  });

  try {
    const turnResult = await generateSimulationTurnReply({
      correlationId,
      history,
      runtime: context.runtime,
      requestedSpeechPrefetch,
      budgetContext: {
        user: context.user,
        orgId: context.actingOrgId,
        divisionId: context.runtime.divisionId,
        segmentId: context.runtime.segment.id,
        scenarioId: context.runtime.scenario.id,
        allowDuringActiveSimulation: true,
      },
    });

    response.setHeader("X-Correlation-Id", correlationId);
    response.json({
      assistantText: turnResult.assistantText,
      usage: turnResult.completion.usage,
      model: turnResult.completion.model,
      promptVersion: AI_PROMPT_VERSION,
      speechPrefetch: turnResult.speechPrefetch,
    });
    activateSimulationAiBudgetGrace(context.user.id, context.maxSimulationMinutes);
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "turn",
      correlationId,
      stage: "response_sent",
      elapsedMs: Date.now() - routeStartedAtMs,
      modelLatencyMs: turnResult.modelLatencyMs,
      workspaceBootstrapPerformed: context.workspaceBootstrapPerformed,
      historyCount: history.length,
      historyChars: turnResult.historyChars,
      promptChars: turnResult.promptChars,
      systemPromptChars: context.runtime.systemPrompt.length,
      trainingPackLookupMs: context.runtime.trainingPackLookupMs,
      cacheStatus: context.runtime.cacheStatus,
      cacheReason: context.runtime.cacheReason,
      contextBuildMs: context.runtime.contextBuildMs,
      speechPrefetchRequested: Boolean(requestedSpeechPrefetch),
      speechPrefetchAvailable: Boolean(turnResult.speechPrefetch),
      speechPrefetchChunkCount: turnResult.speechPrefetch?.chunkCount ?? null,
      speechPrefetchTtsLatencyMs: turnResult.speechPrefetch?.ttsLatencyMs ?? null,
      speechPrefetchBytes: turnResult.speechPrefetch ? Buffer.byteLength(turnResult.speechPrefetch.audioBase64, "base64") : null,
    });

    if (!context.isSuperUser) {
      runSimulationPostResponseTask(async () => {
        const anchoredDivisionId = await resolveAnchoredSimulationDivisionId({
          simulationSessionId: recognizedSessionId,
          userId: context.user.id,
          orgId: context.actingOrgId,
          scenarioId: context.runtime.scenario.id,
          trainingId,
          fallbackDivisionId: context.runtime.divisionId,
        });
        await withDatabaseWrite(async (db) => {
          const user = getUserById(db, context.user.id);
          if (!user) {
            return;
          }

          const aiDetails = buildPersistedSimulationAiDetails({
            requestedModel: OPENAI_SIMULATION_MODEL,
            responseModel: turnResult.completion.model,
            usage: turnResult.completion.usage,
            latencyMs: turnResult.modelLatencyMs
          });

          const event: AiUsageEvent = {
            id: turnResult.usageEventId,
            kind: "turn",
            userId: user.id,
            orgId: context.actingOrgId,
            divisionId: anchoredDivisionId,
            segmentId: context.runtime.segment.id,
            scenarioId: context.runtime.scenario.id,
            model: aiDetails.responseModel,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: null,
            inputTokens: toUsageEventToken(aiDetails.tokenUsage.inputTokens),
            outputTokens: toUsageEventToken(aiDetails.tokenUsage.outputTokens),
            totalTokens: toUsageEventToken(aiDetails.tokenUsage.totalTokens),
            createdAt: nowIso()
          };

          await aiUsageEventAccess.append(event);
          appendMobileAuditEvent(db, user, {
            action: "ai.simulation.turn.details",
            userId: user.id,
            orgId: context.actingOrgId,
            message: "Stored AI details for simulation turn step.",
            metadata: {
              route: "turn",
              sessionId,
              segmentId: context.runtime.segment.id,
              scenarioId: context.runtime.scenario.id,
              aiDetails
            }
          });
        });
      }, {
        logKey: "ai-usage:turn",
        description: "failed to persist turn event"
      });
    }

    runSimulationPostResponseTask(async () => {
      await touchRecognizedSimulationSessionBestEffort({
        simulationSessionId: recognizedSessionId,
        trainingPackId: context.runtime.activeTrainingPack?.id ?? null,
        logKey: "simulation-session:turn"
      });
    }, {
      logKey: "simulation-session:turn",
      description: "failed to touch recognized session after turn"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    // eslint-disable-next-line no-console
    console.log("[simulation-route]", {
      route: "turn",
      correlationId,
      stage: "error",
      elapsedMs: Date.now() - routeStartedAtMs,
      historyCount: history.length,
      error: message,
    });
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/ai/score", requireMobileAiAuthentication, aiRouteRateLimiter, async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const correlationId = resolveSimulationCorrelationId(request);
  // eslint-disable-next-line no-console
  console.log(`[request-hit] route=score userId=${userId}`);
  const body = request.body as {
    scenarioId?: string;
    trainingId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    industryId?: unknown;
    industryBaseline?: unknown;
    trainingPackId?: unknown;
    startedAt?: string;
    endedAt?: string;
    history?: unknown;
    sessionId?: unknown;
    transcript?: unknown;
    audio?: unknown;
    audioUri?: unknown;
    audioBase64?: unknown;
    text?: unknown;
  };

  const scenarioId = body.scenarioId?.trim();
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;
  const submittedTrainingPackId =
    typeof body.trainingPackId === "string" && body.trainingPackId.trim() ? body.trainingPackId.trim() : null;
  const history = normalizeDialogueHistory(body.history, { maxTurns: null });
  const requestBodyRecord = body as Record<string, unknown>;
  const sessionId = resolveSimulationSessionId(request, requestBodyRecord);
  const recognizedSessionId = resolveRecognizedSimulationSessionId(request, requestBodyRecord);
  const latestUserText = getLatestUserTextFromHistory(history);
  const placeholderDetected = hasPlaceholderOrMissingUserText(latestUserText);
  const placeholderDetectedInHistory = hasAnyPlaceholderUserText(history);
  const payloadType = detectSimulationPayloadType(request, requestBodyRecord);

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  const parsedStart = parseIsoDateOrNull(body.startedAt);
  const parsedEnd = parseIsoDateOrNull(body.endedAt);
  if (!parsedStart || !parsedEnd) {
    response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
    return;
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
    return;
  }

  if (history.length === 0) {
    response.status(400).json({ error: "history is required." });
    return;
  }

  logSimulationUserTextDiagnostics({
    route: "score",
    sessionId,
    userText: latestUserText,
    placeholderDetected,
    payloadType
  });

  if (placeholderDetected) {
    // eslint-disable-next-line no-console
    console.warn("[simulation-no-transcript]", {
      route: "score",
      correlationId,
      sessionId,
      payloadMode: payloadType.mode,
      payloadFlags: payloadType,
      placeholderDetected,
      placeholderDetectedInHistory,
    });
    response.status(422).json({
      error: "No transcribed user text received. Transcription may have failed or client is sending placeholder.",
      hint: "Submit score only when history includes real transcribed user text. Do not send placeholder text like 'Voice input captured ...'."
    });
    return;
  }

  if (placeholderDetectedInHistory) {
    // eslint-disable-next-line no-console
    console.warn("[simulation-no-transcript]", {
      route: "score",
      correlationId,
      sessionId,
      payloadMode: payloadType.mode,
      payloadFlags: payloadType,
      placeholderDetected,
      placeholderDetectedInHistory,
    });
    response.status(422).json({
      error:
        "No transcribed user text received in full history. This session appears to include local mock transcript text, so score tracking is disabled.",
      hint:
        "Only score sessions where every user turn comes from real transcription. Do not include placeholder text like 'Voice input captured ...'."
    });
    return;
  }

  const userTurnCount = countUserTurnsForScoring(history);

  const context = await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      allowDuringActiveSimulation: true,
      actingOrgId: accessContext.actingOrgId
    });
    if (!entitlements.canStartSimulation) {
      respondWithEntitlementDenial(response, entitlements);
      return null;
    }

    const aiBudgetError = await resolveAiBudgetLimitError(user, new Date(), {
      allowDuringActiveSimulation: true
    });
    if (aiBudgetError) {
      response.status(429).json({ error: aiBudgetError });
      return null;
    }

    const org = accessContext.actingOrg;
    if (org) {
      await ensureOrgTrainingWorkspace(db, org);
    }

    const configForUser = resolveConfigForUser(db, user, accessContext.actingOrgId);
    if (configForUser.featureFlags?.scoringEnabled === false) {
      response.status(403).json({ error: "Scoring is currently disabled for this account." });
      return null;
    }

    const resolvedScenario = resolveMobileScenarioForUser(configForUser, scenarioId, trainingId);
    if (!resolvedScenario) {
      response.status(400).json({ error: "Invalid scenario for this account." });
      return null;
    }
    const useModularPromptArchitecture =
      USE_MODULAR_PROMPT_ARCHITECTURE_ENV && org?.enableModularPromptArchitecture === true;

    const industryPromptContext = resolveAiIndustryPromptContextForAllowedIndustries(
      configForUser,
      resolvedScenario.allowedIndustryIds,
      body.industryId,
      body.industryBaseline,
      {
        preferClientBaselineSnapshot: false,
        canonicalIndustryDefinitions: db.config.industries
      }
    );
    const scoringGuidance = resolveScenarioScoringGuidanceForEvaluation(
      configForUser,
      resolvedScenario,
      industryPromptContext.industryId
    );

    return {
      user,
      org,
      actingOrgId: accessContext.actingOrgId,
      isSuperUser: accessContext.isSuperUser,
      segment: resolvedScenario.segment,
      scenario: resolvedScenario.scenario,
      resolvedScenarioSource: resolvedScenario.source,
      difficulty: difficulty ?? configForUser.defaultDifficulty,
      personaStyle: personaStyle ?? configForUser.defaultPersonaStyle,
      industryId: industryPromptContext.industryId,
      industryLabel: industryPromptContext.industryLabel,
      industryBaseline: industryPromptContext.industryBaseline,
      scoringGuidance,
      divisionId: resolveSimulationDivisionIdForContext({
        db,
        user,
        org,
        trainingId,
        resolvedScenario,
      }),
      useModularPromptArchitecture
    };
  });

  if (!context) {
    return;
  }

  if (userTurnCount < MIN_USER_TURNS_FOR_SCORE) {
    response.status(200).json({
      status: "not_scored",
      reason: "insufficient_evidence",
      userTurnCount,
      minimumUserTurns: MIN_USER_TURNS_FOR_SCORE,
      message: `We need at least ${MIN_USER_TURNS_FOR_SCORE} real user responses to generate a reliable scorecard. This session was not scored.`
    });
    return;
  }

  const activeTrainingPack = await resolvePersistedTrainingPackForScenario({
    orgId: context.actingOrgId,
    scenarioId: context.scenario.id,
    useModularPromptArchitecture: context.useModularPromptArchitecture,
    submittedTrainingPackId
  });

  try {
    const recognizedSession =
      recognizedSessionId && !context.isSuperUser
        ? await simulationSessionStore.getById(recognizedSessionId)
        : null;
    const evaluationConfig = context.useModularPromptArchitecture
      ? buildEvaluationPromptWithOrchestrator({
          scenario: context.scenario,
          difficulty: context.difficulty,
          segmentLabel: context.segment.label,
          personaStyle: context.personaStyle,
          industryLabel: context.industryLabel,
          industryBaseline: context.industryBaseline,
          scoringGuidance: context.scoringGuidance,
          trainingPack: activeTrainingPack,
          logger: (message) => logWarnThrottled("training-pack:weights", message)
        })
      : null;
    const evaluationPrompt =
      evaluationConfig?.evaluationPrompt ??
      buildEvaluationSystemPrompt({
        scenario: context.scenario,
        difficulty: context.difficulty,
        segmentLabel: context.segment.label,
        personaStyle: context.personaStyle,
        industryLabel: context.industryLabel,
        industryBaseline: context.industryBaseline,
        scoringGuidance: context.scoringGuidance,
      });

    const transcript = formatDialogueForEvaluation(history);
    const { completion, latencyMs, usageEventId } = await requestSimulationCompletion({
      route: "score",
      messages: [
        { role: "system", content: evaluationPrompt },
        { role: "user", content: `Conversation transcript:\n${transcript}` }
      ],
      temperature: 0.2,
      correlationId,
      budgetContext: {
        user: context.user,
        orgId: context.actingOrgId,
        divisionId: context.divisionId,
        segmentId: context.segment.id,
        scenarioId: context.scenario.id,
        allowDuringActiveSimulation: true,
      },
    });
    const aiDetails = buildPersistedSimulationAiDetails({
      requestedModel: OPENAI_SCORING_MODEL,
      responseModel: completion.model,
      usage: completion.usage,
      latencyMs
    });

    const parsed = JSON.parse(extractJsonObject(completion.text)) as unknown;
    assertValidSimulationScorePayload(parsed);
    const scoringWeights = evaluationConfig?.scoringWeights ?? getDefaultScoringWeights();
    const scorecard = normalizeSimulationScorecard(parsed, scoringWeights);
    const coachingArtifact = buildSimulationScoreCoachingArtifactFromScorecard(scorecard);
    const normalizedCoachingThemes = buildNormalizedSimulationScoreThemesFromArtifact(coachingArtifact);

    const now = nowIso();
    const scoreRecordId = recognizedSessionId ? `score_${recognizedSessionId}` : `score_${uuid()}`;
    const divisionId = resolvePreferredSimulationDivisionId({
      recognizedSession,
      userId: context.user.id,
      orgId: context.actingOrgId,
      scenarioId: context.scenario.id,
      trainingId,
      fallbackDivisionId: context.divisionId ?? null,
    });
    const record: SimulationScoreRecord = {
      id: scoreRecordId,
      simulationSessionId: recognizedSessionId,
      userId: context.user.id,
      orgId: context.actingOrgId,
      divisionId,
      segmentId: context.segment.id,
      scenarioId: context.scenario.id,
      trainingId,
      trainingPackId: activeTrainingPack?.id ?? null,
      industryId: context.industryId,
      startedAt: parsedStart.toISOString(),
      endedAt: parsedEnd.toISOString(),
      communicationScore: scorecard.communicationScore,
      outcomeScore: scorecard.outcomeScore,
      overallScore: scorecard.overallScore,
      completionLevel: scorecard.completionLevel,
      objectiveAchieved: scorecard.objectiveAchieved,
      persuasion: scorecard.persuasion,
      clarity: scorecard.clarity,
      empathy: scorecard.empathy,
      assertiveness: scorecard.assertiveness,
      summary: scorecard.summary,
      coachingArtifact,
      normalizedCoachingThemes,
      rubricVersion: AI_RUBRIC_VERSION,
      model: aiDetails.responseModel,
      promptVersion: AI_PROMPT_VERSION,
      inputTokens: toUsageEventToken(aiDetails.tokenUsage.inputTokens),
      outputTokens: toUsageEventToken(aiDetails.tokenUsage.outputTokens),
      totalTokens: toUsageEventToken(aiDetails.tokenUsage.totalTokens),
      createdAt: now
    };

    if (!context.isSuperUser) {
      try {
        await withDatabase(async (db) => {
          const user = getUserById(db, context.user.id);
          if (!user) {
            throw new Error("User not found while saving score.");
          }

          await scoreRecordAccess.append(db, record);
          syncTrainingPackAssignmentsForUserPack(db, context.actingOrgId, user.id, record.trainingPackId ?? null);

          const event: AiUsageEvent = {
            id: usageEventId,
            kind: "score",
            userId: user.id,
            orgId: context.actingOrgId,
            divisionId: record.divisionId ?? null,
            segmentId: context.segment.id,
            scenarioId: context.scenario.id,
            model: aiDetails.responseModel,
            promptVersion: AI_PROMPT_VERSION,
            rubricVersion: AI_RUBRIC_VERSION,
            inputTokens: toUsageEventToken(aiDetails.tokenUsage.inputTokens),
            outputTokens: toUsageEventToken(aiDetails.tokenUsage.outputTokens),
            totalTokens: toUsageEventToken(aiDetails.tokenUsage.totalTokens),
            createdAt: nowIso()
          };

          await aiUsageEventAccess.append(event);
          appendMobileAuditEvent(db, user, {
            action: "ai.simulation.score.details",
            userId: user.id,
            orgId: context.actingOrgId,
            message: "Stored AI details for simulation score step.",
            metadata: {
              route: "score",
              sessionId,
              segmentId: context.segment.id,
              scenarioId: context.scenario.id,
              aiDetails
            }
          });
        });
      } catch (persistError) {
        const message = persistError instanceof Error ? persistError.message : String(persistError);
        logWarnThrottled("ai-usage:score", `[ai-usage] failed to persist score artifacts: ${message}`);
        // eslint-disable-next-line no-console
        console.warn("[simulation-score-persist-failed]", {
          route: "score",
          correlationId,
          sessionId,
          simulationSessionId: recognizedSessionId ?? null,
          userId: context.user.id,
          orgId: context.actingOrgId,
          segmentId: context.segment.id,
          scenarioId: context.scenario.id,
          scoringStage: "score_persistence",
          errorCategory: "score_persistence_failed",
          reason: message
        });
        response.status(503).json({
          error: "Score was generated but could not be saved. Please retry once the service is healthy."
        });
        return;
      }
    }

    await touchRecognizedSimulationSessionBestEffort({
      simulationSessionId: recognizedSessionId,
      trainingPackId: record.trainingPackId ?? null,
      logKey: "simulation-session:score"
    });

    response.status(201).json({
      status: "scored",
      scorecard,
      record: {
        id: record.id,
        createdAt: record.createdAt,
        trainingPackId: record.trainingPackId ?? null,
        model: record.model,
        promptVersion: record.promptVersion,
        rubricVersion: record.rubricVersion,
        usage: {
          inputTokens: record.inputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          totalTokens: record.totalTokens ?? 0
        }
      }
    });
    clearSimulationAiBudgetGrace(context.user.id);
    clearSimulationOrgMonthlyOverrunGrace(context.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Score generation failed.";
    // eslint-disable-next-line no-console
    console.warn("[simulation-score-failed]", {
      route: "score",
      correlationId,
      sessionId,
      simulationSessionId: recognizedSessionId ?? null,
      userId: context.user.id,
      orgId: context.actingOrgId,
      scenarioId: context.scenario.id,
      scoringStage: error instanceof SimulationScorePayloadValidationError ? "score_payload_validation" : "score_generation",
      errorCategory:
        error instanceof SyntaxError || error instanceof SimulationScorePayloadValidationError
          ? "invalid_score_payload"
          : "score_generation_failed",
      reason: message
    });
    response.status(error instanceof AiBudgetLimitError ? 429 : 503).json({ error: message });
  }
});

app.get("/mobile/users/:userId/ai/score", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const simulationSessionId = normalizeSimulationSessionId(request.query.simulationSessionId);
  if (!simulationSessionId) {
    response.status(400).json({ error: "simulationSessionId is required." });
    return;
  }

  await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return;
    }

    const record =
      scoreRecordAccess
        .list(db, {
          userId: user.id,
          simulationSessionId,
        })
        .at(-1) ?? null;

    if (!record) {
      response.status(404).json({ error: "Score not found for this session." });
      return;
    }

    if (!isRecoverableSimulationScoreRecord(record)) {
      response.status(404).json({ error: "Recoverable score not found for this session." });
      return;
    }

    response.json(buildRecoveredSimulationEvaluationResult(record));
  });
});

app.post("/mobile/users/:userId/scores", async (request: Request, response: Response) => {
  if (!ENABLE_INTERNAL_DEBUG_ENDPOINTS) {
    response.status(410).json({
      error: "Legacy manual score recording is disabled for normal testing. Use /mobile/users/:userId/ai/score."
    });
    return;
  }

  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as RecordSimulationScoreRequest;
  const segmentId = body.segmentId?.trim();
  const scenarioId = body.scenarioId?.trim();
  const recognizedSessionId = normalizeSimulationSessionId(body.simulationSessionId);
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const submittedTrainingPackId =
    typeof body.trainingPackId === "string" && body.trainingPackId.trim() ? body.trainingPackId.trim() : null;

  if (!segmentId || !scenarioId) {
    response.status(400).json({ error: "segmentId and scenarioId are required." });
    return;
  }

  const parsedStart = parseIsoDateOrNull(body.startedAt);
  const parsedEnd = parseIsoDateOrNull(body.endedAt);
  if (!parsedStart || !parsedEnd) {
    response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
    return;
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return;
    }

    const org = accessContext.actingOrg;
    if (org) {
      await ensureOrgTrainingWorkspace(db, org);
    }

    const configForUser = resolveConfigForUser(db, user, accessContext.actingOrgId);
    if (configForUser.featureFlags?.scoringEnabled === false) {
      response.status(403).json({ error: "Scoring is currently disabled for this account." });
      return;
    }
    const resolvedScenario = resolveMobileScenarioForUser(configForUser, scenarioId, trainingId);
    if (!resolvedScenario) {
      response.status(400).json({ error: "Invalid scenario for score record." });
      return;
    }
    if (resolvedScenario.segment.id !== segmentId) {
      response.status(400).json({ error: "Scenario does not match the submitted segment." });
      return;
    }
    const useModularPromptArchitecture =
      USE_MODULAR_PROMPT_ARCHITECTURE_ENV && org?.enableModularPromptArchitecture === true;
    const persistedTrainingPack = await resolvePersistedTrainingPackForScenario({
      orgId: accessContext.actingOrgId,
      scenarioId,
      useModularPromptArchitecture,
      submittedTrainingPackId
    });
    const recognizedSession =
      recognizedSessionId && !accessContext.isSuperUser
        ? await simulationSessionStore.getById(recognizedSessionId)
        : null;
    const divisionId = resolvePreferredSimulationDivisionId({
      recognizedSession,
      userId: user.id,
      orgId: accessContext.actingOrgId,
      scenarioId: resolvedScenario.scenario.id,
      trainingId,
      fallbackDivisionId: resolveSimulationDivisionIdForContext({
        db,
        user,
        org,
        trainingId,
        resolvedScenario,
      }),
    });

    const now = new Date();
    const coachingArtifact = normalizeSimulationScoreCoachingArtifact(body.coachingArtifact ?? null);
    const normalizedCoachingThemes = buildNormalizedSimulationScoreThemesFromArtifact(coachingArtifact);
    const normalizedScorecard = normalizeSimulationScorecard(
      {
        communicationScore: body.communicationScore,
        outcomeScore: body.outcomeScore,
        overallScore: body.overallScore,
        completionLevel: body.completionLevel,
        objectiveAchieved: body.objectiveAchieved,
        persuasion: body.persuasion,
        clarity: body.clarity,
        empathy: body.empathy,
        assertiveness: body.assertiveness,
        summary: body.summary
      },
      getDefaultScoringWeights()
    );
    const record: SimulationScoreRecord = {
      id: recognizedSessionId ? `score_${recognizedSessionId}` : `score_${uuid()}`,
      simulationSessionId: recognizedSessionId ?? undefined,
      userId: user.id,
      orgId: accessContext.actingOrgId,
      divisionId,
      segmentId,
      scenarioId,
      trainingId,
      trainingPackId: persistedTrainingPack?.id ?? null,
      startedAt: parsedStart.toISOString(),
      endedAt: parsedEnd.toISOString(),
      communicationScore: normalizedScorecard.communicationScore,
      outcomeScore: normalizedScorecard.outcomeScore,
      overallScore: normalizedScorecard.overallScore,
      completionLevel: normalizedScorecard.completionLevel,
      objectiveAchieved: normalizedScorecard.objectiveAchieved,
      persuasion: normalizedScorecard.persuasion,
      clarity: normalizedScorecard.clarity,
      empathy: normalizedScorecard.empathy,
      assertiveness: normalizedScorecard.assertiveness,
      summary: typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : undefined,
      coachingArtifact,
      normalizedCoachingThemes,
      createdAt: now.toISOString()
    };

    if (!accessContext.isSuperUser) {
      await scoreRecordAccess.append(db, record);
      syncTrainingPackAssignmentsForUserPack(db, accessContext.actingOrgId, user.id, record.trainingPackId ?? null);
    }
    response.status(201).json(record);
  });
});

app.get("/mobile/users/:userId/scores/summary", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const segmentId = typeof request.query.segmentId === "string" ? request.query.segmentId.trim() : "";
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabaseRead(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const industryLabelById = new Map((db.config.industries ?? []).map((industry) => [industry.id, industry.label]));
    const summary = scoreRecordAccess.buildUserScoreSummary({
      db,
      userId: user.id,
      segmentId: segmentId || null,
      periodStartAt: new Date(periodStartAt),
      periodEndAt: now,
      segmentLabelById,
      industryLabelById
    });

    response.json({
      generatedAt: now.toISOString(),
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      filters: { segmentId: segmentId || null },
      totals: summary.totals,
      byDay: summary.byDay,
      bySegment: summary.bySegment,
      byIndustry: summary.byIndustry,
      recent: summary.recent
    });
  });
});

app.get("/mobile/users/:userId/performance/current", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }

    const orgId = accessContext.actingOrgId;
    const usageSessions = orgId ? listUsageSessions(db, { orgId, userId: user.id }) : [];
    const scoreRecords = orgId ? listScoreRecords(db, { orgId, userId: user.id, conclusiveOnly: true }) : [];
    const payload = await buildMobilePerformanceCurrentResponse({
      store: performancePlanStore,
      orgId,
      userId: user.id,
      usageSessions,
      scoreRecords,
      now: new Date()
    });

    response.json(payload);
  });
});

app.get("/mobile/users/:userId/performance/options", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    const userContext = await buildPerformanceUserContext(db, user);
    const payload: MobilePerformancePlanOptionsResponse = buildMobilePerformancePlanOptionsResponse({
      candidates: userContext?.candidates ?? [],
      defaultTimeZone: userContext?.timeZone ?? resolveTimeZone(user.timezone),
      now: new Date()
    });

    response.json(payload);
  });
});

app.post("/mobile/users/:userId/performance/preview", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(403).json({
        error: "Performance goals require an active enterprise account.",
        errors: ["Performance goals require an active enterprise account."]
      });
      return;
    }
    if (rejectMobilePerformanceTargetSpoof(request.body, user.id, accessContext.actingOrgId, response)) {
      return;
    }
    const userContext = await buildPerformanceUserContext(db, user);
    if (!userContext) {
      response.status(403).json({
        error: "Performance goals require an active enterprise account.",
        errors: ["Performance goals require an active enterprise account."]
      });
      return;
    }

    try {
      const input = buildMobilePerformancePlanInput(request.body, userContext.userId, userContext.orgId);
      const payload = previewPerformancePlan({
        orgId: userContext.orgId,
        userId: userContext.userId,
        input,
        candidates: userContext.candidates,
        usageSessions: listUsageSessions(db, { orgId: userContext.orgId, userId: userContext.userId }),
        scoreRecords: listScoreRecords(db, { orgId: userContext.orgId, userId: userContext.userId, conclusiveOnly: true }),
        now: new Date()
      });
      if (!payload.valid) {
        response.status(400).json({
          error: payload.errors[0] ?? "Performance goal input is invalid.",
          errors: payload.errors,
          preview: payload
        });
        return;
      }
      response.json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      throw error;
    }
  });
});

app.post("/mobile/users/:userId/performance/plans", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(403).json({
        error: "Performance goals require an active enterprise account.",
        errors: ["Performance goals require an active enterprise account."]
      });
      return;
    }
    if (rejectMobilePerformanceTargetSpoof(request.body, user.id, accessContext.actingOrgId, response)) {
      return;
    }
    const userContext = await buildPerformanceUserContext(db, user);
    if (!userContext) {
      response.status(403).json({
        error: "Performance goals require an active enterprise account.",
        errors: ["Performance goals require an active enterprise account."]
      });
      return;
    }

    try {
      const now = new Date();
      const usageSessions = listUsageSessions(db, { orgId: userContext.orgId, userId: userContext.userId });
      const scoreRecords = listScoreRecords(db, { orgId: userContext.orgId, userId: userContext.userId, conclusiveOnly: true });
      await finalizeOpenPerformancePlansForUserIfNeeded({
        store: performancePlanStore,
        orgId: userContext.orgId,
        userId: userContext.userId,
        usageSessions,
        scoreRecords,
        now
      });
      const payload = await createPerformancePlanFromInput({
        store: performancePlanStore,
        orgId: userContext.orgId,
        userId: userContext.userId,
        input: buildMobilePerformancePlanInput(request.body, userContext.userId, userContext.orgId),
        candidates: userContext.candidates,
        usageSessions,
        scoreRecords,
        now,
        actorType: "mobile_user",
        actorId: user.id
      });
      response.status(201).json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      if (isDuplicatePerformancePlanError(error)) {
        response.status(409).json({ error: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_MESSAGE, code: PERFORMANCE_DUPLICATE_ACTIVE_PLAN_CODE });
        return;
      }
      throw error;
    }
  });
});

app.get("/mobile/users/:userId/performance/plans", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }

    const orgId = accessContext.actingOrgId;
    const payload: MobilePerformancePlanHistoryResponse = await buildMobilePerformancePlanHistoryResponse({
      store: performancePlanStore,
      orgId,
      userId: user.id,
      usageSessions: orgId ? listUsageSessions(db, { orgId, userId: user.id }) : [],
      scoreRecords: orgId ? listScoreRecords(db, { orgId, userId: user.id, conclusiveOnly: true }) : [],
      now: new Date()
    });

    response.json(payload);
  });
});

app.get("/mobile/users/:userId/performance/plans/:planId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || loaded.plan.orgId !== accessContext.actingOrgId || loaded.plan.userId !== user.id) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const payload: MobilePerformancePlanDetailResponse | null = await buildPerformancePlanDetailResponse({
      store: performancePlanStore,
      planId: loaded.plan.id,
      usageSessions: listUsageSessions(db, { orgId: loaded.plan.orgId, userId: user.id }),
      scoreRecords: listScoreRecords(db, { orgId: loaded.plan.orgId, userId: user.id, conclusiveOnly: true }),
      now: new Date(),
      auditDisplayContext: {
        viewer: "mobile_user",
        currentUserId: user.id,
        planOrgId: loaded.plan.orgId,
        users: db.users.filter((entry) => entry.id === user.id || entry.orgId === loaded.plan.orgId || entry.isSuperUser === true)
      }
    });
    if (!payload) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    response.json(payload);
  });
});

app.get("/mobile/users/:userId/performance/plans/:planId/updates", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || loaded.plan.orgId !== accessContext.actingOrgId || loaded.plan.userId !== user.id) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const payload = await buildPerformancePlanUpdatesResponse({
      store: performancePlanStore,
      planId: loaded.plan.id,
      users: [user],
      now: new Date()
    });
    response.json(payload);
  });
});

app.post("/mobile/users/:userId/performance/plans/:planId/updates", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || loaded.plan.orgId !== accessContext.actingOrgId || loaded.plan.userId !== user.id) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const now = new Date();
    const materialized = await finalizePerformancePlanIfEnded({
      store: performancePlanStore,
      plan: loaded.plan,
      usageSessions: listUsageSessions(db, { orgId: loaded.plan.orgId, userId: user.id }),
      scoreRecords: listScoreRecords(db, { orgId: loaded.plan.orgId, userId: user.id, conclusiveOnly: true }),
      now,
      actorId: user.id
    });
    if (!materialized || materialized.plan.status !== "active") {
      response.status(409).json({
        error: "Updates can only be posted to active or scheduled Performance goals.",
        code: "performance_plan_updates_terminal"
      });
      return;
    }

    try {
      const payload = await createPerformancePlanUpdateForPlan({
        store: performancePlanStore,
        plan: materialized.plan,
        body: (request.body as CreatePerformancePlanUpdateRequest | null)?.body,
        actorType: "mobile_user",
        actorId: user.id,
        now,
        users: [user]
      });
      response.status(201).json(payload);
    } catch (error) {
      if (error instanceof PerformancePlanUpdateInputError) {
        response.status(400).json({ error: error.message, errors: error.errors });
        return;
      }
      if (error instanceof PerformancePlanUpdateConflictError) {
        response.status(409).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  });
});

app.post("/mobile/users/:userId/performance/plans/:planId/cancel", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;

  await withFreshReportingWrite(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response);
    if (!accessContext) {
      return;
    }
    if (!accessContext.actingOrgId) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    const loaded = await performancePlanStore.getPlanById(request.params.planId);
    if (!loaded || loaded.plan.orgId !== accessContext.actingOrgId || loaded.plan.userId !== user.id) {
      response.status(404).json({ error: "Performance goal not found." });
      return;
    }

    response.status(403).json({
      error: "Performance goals can only be cancelled by an authorized dashboard manager.",
      code: "performance_plan_cancel_requires_manager"
    });
  });
});

app.get("/mobile/users/:userId/admin/org/dashboard", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;

  await withDatabaseRead(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }
    Object.assign(org, ensureOrgContractFields(org));

    const now = new Date();
    const usage = buildOrgUsageSnapshot(db, org, now);
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
    const projectedAllocatedUtilizationPercent =
      usage.allottedSeconds > 0 ? (projectedAllocatedUserSecondsThisPeriod / usage.allottedSeconds) * 100 : 0;

    response.json({
      generatedAt: now.toISOString(),
      org,
      billingPeriod: {
        periodStartAt: billing.periodStartAt,
        periodEndAt: billing.periodEndAt,
        nextRenewalAt: billing.nextRenewalAt,
        daysInPeriod
      },
      usage: {
        monthlyAllottedSeconds: usage.allottedSeconds,
        billedSecondsThisPeriod: usage.usedSeconds,
        remainingSecondsThisPeriod: Math.max(0, usage.allottedSeconds - usage.usedSeconds),
        usagePercentThisPeriod: usage.usagePercent,
        perUserDailyCapSeconds: effectivePerUserDailyCapSeconds,
        activeUserCount,
        projectedAllocatedUserSecondsThisPeriod,
        projectedAllocatedUtilizationPercent
      }
    });
  });
});

app.patch("/mobile/users/:userId/admin/org/settings", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const body = request.body as {
    maxSimulationMinutes?: unknown;
    monthlyMinutesAllotted?: unknown;
    perUserDailySecondsCap?: unknown;
    applyPerUserDailySecondsCapNextCycle?: unknown;
    clearPendingPerUserDailySecondsCap?: unknown;
  };
  const applyPerUserDailySecondsCapNextCycle = body.applyPerUserDailySecondsCapNextCycle === true;
  const clearPendingPerUserDailySecondsCap = body.clearPendingPerUserDailySecondsCap === true;

  if (body.maxSimulationMinutes !== undefined || body.monthlyMinutesAllotted !== undefined) {
    response.status(403).json({
      error: "Organization administrators can only change the default per-user daily minutes.",
    });
    return;
  }

  if (
    body.perUserDailySecondsCap === undefined &&
    !clearPendingPerUserDailySecondsCap
  ) {
    response.status(400).json({
      error: "Default per-user daily minutes are required."
    });
    return;
  }

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    if (body.perUserDailySecondsCap !== undefined) {
      if (!Number.isSafeInteger(body.perUserDailySecondsCap) || Number(body.perUserDailySecondsCap) < 0) {
        response.status(400).json({ error: "Default per-user daily seconds must be a non-negative integer." });
        return;
      }
      const nextPerUserDailySecondsCap = clampNonNegativeInteger(
        body.perUserDailySecondsCap,
        org.perUserDailySecondsCap
      );
      if (applyPerUserDailySecondsCapNextCycle) {
        const billing = computeMonthlyPeriodBounds(resolveOrgBillingAnchorAt(org, new Date()), new Date());
        org.pendingPerUserDailySecondsCap = nextPerUserDailySecondsCap;
        org.pendingPerUserDailySecondsCapEffectiveAt = billing.nextRenewalAt;
      } else {
        org.perUserDailySecondsCap = nextPerUserDailySecondsCap;
        org.pendingPerUserDailySecondsCap = null;
        org.pendingPerUserDailySecondsCapEffectiveAt = null;
      }
    }

    if (clearPendingPerUserDailySecondsCap) {
      org.pendingPerUserDailySecondsCap = null;
      org.pendingPerUserDailySecondsCapEffectiveAt = null;
    }

    org.updatedAt = nowIso();
    emitMobileUpdateForOrg(db, org.id, "org");
    appendMobileAuditEvent(db, actor, {
      action: "org.settings_updated",
      userId: actor.id,
      orgId: org.id,
      message: `Updated org settings for ${org.name}.`,
      metadata: {
        perUserDailySecondsCap: org.perUserDailySecondsCap,
        pendingPerUserDailySecondsCap: org.pendingPerUserDailySecondsCap,
        pendingPerUserDailySecondsCapEffectiveAt: org.pendingPerUserDailySecondsCapEffectiveAt
      }
    });

    response.json({
      ok: true,
      org: {
        id: org.id,
        perUserDailySecondsCap: org.perUserDailySecondsCap,
        pendingPerUserDailySecondsCap: org.pendingPerUserDailySecondsCap,
        pendingPerUserDailySecondsCapEffectiveAt: org.pendingPerUserDailySecondsCapEffectiveAt,
        updatedAt: org.updatedAt
      }
    });
  });
});

app.get("/mobile/users/:userId/admin/org/users", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;

  await withDatabaseRead(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }
    const effectiveOrgPerUserDailySecondsCap = resolveEffectiveOrgPerUserDailySecondsCap(org, new Date());

    const orgUsers = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === org.id)
      .sort((a, b) => a.email.localeCompare(b.email));
    const visibleUsers = orgUsers
      .filter((target) => canEnterpriseActorSeeOrganizationUser({ actor, target }))
      .map((user) => {
        const dailyOverage = resolveUserDailyOverageAllowance(db, user, new Date());
        return {
          userId: user.id,
          email: user.email,
          employeeId: user.employeeId ?? null,
          status: user.status,
          orgRole: user.orgRole,
          dailySecondsCapOverride: user.dailySecondsCapOverride,
          effectiveDailySecondsCap:
            (user.dailySecondsCapOverride ?? effectiveOrgPerUserDailySecondsCap) + user.manualBonusSeconds,
          allowDailyOverageThisCycle: dailyOverage.active,
          dailyOverageExpiresAt: dailyOverage.expiresAt,
          dailyOverageMode: dailyOverage.mode,
          dailyOverageExtraSecondsGranted: dailyOverage.extraSecondsGranted,
          dailyOverageExtraSecondsConsumed: dailyOverage.extraSecondsConsumed,
          dailyOverageExtraSecondsRemaining: dailyOverage.extraSecondsRemaining,
        };
      });

    response.json({
      generatedAt: nowIso(),
      org: { id: org.id, name: org.name },
      users: visibleUsers
    });
  });
});

app.get("/mobile/users/:userId/admin/org/users/:targetUserId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const targetUserId = request.params.targetUserId;
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabaseRead(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const target = getUserById(db, targetUserId);
    if (!target || target.accountType !== "enterprise" || target.orgId !== org.id) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    if (!canEnterpriseActorSeeOrganizationUser({ actor, target })) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();
    const activityWindow = simulationHistoryAccess.listActivityWindow(db, {
      userId: target.id,
      periodStartAt: new Date(periodStartAt),
      periodEndAt: now
    });
    const sessions = activityWindow.usageSessions;
    const scores = activityWindow.scoreRecords;
    const billedSeconds = usageSessionAccess.sumBilledSeconds(sessions);
    const avgOverallScore = scoreRecordAccess.computeAverageOverallScore(scores);
    const dailyOverage = resolveUserDailyOverageAllowance(db, target, now);

    response.json({
      generatedAt: now.toISOString(),
      org: { id: org.id, name: org.name },
      user: {
        userId: target.id,
        email: target.email,
        employeeId: target.employeeId ?? null,
        status: target.status,
        orgRole: target.orgRole,
        dailySecondsCapOverride: target.dailySecondsCapOverride,
        effectiveDailySecondsCap:
          (target.dailySecondsCapOverride ?? resolveEffectiveOrgPerUserDailySecondsCap(org, now)) +
          target.manualBonusSeconds,
        allowDailyOverageThisCycle: dailyOverage.active,
        dailyOverageExpiresAt: dailyOverage.expiresAt,
        dailyOverageMode: dailyOverage.mode,
        dailyOverageExtraSecondsGranted: dailyOverage.extraSecondsGranted,
        dailyOverageExtraSecondsConsumed: dailyOverage.extraSecondsConsumed,
        dailyOverageExtraSecondsRemaining: dailyOverage.extraSecondsRemaining,
      },
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      usage: {
        sessions: sessions.length,
        billedSeconds
      },
      scores: {
        sessions: scores.length,
        avgOverallScore,
        recent: scores
          .slice()
          .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
          .slice(0, 20)
          .map((record) => ({
            id: record.id,
            endedAt: record.endedAt,
            segmentId: record.segmentId,
            scenarioId: record.scenarioId,
            industryId: typeof record.industryId === "string" ? record.industryId : null,
            overallScore: record.overallScore
          }))
      }
    });
  });
});

app.patch("/mobile/users/:userId/admin/org/users/:targetUserId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const targetUserId = request.params.targetUserId;
  const body = request.body as {
    status?: UserStatus;
    employeeId?: unknown;
    allowDailyOverageThisCycle?: unknown;
    dailySecondsCapOverride?: unknown;
    dailyOverageMode?: unknown;
    dailyOverageDurationDays?: unknown;
    dailyOverageExtraMinutes?: unknown;
  };
  const hasStatusPatch = body.status !== undefined;
  const hasEmployeeIdPatch = Object.prototype.hasOwnProperty.call(body ?? {}, "employeeId");
  const hasOveragePatch = typeof body.allowDailyOverageThisCycle === "boolean";
  const hasDailyCapOverridePatch = body.dailySecondsCapOverride !== undefined;

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    if (!hasStatusPatch && !hasEmployeeIdPatch && !hasOveragePatch && !hasDailyCapOverridePatch) {
      response.status(400).json({
        error: "Provide at least one patch field: status, employeeId, allowDailyOverageThisCycle, or dailySecondsCapOverride."
      });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const target = getUserById(db, targetUserId);
    if (!target || target.accountType !== "enterprise" || target.orgId !== org.id) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    if (!canEnterpriseActorSeeOrganizationUser({ actor, target })) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    if (target.id === actor.id) {
      response.status(403).json({ error: "You cannot lock or unlock your own account." });
      return;
    }

    const actorCanManageRegularTarget = canEnterpriseActorManageRegularUser({ actor, target });
    if (actor.orgRole === "user_admin" && !actorCanManageRegularTarget) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    if (actor.orgRole === "user_admin" && (hasDailyCapOverridePatch || hasOveragePatch)) {
      response.status(403).json({ error: "User admins cannot modify organization usage controls." });
      return;
    }

    let nextStatus = target.status;
    let nextEmployeeId = target.employeeId ?? null;
    let nextDailySecondsCapOverride = target.dailySecondsCapOverride;
    let nextAllowDailyOverageThisCycle = target.allowDailyOverageThisCycle;
    let nextDailyOverageExpiresAt = target.dailyOverageExpiresAt;
    let nextDailyOverageMode = target.dailyOverageMode ?? null;
    let nextDailyOverageStartedAt = target.dailyOverageStartedAt ?? null;
    let nextDailyOverageBaseSecondsCap = target.dailyOverageBaseSecondsCap ?? null;
    let nextDailyOverageExtraSecondsGranted = target.dailyOverageExtraSecondsGranted ?? null;

    if (hasStatusPatch) {
      if (!body.status || !isUserStatus(body.status)) {
        response.status(400).json({ error: "Valid status is required." });
        return;
      }
      if (target.orgRole === "org_admin" && body.status === "disabled") {
        const activeOrgAdminCount = db.users.filter(
          (user) => user.accountType === "enterprise" && user.orgId === org.id && user.orgRole === "org_admin" && user.status === "active"
        ).length;
        if (activeOrgAdminCount <= 1) {
          response.status(403).json({ error: "At least one active org admin is required." });
          return;
        }
      }
      nextStatus = body.status;
    }

    if (hasEmployeeIdPatch) {
      if (actor.orgRole === "user_admin" && !actorCanManageRegularTarget) {
        response.status(403).json({ error: "You cannot edit Employee ID for this user." });
        return;
      }
      const normalizedEmployeeId = normalizeEmployeeIdInput(body.employeeId);
      if (!normalizedEmployeeId.ok) {
        response.status(400).json({ error: normalizedEmployeeId.error, code: normalizedEmployeeId.code });
        return;
      }
      const employeeIdConflict = findEmployeeIdConflict({
        users: db.users,
        orgId: org.id,
        employeeId: normalizedEmployeeId.value,
        exceptUserId: target.id
      });
      if (employeeIdConflict) {
        response.status(409).json({
          error: "Employee ID is already assigned within this organization.",
          code: employeeIdConflict.code,
        });
        return;
      }
      nextEmployeeId = normalizedEmployeeId.value;
    }

    if (hasDailyCapOverridePatch) {
      if (
        body.dailySecondsCapOverride !== null &&
        (!Number.isSafeInteger(body.dailySecondsCapOverride) || Number(body.dailySecondsCapOverride) < 0)
      ) {
        response.status(400).json({ error: "Daily seconds override must be null or a non-negative integer." });
        return;
      }
      nextDailySecondsCapOverride = normalizeOptionalSecondsCap(body.dailySecondsCapOverride);
    }

    if (hasOveragePatch) {
      const now = new Date();
      const grant = buildTemporaryDailyOverageGrant({
        patch: body,
        user: { ...target, dailySecondsCapOverride: nextDailySecondsCapOverride },
        org,
        now,
      });
      if (!grant.ok) {
        response.status(400).json({ error: grant.error });
        return;
      }
      nextAllowDailyOverageThisCycle = grant.values.allowDailyOverageThisCycle;
      nextDailyOverageExpiresAt = grant.values.dailyOverageExpiresAt;
      nextDailyOverageMode = grant.values.dailyOverageMode ?? null;
      nextDailyOverageStartedAt = grant.values.dailyOverageStartedAt ?? null;
      nextDailyOverageBaseSecondsCap = grant.values.dailyOverageBaseSecondsCap ?? null;
      nextDailyOverageExtraSecondsGranted = grant.values.dailyOverageExtraSecondsGranted ?? null;
    }

    target.status = nextStatus;
    target.employeeId = nextEmployeeId;
    target.dailySecondsCapOverride = nextDailySecondsCapOverride;
    target.allowDailyOverageThisCycle = nextAllowDailyOverageThisCycle;
    target.dailyOverageExpiresAt = nextDailyOverageExpiresAt;
    target.dailyOverageMode = nextDailyOverageMode;
    target.dailyOverageStartedAt = nextDailyOverageStartedAt;
    target.dailyOverageBaseSecondsCap = nextDailyOverageBaseSecondsCap;
    target.dailyOverageExtraSecondsGranted = nextDailyOverageExtraSecondsGranted;
    target.updatedAt = nowIso();
    emitMobileUpdateForUser(db, target.id, "user");
    appendMobileAuditEvent(db, actor, {
      action: "org_user.status_updated",
      orgId: actor.orgId,
      userId: target.id,
      message: `Updated org-user controls for ${target.email}.`,
      metadata: {
        status: target.status,
        employeeIdChanged: hasEmployeeIdPatch,
        dailySecondsCapOverride: target.dailySecondsCapOverride,
        allowDailyOverageThisCycle: target.allowDailyOverageThisCycle,
        dailyOverageExpiresAt: target.dailyOverageExpiresAt,
        dailyOverageMode: target.dailyOverageMode ?? null,
        dailyOverageExtraSecondsGranted: target.dailyOverageExtraSecondsGranted ?? null,
      }
    });
    response.json({
      userId: target.id,
      email: target.email,
      employeeId: target.employeeId ?? null,
      status: target.status,
      dailySecondsCapOverride: target.dailySecondsCapOverride,
      allowDailyOverageThisCycle: target.allowDailyOverageThisCycle,
      dailyOverageExpiresAt: target.dailyOverageExpiresAt,
      dailyOverageMode: target.dailyOverageMode ?? null,
      dailyOverageExtraSecondsGranted: target.dailyOverageExtraSecondsGranted ?? null,
    });
  });
});

app.get("/mobile/users/:userId/admin/org/analytics", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabaseRead(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const industryLabelById = new Map((db.config.industries ?? []).map((industry) => [industry.id, industry.label]));
    const userEmailById = new Map(db.users.map((user) => [user.id, user.email]));
    const analytics = scoreRecordAccess.buildOrgScoreAnalytics({
      db,
      orgId: org.id,
      periodStartAt: new Date(periodStartAt),
      periodEndAt: now,
      segmentLabelById,
      industryLabelById,
      userEmailById
    });

    response.json({
      generatedAt: now.toISOString(),
      org: { id: org.id, name: org.name },
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      orgAvgOverallScore: analytics.orgAvgOverallScore,
      conclusiveSessions: analytics.conclusiveSessions,
      outcomeAwareSessions: analytics.outcomeAwareSessions,
      successfulSessions: analytics.successfulSessions,
      topUsers: analytics.topUsers,
      bySegment: analytics.bySegment,
      byIndustry: analytics.byIndustry,
      trendByDay: analytics.trendByDay
    });
  });
});

app.post("/mobile/users/:userId/simulation-sessions/start", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as StartSimulationSessionRequest & { sessionId?: unknown };
  const bodyRecord = body as unknown as Record<string, unknown>;
  const simulationSessionId = resolveRecognizedSimulationSessionId(request, bodyRecord);
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const submittedTrainingPackId =
    typeof body.trainingPackId === "string" && body.trainingPackId.trim() ? body.trainingPackId.trim() : null;
  const clientStartedAt = body.clientStartedAt ?? null;

  if (!simulationSessionId || !body.segmentId || !body.scenarioId) {
    response.status(400).json({ error: "simulationSessionId, segmentId, and scenarioId are required." });
    return;
  }

  const parsedClientStartedAt = clientStartedAt ? parseIsoDateOrNull(clientStartedAt) : null;
  if (clientStartedAt && !parsedClientStartedAt) {
    response.status(400).json({ error: "clientStartedAt must be a valid ISO timestamp." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return;
    }

    const org = accessContext.actingOrg;
    if (org) {
      await ensureOrgTrainingWorkspace(db, org);
    }

    const configForUser = resolveConfigForUser(db, user, accessContext.actingOrgId);
    const resolvedScenario = resolveMobileScenarioForUser(configForUser, body.scenarioId, trainingId);
    if (!resolvedScenario) {
      response.status(400).json({ error: "Invalid scenario for simulation session start." });
      return;
    }
    if (resolvedScenario.segment.id !== body.segmentId) {
      response.status(400).json({ error: "Invalid segment for simulation session start." });
      return;
    }

    const entitlements = computeEntitlements(db, user, new Date(), {
      actingOrgId: accessContext.actingOrgId,
    });
    if (!entitlements.canStartSimulation) {
      respondWithEntitlementDenial(response, entitlements);
      return;
    }

    const useModularPromptArchitecture =
      USE_MODULAR_PROMPT_ARCHITECTURE_ENV && org?.enableModularPromptArchitecture === true;
    const persistedTrainingPack = await resolvePersistedTrainingPackForScenario({
      orgId: accessContext.actingOrgId,
      scenarioId: body.scenarioId,
      useModularPromptArchitecture,
      submittedTrainingPackId
    });
    const divisionId = resolveSimulationDivisionIdForContext({
      db,
      user,
      org,
      trainingId,
      resolvedScenario,
    });

    if (accessContext.isSuperUser) {
      response.status(201).json({
        recognized: false,
        simulationSessionId,
        status: null,
        serverStartedAt: null
      });
      return;
    }

    let session;
    try {
      session = await registerRecognizedSimulationSessionStart(simulationSessionStore, {
        simulationSessionId,
        userId: user.id,
        orgId: accessContext.actingOrgId,
        divisionId,
        segmentId: body.segmentId,
        scenarioId: body.scenarioId,
        trainingId,
        trainingPackId: persistedTrainingPack?.id ?? submittedTrainingPackId,
        clientStartedAt: parsedClientStartedAt?.toISOString() ?? null,
        now: new Date()
      });
    } catch (error) {
      if (error instanceof SimulationSessionValidationError) {
        response.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof Error && error.message.toLowerCase().includes("simulation session")) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }

    response.status(201).json({
      recognized: true,
      simulationSessionId,
      status: session.status,
      serverStartedAt: session.serverStartedAt
    });
  });
});

app.post("/usage/sessions", async (request: Request, response: Response) => {
  const body = request.body as RecordUsageSessionRequest & { sessionId?: unknown };
  const authToken = getIncomingMobileToken(request);
  const bodyRecord = body as unknown as Record<string, unknown>;
  const correlationId = resolveSimulationCorrelationId(request);
  const simulationSessionId = resolveRecognizedSimulationSessionId(request, bodyRecord);
  const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
  const segmentId = typeof body.segmentId === "string" && body.segmentId.trim() ? body.segmentId.trim() : null;
  const scenarioId = typeof body.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim() : null;
  const trainingId = typeof body.trainingId === "string" && body.trainingId.trim() ? body.trainingId.trim() : null;
  const submittedTrainingPackId =
    typeof body.trainingPackId === "string" && body.trainingPackId.trim() ? body.trainingPackId.trim() : null;

  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const missingFields = listMissingUsageSessionFields({
    simulationSessionId,
    userId,
    segmentId,
    scenarioId,
  });
  if (missingFields.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("[usage-session] missing_required_fields", {
      correlationId,
      missingFields,
      simulationSessionId,
      userIdPresent: Boolean(userId),
      segmentIdPresent: Boolean(segmentId),
      scenarioIdPresent: Boolean(scenarioId),
      trainingIdPresent: Boolean(trainingId),
      trainingPackIdPresent: Boolean(submittedTrainingPackId),
    });
    response.status(400).json({
      error: "simulationSessionId, userId, segmentId, and scenarioId are required.",
      code: "missing_required_fields",
      missingFields,
    });
    return;
  }

  const requiredSimulationSessionId = simulationSessionId as string;
  const requiredUserId = userId as string;
  const requiredSegmentId = segmentId as string;
  const requiredScenarioId = scenarioId as string;

  await withDatabase(async (db) => {
    const user = getUserById(db, requiredUserId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const accessContext = resolveMobileAccessContext(db, user, request, response, {
      requireSuperUserOrgSelection: true,
    });
    if (!accessContext) {
      return;
    }

    const org = accessContext.actingOrg;
    if (org) {
      await ensureOrgTrainingWorkspace(db, org);
    }

    const configForUser = resolveConfigForUser(db, user, accessContext.actingOrgId);
    const resolvedScenario = resolveMobileScenarioForUser(configForUser, requiredScenarioId, trainingId);
    if (!resolvedScenario) {
      response.status(400).json({ error: "Invalid scenario for usage session." });
      return;
    }
    if (resolvedScenario.segment.id !== requiredSegmentId) {
      response.status(400).json({ error: "Invalid segment for usage session." });
      return;
    }
    const useModularPromptArchitecture =
      USE_MODULAR_PROMPT_ARCHITECTURE_ENV && org?.enableModularPromptArchitecture === true;
    const persistedTrainingPack = await resolvePersistedTrainingPackForScenario({
      orgId: accessContext.actingOrgId,
      scenarioId: requiredScenarioId,
      useModularPromptArchitecture,
      submittedTrainingPackId
    });
    const divisionId = resolveSimulationDivisionIdForContext({
      db,
      user,
      org,
      trainingId,
      resolvedScenario,
    });

    const now = new Date();
    const parsedStart = parseIsoDateOrNull(body.startedAt);
    const parsedEnd = parseIsoDateOrNull(body.endedAt);
    if ((body.startedAt && !parsedStart) || (body.endedAt && !parsedEnd)) {
      response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
      return;
    }

    const sessionStart = parsedStart ?? now;
    const sessionEnd = parsedEnd ?? now;
    if (sessionEnd.getTime() < sessionStart.getTime()) {
      response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
      return;
    }

    const entitlements = computeEntitlements(db, user, now, {
      actingOrgId: accessContext.actingOrgId,
    });
    if (!entitlements.canStartSimulation) {
      if (!isQuotaLockReason(entitlements.lockReason)) {
        respondWithEntitlementDenial(response, entitlements);
        return;
      }
    }

    let rawDurationSeconds = clampNonNegativeInteger(body.rawDurationSeconds, 0);
    const maxSimulationMinutes = entitlements.limits.maxSimulationMinutes;
    if (maxSimulationMinutes !== null) {
      rawDurationSeconds = Math.min(rawDurationSeconds, maxSimulationMinutes * 60);
    }

    const normalizedStartedAt = sessionStart.toISOString();
    const normalizedEndedAt = sessionEnd.toISOString();
    let appendResult: Awaited<ReturnType<typeof usageSessionAccess.append>> | null = null;

    if (!accessContext.isSuperUser) {
      try {
        const completion = await completeRecognizedSimulationUsage({
          simulationSessionStore,
          usageSessionAccess,
          db,
          simulationSessionId: requiredSimulationSessionId,
          userId: user.id,
          orgId: accessContext.actingOrgId,
          divisionId,
          segmentId: requiredSegmentId,
          scenarioId: requiredScenarioId,
          trainingId,
          submittedTrainingPackId,
          resolvedTrainingPackId: persistedTrainingPack?.id ?? null,
          startedAt: normalizedStartedAt,
          endedAt: normalizedEndedAt,
          rawDurationSeconds,
          beforeUsage: entitlements.usage,
          maxSimulationMinutes,
          timeZone: entitlements.usage.timezoneUsed,
          now
        });
        appendResult = completion.usageResult;
      } catch (error) {
        if (error instanceof SimulationSessionValidationError) {
          response.status(error.statusCode).json({ error: error.message, code: error.code });
          return;
        }
        throw error;
      }

      // Training-assignment activity fields are secondary derived state. We intentionally
      // reapply this sync even on idempotent replays so a retry can heal a prior monolith-save
      // failure after the authoritative usage-session store write has already succeeded.
      syncTrainingPackAssignmentsForUserPack(
        db,
        accessContext.actingOrgId,
        user.id,
        appendResult.record.trainingPackId ?? null
      );
    }
    clearSimulationAiBudgetGrace(user.id);
    clearSimulationOrgMonthlyOverrunGrace(user.id);

    const refreshed = computeEntitlements(db, user, now, {
      actingOrgId: accessContext.actingOrgId,
    });
    const billedSecondsAdded = accessContext.isSuperUser
      ? 0
      : appendResult?.created === false
        ? appendResult.record.billedSecondsAdded ?? Math.max(
            0,
            refreshed.usage.billedSecondsToday - entitlements.usage.billedSecondsToday
          )
        : Math.max(0, refreshed.usage.billedSecondsToday - entitlements.usage.billedSecondsToday);
    response.status(201).json({
      recorded: !accessContext.isSuperUser,
      billedSecondsAdded,
      entitlements: refreshed
    });
  });
});

app.get("/usage", requireAdmin, async (_request: Request, response: Response) => {
  await withFreshReportingRead(async (db) => {
    const now = new Date();
    const rows = [];

    for (const user of db.users.filter((entry) => entry.isSuperUser !== true)) {
      const entitlements = computeEntitlements(db, user, now);
      const timezone = materializeUserTimezone(user, now);
      const usageTotals = await aiUsageEventAccess.computeCurrentPeriodTotals({
        userId: user.id,
        now,
        timeZone: timezone
      });

      rows.push({
        userId: user.id,
        email: user.email,
        tier: user.tier,
        accountType: user.accountType,
        status: user.status,
        minutesUsedToday: secondsToWholeMinutes(entitlements.usage.billedSecondsToday),
        minutesUsedThisMonth: secondsToWholeMinutes(entitlements.usage.billedSecondsThisMonth),
        dailySecondsRemaining: entitlements.usage.dailySecondsRemaining,
        tokensUsedToday: usageTotals.tokensUsedToday,
        tokensUsedThisMonth: usageTotals.tokensUsedThisMonth
      });
    }

    response.json({
      generatedAt: now.toISOString(),
      rows
    });
  });
});

app.get("/audit/events", requireAdmin, async (request: Request, response: Response) => {
  const queryOrgId = typeof request.query.orgId === "string" ? request.query.orgId.trim() : "";
  const queryActorId = typeof request.query.actorId === "string" ? request.query.actorId.trim() : "";
  const queryActorType = typeof request.query.actorType === "string" ? request.query.actorType.trim() : "";
  const queryAction = typeof request.query.action === "string" ? request.query.action.trim() : "";
  const limit = Math.max(1, Math.min(500, clampNonNegativeInteger(request.query.limit, 200)));
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));
  const from = parseIsoDateOrNull(typeof request.query.from === "string" ? request.query.from.trim() : null);
  const to = parseIsoDateOrNull(typeof request.query.to === "string" ? request.query.to.trim() : null);

  if (from && to && to.getTime() < from.getTime()) {
    response.status(400).json({ error: "to must be greater than or equal to from." });
    return;
  }

  if (queryActorType && !AUDIT_ACTOR_TYPES.includes(queryActorType as (typeof AUDIT_ACTOR_TYPES)[number])) {
    response.status(400).json({
      error: `actorType must be one of: ${AUDIT_ACTOR_TYPES.join(", ")}.`,
    });
    return;
  }

  const now = new Date();
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const events = await auditEventStore.listEvents({
    orgId: queryOrgId || null,
    actorId: queryActorId || null,
    actorType: (queryActorType || null) as AuditEvent["actorType"] | null,
    action: queryAction || null,
    from: start,
    to: end,
    limit
  });

  await withDatabaseRead(async (db) => {
    const orgById = new Map(db.orgs.map((org) => [org.id, org]));
    const userById = new Map(db.users.map((user) => [user.id, user]));

    const rows = events.map((event) => {
      const org = event.orgId ? orgById.get(event.orgId) : null;
      const actorUser = event.actorId ? userById.get(event.actorId) : null;
      const targetUser = event.userId ? userById.get(event.userId) : null;
      return {
        ...event,
        orgName: org?.name ?? null,
        actorEmail: actorUser?.email ?? null,
        userEmail: targetUser?.email ?? null
      };
    });

    response.json({
      generatedAt: now.toISOString(),
      filters: {
        orgId: queryOrgId || null,
        actorId: queryActorId || null,
        actorType: queryActorType || null,
        action: queryAction || null,
        from: start.toISOString(),
        to: end.toISOString(),
        limit
      },
      rows
    });
  });
});

app.get("/org-join-requests", requireAdmin, async (request: Request, response: Response) => {
  const statusFilterRaw = typeof request.query.status === "string" ? request.query.status.trim() : "";
  const statusFilter = statusFilterRaw && isOrgJoinRequestStatus(statusFilterRaw) ? statusFilterRaw : null;

  await withDatabase(async (db) => {
    expireOrgJoinRequests(db, new Date());

    const orgById = new Map(db.orgs.map((org) => [org.id, org]));
    const userById = new Map(db.users.map((user) => [user.id, user]));
    const rows = db.enterpriseJoinRequests
      .filter((row) => (statusFilter ? row.status === statusFilter : true))
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((row) => {
        const org = orgById.get(row.orgId);
        const user = userById.get(row.userId);
        return {
          id: row.id,
          status: row.status,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
          decidedAt: row.decidedAt,
          decisionReason: row.decisionReason,
          email: row.email,
          emailDomain: row.emailDomain,
          user: user
            ? {
                id: user.id,
                email: user.email,
                accountType: user.accountType,
                tier: user.tier,
                status: user.status,
                orgId: user.orgId,
                orgRole: user.orgRole
              }
            : null,
          org: org
            ? {
                id: org.id,
                name: org.name,
                emailDomain: org.emailDomain,
                joinCode: org.joinCode,
                status: org.status
              }
            : null
        };
      });

    response.json({
      generatedAt: nowIso(),
      rows
    });
  });
});

app.patch("/org-join-requests/:requestId", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as { action?: "approve" | "reject"; reason?: string; assignOrgAdmin?: boolean };
  if (body.action !== "approve" && body.action !== "reject") {
    response.status(400).json({ error: "action must be approve or reject." });
    return;
  }

  await withDatabase(async (db) => {
    expireOrgJoinRequests(db, new Date());
    const requestRecord = db.enterpriseJoinRequests.find((row) => row.id === request.params.requestId);
    if (!requestRecord) {
      response.status(404).json({ error: "Join request not found." });
      return;
    }

    if (requestRecord.status !== "pending") {
      response.status(409).json({ error: `Join request is already ${requestRecord.status}.` });
      return;
    }

    const org = getOrgById(db, requestRecord.orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const targetUser = getUserById(db, requestRecord.userId);
    if (!targetUser) {
      const nowValue = nowIso();
      requestRecord.status = "rejected";
      requestRecord.updatedAt = nowValue;
      requestRecord.decidedAt = nowValue;
      requestRecord.decidedByUserId = null;
      requestRecord.decisionReason = "Target user no longer exists.";
      response.status(404).json({ error: "Target user not found." });
      return;
    }

    const nowValue = nowIso();
    if (body.action === "approve") {
      if (org.status !== "active") {
        response.status(400).json({ error: "Organization is not active." });
        return;
      }

      const assignOrgAdmin = Boolean(body.assignOrgAdmin);
      targetUser.accountType = "enterprise";
      targetUser.tier = "enterprise";
      targetUser.orgId = org.id;
      targetUser.orgRole = assignOrgAdmin ? "org_admin" : "user";
      targetUser.status = "active";
      targetUser.updatedAt = nowValue;
      const deactivatedInvalidAssignmentCount = deactivateInvalidTrainingPackAssignmentsForUser({
        assignments: db.trainingPackAssignments ?? [],
        userId: targetUser.id,
        user: targetUser,
        nowIso: nowValue,
      });

      requestRecord.status = "approved";
      requestRecord.updatedAt = nowValue;
      requestRecord.decidedAt = nowValue;
      requestRecord.decidedByUserId = null;
      requestRecord.decisionReason = body.reason?.trim() || (assignOrgAdmin ? "Approved as org admin." : null);

      emitMobileUpdateForUser(db, targetUser.id, "user");
      emitMobileUpdateForOrg(db, org.id, "org");
      appendPlatformAuditEvent(db, {
        action: "org_join.approved_by_platform_admin",
        orgId: org.id,
        userId: targetUser.id,
        message: `Approved org join request for ${targetUser.email}.`,
        metadata: {
          requestId: requestRecord.id,
          assignOrgAdmin,
          deactivatedInvalidTrainingPackAssignments: deactivatedInvalidAssignmentCount
        }
      });
    } else {
      requestRecord.status = "rejected";
      requestRecord.updatedAt = nowValue;
      requestRecord.decidedAt = nowValue;
      requestRecord.decidedByUserId = null;
      requestRecord.decisionReason = body.reason?.trim() || "Rejected by platform admin.";

      emitMobileUpdateForUser(db, targetUser.id, "user");
      emitMobileUpdateForOrg(db, org.id, "org");
      appendPlatformAuditEvent(db, {
        action: "org_join.rejected_by_platform_admin",
        orgId: org.id,
        userId: targetUser.id,
        message: `Rejected org join request for ${targetUser.email}.`,
        metadata: {
          requestId: requestRecord.id,
          reason: requestRecord.decisionReason
        }
      });
    }

    response.json({
      ok: true,
      request: {
        id: requestRecord.id,
        status: requestRecord.status,
        userId: requestRecord.userId,
        email: requestRecord.email,
        orgId: requestRecord.orgId,
        createdAt: requestRecord.createdAt,
        expiresAt: requestRecord.expiresAt,
        updatedAt: requestRecord.updatedAt,
        decidedAt: requestRecord.decidedAt,
        decisionReason: requestRecord.decisionReason
      }
    });
  });
});

app.get("/support/cases", requireAdmin, async (_request: Request, response: Response) => {
  const supportCases = await supportCaseStore.listCases({ now: new Date() });
  await withDatabaseRead(async (db) => {
    const now = nowIso();
    const userById = new Map(db.users.map((user) => [user.id, user]));
    const orgById = new Map(db.orgs.map((org) => [org.id, org]));

    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const scenarioTitleById = new Map<string, string>();
    for (const segment of db.config.segments) {
      for (const scenario of segment.scenarios ?? []) {
        scenarioTitleById.set(scenario.id, scenario.title);
      }
    }

    const cases = supportCases
      .map((entry) => {
        const user = userById.get(entry.userId);
        const org = entry.orgId ? orgById.get(entry.orgId) : undefined;
        const presentation = decodeSupportCaseMessage(entry.message);
        return {
          id: entry.id,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          org: org ? { id: org.id, name: org.name } : null,
          user: user ? { id: user.id, email: user.email } : { id: entry.userId, email: entry.userId },
          segmentId: entry.segmentId,
          segmentLabel: entry.segmentId ? segmentLabelById.get(entry.segmentId) ?? entry.segmentId : null,
          scenarioId: entry.scenarioId,
          scenarioTitle: entry.scenarioId ? scenarioTitleById.get(entry.scenarioId) ?? entry.scenarioId : null,
          message: presentation.message,
          source: presentation.origin,
          transcript: {
            available: Boolean(entry.transcriptEncrypted),
            expiresAt: entry.transcriptExpiresAt,
            fileName: entry.transcriptFileName
          },
          meta: entry.transcriptMeta
        };
      });

    response.json({ generatedAt: now, cases });
  });
});

app.get("/support/cases/:caseId", requireAdmin, async (request: Request, response: Response) => {
  const caseId = request.params.caseId;
  const entry = await supportCaseStore.getCaseById(caseId, { now: new Date() });
  if (!entry) {
    response.status(404).json({ error: "Support case not found." });
    return;
  }

  await withDatabaseRead(async (db) => {
    const user = getUserById(db, entry.userId);
    const org = getOrgById(db, entry.orgId);
    const presentation = decodeSupportCaseMessage(entry.message);

    const transcriptText = entry.transcriptEncrypted ? decryptSupportTranscript(entry.transcriptEncrypted) : null;

    response.json({
      id: entry.id,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      org: org ? { id: org.id, name: org.name } : null,
      user: user ? { id: user.id, email: user.email } : { id: entry.userId, email: entry.userId },
      message: presentation.message,
      source: presentation.origin,
      transcript: {
        available: Boolean(entry.transcriptEncrypted),
        expiresAt: entry.transcriptExpiresAt,
        fileName: entry.transcriptFileName,
        text: transcriptText
      },
      meta: entry.transcriptMeta
    });
  });
});

app.get("/stats", requireAdmin, async (request: Request, response: Response) => {
  const queryOrgId = typeof request.query.orgId === "string" ? request.query.orgId.trim() : "";
  const querySegmentId = typeof request.query.segmentId === "string" ? request.query.segmentId.trim() : "";
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabaseRead(async (db) => {
    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const toDayKeyUtc = (iso: string): string | null => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString().slice(0, 10);
    };

    const orgById = new Map(db.orgs.map((org) => [org.id, org]));
    const userById = new Map(db.users.map((user) => [user.id, user]));
    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const filteredActivity = simulationHistoryAccess.listActivityWindow(db, {
      orgId: queryOrgId || undefined,
      segmentId: querySegmentId || undefined,
      periodStartAt: new Date(periodStartAt),
      periodEndAt: now
    });
    const filteredSessions = filteredActivity.usageSessions.filter((session) => Boolean(session.orgId));
    const filteredScores = filteredActivity.scoreRecords.filter((record) => Boolean(record.orgId));

    const filteredAiEvents = (await aiUsageEventAccess.list({
      orgId: queryOrgId || null,
      segmentId: querySegmentId || null,
      createdAtFrom: new Date(periodStartAt),
      createdAtBefore: now
    })).filter((event) => Boolean(event.orgId));

    const totalBilledSeconds = filteredSessions.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );
    const totalAiTokens = sumAiUsageEventTokens(filteredAiEvents);
    const totalAvgScore =
      filteredScores.length > 0
        ? filteredScores.reduce((total, record) => total + Math.max(0, Math.min(100, record.overallScore)), 0) /
          filteredScores.length
        : null;

    const sessionsByOrgId = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
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
    for (const record of filteredScores) {
      if (!record.orgId) {
        continue;
      }
      const current = scoresByOrgId.get(record.orgId) ?? { sessions: 0, totalScore: 0 };
      scoresByOrgId.set(record.orgId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const aiByOrgId = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      if (!event.orgId) {
        continue;
      }
      const current = aiByOrgId.get(event.orgId) ?? { calls: 0, totalTokens: 0 };
      aiByOrgId.set(event.orgId, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const byOrg = Array.from(new Set([...sessionsByOrgId.keys(), ...scoresByOrgId.keys(), ...aiByOrgId.keys()]))
      .map((orgId) => {
        const org = orgById.get(orgId);
        const usage = sessionsByOrgId.get(orgId) ?? { sessions: 0, billedSeconds: 0 };
        const scores = scoresByOrgId.get(orgId) ?? { sessions: 0, totalScore: 0 };
        const ai = aiByOrgId.get(orgId) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          orgId,
          orgName: org?.name ?? orgId,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      })
      .sort((a, b) => b.billedSeconds - a.billedSeconds);

    const sessionsBySegmentId = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
      const segmentId = session.segmentId;
      const current = sessionsBySegmentId.get(segmentId) ?? { sessions: 0, billedSeconds: 0 };
      sessionsBySegmentId.set(segmentId, {
        sessions: current.sessions + 1,
        billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
      });
    }

    const scoresBySegmentId = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const segmentId = record.segmentId;
      const current = scoresBySegmentId.get(segmentId) ?? { sessions: 0, totalScore: 0 };
      scoresBySegmentId.set(segmentId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const aiBySegmentId = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      if (!event.segmentId) {
        continue;
      }
      const current = aiBySegmentId.get(event.segmentId) ?? { calls: 0, totalTokens: 0 };
      aiBySegmentId.set(event.segmentId, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const bySegment = Array.from(new Set([...sessionsBySegmentId.keys(), ...scoresBySegmentId.keys(), ...aiBySegmentId.keys()]))
      .map((segmentId) => {
        const usage = sessionsBySegmentId.get(segmentId) ?? { sessions: 0, billedSeconds: 0 };
        const scores = scoresBySegmentId.get(segmentId) ?? { sessions: 0, totalScore: 0 };
        const ai = aiBySegmentId.get(segmentId) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          segmentId,
          segmentLabel: segmentLabelById.get(segmentId) ?? segmentId,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      })
      .sort((a, b) => b.billedSeconds - a.billedSeconds);

    const trendUsageByDay = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
      const dayKey = toDayKeyUtc(session.startedAt);
      if (!dayKey) {
        continue;
      }
      const current = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
      trendUsageByDay.set(dayKey, {
        sessions: current.sessions + 1,
        billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
      });
    }

    const trendScoresByDay = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const dayKey = toDayKeyUtc(record.endedAt);
      if (!dayKey) {
        continue;
      }
      const current = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
      trendScoresByDay.set(dayKey, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const trendAiByDay = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      const dayKey = toDayKeyUtc(event.createdAt);
      if (!dayKey) {
        continue;
      }
      const current = trendAiByDay.get(dayKey) ?? { calls: 0, totalTokens: 0 };
      trendAiByDay.set(dayKey, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const trendByDay = Array.from(new Set([...trendUsageByDay.keys(), ...trendScoresByDay.keys(), ...trendAiByDay.keys()]))
      .sort()
      .map((dayKey) => {
        const usage = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
        const scores = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
        const ai = trendAiByDay.get(dayKey) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          dayKey,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      });

    const scoresByUserId = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const current = scoresByUserId.get(record.userId) ?? { sessions: 0, totalScore: 0 };
      scoresByUserId.set(record.userId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const topUsers = Array.from(scoresByUserId.entries())
      .filter(([userId]) => userId !== DEIDENTIFIED_ACCOUNT_USER_ID)
      .map(([userId, scores]) => {
        const user = userById.get(userId);
        const org = user?.orgId ? orgById.get(user.orgId) : null;
        return {
          userId,
          email: user?.email ?? userId,
          orgId: user?.orgId ?? null,
          orgName: org?.name ?? null,
          sessions: scores.sessions,
          avgOverallScore: scores.sessions > 0 ? scores.totalScore / scores.sessions : null
        };
      })
      .sort((a, b) => (b.avgOverallScore ?? 0) - (a.avgOverallScore ?? 0))
      .slice(0, 10);

    response.json({
      generatedAt: now.toISOString(),
      period: {
        startAt: periodStartAt,
        endAt: periodEndAt,
        days
      },
      filters: {
        orgId: queryOrgId || null,
        segmentId: querySegmentId || null
      },
      totals: {
        sessions: filteredSessions.length,
        billedSeconds: totalBilledSeconds,
        aiCalls: filteredAiEvents.length,
        aiTokens: totalAiTokens,
        avgOverallScore: totalAvgScore
      },
      byOrg,
      bySegment,
      trendByDay,
      topUsers
    });
  });
});

function isTransientDatabaseError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === "string") {
      const lower = current.toLowerCase();
      if (TRANSIENT_DATABASE_ERROR_PATTERNS.some((pattern) => lower.includes(pattern))) {
        return true;
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };

    if (typeof candidate.code === "string" && TRANSIENT_DATABASE_ERROR_CODES.has(candidate.code.toUpperCase())) {
      return true;
    }

    if (typeof candidate.message === "string") {
      const lowerMessage = candidate.message.toLowerCase();
      if (TRANSIENT_DATABASE_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern))) {
        return true;
      }
    }

    if (candidate.cause) {
      queue.push(candidate.cause);
    }

    if (Array.isArray(candidate.errors)) {
      queue.push(...candidate.errors);
    }
  }

  return false;
}

function isJsonBodyParseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  const status = candidate.status ?? candidate.statusCode;
  return candidate.type === "entity.parse.failed" && status === 400;
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({
      error: "Multipart upload is invalid or exceeds the allowed limits.",
      code: error.code
    });
    return;
  }

  if (isJsonBodyParseError(error)) {
    response.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }

  if (error instanceof AuthCodeDeliveryError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (isTransientDatabaseError(error)) {
    response.status(503).json({ error: "Database temporarily unavailable. Please retry." });
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown API error.";
  response.status(500).json({ error: message });
});

export async function startApiServer(): Promise<void> {
  await initializeDatabaseStoresForStartup({
    stores: {
      auditEventStore,
      aiUsageEventStore,
      simulationSessionStore,
      usageSessionStore,
      scoreRecordStore,
      supportCaseStore,
      webAuthSessionStore,
      performancePlanStore,
      userEmployeeIdClaimStore,
      orgModuleEntitlementStore,
      trainingContentStore,
      trainingContentAssetStore,
      trainingPackStore
    },
    maintenance: {
      migrateLegacyAuditEventsFromAppState,
      migrateLegacyAiUsageEventsFromAppState,
      migrateLegacyUsageSessionsFromAppState,
      migrateLegacyScoreRecordsFromAppState,
      migrateLegacySupportCasesFromAppState,
      migrateLegacyWebAuthSessionsFromAppState,
      migrateUserProfileAppStateNormalization,
      runStartupUsageIntegrityMaintenance
    }
  });

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`VoicePractice API running on http://localhost:${PORT} (storage=${STORAGE_PROVIDER})`);
  });

  const trainingContentStorageStatus = await trainingContentStorageReadiness.refresh();
  if (trainingContentStorageStatus.enabled && !trainingContentStorageStatus.available) {
    logWarn("[training-content-storage] configured provider is currently unavailable.");
  }
  if (trainingContentStorageStatus.enabled) {
    const trainingContentStorageReadinessInterval = setInterval(() => {
      void trainingContentStorageReadiness.refresh();
    }, 60_000);
    trainingContentStorageReadinessInterval.unref();
  }

  await refreshDatabaseReadiness();
  const readinessInterval = setInterval(() => {
    queueDatabaseReadinessRefresh();
  }, READINESS_REFRESH_MS);
  readinessInterval.unref();
}

export function setDashboardTrainingPackLoaderForTest(loader: ((orgId: string) => Promise<TrainingPack[]>) | null): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setDashboardTrainingPackLoaderForTest is only available in test.");
  }
  dashboardTrainingPackLoaderForTest = loader;
}

export function clearRateLimitsForTest(): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("clearRateLimitsForTest is only available in test.");
  }
  rateLimitByKey.clear();
  rateLimitCleanupCounter = 0;
}

export function setMobileAccountDeletionFailureForTest(error: Error | null): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setMobileAccountDeletionFailureForTest is only available in test.");
  }
  mobileAccountDeletionFailureForTest = error;
}

export function setOrgModuleEntitlementStoreForTest(store: OrgModuleEntitlementStore): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setOrgModuleEntitlementStoreForTest is only available in test.");
  }
  orgModuleEntitlementStore = store;
}

export function setTrainingContentAssetServiceForTest(
  service: TrainingContentAssetService | null
): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setTrainingContentAssetServiceForTest is only available in test.");
  }
  trainingContentAssetService = service ?? defaultTrainingContentAssetService;
}

export function setTrainingContentManagementServiceForTest(
  service: TrainingContentManagementService | null
): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setTrainingContentManagementServiceForTest is only available in test.");
  }
  trainingContentManagementService = service ?? defaultTrainingContentManagementService;
}

export function setTrainingContentMobileServiceForTest(
  service: TrainingContentMobileService | null
): void {
  if (runtimeConfig.nodeEnv !== "test") {
    throw new Error("setTrainingContentMobileServiceForTest is only available in test.");
  }
  trainingContentMobileService = service ?? defaultTrainingContentMobileService;
}

export { app, createDefaultDatabase, ensureDatabaseShape };

if (runtimeConfig.nodeEnv !== "test") {
  void startApiServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`[BOOT] startup failed: ${message}`);
    process.exit(1);
  });
}
