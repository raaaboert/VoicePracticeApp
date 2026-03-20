import path from "node:path";

export type StorageProvider = "file" | "postgres";
export type AuthCodeDeliveryProvider = "log_only" | "resend";

export interface RuntimeConfig {
  nodeEnv: string;
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
  webAuthTokenTtlMinutes: number;
  authCodeDeliveryProvider: AuthCodeDeliveryProvider;
  webAuthCodeDeliveryProvider: AuthCodeDeliveryProvider | null;
  mobileEmailVerificationDeliveryProvider: AuthCodeDeliveryProvider | null;
  resendApiKey: string | null;
  authCodeFromEmail: string | null;
  authCodeFromName: string;
  authCodeReplyTo: string | null;
  requireReverifyOnOnboard: boolean;
  openAiChatModel: string;
  openAiSimulationModel: string;
  openAiTranscriptionModel: string;
  enableRemoteTts: boolean;
  openAiSimulationMaxOutputTokens: number | null;
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

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const hasOpenAiApiKey = Boolean(env.OPENAI_API_KEY?.trim());

  const port = toInt(env.PORT, 4100);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const storageProvider = parseStorageProvider(env.STORAGE_PROVIDER, databaseUrl, isProduction);
  if (storageProvider === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }
  const pgPoolMax = parsePositiveInt("PG_POOL_MAX", env.PG_POOL_MAX, 5);
  const pgConnectTimeoutMs = parsePositiveInt("PG_CONNECT_TIMEOUT_MS", env.PG_CONNECT_TIMEOUT_MS, 8000);
  const pgIdleTimeoutMs = parsePositiveInt("PG_IDLE_TIMEOUT_MS", env.PG_IDLE_TIMEOUT_MS, 30000);

  const dbPath = path.resolve(process.cwd(), env.DB_PATH ?? "./db.local.json");
  const corsAllowedOrigins = parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (isProduction && corsAllowedOrigins.length === 0) {
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

  assertNotPlaceholderSecret("ADMIN_BOOTSTRAP_PASSWORD", adminBootstrapPassword, isProduction, {
    minimumLength: 8
  });
  assertNotPlaceholderSecret("ADMIN_TOKEN_SECRET", adminTokenSecret, isProduction, { minimumLength: 32 });
  assertNotPlaceholderSecret("WEB_AUTH_TOKEN_SECRET", webAuthTokenSecret, isProduction, { minimumLength: 32 });
  assertNotPlaceholderSecret("MOBILE_TOKEN_SECRET", mobileTokenSecret, isProduction, { minimumLength: 32 });
  assertNotPlaceholderSecret("SUPPORT_TRANSCRIPT_SECRET", supportTranscriptSecret, isProduction, {
    minimumLength: 32
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
    webAuthTokenTtlMinutes: toInt(env.WEB_AUTH_TOKEN_TTL_MINUTES, 720),
    authCodeDeliveryProvider,
    webAuthCodeDeliveryProvider,
    mobileEmailVerificationDeliveryProvider,
    resendApiKey,
    authCodeFromEmail,
    authCodeFromName,
    authCodeReplyTo,
    requireReverifyOnOnboard: toBoolean(env.MOBILE_REVERIFY_ON_ONBOARD, isProduction),
    openAiChatModel: env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    openAiSimulationModel: env.OPENAI_SIMULATION_MODEL?.trim() || env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
    enableRemoteTts: toBoolean(env.ENABLE_REMOTE_TTS, false),
    openAiSimulationMaxOutputTokens: parseOptionalNonNegativeInt(
      "OPENAI_SIMULATION_MAX_OUTPUT_TOKENS",
      env.OPENAI_SIMULATION_MAX_OUTPUT_TOKENS,
      null
    ),
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
