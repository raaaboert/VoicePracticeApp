export type TrainingContentStorageProvider = "disabled" | "r2";
export type TrainingContentStorageEnvironment = "development" | "staging" | "production";
export type TrainingContentFileKind = "video" | "audio" | "pdf" | "docx" | "image";

export interface TrainingContentFileSizeLimits {
  video: number;
  audio: number;
  pdf: number;
  docx: number;
  image: number;
}

export interface TrainingContentR2Config {
  environment: TrainingContentStorageEnvironment;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
}

export interface TrainingContentStorageConfig {
  provider: TrainingContentStorageProvider;
  r2: TrainingContentR2Config | null;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  mediaAccessUrlTtlSeconds: number;
  maxPendingUploadBytesPerOrganization: number;
  fileSizeLimits: TrainingContentFileSizeLimits;
  finalizationLeaseSeconds: number;
  orphanGracePeriodSeconds: number;
  supersededRetentionDays: number;
}

const STAGING_BUCKET = "peritio-training-content-staging";
const PRODUCTION_BUCKET = "peritio-training-content-production";

const HARD_FILE_SIZE_LIMITS: TrainingContentFileSizeLimits = {
  video: 500 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  image: 20 * 1024 * 1024,
};

const R2_ENVIRONMENT_VARIABLES = [
  "TRAINING_CONTENT_R2_ENVIRONMENT",
  "TRAINING_CONTENT_R2_ACCOUNT_ID",
  "TRAINING_CONTENT_R2_BUCKET",
  "TRAINING_CONTENT_R2_ACCESS_KEY_ID",
  "TRAINING_CONTENT_R2_SECRET_ACCESS_KEY",
  "TRAINING_CONTENT_R2_ENDPOINT",
] as const;

function parseBoundedPositiveInteger(params: {
  envName: string;
  rawValue: string | undefined;
  fallback: number;
  minimum: number;
  maximum: number;
}): number {
  const trimmed = params.rawValue?.trim();
  const parsed = trimmed ? Number(trimmed) : params.fallback;
  if (!Number.isSafeInteger(parsed) || parsed < params.minimum || parsed > params.maximum) {
    throw new Error(
      `${params.envName} must be an integer between ${params.minimum} and ${params.maximum}.`
    );
  }
  return parsed;
}

function parseFileSizeLimit(
  env: NodeJS.ProcessEnv,
  kind: TrainingContentFileKind,
  envName: string
): number {
  const hardLimit = HARD_FILE_SIZE_LIMITS[kind];
  return parseBoundedPositiveInteger({
    envName,
    rawValue: env[envName],
    fallback: hardLimit,
    minimum: 1,
    maximum: hardLimit,
  });
}

function requireValue(env: NodeJS.ProcessEnv, envName: string): string {
  const value = env[envName]?.trim();
  if (!value) {
    throw new Error(`${envName} is required when TRAINING_CONTENT_STORAGE_PROVIDER=r2.`);
  }
  return value;
}

function parseR2Environment(value: string): TrainingContentStorageEnvironment {
  const normalized = value.trim().toLowerCase();
  if (normalized === "development" || normalized === "staging" || normalized === "production") {
    return normalized;
  }
  throw new Error(
    'TRAINING_CONTENT_R2_ENVIRONMENT must be "development", "staging", or "production".'
  );
}

function validateR2Endpoint(accountId: string, rawEndpoint: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("TRAINING_CONTENT_R2_ENDPOINT must be a valid HTTPS URL.");
  }

  const expectedHostname = `${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
  if (
    endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || (endpoint.pathname !== "/" && endpoint.pathname !== "")
    || endpoint.hostname.toLowerCase() !== expectedHostname
  ) {
    throw new Error(
      "TRAINING_CONTENT_R2_ENDPOINT must be the account-scoped Cloudflare R2 HTTPS endpoint."
    );
  }

  return endpoint.origin;
}

function assertStorageLane(params: {
  deploymentEnvironment: TrainingContentStorageEnvironment;
  r2Environment: TrainingContentStorageEnvironment;
  bucket: string;
}): void {
  if (params.r2Environment !== params.deploymentEnvironment) {
    throw new Error(
      "TRAINING_CONTENT_R2_ENVIRONMENT must match PERITIO_ENV for the current deployment."
    );
  }

  if (params.deploymentEnvironment === "staging" && params.bucket !== STAGING_BUCKET) {
    throw new Error(`Staging Training Content storage must use bucket "${STAGING_BUCKET}".`);
  }
  if (params.deploymentEnvironment === "production" && params.bucket !== PRODUCTION_BUCKET) {
    throw new Error(`Production Training Content storage must use bucket "${PRODUCTION_BUCKET}".`);
  }
  if (
    params.deploymentEnvironment === "development"
    && (params.bucket === STAGING_BUCKET || params.bucket === PRODUCTION_BUCKET)
  ) {
    throw new Error("Development Training Content storage cannot use a staging or production bucket.");
  }
}

export function loadTrainingContentStorageConfig(
  env: NodeJS.ProcessEnv,
  deploymentEnvironment: TrainingContentStorageEnvironment
): TrainingContentStorageConfig {
  const providerValue = env.TRAINING_CONTENT_STORAGE_PROVIDER?.trim().toLowerCase();
  const hasR2Configuration = R2_ENVIRONMENT_VARIABLES.some((envName) => Boolean(env[envName]?.trim()));

  if (!providerValue && hasR2Configuration) {
    throw new Error(
      "TRAINING_CONTENT_STORAGE_PROVIDER must be explicitly set when R2 configuration is present."
    );
  }
  if (providerValue && providerValue !== "disabled" && providerValue !== "r2") {
    throw new Error(
      'TRAINING_CONTENT_STORAGE_PROVIDER must be either "disabled" or "r2".'
    );
  }

  const provider: TrainingContentStorageProvider = providerValue === "r2" ? "r2" : "disabled";
  let r2: TrainingContentR2Config | null = null;
  if (provider === "r2") {
    const environment = parseR2Environment(requireValue(env, "TRAINING_CONTENT_R2_ENVIRONMENT"));
    const accountId = requireValue(env, "TRAINING_CONTENT_R2_ACCOUNT_ID");
    if (!/^[a-zA-Z0-9]+$/.test(accountId)) {
      throw new Error("TRAINING_CONTENT_R2_ACCOUNT_ID contains unsupported characters.");
    }
    const bucket = requireValue(env, "TRAINING_CONTENT_R2_BUCKET");
    assertStorageLane({
      deploymentEnvironment,
      r2Environment: environment,
      bucket,
    });

    r2 = {
      environment,
      accountId,
      bucket,
      accessKeyId: requireValue(env, "TRAINING_CONTENT_R2_ACCESS_KEY_ID"),
      secretAccessKey: requireValue(env, "TRAINING_CONTENT_R2_SECRET_ACCESS_KEY"),
      endpoint: validateR2Endpoint(accountId, requireValue(env, "TRAINING_CONTENT_R2_ENDPOINT")),
    };
  }

  return {
    provider,
    r2,
    uploadUrlTtlSeconds: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS",
      rawValue: env.TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS,
      fallback: 600,
      minimum: 60,
      maximum: 900,
    }),
    downloadUrlTtlSeconds: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_DOWNLOAD_URL_TTL_SECONDS",
      rawValue: env.TRAINING_CONTENT_DOWNLOAD_URL_TTL_SECONDS,
      fallback: 300,
      minimum: 60,
      maximum: 900,
    }),
    mediaAccessUrlTtlSeconds: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_MEDIA_ACCESS_URL_TTL_SECONDS",
      rawValue: env.TRAINING_CONTENT_MEDIA_ACCESS_URL_TTL_SECONDS,
      fallback: 3600,
      minimum: 60,
      maximum: 3600,
    }),
    maxPendingUploadBytesPerOrganization: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_MAX_PENDING_UPLOAD_BYTES",
      rawValue: env.TRAINING_CONTENT_MAX_PENDING_UPLOAD_BYTES,
      fallback: 1024 * 1024 * 1024,
      minimum: 1,
      maximum: 10 * 1024 * 1024 * 1024,
    }),
    fileSizeLimits: {
      video: parseFileSizeLimit(env, "video", "TRAINING_CONTENT_MAX_VIDEO_BYTES"),
      audio: parseFileSizeLimit(env, "audio", "TRAINING_CONTENT_MAX_AUDIO_BYTES"),
      pdf: parseFileSizeLimit(env, "pdf", "TRAINING_CONTENT_MAX_PDF_BYTES"),
      docx: parseFileSizeLimit(env, "docx", "TRAINING_CONTENT_MAX_DOCX_BYTES"),
      image: parseFileSizeLimit(env, "image", "TRAINING_CONTENT_MAX_IMAGE_BYTES"),
    },
    finalizationLeaseSeconds: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_FINALIZATION_LEASE_SECONDS",
      rawValue: env.TRAINING_CONTENT_FINALIZATION_LEASE_SECONDS,
      fallback: 300,
      minimum: 30,
      maximum: 1800,
    }),
    orphanGracePeriodSeconds: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_ORPHAN_GRACE_SECONDS",
      rawValue: env.TRAINING_CONTENT_ORPHAN_GRACE_SECONDS,
      fallback: 24 * 60 * 60,
      minimum: 60 * 60,
      maximum: 7 * 24 * 60 * 60,
    }),
    supersededRetentionDays: parseBoundedPositiveInteger({
      envName: "TRAINING_CONTENT_SUPERSEDED_RETENTION_DAYS",
      rawValue: env.TRAINING_CONTENT_SUPERSEDED_RETENTION_DAYS,
      fallback: 30,
      minimum: 1,
      maximum: 365,
    }),
  };
}

export const TRAINING_CONTENT_STORAGE_BUCKETS = {
  staging: STAGING_BUCKET,
  production: PRODUCTION_BUCKET,
} as const;

export const TRAINING_CONTENT_HARD_FILE_SIZE_LIMITS = HARD_FILE_SIZE_LIMITS;
