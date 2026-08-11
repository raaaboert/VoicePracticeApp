import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { ApiDatabase, createDefaultConfig, EnterpriseOrg, UserProfile } from "@voicepractice/shared";

const NOW = "2026-08-10T12:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_ai_budget_route_test_secret_123456";
const ENTERPRISE_TOKEN = "enterprise_budget_token";
const INDIVIDUAL_TOKEN = "individual_budget_token";

let tempDir: string;
let dbPath: string;
let aiUsagePath: string;
let baseUrl: string;
let server: Server;
let originalFetch: typeof globalThis.fetch;
let providerCalls = 0;
let successfulProviderCalls = 0;
let failNextProviderCall = false;
let delayProviderCalls = false;

function buildOrg(): EnterpriseOrg {
  return {
    id: "org_budget",
    name: "Budget Test Organization",
    status: "active",
    contactName: "Budget Owner",
    contactEmail: "owner@example.test",
    emailDomain: null,
    joinCode: "BUDGET20",
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

function buildUser(overrides: Partial<UserProfile> & Pick<UserProfile, "id" | "email">): UserProfile {
  const { id, email, ...remainingOverrides } = overrides;
  return {
    id,
    email,
    firstName: "Budget",
    lastName: "Tester",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "individual",
    tier: "free",
    status: "active",
    orgId: null,
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
    ...remainingOverrides,
  };
}

function hashToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser({
        id: "enterprise_budget_user",
        email: "enterprise-budget@example.test",
        accountType: "enterprise",
        tier: "enterprise",
        orgId: "org_budget",
      }),
      buildUser({
        id: "individual_budget_user",
        email: "individual-budget@example.test",
        isSuperUser: true,
      }),
    ],
    orgs: [buildOrg()],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      { userId: "enterprise_budget_user", tokenHash: hashToken(ENTERPRISE_TOKEN), createdAt: NOW, updatedAt: NOW },
      { userId: "individual_budget_user", tokenHash: hashToken(INDIVIDUAL_TOKEN), createdAt: NOW, updatedAt: NOW },
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: {},
    admin: { passwordHash: null, activeSessionIds: [] },
  };
}

async function requestTts(userId: string, token?: string) {
  const response = await originalFetch(`${baseUrl}/mobile/users/${userId}/ai/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId === "individual_budget_user" ? { "X-Superuser-Org-Id": "org_budget" } : {}),
    },
    body: JSON.stringify({ text: "Budget safety test response.", preset: "female-balanced" }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body: contentType.includes("application/json") ? await response.json() as Record<string, unknown> : null,
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-ai-budget-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  aiUsagePath = path.join(tempDir, "db.local.ai-usage-events.json");
  await writeFile(dbPath, JSON.stringify(buildDatabase(), null, 2), "utf8");

  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "ai-budget-route-admin-password";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_ai_budget_route";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_ai_budget_route";
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_secret_for_ai_budget_route";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.ENABLE_REMOTE_TTS = "true";
  process.env.OPENAI_MAX_DAILY_CALLS_PER_USER = "1";
  process.env.OPENAI_MAX_DAILY_CALLS_GLOBAL = "4";
  process.env.OPENAI_MAX_DAILY_TOKENS_PER_USER = "1000000";
  process.env.OPENAI_MAX_DAILY_TOKENS_GLOBAL = "1000000";
  delete process.env.DATABASE_URL;

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
    if (delayProviderCalls) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (failNextProviderCall) {
      failNextProviderCall = false;
      return new Response(JSON.stringify({ error: { message: "Mock provider failure." } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    successfulProviderCalls += 1;
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(tempDir, { recursive: true, force: true });
});

test("global AI safety accounting covers enterprise and TTS while preserving enterprise per-user exemption", async () => {
  const unauthorized = await requestTts("enterprise_budget_user");
  assert.equal(unauthorized.status, 401);
  assert.equal(providerCalls, 0);

  failNextProviderCall = true;
  const failed = await requestTts("enterprise_budget_user", ENTERPRISE_TOKEN);
  assert.equal(failed.status, 503);
  assert.equal(providerCalls, 1);
  assert.equal(successfulProviderCalls, 0);

  assert.equal((await requestTts("enterprise_budget_user", ENTERPRISE_TOKEN)).status, 200);
  assert.equal((await requestTts("enterprise_budget_user", ENTERPRISE_TOKEN)).status, 200);
  assert.equal(successfulProviderCalls, 2, "enterprise user was incorrectly subjected to the per-user cap");

  assert.equal((await requestTts("individual_budget_user", INDIVIDUAL_TOKEN)).status, 200);
  const individualLimited = await requestTts("individual_budget_user", INDIVIDUAL_TOKEN);
  assert.equal(individualLimited.status, 429);
  assert.equal(successfulProviderCalls, 3);

  delayProviderCalls = true;
  const concurrent = await Promise.all([
    requestTts("enterprise_budget_user", ENTERPRISE_TOKEN),
    requestTts("enterprise_budget_user", ENTERPRISE_TOKEN),
  ]);
  delayProviderCalls = false;
  assert.deepEqual(concurrent.map((entry) => entry.status).sort(), [200, 429]);
  assert.equal(successfulProviderCalls, 4);

  const globalLimited = await requestTts("enterprise_budget_user", ENTERPRISE_TOKEN);
  assert.equal(globalLimited.status, 429);
  assert.equal(successfulProviderCalls, 4, "provider was invoked after the global circuit breaker was exhausted");

  const stored = JSON.parse(await readFile(aiUsagePath, "utf8")) as { events: Array<{ kind: string }> };
  assert.equal(stored.events.length, 4, "failed provider reservation was not released cleanly");
  assert.equal(stored.events.every((entry) => entry.kind === "tts"), true);
});
