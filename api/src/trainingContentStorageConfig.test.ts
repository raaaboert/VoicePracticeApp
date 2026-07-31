import assert from "node:assert/strict";
import test from "node:test";

import {
  loadTrainingContentStorageConfig,
  TRAINING_CONTENT_STORAGE_BUCKETS,
} from "./trainingContentStorageConfig.js";

function stagingR2Env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
    TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.staging,
    TRAINING_CONTENT_R2_ACCESS_KEY_ID: "staging-access-key",
    TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "staging-secret-key",
    TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
    ...overrides,
  };
}

test("Training Content storage remains disabled when no provider is configured", () => {
  const config = loadTrainingContentStorageConfig({}, "staging");
  assert.equal(config.provider, "disabled");
  assert.equal(config.r2, null);
  assert.equal(config.uploadUrlTtlSeconds, 600);
  assert.equal(config.downloadUrlTtlSeconds, 300);
  assert.equal(config.mediaAccessUrlTtlSeconds, 3600);
});

test("Training Content R2 configuration locks staging and production lanes", () => {
  const staging = loadTrainingContentStorageConfig(stagingR2Env(), "staging");
  assert.equal(staging.r2?.bucket, TRAINING_CONTENT_STORAGE_BUCKETS.staging);

  const production = loadTrainingContentStorageConfig(stagingR2Env({
    TRAINING_CONTENT_R2_ENVIRONMENT: "production",
    TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.production,
  }), "production");
  assert.equal(production.r2?.bucket, TRAINING_CONTENT_STORAGE_BUCKETS.production);

  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.production,
    }), "staging"),
    /Staging Training Content storage must use bucket/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_R2_ENVIRONMENT: "production",
      TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.staging,
    }), "production"),
    /Production Training Content storage must use bucket/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_R2_ENVIRONMENT: "production",
      TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.production,
    }), "staging"),
    /must match PERITIO_ENV/
  );
});

test("Training Content R2 configuration fails closed for ambiguity, unsupported providers, and missing credentials", () => {
  assert.throws(
    () => loadTrainingContentStorageConfig({
      TRAINING_CONTENT_R2_BUCKET: TRAINING_CONTENT_STORAGE_BUCKETS.staging,
    }, "staging"),
    /must be explicitly set/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig({
      TRAINING_CONTENT_STORAGE_PROVIDER: "filesystem",
    }, "staging"),
    /must be either "disabled" or "r2"/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "",
    }), "staging"),
    /TRAINING_CONTENT_R2_SECRET_ACCESS_KEY is required/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_R2_ENDPOINT: "https://example.com",
    }), "staging"),
    /account-scoped Cloudflare R2 HTTPS endpoint/
  );
});

test("Training Content storage TTLs and per-type limits stay within platform caps", () => {
  const config = loadTrainingContentStorageConfig(stagingR2Env({
    TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS: "900",
    TRAINING_CONTENT_DOWNLOAD_URL_TTL_SECONDS: "600",
    TRAINING_CONTENT_MEDIA_ACCESS_URL_TTL_SECONDS: "1800",
    TRAINING_CONTENT_MAX_VIDEO_BYTES: String(400 * 1024 * 1024),
  }), "staging");
  assert.equal(config.uploadUrlTtlSeconds, 900);
  assert.equal(config.downloadUrlTtlSeconds, 600);
  assert.equal(config.mediaAccessUrlTtlSeconds, 1800);
  assert.equal(config.fileSizeLimits.video, 400 * 1024 * 1024);

  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS: "3600",
    }), "staging"),
    /between 60 and 900/
  );
  assert.throws(
    () => loadTrainingContentStorageConfig(stagingR2Env({
      TRAINING_CONTENT_MAX_IMAGE_BYTES: String(21 * 1024 * 1024),
    }), "staging"),
    /between 1 and 20971520/
  );
});
