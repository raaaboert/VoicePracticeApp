import {
  loadTrainingContentStorageConfig,
  TrainingContentStorageEnvironment,
} from "./trainingContentStorageConfig.js";
import type {
  TrainingContentVideoWorkerConfig,
} from "./services/trainingContentVideoWorker.js";

export interface TrainingContentVideoWorkerRuntimeConfig {
  deploymentEnvironment: TrainingContentStorageEnvironment;
  databaseUrl: string;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  pollIntervalMs: number;
  ffmpegPath: string;
  ffprobePath: string;
  mediaToolVersionPrefix: string;
  storage: ReturnType<typeof loadTrainingContentStorageConfig>;
  worker: TrainingContentVideoWorkerConfig;
}

export function loadTrainingContentVideoWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): TrainingContentVideoWorkerRuntimeConfig {
  const deploymentEnvironment = parseDeploymentEnvironment(env.PERITIO_ENV);
  const databaseUrl = requireValue(env, "DATABASE_URL");
  assertDatabaseLane(deploymentEnvironment, databaseUrl);
  if (env.STORAGE_PROVIDER?.trim().toLowerCase() !== "postgres") {
    throw new Error("The Training Content video worker requires STORAGE_PROVIDER=postgres.");
  }
  const storage = loadTrainingContentStorageConfig(env, deploymentEnvironment);
  if (storage.provider !== "r2") {
    throw new Error("The Training Content video worker requires R2 object storage.");
  }
  const concurrency = parseBoundedInteger(
    "TRAINING_CONTENT_VIDEO_WORKER_CONCURRENCY",
    env.TRAINING_CONTENT_VIDEO_WORKER_CONCURRENCY,
    1,
    1,
    1
  );
  if (concurrency !== 1) {
    throw new Error("Training Content video worker concurrency must remain 1.");
  }
  const jobTimeoutMs = parseBoundedInteger(
    "TRAINING_CONTENT_VIDEO_JOB_TIMEOUT_SECONDS",
    env.TRAINING_CONTENT_VIDEO_JOB_TIMEOUT_SECONDS,
    20 * 60,
    60,
    30 * 60
  ) * 1000;
  const leaseSeconds = parseBoundedInteger(
    "TRAINING_CONTENT_VIDEO_LEASE_SECONDS",
    env.TRAINING_CONTENT_VIDEO_LEASE_SECONDS,
    30 * 60,
    120,
    60 * 60
  );
  if (leaseSeconds * 1000 < jobTimeoutMs + 60_000) {
    throw new Error(
      "TRAINING_CONTENT_VIDEO_LEASE_SECONDS must exceed the job timeout by at least 60 seconds."
    );
  }

  return {
    deploymentEnvironment,
    databaseUrl,
    pgPoolMax: parseBoundedInteger("PG_POOL_MAX", env.PG_POOL_MAX, 2, 1, 5),
    pgConnectTimeoutMs: parseBoundedInteger(
      "PG_CONNECT_TIMEOUT_MS",
      env.PG_CONNECT_TIMEOUT_MS,
      8_000,
      1_000,
      60_000
    ),
    pgIdleTimeoutMs: parseBoundedInteger(
      "PG_IDLE_TIMEOUT_MS",
      env.PG_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      120_000
    ),
    pollIntervalMs: parseBoundedInteger(
      "TRAINING_CONTENT_VIDEO_POLL_INTERVAL_MS",
      env.TRAINING_CONTENT_VIDEO_POLL_INTERVAL_MS,
      2_000,
      250,
      60_000
    ),
    ffmpegPath: env.TRAINING_CONTENT_FFMPEG_PATH?.trim() || "ffmpeg",
    ffprobePath: env.TRAINING_CONTENT_FFPROBE_PATH?.trim() || "ffprobe",
    mediaToolVersionPrefix:
      env.TRAINING_CONTENT_MEDIA_TOOL_VERSION_PREFIX?.trim() || "5.1.9",
    storage,
    worker: {
      maximumInputBytes: storage.fileSizeLimits.video,
      minimumFreeDiskBytes: parseBoundedInteger(
        "TRAINING_CONTENT_VIDEO_MINIMUM_FREE_DISK_BYTES",
        env.TRAINING_CONTENT_VIDEO_MINIMUM_FREE_DISK_BYTES,
        256 * 1024 * 1024,
        64 * 1024 * 1024,
        4 * 1024 * 1024 * 1024
      ),
      jobTimeoutMs,
      leaseSeconds,
      maximumAttempts: parseBoundedInteger(
        "TRAINING_CONTENT_VIDEO_MAX_ATTEMPTS",
        env.TRAINING_CONTENT_VIDEO_MAX_ATTEMPTS,
        3,
        1,
        5
      ),
      retryDelaySeconds: [60, 300, 900],
    },
  };
}

function parseDeploymentEnvironment(
  value: string | undefined
): TrainingContentStorageEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "development"
    || normalized === "staging"
    || normalized === "production"
  ) {
    return normalized;
  }
  throw new Error(
    'PERITIO_ENV must be "development", "staging", or "production" for the video worker.'
  );
}

function assertDatabaseLane(
  environment: TrainingContentStorageEnvironment,
  databaseUrl: string
): void {
  const normalized = databaseUrl.trim().toLowerCase();
  if (
    environment === "staging"
    && (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod"))
  ) {
    throw new Error("Staging video processing cannot use the production database.");
  }
  if (
    environment === "production"
    && (normalized.includes("voicepractice_db") || normalized.includes("voicepractice-db"))
  ) {
    throw new Error("Production video processing cannot use the staging database.");
  }
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Training Content video worker.`);
  }
  return value;
}

function parseBoundedInteger(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = rawValue?.trim() ? Number(rawValue) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
