import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import type {
  EnterpriseOrg,
  MobileAuthRecord,
  UserProfile,
} from "@voicepractice/shared";

import {
  TrainingContentMobileServiceError,
  type MobileTrainingContentRequestContext,
  type TrainingContentMobileService,
} from "./services/trainingContentMobileService.js";

const NOW = "2026-07-28T16:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_training_content_routes";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let service: FakeMobileTrainingContentService;

function buildOrg(id: string, status: EnterpriseOrg["status"] = "active"): EnterpriseOrg {
  return {
    id,
    name: id,
    status,
    contactName: "Admin User",
    contactEmail: `admin@${id}.example`,
    emailDomain: `${id}.example`,
    joinCode: `${id}CODE`,
    activeIndustries: ["people_management"],
    dailySecondsQuota: 3600,
    perUserDailySecondsCap: 1800,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 1000,
    renewalTotalUsd: 100,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: false,
    customScenarios: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildUser(
  id: string,
  orgId: string | null,
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: "Test",
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: orgId ? "enterprise" : "individual",
    tier: orgId ? "enterprise" : "free",
    status: "active",
    orgId,
    orgRole: "user",
    divisionId: null,
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
    ...overrides,
  };
}

function hashMobileToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function mobileToken(userId: string, token: string): MobileAuthRecord {
  return {
    userId,
    tokenHash: hashMobileToken(token),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeMobileTrainingContentService implements TrainingContentMobileService {
  calls: Array<{
    method: string;
    context: MobileTrainingContentRequestContext;
    contentId?: string;
    scenarioId?: string;
    trainingId?: string | null;
  }> = [];
  failure: TrainingContentMobileServiceError | null = null;

  private record(
    method: string,
    context: MobileTrainingContentRequestContext,
    contentId?: string,
    scenarioId?: string,
    trainingId?: string | null
  ): void {
    this.calls.push({ method, context, contentId, scenarioId, trainingId });
    if (this.failure) {
      throw this.failure;
    }
  }

  async getModules(context: MobileTrainingContentRequestContext) {
    this.record("getModules", context);
    return { modules: { trainingContent: { enabled: true } } };
  }
  async getLibrary(context: MobileTrainingContentRequestContext) {
    this.record("getLibrary", context);
    return {
      categories: [{
        id: "category",
        name: "General",
        description: "",
        itemCount: 1,
        displayOrder: 0,
      }],
      items: [{
        id: "content",
        contentType: "native" as const,
        title: "Guide",
        description: "",
        category: { id: "category", name: "General" },
        relatedFocusTopic: null,
      }],
      truncated: false,
    };
  }
  async getCategories(context: MobileTrainingContentRequestContext) {
    this.record("getCategories", context);
    return { categories: [] };
  }
  async getRelatedForScenario(
    context: MobileTrainingContentRequestContext,
    scenarioId: string,
    trainingId?: string | null
  ) {
    this.record("getRelatedForScenario", context, undefined, scenarioId, trainingId);
    return {
      categories: [],
      items: [{
        id: "content",
        contentType: "native" as const,
        title: "Guide",
        description: "",
        category: { id: "category", name: "General" },
        relatedFocusTopic: null,
      }],
      truncated: false,
    };
  }
  async getRelatedScenariosForContent(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ) {
    this.record("getRelatedScenariosForContent", context, contentId);
    return {
      scenarios: [{
        id: "standard_visible",
        title: "Standard visible",
        source: "standard" as const,
        segmentId: "sales",
        industryId: "sales",
        trainingId: null,
      }],
    };
  }
  async getDetail(context: MobileTrainingContentRequestContext, contentId: string) {
    this.record("getDetail", context, contentId);
    return {
      item: {
        id: contentId,
        contentType: "native" as const,
        title: "Guide",
        description: "",
        category: { id: "category", name: "General" },
        relatedFocusTopic: null,
        nativeBody: "# Guide",
        externalUrl: null,
        asset: null,
        contentVersion: 1,
      },
    };
  }
  async createAssetAccess(
    context: MobileTrainingContentRequestContext,
    contentId: string
  ) {
    this.record("createAssetAccess", context, contentId);
    return {
      access: {
        url: "https://signed.example.test/resource",
        expiresAt: NOW,
        requiredHeaders: {},
      },
    };
  }
}

async function mobileRequest(
  pathname: string,
  token: string | null,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "training-content-mobile-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.ADMIN_TOKEN_SECRET = "admin_token_for_training_content_routes";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_token_for_training_content_routes";
  process.env.WEB_AUTH_CODE_SECRET = "web_code_for_training_content_routes";
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_secret_for_training_content_routes";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  delete process.env.DATABASE_URL;

  const imported = await import("./index.js");
  const database = imported.createDefaultDatabase();
  database.orgs = [buildOrg("org_a"), buildOrg("org_b")];
  database.users = [
    buildUser("learner", "org_a"),
    buildUser("other", "org_b"),
    buildUser("interim", "org_a", { firstName: null, lastName: null }),
    buildUser("reonboard", "org_a", { mobileProfileReonboardingRequired: true }),
  ];
  database.mobileAuthTokens = [
    mobileToken("learner", "token_learner"),
    mobileToken("other", "token_other"),
    mobileToken("interim", "token_interim"),
    mobileToken("reonboard", "token_reonboard"),
  ];
  await writeFile(dbPath, `${JSON.stringify(database, null, 2)}\n`, "utf8");

  service = new FakeMobileTrainingContentService();
  imported.setTrainingContentMobileServiceForTest(service);
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("mobile module and library routes derive current user and organization context", async () => {
  const modules = await mobileRequest(
    "/mobile/users/learner/modules",
    "token_learner",
    { headers: { "X-Superuser-Org-Id": "org_b" } }
  );
  assert.equal(modules.status, 200);
  assert.equal(modules.body.modules.trainingContent.enabled, true);

  const library = await mobileRequest(
    "/mobile/users/learner/training-content",
    "token_learner"
  );
  assert.equal(library.status, 200);
  const calls = service.calls.slice(-2);
  assert.deepEqual(calls.map((entry) => entry.method), ["getModules", "getLibrary"]);
  assert.equal(calls[0]?.context.user.id, "learner");
  assert.equal(calls[0]?.context.user.orgId, "org_a");
  assert.equal(calls[0]?.context.organizationActive, true);
  assert.equal(calls[0]?.context.users.some((user) => user.id === "other"), true);
});

test("mobile related-resource route forwards only authenticated scenario context", async () => {
  const result = await mobileRequest(
    "/mobile/users/learner/scenarios/custom_visible/training-content?trainingId=training_visible",
    "token_learner",
    { headers: { "X-Superuser-Org-Id": "org_b" } }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item: { id: string }) => item.id), ["content"]);

  const call = service.calls.at(-1);
  assert.equal(call?.method, "getRelatedForScenario");
  assert.equal(call?.context.user.id, "learner");
  assert.equal(call?.context.user.orgId, "org_a");
  assert.equal(call?.scenarioId, "custom_visible");
  assert.equal(call?.trainingId, "training_visible");
  assert.equal(Array.isArray(call?.context.scenarioConfig.segments), true);
});

test("mobile related-scenario route forwards only authenticated resource context", async () => {
  const result = await mobileRequest(
    "/mobile/users/learner/training-content/content_from_path/related-scenarios",
    "token_learner",
    { headers: { "X-Superuser-Org-Id": "org_b" } }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.scenarios.map((scenario: { id: string }) => scenario.id), [
    "standard_visible",
  ]);

  const call = service.calls.at(-1);
  assert.equal(call?.method, "getRelatedScenariosForContent");
  assert.equal(call?.context.user.id, "learner");
  assert.equal(call?.context.user.orgId, "org_a");
  assert.equal(call?.contentId, "content_from_path");
  assert.equal(Array.isArray(call?.context.scenarioConfig.industries), true);
  assert.equal(Array.isArray(call?.context.scenarioConfig.roleIndustries), true);
});

test("mobile routes reject missing, mismatched, interim, and re-onboarding tokens", async () => {
  const missing = await mobileRequest("/mobile/users/learner/modules", null);
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, "Missing mobile token.");

  const mismatch = await mobileRequest(
    "/mobile/users/learner/training-content",
    "token_other"
  );
  assert.equal(mismatch.status, 401);
  assert.equal(mismatch.body.error, "Invalid mobile token.");

  const interim = await mobileRequest(
    "/mobile/users/interim/training-content",
    "token_interim"
  );
  assert.equal(interim.status, 401);

  const reonboard = await mobileRequest(
    "/mobile/users/reonboard/training-content",
    "token_reonboard"
  );
  assert.equal(reonboard.status, 401);
});

test("detail and asset routes accept no client org, actor, asset, or object-key authority", async () => {
  const detail = await mobileRequest(
    "/mobile/users/learner/training-content/content_from_path",
    "token_learner",
    {
      headers: {
        "X-Superuser-Org-Id": "org_b",
        "X-Actor-Id": "other",
      },
    }
  );
  assert.equal(detail.status, 200);
  assert.equal(service.calls.at(-1)?.contentId, "content_from_path");
  assert.equal(service.calls.at(-1)?.context.user.orgId, "org_a");

  const access = await mobileRequest(
    "/mobile/users/learner/training-content/content_from_path/asset-access",
    "token_learner",
    {
      method: "POST",
      body: JSON.stringify({
        orgId: "org_b",
        actorId: "other",
        assetId: "asset_other",
        finalObjectKey: "orgs/org_b/private",
      }),
    }
  );
  assert.equal(access.status, 200);
  const call = service.calls.at(-1);
  assert.equal(call?.method, "createAssetAccess");
  assert.equal(call?.contentId, "content_from_path");
  assert.equal(call?.context.user.id, "learner");
  assert.equal(call?.context.user.orgId, "org_a");
});

test("mobile routes preserve structured module-disabled and generic unavailable errors", async () => {
  service.failure = new TrainingContentMobileServiceError(
    "Training Content is not enabled for this organization.",
    403,
    "module_disabled"
  );
  const disabled = await mobileRequest(
    "/mobile/users/learner/training-content",
    "token_learner"
  );
  assert.equal(disabled.status, 403);
  assert.deepEqual(disabled.body, {
    error: "Training Content is not enabled for this organization.",
    code: "module_disabled",
    moduleKey: "training_content",
  });

  service.failure = new TrainingContentMobileServiceError(
    "Training Content is not available.",
    404,
    "training_content_not_found"
  );
  const unavailable = await mobileRequest(
    "/mobile/users/learner/training-content/guessed_other_org_id",
    "token_learner"
  );
  assert.equal(unavailable.status, 404);
  assert.deepEqual(unavailable.body, {
    error: "Training Content is not available.",
    code: "training_content_not_found",
  });
  service.failure = null;
});

test("each request re-reads current app-state identity and organization status", async () => {
  const database = JSON.parse(await readFile(dbPath, "utf8")) as {
    users: UserProfile[];
    orgs: EnterpriseOrg[];
  };
  const learner = database.users.find((user) => user.id === "learner");
  const org = database.orgs.find((entry) => entry.id === "org_a");
  assert.ok(learner);
  assert.ok(org);
  database.users.push(buildUser("fresh_manager", "org_a", { orgRole: "user_admin" }));
  learner.managerUserId = "fresh_manager";
  org.status = "disabled";
  await writeFile(dbPath, `${JSON.stringify(database, null, 2)}\n`, "utf8");

  const result = await mobileRequest(
    "/mobile/users/learner/modules",
    "token_learner"
  );
  assert.equal(result.status, 200);
  const context = service.calls.at(-1)?.context;
  assert.equal(context?.user.managerUserId, "fresh_manager");
  assert.equal(context?.organizationActive, false);
});
