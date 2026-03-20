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
