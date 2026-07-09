import path from "node:path";
import { loadOpenAiModelConfig, OpenAiModelConfig } from "./openaiModelConfig.js";

export type StorageProvider = "file" | "postgres";
export type AuthCodeDeliveryProvider = "log_only" | "resend";
export type DeploymentEnvironment = "development" | "staging" | "production";

export interface RuntimeConfig {
  nodeEnv: string;
  deploymentEnvironment: DeploymentEnvironment;
  isProduction: boolean;
  port: number;
  storageProvider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  corsAllowedOrigins: string[];
  adminBootstrapPassword: string;
  adminTokenSecret: string;
  webAuthTokenSecret: string;
  mobileTokenSecret: string;
  adminTokenTtlMinutes: number;
  authCodeDeliveryProvider: AuthCodeDeliveryProvider;
  webAuthCodeDeliveryProvider: AuthCodeDeliveryProvider | null;
  mobileEmailVerificationDeliveryProvider: AuthCodeDeliveryProvider | null;
  resendApiKey: string | null;
  authCodeFromEmail: string | null;
  authCodeFromName: string;
  authCodeReplyTo: string | null;
  requireReverifyOnOnboard: boolean;
  openAi: OpenAiModelConfig;
  enableRemoteTts: boolean;
  openAiMaxDailyCallsPerUser: number | null;
  openAiMaxDailyCallsGlobal: number | null;
  openAiMaxDailyTokensPerUser: number | null;
  openAiMaxDailyTokensGlobal: number | null;
  supportTranscriptSecret: string;
  useModularPromptArchitecture: boolean;
  enableInternalDebugEndpoints: boolean;
}

const PLACEHOLDER_VALUES = new Set([
  "",
  "replace_me_for_production",
  "replace_me_for_mobile_tokens",
  "replace_me_for_mobile_token",
  "replace_me_for_mobile",
  "replace_me_for_shared_web_auth",
  "admin",
]);

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parsePositiveInt(envName: string, value: string | undefined, fallback: number): number {
  const parsed = toInt(value, fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function parseOptionalNonNegativeInt(
  envName: string,
  rawValue: string | undefined,
  fallback: number | null
): number | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer when provided.`);
  }

  return Math.floor(parsed);
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "on") {
    return true;
  }

  if (trimmed === "0" || trimmed === "false" || trimmed === "no" || trimmed === "off") {
    return false;
  }

  throw new Error(`Expected boolean environment value, received "${value}".`);
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value.split(",")) {
    const normalized = normalizeOrigin(entry);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function parseStorageProvider(
  rawStorageProvider: string | undefined,
  databaseUrl: string | null,
  isProduction: boolean
): StorageProvider {
  const candidate = rawStorageProvider?.trim().toLowerCase();
  if (candidate === "file" || candidate === "postgres") {
    return candidate;
  }

  if (candidate) {
    throw new Error(`Invalid STORAGE_PROVIDER value "${rawStorageProvider}". Expected "file" or "postgres".`);
  }

  if (isProduction) {
    throw new Error('STORAGE_PROVIDER is required in production and must be either "file" or "postgres".');
  }

  return databaseUrl ? "postgres" : "file";
}

function parseDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) {
    return "development";
  }
  if (candidate === "development" || candidate === "dev" || candidate === "local") {
    return "development";
  }
  if (candidate === "staging" || candidate === "stage") {
    return "staging";
  }
  if (candidate === "production" || candidate === "prod") {
    return "production";
  }

  throw new Error('PERITIO_ENV must be one of "development", "staging", or "production".');
}

function normalizeDatabaseUrlFingerprint(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function databaseUrlContainsAny(value: string | null, markers: string[]): boolean {
  const normalized = value ? normalizeDatabaseUrlFingerprint(value) : "";
  return markers.some((marker) => normalized.includes(marker));
}

function assertDeploymentDatabaseSeparation(params: {
  deploymentEnvironment: DeploymentEnvironment;
  databaseUrl: string | null;
  productionDatabaseUrl?: string;
}): void {
  const explicitProductionDatabaseUrl = params.productionDatabaseUrl?.trim();
  if (
    params.deploymentEnvironment === "staging" &&
    explicitProductionDatabaseUrl &&
    params.databaseUrl &&
    normalizeDatabaseUrlFingerprint(params.databaseUrl) === normalizeDatabaseUrlFingerprint(explicitProductionDatabaseUrl)
  ) {
    throw new Error("Staging DATABASE_URL must not match PRODUCTION_DATABASE_URL.");
  }

  if (
    params.deploymentEnvironment === "staging" &&
    databaseUrlContainsAny(params.databaseUrl, ["peritio-db-prod", "peritio_db_prod"])
  ) {
    throw new Error("Staging DATABASE_URL appears to point at the production database.");
  }

  if (
    params.deploymentEnvironment === "production" &&
    databaseUrlContainsAny(params.databaseUrl, ["voicepractice_db", "voicepractice-db"])
  ) {
    throw new Error("Production DATABASE_URL appears to point at the staging database.");
  }
}

function parseAuthCodeDeliveryProvider(rawValue: string | undefined): AuthCodeDeliveryProvider {
  const candidate = rawValue?.trim().toLowerCase();
  if (!candidate || candidate === "log_only") {
    return "log_only";
  }
  if (candidate === "resend") {
    return "resend";
  }
  throw new Error(`Invalid AUTH_CODE_DELIVERY_PROVIDER value "${rawValue}". Expected "log_only" or "resend".`);
}

function parseOptionalAuthCodeDeliveryProvider(rawValue: string | undefined): AuthCodeDeliveryProvider | null {
  const candidate = rawValue?.trim();
  if (!candidate) {
    return null;
  }

  return parseAuthCodeDeliveryProvider(candidate);
}

function assertNotPlaceholderSecret(
  envName: string,
  value: string,
  isProduction: boolean,
  options?: { allowAdminDefault?: boolean; minimumLength?: number }
): void {
  if (!isProduction) {
    return;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${envName} is required in production.`);
  }

  const normalized = trimmed.toLowerCase();
  const allowAdminDefault = options?.allowAdminDefault ?? false;
  if (PLACEHOLDER_VALUES.has(normalized) && !(allowAdminDefault && normalized === "admin")) {
    throw new Error(`${envName} cannot use a placeholder/default value in production.`);
  }

  const minimumLength = options?.minimumLength ?? 1;
  if (trimmed.length < minimumLength) {
    throw new Error(`${envName} must be at least ${minimumLength} characters in production.`);
  }
}

function assertExplicitProductionSecret(
  envName: string,
  rawValue: string | undefined,
  resolvedValue: string,
  isProductionDeployment: boolean,
  options?: { minimumLength?: number }
): void {
  if (isProductionDeployment && !rawValue?.trim()) {
    throw new Error(`${envName} must be explicitly set in production.`);
  }

  assertNotPlaceholderSecret(envName, resolvedValue, isProductionDeployment, options);
}

function assertDistinctProductionSecrets(
  isProductionDeployment: boolean,
  secrets: Array<{ envName: string; value: string }>
): void {
  if (!isProductionDeployment) {
    return;
  }

  const seen = new Map<string, string>();
  for (const secret of secrets) {
    const normalized = secret.value.trim();
    const existing = seen.get(normalized);
    if (existing) {
      throw new Error(`${secret.envName} must not reuse the same value as ${existing} in production.`);
    }
    seen.set(normalized, secret.envName);
  }
}

function assertProductionAuthCodeDelivery(params: {
  isProductionDeployment: boolean;
  authCodeDeliveryProvider: AuthCodeDeliveryProvider;
  webAuthCodeDeliveryProvider: AuthCodeDeliveryProvider | null;
  mobileEmailVerificationDeliveryProvider: AuthCodeDeliveryProvider | null;
}): void {
  if (!params.isProductionDeployment) {
    return;
  }

  const effectiveWebAuthProvider = params.webAuthCodeDeliveryProvider ?? params.authCodeDeliveryProvider;
  const effectiveMobileProvider =
    params.mobileEmailVerificationDeliveryProvider ?? params.authCodeDeliveryProvider;

  if (
    params.authCodeDeliveryProvider === "log_only" ||
    effectiveWebAuthProvider === "log_only" ||
    effectiveMobileProvider === "log_only"
  ) {
    throw new Error("Production auth code delivery must use resend for default, web, and mobile flows.");
  }
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const deploymentEnvironment = parseDeploymentEnvironment(env.PERITIO_ENV);
  const isProduction = nodeEnv === "production";
  const isProductionDeployment = deploymentEnvironment === "production";
  const hasOpenAiApiKey = Boolean(env.OPENAI_API_KEY?.trim());

  const port = toInt(env.PORT, 4100);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  assertDeploymentDatabaseSeparation({
    deploymentEnvironment,
    databaseUrl,
    productionDatabaseUrl: env.PRODUCTION_DATABASE_URL
  });

  const storageProvider = parseStorageProvider(env.STORAGE_PROVIDER, databaseUrl, isProductionDeployment);
  if (storageProvider === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  if (isProductionDeployment && storageProvider !== "postgres") {
    throw new Error('STORAGE_PROVIDER must be "postgres" when PERITIO_ENV=production.');
  }
  const pgPoolMax = parsePositiveInt("PG_POOL_MAX", env.PG_POOL_MAX, 5);
  const pgConnectTimeoutMs = parsePositiveInt("PG_CONNECT_TIMEOUT_MS", env.PG_CONNECT_TIMEOUT_MS, 8000);
  const pgIdleTimeoutMs = parsePositiveInt("PG_IDLE_TIMEOUT_MS", env.PG_IDLE_TIMEOUT_MS, 30000);

  const dbPath = path.resolve(process.cwd(), env.DB_PATH ?? "./db.local.json");
  const corsAllowedOrigins = parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (isProductionDeployment && corsAllowedOrigins.length === 0) {
    throw new Error(
      "CORS_ALLOWED_ORIGINS is required in production and must contain one or more comma-separated origins."
    );
  }

  const adminBootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD?.trim() || "admin";
  const adminTokenSecret = env.ADMIN_TOKEN_SECRET?.trim() || "replace_me_for_production";
  const webAuthTokenSecret = env.WEB_AUTH_TOKEN_SECRET?.trim() || "";
  const authCodeDeliveryProvider = parseAuthCodeDeliveryProvider(env.AUTH_CODE_DELIVERY_PROVIDER);
  const webAuthCodeDeliveryProvider = parseOptionalAuthCodeDeliveryProvider(env.WEB_AUTH_CODE_DELIVERY_PROVIDER);
  const mobileEmailVerificationDeliveryProvider = parseOptionalAuthCodeDeliveryProvider(
    env.MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER
  );
  const resendApiKey = env.RESEND_API_KEY?.trim() || null;
  const authCodeFromEmail = env.AUTH_CODE_FROM_EMAIL?.trim() || null;
  const authCodeFromName = env.AUTH_CODE_FROM_NAME?.trim() || "Peritio";
  const authCodeReplyTo = env.AUTH_CODE_REPLY_TO?.trim() || null;
  const mobileTokenSecret = env.MOBILE_TOKEN_SECRET?.trim() || adminTokenSecret;
  const supportTranscriptSecret =
    env.SUPPORT_TRANSCRIPT_SECRET?.trim() || env.ADMIN_TOKEN_SECRET?.trim() || "replace_me_for_production";

  if (webAuthTokenSecret.length < 32) {
    throw new Error("WEB_AUTH_TOKEN_SECRET is required and must be at least 32 characters.");
  }

  assertNotPlaceholderSecret("ADMIN_BOOTSTRAP_PASSWORD", adminBootstrapPassword, isProductionDeployment, {
    minimumLength: 8
  });
  assertExplicitProductionSecret("ADMIN_TOKEN_SECRET", env.ADMIN_TOKEN_SECRET, adminTokenSecret, isProductionDeployment, {
    minimumLength: 32
  });
  assertExplicitProductionSecret(
    "WEB_AUTH_TOKEN_SECRET",
    env.WEB_AUTH_TOKEN_SECRET,
    webAuthTokenSecret,
    isProductionDeployment,
    { minimumLength: 32 }
  );
  assertExplicitProductionSecret(
    "MOBILE_TOKEN_SECRET",
    env.MOBILE_TOKEN_SECRET,
    mobileTokenSecret,
    isProductionDeployment,
    { minimumLength: 32 }
  );
  assertExplicitProductionSecret(
    "SUPPORT_TRANSCRIPT_SECRET",
    env.SUPPORT_TRANSCRIPT_SECRET,
    supportTranscriptSecret,
    isProductionDeployment,
    { minimumLength: 32 }
  );
  assertDistinctProductionSecrets(isProductionDeployment, [
    { envName: "ADMIN_TOKEN_SECRET", value: adminTokenSecret },
    { envName: "WEB_AUTH_TOKEN_SECRET", value: webAuthTokenSecret },
    { envName: "MOBILE_TOKEN_SECRET", value: mobileTokenSecret },
    { envName: "SUPPORT_TRANSCRIPT_SECRET", value: supportTranscriptSecret }
  ]);
  assertProductionAuthCodeDelivery({
    isProductionDeployment,
    authCodeDeliveryProvider,
    webAuthCodeDeliveryProvider,
    mobileEmailVerificationDeliveryProvider
  });

  const usesResend =
    authCodeDeliveryProvider === "resend"
    || webAuthCodeDeliveryProvider === "resend"
    || mobileEmailVerificationDeliveryProvider === "resend";

  if (usesResend) {
    if (!resendApiKey || resendApiKey.length < 16) {
      throw new Error(
        "RESEND_API_KEY is required when any auth code delivery provider is set to resend."
      );
    }
    if (!authCodeFromEmail) {
      throw new Error(
        "AUTH_CODE_FROM_EMAIL is required when any auth code delivery provider is set to resend."
      );
    }
  }

  const openAiDefaults = hasOpenAiApiKey && isProduction
    ? {
        perUserCalls: 120,
        globalCalls: 1500,
        perUserTokens: 250_000,
        globalTokens: 2_000_000
      }
    : {
        perUserCalls: null,
        globalCalls: null,
        perUserTokens: null,
        globalTokens: null
      };

  return {
    nodeEnv,
    deploymentEnvironment,
    isProduction,
    port,
    storageProvider,
    dbPath,
    databaseUrl,
    pgPoolMax,
    pgConnectTimeoutMs,
    pgIdleTimeoutMs,
    corsAllowedOrigins,
    adminBootstrapPassword,
    adminTokenSecret,
    webAuthTokenSecret,
    mobileTokenSecret,
    adminTokenTtlMinutes: toInt(env.ADMIN_TOKEN_TTL_MINUTES, 720),
    authCodeDeliveryProvider,
    webAuthCodeDeliveryProvider,
    mobileEmailVerificationDeliveryProvider,
    resendApiKey,
    authCodeFromEmail,
    authCodeFromName,
    authCodeReplyTo,
    requireReverifyOnOnboard: toBoolean(env.MOBILE_REVERIFY_ON_ONBOARD, isProduction),
    openAi: loadOpenAiModelConfig(env),
    enableRemoteTts: toBoolean(env.ENABLE_REMOTE_TTS, false),
    openAiMaxDailyCallsPerUser: parseOptionalNonNegativeInt(
      "OPENAI_MAX_DAILY_CALLS_PER_USER",
      env.OPENAI_MAX_DAILY_CALLS_PER_USER,
      openAiDefaults.perUserCalls
    ),
    openAiMaxDailyCallsGlobal: parseOptionalNonNegativeInt(
      "OPENAI_MAX_DAILY_CALLS_GLOBAL",
      env.OPENAI_MAX_DAILY_CALLS_GLOBAL,
      openAiDefaults.globalCalls
    ),
    openAiMaxDailyTokensPerUser: parseOptionalNonNegativeInt(
      "OPENAI_MAX_DAILY_TOKENS_PER_USER",
      env.OPENAI_MAX_DAILY_TOKENS_PER_USER,
      openAiDefaults.perUserTokens
    ),
    openAiMaxDailyTokensGlobal: parseOptionalNonNegativeInt(
      "OPENAI_MAX_DAILY_TOKENS_GLOBAL",
      env.OPENAI_MAX_DAILY_TOKENS_GLOBAL,
      openAiDefaults.globalTokens
    ),
    supportTranscriptSecret,
    useModularPromptArchitecture: toBoolean(env.USE_MODULAR_PROMPT_ARCHITECTURE, false),
    enableInternalDebugEndpoints: toBoolean(env.ENABLE_INTERNAL_DEBUG_ENDPOINTS, false),
  };
}
