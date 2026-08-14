import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const mobileDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildProfiles = JSON.parse(readFileSync(resolve(mobileDirectory, "eas.json"), "utf8")).build;
const createAppConfig = require(resolve(mobileDirectory, "app.config.js"));
const scopedEnvironmentKeys = [
  "EAS_BUILD_PROFILE",
  "PERITIO_MOBILE_ENV",
  "PERITIO_MOBILE_APP_VARIANT",
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_REMOTE_AI_ENABLED",
  "EXPO_PUBLIC_REMOTE_TTS_ENABLED",
];

function resolveBuildProfile(profileName) {
  const profile = buildProfiles[profileName];
  assert.ok(profile, `missing EAS build profile: ${profileName}`);
  if (!profile.extends) {
    return profile;
  }

  const parent = resolveBuildProfile(profile.extends);
  return {
    ...parent,
    ...profile,
    env: {
      ...parent.env,
      ...profile.env,
    },
  };
}

function resolveAppConfig(profileName) {
  const previous = Object.fromEntries(scopedEnvironmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of scopedEnvironmentKeys) {
      delete process.env[key];
    }
    const profile = resolveBuildProfile(profileName);
    process.env.EAS_BUILD_PROFILE = profileName;
    Object.assign(process.env, profile.env ?? {});
    return createAppConfig();
  } finally {
    for (const key of scopedEnvironmentKeys) {
      const value = previous[key];
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
}

test("production Android profiles resolve the permanent Peritio identity and API", () => {
  for (const profileName of ["production", "production-apk"]) {
    const config = resolveAppConfig(profileName);
    assert.equal(config.name, "Peritio", profileName);
    assert.equal(config.android.package, "com.peritio.practice", profileName);
    assert.equal(config.ios.bundleIdentifier, "com.peritio.practice", profileName);
    assert.equal(config.extra.peritio.mobileEnvironment, "production", profileName);
    assert.equal(config.extra.peritio.apiBaseUrl, "https://peritio-api-prod.onrender.com", profileName);
  }
});

test("preview resolves the staging identity and API without changing production defaults", () => {
  const config = resolveAppConfig("preview");
  assert.equal(config.name, "Peritio Staging");
  assert.equal(config.android.package, "com.peritio.practice.staging");
  assert.equal(config.ios.bundleIdentifier, "com.peritio.practice.staging");
  assert.equal(config.extra.peritio.mobileEnvironment, "staging");
  assert.equal(config.extra.peritio.apiBaseUrl, "https://voicepractice-api-dev.onrender.com");
});

test("iOS store profiles retain their production and staging identities and APIs", () => {
  const production = resolveAppConfig("production-ios");
  assert.equal(production.name, "Peritio");
  assert.equal(production.ios.bundleIdentifier, "com.peritio.practice");
  assert.equal(production.extra.peritio.apiBaseUrl, "https://peritio-api-prod.onrender.com");

  const staging = resolveAppConfig("staging-ios");
  assert.equal(staging.name, "Peritio Staging");
  assert.equal(staging.ios.bundleIdentifier, "com.peritio.practice.staging");
  assert.equal(staging.extra.peritio.apiBaseUrl, "https://voicepractice-api-dev.onrender.com");
});

test("tracked mobile configuration contains no anonymous Android identity", () => {
  for (const relativePath of ["app.config.js", "app.json"]) {
    const source = readFileSync(resolve(mobileDirectory, relativePath), "utf8");
    assert.doesNotMatch(source, /com\.anonymous\.VoicePracticeApp/);
  }
});
