import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { ApiDatabase, createDefaultConfig, EnterpriseOrg, UserProfile } from "@voicepractice/shared";

const NOW = "2026-08-10T12:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_multipart_route_test_secret_123456";
const MOBILE_TOKEN = "mobile_multipart_route_token";
const USER_ID = "multipart_security_user";
const RATE_USER_A_ID = "multipart_rate_user_a";
const RATE_USER_A_TOKEN = "multipart_rate_token_a";
const RATE_USER_B_ID = "multipart_rate_user_b";
const RATE_USER_B_TOKEN = "multipart_rate_token_b";
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

let tempDir: string;
let baseUrl: string;
let server: Server;
let originalFetch: typeof globalThis.fetch;
let providerCalls = 0;

function buildOrg(): EnterpriseOrg {
  return {
    id: "org_multipart",
    name: "Multipart Test Organization",
    status: "active",
    contactName: "Multipart Owner",
    contactEmail: "owner@example.test",
    emailDomain: null,
    joinCode: "UPLOAD20",
    activeIndustries: ["people_management"],
    dailySecondsQuota: 36_000,
    perUserDailySecondsCap: 36_000,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 10_000,
    renewalTotalUsd: 1_000,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: false,
    customScenarios: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildUser(id = USER_ID, email = "multipart-user@example.test"): UserProfile {
  return {
    id,
    email,
    firstName: "Multipart",
    lastName: "Tester",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_multipart",
    orgRole: "user",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser(),
      buildUser(RATE_USER_A_ID, "multipart-rate-a@example.test"),
      buildUser(RATE_USER_B_ID, "multipart-rate-b@example.test"),
    ],
    orgs: [buildOrg()],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [{
      userId: USER_ID,
      tokenHash: crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(MOBILE_TOKEN).digest("hex"),
      createdAt: NOW,
      updatedAt: NOW,
    }, {
      userId: RATE_USER_A_ID,
      tokenHash: crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(RATE_USER_A_TOKEN).digest("hex"),
      createdAt: NOW,
      updatedAt: NOW,
    }, {
      userId: RATE_USER_B_ID,
      tokenHash: crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(RATE_USER_B_TOKEN).digest("hex"),
      createdAt: NOW,
      updatedAt: NOW,
    }],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: {},
    admin: { passwordHash: null, activeSessionIds: [] },
  };
}

function buildForm(fileBytes: number, options?: { fields?: number; oversizedNestedMetadata?: boolean }): FormData {
  const form = new FormData();
  if (options?.oversizedNestedMetadata) {
    form.append("payload", JSON.stringify({ metadata: { note: "x".repeat(1024 * 1024) } }));
  } else {
    for (let index = 0; index < (options?.fields ?? 0); index += 1) {
      form.append(`field${index}`, "value");
    }
  }
  form.append("file", new Blob([new Uint8Array(fileBytes)], { type: "audio/mp4" }), "voice.m4a");
  return form;
}

async function postForm(
  form: FormData,
  token?: string,
  route: "transcribe" | "submit-turn" = "transcribe",
  options?: { userId?: string; clientIp?: string },
) {
  const userId = options?.userId ?? USER_ID;
  const response = await originalFetch(`${baseUrl}/mobile/users/${encodeURIComponent(userId)}/ai/${route}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.clientIp ? { "X-Forwarded-For": options.clientIp } : {}),
    },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function postJson(
  userId: string,
  token: string,
  route: "opening" | "tts",
  body: Record<string, unknown>,
  clientIp?: string,
) {
  const response = await originalFetch(`${baseUrl}/mobile/users/${encodeURIComponent(userId)}/ai/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-multipart-security-"));
  const dbPath = path.join(tempDir, "db.local.json");
  await writeFile(dbPath, JSON.stringify(buildDatabase(), null, 2), "utf8");

  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "multipart-route-admin-password";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_multipart_route";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_multipart_route";
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_secret_for_multipart_route";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_MAX_DAILY_CALLS_PER_USER;
  delete process.env.OPENAI_MAX_DAILY_CALLS_GLOBAL;
  delete process.env.OPENAI_MAX_DAILY_TOKENS_PER_USER;
  delete process.env.OPENAI_MAX_DAILY_TOKENS_GLOBAL;

  const imported = await import("./index.js");
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("https://api.openai.com/")) {
      return originalFetch(input, init);
    }
    providerCalls += 1;
    return new Response(JSON.stringify({ text: "Secure multipart transcription." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(tempDir, { recursive: true, force: true });
});

test("multipart limits are unreachable until the requested user's mobile token is authenticated", async () => {
  const missing = await postForm(buildForm(1, { fields: 5 }));
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, "Missing mobile token.");

  const invalid = await postForm(buildForm(1, { fields: 5 }), "invalid-token");
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error, "Invalid mobile token.");
  assert.equal(providerCalls, 0);

  const authenticated = await postForm(buildForm(1, { fields: 5 }), MOBILE_TOKEN);
  assert.equal(authenticated.status, 400);
  assert.equal(authenticated.body.code, "LIMIT_FIELD_COUNT");

  const submitTurnMissing = await postForm(buildForm(1, { fields: 5 }), undefined, "submit-turn");
  assert.equal(submitTurnMissing.status, 401);
  assert.equal(submitTurnMissing.body.error, "Missing mobile token.");
  const submitTurnAuthenticated = await postForm(buildForm(1, { fields: 5 }), MOBILE_TOKEN, "submit-turn");
  assert.equal(submitTurnAuthenticated.status, 400);
  assert.equal(submitTurnAuthenticated.body.code, "LIMIT_FIELD_COUNT");
  assert.equal(providerCalls, 0);
});

test("authenticated transcription accepts the existing 12 MB maximum and rejects larger audio", async () => {
  const maximum = await postForm(buildForm(MAX_AUDIO_BYTES), MOBILE_TOKEN);
  assert.equal(maximum.status, 200, JSON.stringify(maximum.body));
  assert.equal(maximum.body.text, "Secure multipart transcription.");
  assert.equal(providerCalls, 1);

  const oversized = await postForm(buildForm(MAX_AUDIO_BYTES + 1), MOBILE_TOKEN);
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.code, "LIMIT_FILE_SIZE");
  assert.equal(providerCalls, 1);
});

test("multipart parser rejects excess parts and oversized nested metadata before provider use", async () => {
  const excessParts = await postForm(buildForm(1, { fields: 5 }), MOBILE_TOKEN);
  assert.equal(excessParts.status, 400);
  assert.equal(excessParts.body.code, "LIMIT_FIELD_COUNT");

  const oversizedMetadata = await postForm(buildForm(1, { oversizedNestedMetadata: true }), MOBILE_TOKEN);
  assert.equal(oversizedMetadata.status, 400);
  assert.equal(oversizedMetadata.body.code, "LIMIT_FIELD_VALUE");
  assert.equal(providerCalls, 1);
});

test("unauthenticated AI requests share one IP abuse bucket even when userId changes", async () => {
  const attackerIp = "198.51.100.40";
  for (let index = 0; index < 120; index += 1) {
    const denied = await postForm(
      buildForm(1, { fields: 5 }),
      undefined,
      "transcribe",
      { userId: `attacker-selected-${index}`, clientIp: attackerIp },
    );
    assert.equal(denied.status, 401, `request ${index + 1}: ${JSON.stringify(denied.body)}`);
    assert.equal(denied.body.error, "Missing mobile token.");
  }

  const limited = await postForm(
    buildForm(1, { fields: 5 }),
    undefined,
    "transcribe",
    { userId: "attacker-selected-new-bucket", clientIp: attackerIp },
  );
  assert.equal(limited.status, 429);
  assert.equal(providerCalls, 1);
});

test("authenticated users behind one IP have separate shared-across-route AI allowances", async () => {
  const sharedCorporateIp = "203.0.113.80";
  for (let index = 0; index < 120; index += 1) {
    const parsed = await postForm(
      buildForm(1, { fields: 5 }),
      RATE_USER_A_TOKEN,
      "transcribe",
      { userId: RATE_USER_A_ID, clientIp: sharedCorporateIp },
    );
    assert.equal(parsed.status, 400, `request ${index + 1}: ${JSON.stringify(parsed.body)}`);
    assert.equal(parsed.body.code, "LIMIT_FIELD_COUNT");
  }

  const userALimited = await postJson(
    RATE_USER_A_ID,
    RATE_USER_A_TOKEN,
    "opening",
    {},
    sharedCorporateIp,
  );
  assert.equal(userALimited.status, 429, "the authenticated allowance was not shared across AI route paths");

  const userBAllowed = await postForm(
    buildForm(1, { fields: 5 }),
    RATE_USER_B_TOKEN,
    "transcribe",
    { userId: RATE_USER_B_ID, clientIp: sharedCorporateIp },
  );
  assert.equal(userBAllowed.status, 400);
  assert.equal(userBAllowed.body.code, "LIMIT_FIELD_COUNT");

  const mismatchedIdentity = await postForm(
    buildForm(1, { fields: 5 }),
    RATE_USER_A_TOKEN,
    "transcribe",
    { userId: RATE_USER_B_ID, clientIp: sharedCorporateIp },
  );
  assert.equal(mismatchedIdentity.status, 401);
  assert.equal(mismatchedIdentity.body.error, "Invalid mobile token.");
  assert.equal(providerCalls, 1);
});

test("existing submit-turn multipart and normal JSON AI request formats reach their handlers", async () => {
  const submitTurnForm = new FormData();
  submitTurnForm.append("file", new Blob([new Uint8Array(1)], { type: "audio/mp4" }), "voice.m4a");
  submitTurnForm.append("payload", JSON.stringify({}));
  const submitTurn = await postForm(submitTurnForm, MOBILE_TOKEN, "submit-turn");
  assert.equal(submitTurn.status, 400);
  assert.equal(submitTurn.body.error, "scenarioId is required.");

  const opening = await postJson(RATE_USER_B_ID, RATE_USER_B_TOKEN, "opening", {});
  assert.equal(opening.status, 400);
  assert.equal(opening.body.error, "scenarioId is required.");
  assert.equal(providerCalls, 1);
});
