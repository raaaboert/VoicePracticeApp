import path from "node:path";

export type StorageProvider = "file" | "postgres";

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
  mobileTokenSecret: string;
  adminTokenTtlMinutes: number;
  requireReverifyOnOnboard: boolean;
  openAiChatModel: string;
  openAiTranscriptionModel: string;
  openAiMaxDailyCallsPerUser: number | null;
  openAiMaxDailyCallsGlobal: number | null;
  openAiMaxDailyTokensPerUser: number | null;
  openAiMaxDailyTokensGlobal: number | null;
  supportTranscriptSecret: string;
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
  const mobileTokenSecret = env.MOBILE_TOKEN_SECRET?.trim() || adminTokenSecret;
  const supportTranscriptSecret =
    env.SUPPORT_TRANSCRIPT_SECRET?.trim() || env.ADMIN_TOKEN_SECRET?.trim() || "replace_me_for_production";

  assertNotPlaceholderSecret("ADMIN_BOOTSTRAP_PASSWORD", adminBootstrapPassword, isProduction, {
    minimumLength: 8
  });
  assertNotPlaceholderSecret("ADMIN_TOKEN_SECRET", adminTokenSecret, isProduction, { minimumLength: 32 });
  assertNotPlaceholderSecret("MOBILE_TOKEN_SECRET", mobileTokenSecret, isProduction, { minimumLength: 32 });
  assertNotPlaceholderSecret("SUPPORT_TRANSCRIPT_SECRET", supportTranscriptSecret, isProduction, {
    minimumLength: 32
  });

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
    mobileTokenSecret,
    adminTokenTtlMinutes: toInt(env.ADMIN_TOKEN_TTL_MINUTES, 720),
    requireReverifyOnOnboard: toBoolean(env.MOBILE_REVERIFY_ON_ONBOARD, isProduction),
    openAiChatModel: env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
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
    supportTranscriptSecret
  };
}
