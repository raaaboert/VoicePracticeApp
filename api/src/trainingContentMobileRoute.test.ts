import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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
import type { MobileFocusTopicCatalogService } from "./services/mobileFocusTopicCatalog.js";

const NOW = "2026-07-28T16:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_training_content_routes";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let service: FakeMobileTrainingContentService;
let setMobileFocusTopicCatalogServiceForTest: (
  service: MobileFocusTopicCatalogService | null
) => void;

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
  setMobileFocusTopicCatalogServiceForTest = imported.setMobileFocusTopicCatalogServiceForTest;
  const database = imported.createDefaultDatabase();
  database.orgs = [buildOrg("org_a"), buildOrg("org_b")];
  database.users = [
    buildUser("learner", "org_a"),
    buildUser("other", "org_b"),
    buildUser("disabled", "org_a", { status: "disabled" }),
    buildUser("individual", null),
    buildUser("superuser", null, { isSuperUser: true, isPlatformAdmin: true }),
    buildUser("interim", "org_a", { firstName: null, lastName: null }),
    buildUser("reonboard", "org_a", { mobileProfileReonboardingRequired: true }),
  ];
  database.mobileAuthTokens = [
    mobileToken("learner", "token_learner"),
    mobileToken("other", "token_other"),
    mobileToken("disabled", "token_disabled"),
    mobileToken("individual", "token_individual"),
    mobileToken("superuser", "token_superuser"),
    mobileToken("interim", "token_interim"),
    mobileToken("reonboard", "token_reonboard"),
  ];
  const industry = database.config.industries.find((entry) => entry.enabled);
  const roleIndustry = database.config.roleIndustries.find(
    (entry) => entry.active
      && entry.industryId === industry?.id
      && database.config.segments.some((segment) => segment.id === entry.roleId && segment.enabled)
  );
  assert.ok(industry && roleIndustry);
  database.orgs[0]!.activeIndustries = [industry.id];
  database.orgs[0]!.customScenarios = [{
    id: "focus_custom",
    orgId: "org_a",
    segmentId: roleIndustry.roleId,
    title: "Focus custom",
    description: "Actionable custom scenario",
    aiRole: "Buyer",
    scoringGuidance: "",
    applicableIndustryIds: [industry.id],
    enabled: true,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  }];
  database.orgs[1]!.activeIndustries = [industry.id];
  database.orgs[1]!.customScenarios = [{
    id: "unattached_legacy_custom",
    orgId: "org_b",
    segmentId: roleIndustry.roleId,
    title: "Unattached legacy custom",
    description: "Must not manufacture a Focus Topic on read",
    aiRole: "Buyer",
    scoringGuidance: "",
    applicableIndustryIds: [industry.id],
    enabled: true,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  }];
  database.orgTrainings = [{
    id: "focus_topic",
    orgId: "org_a",
    name: "Focus Topic",
    status: "active",
    description: "Focus description",
    createdAt: NOW,
    updatedAt: NOW,
  }];
  database.orgTrainingScenarioAttachments = [{
    id: "focus_attachment",
    orgId: "org_a",
    trainingId: "focus_topic",
    scenarioId: "focus_custom",
    createdAt: NOW,
    updatedAt: NOW,
  }];
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

test("mobile Focus Topic catalog binds token, acting organization, and the existing scenario resolver", async () => {
  const sentinelTime = new Date("2001-01-01T00:00:00.000Z");
  await utimes(dbPath, sentinelTime, sentinelTime);
  const beforeRead = await stat(dbPath);
  const result = await mobileRequest(
    "/mobile/users/learner/focus-topics",
    "token_learner",
    { headers: { "X-Superuser-Org-Id": "org_b" } }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    topics: [{
      id: "focus_topic",
      name: "Focus Topic",
      description: "Focus description",
      createdAt: NOW,
      scenarioCount: 1,
      resourceCount: 0,
    }],
  });
  assert.deepEqual(Object.keys(result.body.topics[0]).sort(), [
    "createdAt",
    "description",
    "id",
    "name",
    "resourceCount",
    "scenarioCount",
  ]);
  const afterRead = await stat(dbPath);
  assert.equal(afterRead.mtimeMs, beforeRead.mtimeMs);

  const wrongToken = await mobileRequest(
    "/mobile/users/learner/focus-topics",
    "token_other"
  );
  assert.equal(wrongToken.status, 401);

  const disabled = await mobileRequest(
    "/mobile/users/disabled/focus-topics",
    "token_disabled"
  );
  assert.equal(disabled.status, 403);

  const individual = await mobileRequest(
    "/mobile/users/individual/focus-topics",
    "token_individual"
  );
  assert.equal(individual.status, 403);

  const superuserNeedsActingOrg = await mobileRequest(
    "/mobile/users/superuser/focus-topics",
    "token_superuser"
  );
  assert.equal(superuserNeedsActingOrg.status, 400);

  const otherOrg = await mobileRequest(
    "/mobile/users/superuser/focus-topics",
    "token_superuser",
    { headers: { "X-Superuser-Org-Id": "org_b" } }
  );
  assert.equal(otherOrg.status, 200);
  assert.deepEqual(otherOrg.body, { topics: [] });
  const persisted = JSON.parse(await readFile(dbPath, "utf8")) as {
    orgTrainings?: Array<{ orgId: string }>;
  };
  assert.equal(persisted.orgTrainings?.some((topic) => topic.orgId === "org_b"), false);
  assert.equal((await stat(dbPath)).mtimeMs, beforeRead.mtimeMs);
});

test("mobile Focus Topic detail independently authenticates and returns resolver-approved safe fields", async () => {
  const calls: Array<{ topicId: string; context: Parameters<MobileFocusTopicCatalogService["getDetail"]>[0] }> = [];
  setMobileFocusTopicCatalogServiceForTest({
    async getCatalog() {
      return { topics: [] };
    },
    async getDetail(context, topicId) {
      calls.push({ context, topicId });
      if (topicId !== "focus_topic") {
        return null;
      }
      const scenario = context.resolveScenario("focus_custom", "focus_topic");
      assert.ok(scenario);
      return {
        topic: { id: "focus_topic", name: "Focus Topic", description: "Focus description" },
        scenarios: [scenario],
        resources: [],
      };
    },
  });

  try {
    const valid = await mobileRequest(
      "/mobile/users/learner/focus-topics/focus_topic",
      "token_learner",
      { headers: { "X-Superuser-Org-Id": "org_b" } }
    );
    assert.equal(valid.status, 200);
    assert.equal(calls[0]?.context.actingOrgId, "org_a");
    assert.deepEqual(valid.body.scenarios[0], {
      id: "focus_custom",
      title: "Focus custom",
      description: "Actionable custom scenario",
      source: "custom",
      segmentId: valid.body.scenarios[0].segmentId,
      segmentLabel: valid.body.scenarios[0].segmentLabel,
      industryId: valid.body.scenarios[0].industryId,
      industryLabel: valid.body.scenarios[0].industryLabel,
      trainingId: "focus_topic",
    });

    assert.equal((await mobileRequest(
      "/mobile/users/learner/focus-topics/focus_topic",
      null
    )).status, 401);
    assert.equal((await mobileRequest(
      "/mobile/users/learner/focus-topics/focus_topic",
      "token_other"
    )).status, 401);
    assert.equal((await mobileRequest(
      "/mobile/users/disabled/focus-topics/focus_topic",
      "token_disabled"
    )).status, 403);
    assert.equal((await mobileRequest(
      "/mobile/users/individual/focus-topics/focus_topic",
      "token_individual"
    )).status, 403);
    assert.equal((await mobileRequest(
      "/mobile/users/superuser/focus-topics/focus_topic",
      "token_superuser"
    )).status, 400);

    const missing = await mobileRequest(
      "/mobile/users/learner/focus-topics/missing",
      "token_learner"
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "focus_topic_not_available");
  } finally {
    setMobileFocusTopicCatalogServiceForTest(null);
  }
});

test("Focus Topic SQL work does not hold the app-state lock", async () => {
  let markCatalogStarted!: () => void;
  const catalogStarted = new Promise<void>((resolve) => {
    markCatalogStarted = resolve;
  });
  let releaseCatalog!: () => void;
  const catalogRelease = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  setMobileFocusTopicCatalogServiceForTest({
    async getCatalog() {
      markCatalogStarted();
      await catalogRelease;
      return { topics: [] };
    },
    async getDetail() {
      return null;
    },
  });

  const focusRequest = mobileRequest(
    "/mobile/users/learner/focus-topics",
    "token_learner"
  );
  await catalogStarted;
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const writeOutcome = await Promise.race([
      mobileRequest(
        "/mobile/users/learner/settings",
        "token_learner",
        { method: "PATCH", body: JSON.stringify({ timezone: "America/Denver" }) }
      ).then((result) => ({ kind: "write" as const, result })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
      }),
    ]);
    assert.equal(writeOutcome.kind, "write");
    if (writeOutcome.kind === "write") {
      assert.equal(writeOutcome.result.status, 200);
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    releaseCatalog();
    const focusResult = await focusRequest;
    assert.equal(focusResult.status, 200);
    setMobileFocusTopicCatalogServiceForTest(null);
  }
});

test("Focus Topic detail SQL work does not hold the app-state lock", async () => {
  let markDetailStarted!: () => void;
  const detailStarted = new Promise<void>((resolve) => {
    markDetailStarted = resolve;
  });
  let releaseDetail!: () => void;
  const detailRelease = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  setMobileFocusTopicCatalogServiceForTest({
    async getCatalog() {
      return { topics: [] };
    },
    async getDetail() {
      markDetailStarted();
      await detailRelease;
      return null;
    },
  });

  const detailRequest = mobileRequest(
    "/mobile/users/learner/focus-topics/focus_topic",
    "token_learner"
  );
  await detailStarted;
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const writeOutcome = await Promise.race([
      mobileRequest(
        "/mobile/users/learner/settings",
        "token_learner",
        { method: "PATCH", body: JSON.stringify({ timezone: "UTC" }) }
      ).then((result) => ({ kind: "write" as const, result })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), 1_000);
      }),
    ]);
    assert.equal(writeOutcome.kind, "write");
    if (writeOutcome.kind === "write") {
      assert.equal(writeOutcome.result.status, 200);
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    releaseDetail();
    const detailResult = await detailRequest;
    assert.equal(detailResult.status, 404);
    assert.equal(detailResult.body.code, "focus_topic_not_available");
    setMobileFocusTopicCatalogServiceForTest(null);
  }
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
