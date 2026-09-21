import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import {
  type ApiDatabase,
  createDefaultConfig,
  type EnterpriseOrg,
  type OrgCustomScenario,
  type UserProfile,
} from "@voicepractice/shared";

const NOW = "2026-09-21T12:00:00.000Z";
const MOBILE_TOKEN_SECRET = "phase_0_prompt_route_secret_123456";
const MOBILE_TOKEN = "phase_0_prompt_route_token";

export const STANDARD_ORG_ID = "org_prompt_base";
export const MODULAR_ORG_ID = "org_prompt_modular";
export const ROUTE_USER_ID = "prompt_route_reviewer";
export const STANDARD_SCENARIO_ID = "standard_renewal";
export const CUSTOM_SCENARIO_ID = "custom_recovery_route";
export const CUSTOM_TRAINING_ID = "training_custom_recovery";
export const CLIENT_BASELINE_SENTINEL = "CLIENT BASELINE MUST NOT REACH THE PROVIDER";
export const CUSTOM_SCORING_GUIDANCE =
  "Prioritize ownership, recovery dates, and explicit stakeholder alignment.";

export interface CapturedRoutePrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface CapturedPromptFamily {
  opening: CapturedRoutePrompt;
  turn: CapturedRoutePrompt;
  score: CapturedRoutePrompt;
}

interface ProviderRequestBody {
  model?: string;
  input?: Array<{ role?: string; content?: string }>;
}

export interface PromptRouteHarness {
  captureFamily(params: {
    orgId: string;
    scenarioId: string;
    industryId: string;
    difficulty: "easy" | "medium" | "hard";
    personaStyle: "defensive" | "frustrated" | "skeptical";
    trainingId?: string;
  }): Promise<CapturedPromptFamily>;
  close(): Promise<void>;
}

function hashToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function buildUser(): UserProfile {
  return {
    id: ROUTE_USER_ID,
    email: "prompt-route-reviewer@peritio.test",
    firstName: "Prompt",
    lastName: "Reviewer",
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
    isSuperUser: true,
    isPlatformAdmin: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildCustomScenario(): OrgCustomScenario {
  return {
    id: CUSTOM_SCENARIO_ID,
    orgId: STANDARD_ORG_ID,
    segmentId: "customer_success",
    title: "Recover a delayed rollout",
    summary: "Restore confidence after an implementation delay.",
    description:
      "A healthcare operations leader is frustrated by a delayed rollout and unclear ownership.",
    desiredOutcome: "Secure agreement on owners, recovery dates, and the next executive check-in.",
    aiRole: "a healthcare operations leader",
    scoringGuidance: CUSTOM_SCORING_GUIDANCE,
    applicableIndustryIds: ["healthcare"],
    enabled: true,
    provenance: {
      sourceMode: "scratch",
      creationMethod: "manual",
    },
    createdBy: ROUTE_USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildOrg(params: {
  id: string;
  enableModularPromptArchitecture: boolean;
  activeIndustries: string[];
  customScenarios?: OrgCustomScenario[];
}): EnterpriseOrg {
  return {
    id: params.id,
    name: `Prompt Route ${params.id}`,
    status: "active",
    contactName: "Prompt Owner",
    contactEmail: `${params.id}@peritio.test`,
    emailDomain: null,
    joinCode: params.id === STANDARD_ORG_ID ? "PROMPT01" : "PROMPT02",
    activeIndustries: params.activeIndustries,
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
    enableModularPromptArchitecture: params.enableModularPromptArchitecture,
    divisionsEnabled: false,
    customScenarios: params.customScenarios ?? [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDatabase(): ApiDatabase {
  const config = createDefaultConfig(NOW);
  config.activeSegmentId = "account_executive";
  config.defaultDifficulty = "medium";
  config.defaultPersonaStyle = "skeptical";
  config.industries = [
    {
      id: "technology",
      label: "Technology",
      enabled: true,
      aiBaseline:
        "Technology buyers expect concise business-value evidence, credible implementation detail, and a clear owner for next steps.",
      standardScoringGuidance:
        "Reward specific value evidence, direct objection handling, and a mutual renewal commitment.",
    },
    {
      id: "healthcare",
      label: "Healthcare",
      enabled: true,
      aiBaseline:
        "Healthcare client communication must be precise, accountable, and careful about operational and compliance impacts.",
      standardScoringGuidance:
        "Reward de-escalation, accountable recovery planning, and operationally credible commitments.",
    },
  ];
  config.roleIndustries = [
    { roleId: "account_executive", industryId: "technology", active: true },
    { roleId: "customer_success", industryId: "healthcare", active: true },
  ];
  config.segments = [
    {
      id: "account_executive",
      label: "Account Executive",
      summary: "Account renewal conversations.",
      enabled: true,
      scenarios: [
        {
          id: STANDARD_SCENARIO_ID,
          segmentId: "account_executive",
          title: "Resolve renewal concerns",
          summary: "Address a cautious customer's renewal concerns.",
          description: "A technology customer is questioning value before approving a renewal.",
          desiredOutcome: "Agree on a documented renewal decision and a dated next step.",
          aiRole: "a skeptical technology buyer",
          enabled: true,
        },
      ],
    },
    {
      id: "customer_success",
      label: "Customer Success Manager",
      summary: "Customer recovery conversations.",
      enabled: true,
      scenarios: [],
    },
  ];

  const customScenario = buildCustomScenario();
  return {
    config,
    users: [buildUser()],
    orgs: [
      buildOrg({
        id: STANDARD_ORG_ID,
        enableModularPromptArchitecture: false,
        activeIndustries: ["technology", "healthcare"],
        customScenarios: [customScenario],
      }),
      buildOrg({
        id: MODULAR_ORG_ID,
        enableModularPromptArchitecture: true,
        activeIndustries: ["technology"],
      }),
    ],
    orgDivisions: [],
    orgTrainings: [
      {
        id: CUSTOM_TRAINING_ID,
        orgId: STANDARD_ORG_ID,
        name: "Customer Recovery",
        status: "active",
        description: "Practice recovery after implementation delays.",
        divisionId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [
      {
        id: "attachment_custom_recovery",
        orgId: STANDARD_ORG_ID,
        trainingId: CUSTOM_TRAINING_ID,
        scenarioId: CUSTOM_SCENARIO_ID,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      {
        userId: ROUTE_USER_ID,
        tokenHash: hashToken(MOBILE_TOKEN),
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: {},
    admin: { passwordHash: null, activeSessionIds: [] },
  };
}

const dialogueHistory = [
  { role: "assistant", content: "What would help you move forward?" },
  { role: "user", content: "First, I would confirm the concern and ask what evidence is missing." },
  { role: "assistant", content: "I still need a concrete reason to trust the plan." },
  { role: "user", content: "Second, I would offer specific evidence and confirm who owns each action." },
  { role: "assistant", content: "How will you make sure this does not drift again?" },
  { role: "user", content: "Third, I would document the date, owner, and next review before we close." },
];

const deterministicScore = {
  communicationScore: 82,
  outcomeScore: 76,
  overallScore: 80,
  completionLevel: "complete",
  objectiveAchieved: true,
  persuasion: 8,
  clarity: 9,
  empathy: 7,
  assertiveness: 8,
  strengths: ["Clear framing"],
  improvements: ["Tighter close"],
  summary: "Handled the conversation well.",
};

function configureEnvironment(tempDbPath: string, modularEnvironmentEnabled: boolean): void {
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = tempDbPath;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "prompt-route-admin-password";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_prompt_routes";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_prompt_routes";
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_secret_for_prompt_routes";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_SIMULATION_MODEL = "route-simulation-model";
  process.env.OPENAI_SCORING_MODEL = "route-scoring-model";
  process.env.OPENAI_SIMULATION_API_FAMILY = "responses";
  process.env.OPENAI_SCORING_API_FAMILY = "responses";
  process.env.ENABLE_REMOTE_TTS = "false";
  process.env.USE_MODULAR_PROMPT_ARCHITECTURE = modularEnvironmentEnabled ? "true" : "false";
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_MAX_DAILY_CALLS_PER_USER;
  delete process.env.OPENAI_MAX_DAILY_CALLS_GLOBAL;
  delete process.env.OPENAI_MAX_DAILY_TOKENS_PER_USER;
  delete process.env.OPENAI_MAX_DAILY_TOKENS_GLOBAL;
}

export async function startPromptRouteHarness(params: {
  modularEnvironmentEnabled: boolean;
}): Promise<PromptRouteHarness> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "simulation-prompt-routes-"));
  const dbPath = path.join(tempDir, "db.local.json");
  await writeFile(dbPath, JSON.stringify(buildDatabase(), null, 2), "utf8");
  configureEnvironment(dbPath, params.modularEnvironmentEnabled);

  const imported = await import("./index.js");
  const server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  const providerRequests: ProviderRequestBody[] = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("https://api.openai.com/")) {
      return originalFetch(input, init);
    }

    const rawRequestBody = init?.body;
    assert.equal(typeof rawRequestBody, "string");
    if (typeof rawRequestBody !== "string") {
      throw new Error("Expected a JSON provider request body.");
    }
    const requestBody = JSON.parse(rawRequestBody) as ProviderRequestBody;
    providerRequests.push(requestBody);
    const outputText =
      requestBody.model === "route-scoring-model"
        ? JSON.stringify(deterministicScore)
        : "Deterministic route characterization reply.";
    return new Response(
      JSON.stringify({
        output_text: outputText,
        model: requestBody.model,
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  async function postAndCapture(
    route: "opening" | "turn" | "score",
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<CapturedRoutePrompt> {
    const requestCountBefore = providerRequests.length;
    const response = await originalFetch(`${baseUrl}/mobile/users/${ROUTE_USER_ID}/ai/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MOBILE_TOKEN}`,
        "Content-Type": "application/json",
        "X-Superuser-Org-Id": orgId,
      },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json() as Record<string, unknown>;
    assert.equal(
      response.status,
      route === "score" ? 201 : 200,
      `${route}: ${JSON.stringify(responseBody)}`,
    );
    assert.equal(providerRequests.length, requestCountBefore + 1, `${route} provider call count`);
    const providerRequest = providerRequests.at(-1);
    const systemMessage = providerRequest?.input?.[0];
    const userMessage = providerRequest?.input?.slice().reverse().find((message) => message.role === "user");
    assert.equal(systemMessage?.role, "system");
    assert.equal(userMessage?.role, "user");
    const systemPrompt = systemMessage?.content;
    const userPrompt = userMessage?.content;
    assert.equal(typeof systemPrompt, "string");
    assert.equal(typeof userPrompt, "string");
    if (typeof systemPrompt !== "string" || typeof userPrompt !== "string") {
      throw new Error(`Expected provider-bound prompts for ${route}.`);
    }
    return {
      systemPrompt,
      userPrompt,
    };
  }

  return {
    async captureFamily(familyParams): Promise<CapturedPromptFamily> {
      const commonBody = {
        scenarioId: familyParams.scenarioId,
        difficulty: familyParams.difficulty,
        personaStyle: familyParams.personaStyle,
        industryId: familyParams.industryId,
        industryBaseline: CLIENT_BASELINE_SENTINEL,
        ...(familyParams.trainingId ? { trainingId: familyParams.trainingId } : {}),
      };
      return {
        opening: await postAndCapture("opening", familyParams.orgId, commonBody),
        turn: await postAndCapture("turn", familyParams.orgId, {
          ...commonBody,
          history: dialogueHistory.slice(0, 2),
        }),
        score: await postAndCapture("score", familyParams.orgId, {
          ...commonBody,
          startedAt: "2026-09-21T11:55:00.000Z",
          endedAt: "2026-09-21T12:00:00.000Z",
          history: dialogueHistory,
        }),
      };
    },
    async close(): Promise<void> {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
