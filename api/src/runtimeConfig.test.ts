import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig } from "./runtimeConfig.js";

function makeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    STORAGE_PROVIDER: "file",
    DB_PATH: "./db.local.json",
    CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    ADMIN_BOOTSTRAP_PASSWORD: "admin",
    ADMIN_TOKEN_SECRET: "admin_token_secret_1234567890123456",
    WEB_AUTH_TOKEN_SECRET: "web_auth_token_secret_123456789012",
    MOBILE_TOKEN_SECRET: "mobile_token_secret_12345678901234",
    SUPPORT_TRANSCRIPT_SECRET: "support_transcript_secret_123456789",
    AUTH_CODE_DELIVERY_PROVIDER: "log_only",
    ...overrides
  };
}

function makeProductionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return makeEnv({
    PERITIO_ENV: "production",
    NODE_ENV: "production",
    STORAGE_PROVIDER: "postgres",
    DATABASE_URL: "postgres://user:password@prod-db.render.com/peritio_db_prod",
    CORS_ALLOWED_ORIGINS: "https://app.peritio.ai",
    ADMIN_BOOTSTRAP_PASSWORD: "production-admin-bootstrap-password",
    ADMIN_TOKEN_SECRET: "production-admin-token-secret-123456",
    WEB_AUTH_TOKEN_SECRET: "production-web-auth-token-secret-1234",
    MOBILE_TOKEN_SECRET: "production-mobile-token-secret-12345",
    SUPPORT_TRANSCRIPT_SECRET: "production-support-transcript-secret",
    AUTH_CODE_DELIVERY_PROVIDER: "resend",
    WEB_AUTH_CODE_DELIVERY_PROVIDER: "resend",
    MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "resend",
    RESEND_API_KEY: "re_production_12345678901234567890",
    AUTH_CODE_FROM_EMAIL: "noreply@peritio.ai",
    ...overrides
  });
}

test("auth code delivery overrides default to null when unset", () => {
  const config = loadRuntimeConfig(makeEnv());
  assert.equal(config.authCodeDeliveryProvider, "log_only");
  assert.equal(config.webAuthCodeDeliveryProvider, null);
  assert.equal(config.mobileEmailVerificationDeliveryProvider, null);
});

test("web auth resend override requires resend credentials even when default provider stays log_only", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeEnv({
          WEB_AUTH_CODE_DELIVERY_PROVIDER: "resend",
          RESEND_API_KEY: "",
          AUTH_CODE_FROM_EMAIL: ""
        })
      ),
    /RESEND_API_KEY is required when any auth code delivery provider is set to resend/
  );
});

test("mobile resend override is accepted when resend credentials are present", () => {
  const config = loadRuntimeConfig(
    makeEnv({
      MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_12345678901234567890",
      AUTH_CODE_FROM_EMAIL: "noreply@example.com"
    })
  );

  assert.equal(config.authCodeDeliveryProvider, "log_only");
  assert.equal(config.mobileEmailVerificationDeliveryProvider, "resend");
});

test("staging refuses an obvious production database URL", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeEnv({
          PERITIO_ENV: "staging",
          STORAGE_PROVIDER: "postgres",
          DATABASE_URL: "postgres://user:password@host/peritio_db_prod"
        })
      ),
    /Staging DATABASE_URL appears to point at the production database/
  );
});

test("production accepts strict postgres, resend, and unique-secret settings", () => {
  const config = loadRuntimeConfig(makeProductionEnv());

  assert.equal(config.deploymentEnvironment, "production");
  assert.equal(config.storageProvider, "postgres");
  assert.equal(config.authCodeDeliveryProvider, "resend");
  assert.equal(config.webAuthCodeDeliveryProvider, "resend");
  assert.equal(config.mobileEmailVerificationDeliveryProvider, "resend");
});

test("production refuses file storage", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeProductionEnv({
          STORAGE_PROVIDER: "file",
          DATABASE_URL: ""
        })
      ),
    /STORAGE_PROVIDER must be "postgres" when PERITIO_ENV=production/
  );
});

test("production refuses log-only auth code delivery", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeProductionEnv({
          AUTH_CODE_DELIVERY_PROVIDER: "log_only"
        })
      ),
    /Production auth code delivery must use resend/
  );
});

test("production refuses fallback or shared token secrets", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeProductionEnv({
          MOBILE_TOKEN_SECRET: "",
        })
      ),
    /MOBILE_TOKEN_SECRET must be explicitly set in production/
  );

  assert.throws(
    () =>
      loadRuntimeConfig(
        makeProductionEnv({
          MOBILE_TOKEN_SECRET: "production-admin-token-secret-123456"
        })
      ),
    /MOBILE_TOKEN_SECRET must not reuse the same value as ADMIN_TOKEN_SECRET/
  );
});

test("production refuses an obvious staging database URL", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        makeProductionEnv({
          DATABASE_URL: "postgres://user:password@host/voicepractice_db"
        })
      ),
    /Production DATABASE_URL appears to point at the staging database/
  );
});
