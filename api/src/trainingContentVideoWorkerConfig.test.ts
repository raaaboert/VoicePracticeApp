import assert from "node:assert/strict";
import test from "node:test";

import {
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
