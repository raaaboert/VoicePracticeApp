import path from "node:path";

export type StorageProvider = "file" | "postgres";

export interface RuntimeConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  storageProvider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  corsAllowedOrigins: string[];
  adminBootstrapPassword: string;
  adminTokenSecret: string;
  mobileTokenSecret: string;
  adminTokenTtlMinutes: number;
  openAiChatModel: string;
  openAiTranscriptionModel: string;
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

  const port = toInt(env.PORT, 4100);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const storageProvider = parseStorageProvider(env.STORAGE_PROVIDER, databaseUrl, isProduction);
  if (storageProvider === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }

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

  return {
    nodeEnv,
    isProduction,
    port,
    storageProvider,
    dbPath,
    databaseUrl,
    corsAllowedOrigins,
    adminBootstrapPassword,
    adminTokenSecret,
    mobileTokenSecret,
    adminTokenTtlMinutes: toInt(env.ADMIN_TOKEN_TTL_MINUTES, 720),
    openAiChatModel: env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
    supportTranscriptSecret
  };
}
