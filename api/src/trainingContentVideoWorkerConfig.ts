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

export type TrainingContentVideoWorkerFailureStage =
  | "config"
  | "database"
  | "r2"
  | "media"
  | "polling";

export type TrainingContentVideoWorkerFailureCategory =
  | "startup_config_invalid"
  | "environment_lane_mismatch"
  | "r2_config_invalid"
  | "database_initialization_failed"
  | "r2_connection_failed"
  | "ffmpeg_runtime_invalid"
  | "ffprobe_runtime_invalid"
  | "media_tool_version_invalid"
  | "media_runtime_invalid"
  | "poll_sweep_failed"
  | "poll_claim_failed"
  | "worker_runtime_failure";

export function classifyTrainingContentVideoWorkerFailure(
  stage: TrainingContentVideoWorkerFailureStage,
  error: unknown
): TrainingContentVideoWorkerFailureCategory {
  if (stage === "config") {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("cannot use the production database")
      || message.includes("cannot use the staging database")
      || message.includes("must match PERITIO_ENV")
      || message.includes("Staging Training Content storage")
      || message.includes("Production Training Content storage")
      || message.includes("Development Training Content storage")
    ) {
      return "environment_lane_mismatch";
    }
    if (
      message.includes("TRAINING_CONTENT_STORAGE_PROVIDER")
      || message.includes("TRAINING_CONTENT_R2_")
      || message.includes("TRAINING_CONTENT_BACKUP_")
      || message.includes("R2 object storage")
    ) {
      return "r2_config_invalid";
    }
    return "startup_config_invalid";
  }
  if (stage === "database") {
    return "database_initialization_failed";
  }
  if (stage === "r2") {
    return "r2_connection_failed";
  }
  if (stage === "media") {
    const category = typeof error === "object"
      && error !== null
      && "category" in error
      && typeof error.category === "string"
      ? error.category
      : "";
    if (category === "ffmpeg_unavailable") {
      return "ffmpeg_runtime_invalid";
    }
    if (category === "ffprobe_unavailable") {
      return "ffprobe_runtime_invalid";
    }
    if (category === "media_tool_version_mismatch") {
      return "media_tool_version_invalid";
    }
    return "media_runtime_invalid";
  }
  const runtimeCategory = typeof error === "object"
    && error !== null
    && "category" in error
    && typeof error.category === "string"
    ? error.category
    : "";
  if (runtimeCategory === "poll_sweep_failed" || runtimeCategory === "poll_claim_failed") {
    return runtimeCategory;
  }
  return "worker_runtime_failure";
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
