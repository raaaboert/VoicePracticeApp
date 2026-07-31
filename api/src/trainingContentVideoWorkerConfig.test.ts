import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTrainingContentVideoWorkerFailure,
  loadTrainingContentVideoWorkerConfig,
} from "./trainingContentVideoWorkerConfig.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  PERITIO_ENV: "staging",
  STORAGE_PROVIDER: "postgres",
  DATABASE_URL: "postgres://user:pass@host/voicepractice_db",
  TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
  TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
  TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
  TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-staging",
  TRAINING_CONTENT_R2_ACCESS_KEY_ID: "access",
  TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "secret",
  TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
};

test("video worker configuration is single-concurrency, bounded, and version-verified", () => {
  const config = loadTrainingContentVideoWorkerConfig(BASE_ENV);
  assert.equal(config.deploymentEnvironment, "staging");
  assert.equal(config.worker.maximumInputBytes, 500 * 1024 * 1024);
  assert.equal(config.worker.maximumAttempts, 3);
  assert.equal(config.worker.jobTimeoutMs, 20 * 60 * 1000);
  assert.equal(config.worker.leaseSeconds, 30 * 60);
  assert.equal(config.mediaToolVersionPrefix, "5.1.9");
});

test("video worker rejects concurrency above one and a lease shorter than the job timeout", () => {
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...BASE_ENV,
      TRAINING_CONTENT_VIDEO_WORKER_CONCURRENCY: "2",
    }),
    /between 1 and 1/
  );
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...BASE_ENV,
      TRAINING_CONTENT_VIDEO_JOB_TIMEOUT_SECONDS: "1200",
      TRAINING_CONTENT_VIDEO_LEASE_SECONDS: "1200",
    }),
    /must exceed the job timeout/
  );
});

test("video worker enforces staging database and R2 lane separation", () => {
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...BASE_ENV,
      DATABASE_URL: "postgres://user:pass@host/peritio-db-prod",
    }),
    /production database/
  );
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...BASE_ENV,
      TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-production",
    }),
    /Staging Training Content storage/
  );
});

test("manual Render configuration requires the database and complete R2 lane settings", () => {
  const configuredSix: NodeJS.ProcessEnv = {
    PERITIO_ENV: "staging",
    DATABASE_URL: "postgres://user:pass@host/voicepractice_db",
    TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
    TRAINING_CONTENT_R2_ACCESS_KEY_ID: "access",
    TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "secret",
    TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  };
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig(configuredSix),
    /requires STORAGE_PROVIDER=postgres/
  );
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...configuredSix,
      STORAGE_PROVIDER: "postgres",
    }),
    /TRAINING_CONTENT_STORAGE_PROVIDER must be explicitly set/
  );
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...configuredSix,
      STORAGE_PROVIDER: "postgres",
      TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    }),
    /TRAINING_CONTENT_R2_ENVIRONMENT is required/
  );
  assert.throws(
    () => loadTrainingContentVideoWorkerConfig({
      ...configuredSix,
      STORAGE_PROVIDER: "postgres",
      TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
      TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    }),
    /TRAINING_CONTENT_R2_BUCKET is required/
  );
  assert.doesNotThrow(() => loadTrainingContentVideoWorkerConfig({
    ...configuredSix,
    STORAGE_PROVIDER: "postgres",
    TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-staging",
  }));
});

test("worker fatal diagnostics expose only a safe stage category", () => {
  assert.equal(
    classifyTrainingContentVideoWorkerFailure(
      "config",
      new Error("The Training Content video worker requires STORAGE_PROVIDER=postgres.")
    ),
    "startup_config_invalid"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure(
      "config",
      new Error("TRAINING_CONTENT_R2_BUCKET is required.")
    ),
    "r2_config_invalid"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure(
      "config",
      new Error("TRAINING_CONTENT_R2_ENVIRONMENT must match PERITIO_ENV.")
    ),
    "environment_lane_mismatch"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("database", new Error("sensitive")),
    "database_initialization_failed"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("r2", new Error("sensitive")),
    "r2_connection_failed"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("media", { category: "ffmpeg_unavailable" }),
    "ffmpeg_runtime_invalid"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("media", { category: "ffprobe_unavailable" }),
    "ffprobe_runtime_invalid"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("media", {
      category: "media_tool_version_mismatch",
    }),
    "media_tool_version_invalid"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("polling", {
      category: "poll_sweep_failed",
    }),
    "poll_sweep_failed"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("polling", {
      category: "poll_claim_failed",
    }),
    "poll_claim_failed"
  );
  assert.equal(
    classifyTrainingContentVideoWorkerFailure("polling", new Error("sensitive")),
    "worker_runtime_failure"
  );
});
