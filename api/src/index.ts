import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import multer from "multer";
import {
  ACCOUNT_TYPES,
  ApiDatabase,
  AiUsageEvent,
  AppConfig,
  ChangeAdminPasswordRequest,
  COMMON_TIMEZONES,
  CreateUserRequest,
  DEFAULT_SEGMENTS,
  DEFAULT_TIER_DEFINITIONS,
  Difficulty,
  EnterpriseOrg,
  INDUSTRY_IDS,
  IndustryId,
  OrgUserRole,
  PersonaStyle,
  MobileOnboardRequest,
  MobileOnboardResponse,
  MobileUpdateSettingsRequest,
  RecordUsageSessionRequest,
  RecordSimulationScoreRequest,
  Scenario,
  SegmentDefinition,
  SupportCaseRecord,
  SimulationScoreRecord,
  TIER_IDS,
  TierDefinition,
  UpdateConfigRequest,
  UpdateUserRequest,
  UserEntitlementsResponse,
  UserProfile,
  UserStatus,
  USAGE_BILLING_INCREMENT_SECONDS,
  UsageSessionRecord,
  calculateBilledSecondsFromRaw,
  createDefaultConfig,
  getDayKey,
  getMonthKey,
  getRoleSegmentIdsForIndustries,
  getTierById,
  humanDailyResetLabel,
  isAccountType,
  isIndustryId,
  isOrgUserRole,
  isTierId,
  isUserStatus,
  secondsToWholeMinutes,
  sumRawSeconds,
  computeAnnualPeriodBounds,
  computeNextRenewalAt
} from "@voicepractice/shared";
import {
  AI_PROMPT_VERSION,
  AI_RUBRIC_VERSION,
  buildEvaluationSystemPrompt,
  buildOpeningPrompt,
  buildRoleplaySystemPrompt,
  formatDialogueForEvaluation
} from "./aiPrompts.js";
import { requestChatCompletion, requestTranscription } from "./openaiClient.js";
import { decryptSupportTranscript, encryptSupportTranscript } from "./supportCrypto.js";

const PORT = Number(process.env.PORT ?? 4100);
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH ?? "./db.local.json");
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "admin";
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET ?? "replace_me_for_production";
const ADMIN_TOKEN_TTL_MINUTES = Number(process.env.ADMIN_TOKEN_TTL_MINUTES ?? 720);
const MOBILE_TOKEN_SECRET = process.env.MOBILE_TOKEN_SECRET ?? ADMIN_TOKEN_SECRET;
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";
const SUPPORT_TRANSCRIPT_TTL_DAYS = 10;

interface AdminTokenPayload {
  role: "admin";
  exp: number;
}

interface AdminAuthRequest extends Request {
  admin?: AdminTokenPayload;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseIsoDateOrNull(value: string | undefined | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeIndustryIds(value: unknown): IndustryId[] {
  if (!Array.isArray(value)) {
    return [...INDUSTRY_IDS];
  }

  const unique = Array.from(
    new Set(
      value.filter((entry): entry is IndustryId => typeof entry === "string" && isIndustryId(entry))
    )
  );

  return unique.length > 0 ? unique : [...INDUSTRY_IDS];
}

function normalizeContactName(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown";
}

function normalizeContactEmail(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "unknown@example.com";
}

function normalizeOrgUserRole(value: unknown): OrgUserRole {
  if (typeof value === "string" && isOrgUserRole(value)) {
    return value;
  }

  return "user";
}

const DEMO_ENTERPRISE_ORGS: Array<{
  id: string;
  name: string;
  activeIndustries: IndustryId[];
  contactName: string;
  contactEmail: string;
  establishedAt: string;
}> = [
  {
    id: "org_demo_people",
    name: "Northstar People Ops",
    activeIndustries: ["people_management"],
    contactName: "Jessica Lane",
    contactEmail: "jessica.lane@northstarpeople.example",
    establishedAt: "2024-04-18T00:00:00.000Z"
  },
  {
    id: "org_demo_sales",
    name: "Summit Revenue Systems",
    activeIndustries: ["sales"],
    contactName: "Marcus Reed",
    contactEmail: "marcus.reed@summitrevenue.example",
    establishedAt: "2023-10-02T00:00:00.000Z"
  },
  {
    id: "org_demo_medical",
    name: "Acme Health Group",
    activeIndustries: ["medical"],
    contactName: "Dr. Priya Shah",
    contactEmail: "priya.shah@acmehealth.example",
    establishedAt: "2025-01-27T00:00:00.000Z"
  }
];

const DEMO_ENTERPRISE_USERS: Array<{
  id: string;
  email: string;
  orgId: string;
  orgRole: OrgUserRole;
}> = [
  {
    id: "usr_demo_people_admin",
    email: "admin@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_people_mgr",
    email: "manager@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_people_hr",
    email: "hr@northstarpeople.example",
    orgId: "org_demo_people",
    orgRole: "user"
  },
  {
    id: "usr_demo_sales_admin",
    email: "admin@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_sales_rep",
    email: "rep@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_sales_se",
    email: "se@summitrevenue.example",
    orgId: "org_demo_sales",
    orgRole: "user"
  },
  {
    id: "usr_demo_medical_admin",
    email: "admin@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "org_admin"
  },
  {
    id: "usr_demo_medical_nurse",
    email: "nurse@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "user_admin"
  },
  {
    id: "usr_demo_medical_doc",
    email: "doctor@acmehealth.example",
    orgId: "org_demo_medical",
    orgRole: "user"
  }
];

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) {
    return "UTC";
  }

  if (isValidTimeZone(timeZone)) {
    return timeZone;
  }

  return "UTC";
}

type DialogueRole = "user" | "assistant";

interface DialogueTurn {
  role: DialogueRole;
  content: string;
}

function normalizeDialogueHistory(value: unknown): DialogueTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const safe: DialogueTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      continue;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      continue;
    }

    safe.push({ role, content: trimmed.slice(0, 2_500) });
    if (safe.length >= 40) {
      break;
    }
  }

  // Keep the most recent turns when the client sends a lot.
  return safe.length > 24 ? safe.slice(safe.length - 24) : safe;
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isPersonaStyle(value: unknown): value is PersonaStyle {
  return value === "defensive" || value === "frustrated" || value === "skeptical";
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Evaluator returned invalid JSON.");
  }

  return text.slice(start, end + 1);
}

interface SimulationScorecard {
  overallScore: number;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function normalizeScorecard(raw: unknown): SimulationScorecard {
  const candidate = (raw ?? {}) as Partial<SimulationScorecard>;

  const safeList = (value: unknown, fallback: string): string[] => {
    if (!Array.isArray(value)) {
      return [fallback];
    }

    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 4);

    return items.length > 0 ? items : [fallback];
  };

  const summary =
    typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : "Good effort. Keep improving clarity, evidence, and objection handling.";

  return {
    overallScore: clamp(Number(candidate.overallScore), 0, 100),
    persuasion: clamp(Number(candidate.persuasion), 1, 10),
    clarity: clamp(Number(candidate.clarity), 1, 10),
    empathy: clamp(Number(candidate.empathy), 1, 10),
    assertiveness: clamp(Number(candidate.assertiveness), 1, 10),
    strengths: safeList(candidate.strengths, "Stayed engaged throughout the conversation."),
    improvements: safeList(candidate.improvements, "Use clearer structure and stronger evidence."),
    summary
  };
}

function createDefaultDatabase(): ApiDatabase {
  const now = nowIso();
  return {
    config: createDefaultConfig(now),
    users: [],
    orgs: [
      {
        id: "org_starter",
        name: "Starter Enterprise Org",
        status: "active",
        contactName: "Starter Admin",
        contactEmail: "starter@example.com",
        activeIndustries: [...INDUSTRY_IDS],
        dailySecondsQuota: 8 * 60 * 60,
        perUserDailySecondsCap: 60 * 60,
        manualBonusSeconds: 0,
        createdAt: now,
        updatedAt: now
      }
    ],
    usageSessions: [],
    scoreRecords: [],
    aiUsageEvents: [],
    supportCases: [],
    mobileAuthTokens: [],
    admin: {
      passwordHash: null
    }
  };
}

function purgeExpiredSupportTranscripts(db: { supportCases?: SupportCaseRecord[] }, nowIso: string): void {
  const cases = db.supportCases;
  if (!cases || cases.length === 0) {
    return;
  }

  const nowMs = new Date(nowIso).getTime();
  for (const entry of cases) {
    if (!entry.transcriptExpiresAt || !entry.transcriptEncrypted) {
      continue;
    }

    const expiresMs = new Date(entry.transcriptExpiresAt).getTime();
    if (Number.isNaN(expiresMs) || expiresMs > nowMs) {
      continue;
    }

    entry.transcriptEncrypted = null;
    entry.transcriptFileName = null;
    entry.transcriptExpiresAt = null;
  }
}

function ensureDemoEnterpriseData(db: {
  users: UserProfile[];
  orgs: EnterpriseOrg[];
  config: AppConfig;
  usageSessions: UsageSessionRecord[];
  scoreRecords: SimulationScoreRecord[];
}, now: string): void {
  for (const demoOrg of DEMO_ENTERPRISE_ORGS) {
    const existing = db.orgs.find((org) => org.id === demoOrg.id);
    if (existing) {
      existing.contactName = demoOrg.contactName;
      existing.contactEmail = demoOrg.contactEmail;
      existing.activeIndustries = normalizeIndustryIds(existing.activeIndustries);
      // Demo orgs use a stable established date so "renewal" and reporting are deterministic.
      existing.createdAt = demoOrg.establishedAt;
      existing.updatedAt = existing.updatedAt || existing.createdAt || demoOrg.establishedAt;
      continue;
    }

    db.orgs.push({
      id: demoOrg.id,
      name: demoOrg.name,
      status: "active",
      contactName: demoOrg.contactName,
      contactEmail: demoOrg.contactEmail,
      activeIndustries: demoOrg.activeIndustries,
      dailySecondsQuota: db.config.enterprise.defaultOrgDailySecondsQuota,
      perUserDailySecondsCap: db.config.enterprise.defaultPerUserDailySecondsCap,
      manualBonusSeconds: 0,
      createdAt: demoOrg.establishedAt,
      updatedAt: demoOrg.establishedAt
    });
  }

  for (const demoUser of DEMO_ENTERPRISE_USERS) {
    const duplicateById = db.users.find((user) => user.id === demoUser.id);
    const duplicateByEmail = db.users.find(
      (user) => user.email.toLowerCase() === demoUser.email.toLowerCase()
    );
    const existingUser = duplicateById ?? duplicateByEmail;
    if (existingUser) {
      existingUser.accountType = "enterprise";
      existingUser.tier = "enterprise";
      existingUser.orgId = demoUser.orgId;
      existingUser.orgRole = demoUser.orgRole;
      existingUser.status = existingUser.status ?? "active";
      existingUser.timezone = existingUser.timezone ?? "America/New_York";
      existingUser.updatedAt = existingUser.updatedAt || now;
      continue;
    }

    db.users.push({
      id: demoUser.id,
      email: demoUser.email,
      accountType: "enterprise",
      tier: "enterprise",
      status: "active",
      orgId: demoUser.orgId,
      orgRole: demoUser.orgRole,
      timezone: "America/New_York",
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  const nowDate = new Date(now);
  const demoSessions: Array<{
    id: string;
    userId: string;
    orgId: string;
    segmentId: string;
    scenarioId: string;
    rawDurationSeconds: number;
    daysAgo: number;
  }> = [
    {
      id: "sess_demo_people_admin_1",
      userId: "usr_demo_people_admin",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_undermining_report",
      rawDurationSeconds: 18 * 60,
      daysAgo: 16
    },
    {
      id: "sess_demo_people_mgr_1",
      userId: "usr_demo_people_mgr",
      orgId: "org_demo_people",
      segmentId: "project_manager",
      scenarioId: "pm_team_conflict",
      rawDurationSeconds: 12 * 60,
      daysAgo: 12
    },
    {
      id: "sess_demo_people_hr_1",
      userId: "usr_demo_people_hr",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_scope_creep_client",
      rawDurationSeconds: 9 * 60,
      daysAgo: 8
    },
    {
      id: "sess_demo_sales_admin_1",
      userId: "usr_demo_sales_admin",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_unfixable_issue",
      rawDurationSeconds: 22 * 60,
      daysAgo: 14
    },
    {
      id: "sess_demo_sales_rep_1",
      userId: "usr_demo_sales_rep",
      orgId: "org_demo_sales",
      segmentId: "sales_representative",
      scenarioId: "sales_discount_pushback",
      rawDurationSeconds: 15 * 60,
      daysAgo: 10
    },
    {
      id: "sess_demo_sales_se_1",
      userId: "usr_demo_sales_se",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_repeating_questions",
      rawDurationSeconds: 11 * 60,
      daysAgo: 6
    },
    {
      id: "sess_demo_medical_admin_1",
      userId: "usr_demo_medical_admin",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_erratic_family_member",
      rawDurationSeconds: 20 * 60,
      daysAgo: 15
    },
    {
      id: "sess_demo_medical_nurse_1",
      userId: "usr_demo_medical_nurse",
      orgId: "org_demo_medical",
      segmentId: "nurse",
      scenarioId: "nurse_vaccine_conspiracy",
      rawDurationSeconds: 13 * 60,
      daysAgo: 9
    },
    {
      id: "sess_demo_medical_doc_1",
      userId: "usr_demo_medical_doc",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_unsuccessful_surgery",
      rawDurationSeconds: 16 * 60,
      daysAgo: 5
    }
  ];

  for (const session of demoSessions) {
    if (db.usageSessions.some((existing) => existing.id === session.id)) {
      continue;
    }

    const startedAt = new Date(nowDate.getTime() - session.daysAgo * 24 * 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + session.rawDurationSeconds * 1000);

    db.usageSessions.push({
      id: session.id,
      userId: session.userId,
      orgId: session.orgId,
      segmentId: session.segmentId,
      scenarioId: session.scenarioId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      rawDurationSeconds: session.rawDurationSeconds,
      createdAt: endedAt.toISOString()
    });
  }

  const demoScores: Array<{
    id: string;
    userId: string;
    orgId: string;
    segmentId: string;
    scenarioId: string;
    overallScore: number;
    persuasion: number;
    clarity: number;
    empathy: number;
    assertiveness: number;
    daysAgo: number;
  }> = [
    {
      id: "score_demo_people_admin_1",
      userId: "usr_demo_people_admin",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_undermining_report",
      overallScore: 82,
      persuasion: 8,
      clarity: 7,
      empathy: 8,
      assertiveness: 7,
      daysAgo: 16
    },
    {
      id: "score_demo_people_mgr_1",
      userId: "usr_demo_people_mgr",
      orgId: "org_demo_people",
      segmentId: "project_manager",
      scenarioId: "pm_team_conflict",
      overallScore: 74,
      persuasion: 7,
      clarity: 7,
      empathy: 6,
      assertiveness: 7,
      daysAgo: 12
    },
    {
      id: "score_demo_people_hr_1",
      userId: "usr_demo_people_hr",
      orgId: "org_demo_people",
      segmentId: "solution_manager",
      scenarioId: "sm_scope_creep_client",
      overallScore: 68,
      persuasion: 6,
      clarity: 6,
      empathy: 7,
      assertiveness: 6,
      daysAgo: 8
    },
    {
      id: "score_demo_sales_admin_1",
      userId: "usr_demo_sales_admin",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_unfixable_issue",
      overallScore: 86,
      persuasion: 8,
      clarity: 9,
      empathy: 7,
      assertiveness: 8,
      daysAgo: 14
    },
    {
      id: "score_demo_sales_rep_1",
      userId: "usr_demo_sales_rep",
      orgId: "org_demo_sales",
      segmentId: "sales_representative",
      scenarioId: "sales_discount_pushback",
      overallScore: 78,
      persuasion: 8,
      clarity: 7,
      empathy: 7,
      assertiveness: 7,
      daysAgo: 10
    },
    {
      id: "score_demo_sales_se_1",
      userId: "usr_demo_sales_se",
      orgId: "org_demo_sales",
      segmentId: "sales_engineer",
      scenarioId: "se_repeating_questions",
      overallScore: 81,
      persuasion: 7,
      clarity: 8,
      empathy: 7,
      assertiveness: 8,
      daysAgo: 6
    },
    {
      id: "score_demo_medical_admin_1",
      userId: "usr_demo_medical_admin",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_erratic_family_member",
      overallScore: 90,
      persuasion: 8,
      clarity: 9,
      empathy: 9,
      assertiveness: 8,
      daysAgo: 15
    },
    {
      id: "score_demo_medical_nurse_1",
      userId: "usr_demo_medical_nurse",
      orgId: "org_demo_medical",
      segmentId: "nurse",
      scenarioId: "nurse_vaccine_conspiracy",
      overallScore: 76,
      persuasion: 7,
      clarity: 7,
      empathy: 8,
      assertiveness: 6,
      daysAgo: 9
    },
    {
      id: "score_demo_medical_doc_1",
      userId: "usr_demo_medical_doc",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_unsuccessful_surgery",
      overallScore: 84,
      persuasion: 7,
      clarity: 8,
      empathy: 8,
      assertiveness: 7,
      daysAgo: 5
    }
  ];

  for (const score of demoScores) {
    if (db.scoreRecords.some((existing) => existing.id === score.id)) {
      continue;
    }

    const startedAt = new Date(nowDate.getTime() - score.daysAgo * 24 * 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + 6 * 60 * 1000);

    db.scoreRecords.push({
      id: score.id,
      userId: score.userId,
      orgId: score.orgId,
      segmentId: score.segmentId,
      scenarioId: score.scenarioId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      overallScore: score.overallScore,
      persuasion: score.persuasion,
      clarity: score.clarity,
      empathy: score.empathy,
      assertiveness: score.assertiveness,
      createdAt: endedAt.toISOString()
    });
  }
}

function ensureDemoSupportCases(db: { supportCases: SupportCaseRecord[] }, nowIso: string): void {
  if (!Array.isArray(db.supportCases)) {
    return;
  }

  if (db.supportCases.some((entry) => entry && typeof entry.id === "string" && entry.id.startsWith("case_demo_"))) {
    return;
  }

  const createdAt = nowIso;
  const nowMs = new Date(nowIso).getTime();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  const transcriptExpiresAt = new Date(nowMs + tenDaysMs).toISOString();

  const demoTranscript1 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Discount Pushback",
    "Segment: Sales Representative",
    "Difficulty: Medium",
    "Persona: Skeptical",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I hear you. Let me explain what the discount includes and why it is priced that way.",
    "AI: I do not understand why you cannot just match the competitor. It feels like you are stalling.",
    "User: If we matched that number, we would have to remove onboarding and support. Would that still work for you?",
    "AI: Maybe. But I need something concrete, not hypotheticals."
  ].join("\n");

  const demoTranscript2 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Conflict Between Team Members",
    "Segment: Project Manager",
    "Difficulty: Hard",
    "Persona: Frustrated",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I want to understand both perspectives. What happened from your point of view?",
    "AI: This is a waste of time. They never listen and you always take their side.",
    "User: I am not taking sides. I am going to set ground rules and we will agree on next steps today.",
    "AI: Fine. But if nothing changes, I am done."
  ].join("\n");

  const demoTranscript3 = [
    "Voice Practice Session Transcript",
    "",
    "Scenario: Family Member Is Erratic And Afraid About Low Risk Procedure",
    "Segment: Doctor",
    "Difficulty: Easy",
    "Persona: Defensive",
    "AI Model: gpt-4o-mini",
    "Prompt Version: demo",
    "Rubric Version: demo",
    "",
    "User: I can see how scary this feels. Let me walk you through what will happen step by step.",
    "AI: You are not listening. People die from this. Why are you minimizing it?",
    "User: I am not minimizing it. I am taking it seriously and I will answer every question you have.",
    "AI: Okay... I just need to understand the risks."
  ].join("\n");

  db.supportCases.push(
    {
      id: "case_demo_1",
      status: "open",
      userId: "usr_demo_sales_rep",
      orgId: "org_demo_sales",
      segmentId: "sales_representative",
      scenarioId: "sales_discount_pushback",
      message: "Score felt too harsh. The assistant kept changing the requirements mid-call.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript1),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-1.txt",
      transcriptMeta: {
        scenarioTitle: "Discount Pushback",
        segmentLabel: "Sales Representative",
        difficulty: "medium",
        personaStyle: "skeptical",
        startedAt: new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 3 * 24 * 60 * 60 * 1000 + 9 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "case_demo_2",
      status: "open",
      userId: "usr_demo_people_mgr",
      orgId: "org_demo_people",
      segmentId: "project_manager",
      scenarioId: "pm_team_conflict",
      message: "Audio cut out mid-turn and the response didn't match what I said.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript2),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-2.txt",
      transcriptMeta: {
        scenarioTitle: "Conflict Between Team Members",
        segmentLabel: "Project Manager",
        difficulty: "hard",
        personaStyle: "frustrated",
        startedAt: new Date(nowMs - 5 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 5 * 24 * 60 * 60 * 1000 + 7 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "case_demo_3",
      status: "closed",
      userId: "usr_demo_medical_doc",
      orgId: "org_demo_medical",
      segmentId: "doctor",
      scenarioId: "doctor_erratic_family_member",
      message: "The assistant was fine, but the score summary mentioned details I didn't say. Please review.",
      transcriptEncrypted: encryptSupportTranscript(demoTranscript3),
      transcriptExpiresAt,
      transcriptFileName: "transcript-case-demo-3.txt",
      transcriptMeta: {
        scenarioTitle: "Family Member Is Erratic And Afraid About Low Risk Procedure",
        segmentLabel: "Doctor",
        difficulty: "easy",
        personaStyle: "defensive",
        startedAt: new Date(nowMs - 9 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(nowMs - 9 * 24 * 60 * 60 * 1000 + 6 * 60 * 1000).toISOString(),
        model: "gpt-4o-mini",
        promptVersion: "demo",
        rubricVersion: "demo"
      },
      createdAt,
      updatedAt: createdAt
    }
  );
}

function mergeScenariosWithDefaults(
  existing: Scenario[],
  defaults: Scenario[],
  segmentId: string
): Scenario[] {
  const existingById = new Map(existing.map((scenario) => [scenario.id, scenario]));
  const defaultScenarioIds = new Set(defaults.map((scenario) => scenario.id));

  const mergedDefaults = defaults.map((defaultScenario) => {
    const current = existingById.get(defaultScenario.id);
    if (!current) {
      return defaultScenario;
    }

    return {
      ...defaultScenario,
      ...current,
      id: defaultScenario.id,
      segmentId
    };
  });

  const customScenarios = existing
    .filter((scenario) => !defaultScenarioIds.has(scenario.id))
    .map((scenario) => ({ ...scenario, segmentId }));

  return [...mergedDefaults, ...customScenarios];
}

function mergeSegmentsWithDefaults(
  existing: SegmentDefinition[],
  defaults: SegmentDefinition[]
): SegmentDefinition[] {
  const existingById = new Map(existing.map((segment) => [segment.id, segment]));
  const defaultSegmentIds = new Set(defaults.map((segment) => segment.id));

  const mergedDefaults = defaults.map((defaultSegment) => {
    const current = existingById.get(defaultSegment.id);
    if (!current) {
      return defaultSegment;
    }

    return {
      ...defaultSegment,
      ...current,
      id: defaultSegment.id,
      scenarios: mergeScenariosWithDefaults(current.scenarios ?? [], defaultSegment.scenarios, defaultSegment.id)
    };
  });

  const customSegments = existing
    .filter((segment) => !defaultSegmentIds.has(segment.id))
    .map((segment) => ({
      ...segment,
      scenarios: (segment.scenarios ?? []).map((scenario) => ({
        ...scenario,
        segmentId: segment.id
      }))
    }));

  return [...mergedDefaults, ...customSegments];
}

function ensureDatabaseShape(raw: unknown): ApiDatabase {
  const fallback = createDefaultDatabase();
  const candidate = (raw ?? {}) as Partial<ApiDatabase>;
  const now = nowIso();

  const configCandidate = candidate.config;
  const mergedSegments = mergeSegmentsWithDefaults(
    Array.isArray(configCandidate?.segments) && configCandidate.segments.length > 0
      ? configCandidate.segments
      : DEFAULT_SEGMENTS,
    DEFAULT_SEGMENTS
  );

  const candidateActiveSegmentId =
    configCandidate?.activeSegmentId && typeof configCandidate.activeSegmentId === "string"
      ? configCandidate.activeSegmentId
      : fallback.config.activeSegmentId;
  const resolvedActiveSegmentId =
    mergedSegments.some((segment) => segment.id === candidateActiveSegmentId && segment.enabled) &&
    candidateActiveSegmentId
      ? candidateActiveSegmentId
      : mergedSegments.find((segment) => segment.enabled)?.id ?? fallback.config.activeSegmentId;

  const config: AppConfig = {
    activeSegmentId: resolvedActiveSegmentId,
    defaultDifficulty: configCandidate?.defaultDifficulty ?? fallback.config.defaultDifficulty,
    defaultPersonaStyle: configCandidate?.defaultPersonaStyle ?? fallback.config.defaultPersonaStyle,
    segments: mergedSegments,
    tiers:
      Array.isArray(configCandidate?.tiers) && configCandidate?.tiers.length > 0
        ? configCandidate.tiers
        : DEFAULT_TIER_DEFINITIONS,
    enterprise: {
      visibleInApp: configCandidate?.enterprise?.visibleInApp ?? fallback.config.enterprise.visibleInApp,
      contactEmail: configCandidate?.enterprise?.contactEmail ?? fallback.config.enterprise.contactEmail,
      contactUrl: configCandidate?.enterprise?.contactUrl ?? fallback.config.enterprise.contactUrl,
      defaultOrgDailySecondsQuota:
        configCandidate?.enterprise?.defaultOrgDailySecondsQuota ??
        fallback.config.enterprise.defaultOrgDailySecondsQuota,
      defaultPerUserDailySecondsCap:
        configCandidate?.enterprise?.defaultPerUserDailySecondsCap ??
        fallback.config.enterprise.defaultPerUserDailySecondsCap,
      allowManualBonusSeconds:
        configCandidate?.enterprise?.allowManualBonusSeconds ??
        fallback.config.enterprise.allowManualBonusSeconds
    },
    featureFlags: {
      scoringEnabled:
        configCandidate?.featureFlags?.scoringEnabled ?? fallback.config.featureFlags.scoringEnabled,
      customScenarioBuilder:
        configCandidate?.featureFlags?.customScenarioBuilder ??
        fallback.config.featureFlags.customScenarioBuilder
    },
    updatedAt: configCandidate?.updatedAt || now
  };

  const normalizedOrgs = (
    Array.isArray(candidate.orgs) && candidate.orgs.length > 0 ? candidate.orgs : fallback.orgs
  ).map((org) => ({
    ...org,
    contactName: normalizeContactName((org as Partial<EnterpriseOrg>).contactName),
    contactEmail: normalizeContactEmail((org as Partial<EnterpriseOrg>).contactEmail),
    activeIndustries: normalizeIndustryIds((org as Partial<EnterpriseOrg>).activeIndustries)
  }));

  const normalizedUsers = (Array.isArray(candidate.users) ? candidate.users : fallback.users).map((user) => ({
    ...user,
    orgRole:
      (user as Partial<UserProfile>).accountType === "enterprise"
        ? normalizeOrgUserRole((user as Partial<UserProfile>).orgRole)
        : "user"
  }));

  const normalized = {
    config,
    users: normalizedUsers,
    orgs: normalizedOrgs,
    usageSessions: Array.isArray(candidate.usageSessions) ? candidate.usageSessions : fallback.usageSessions,
    scoreRecords: Array.isArray((candidate as Partial<ApiDatabase>).scoreRecords)
      ? (candidate as Partial<ApiDatabase>).scoreRecords ?? []
      : fallback.scoreRecords,
    aiUsageEvents: Array.isArray((candidate as Partial<ApiDatabase>).aiUsageEvents)
      ? (candidate as Partial<ApiDatabase>).aiUsageEvents ?? []
      : [],
    supportCases: Array.isArray((candidate as Partial<ApiDatabase>).supportCases)
      ? (candidate as Partial<ApiDatabase>).supportCases ?? []
      : [],
    mobileAuthTokens:
      Array.isArray(candidate.mobileAuthTokens) ? candidate.mobileAuthTokens : fallback.mobileAuthTokens,
    admin: {
      passwordHash:
        candidate.admin && typeof candidate.admin.passwordHash === "string"
          ? candidate.admin.passwordHash
          : null
    }
  };

  ensureDemoEnterpriseData(normalized, now);
  ensureDemoSupportCases(normalized, now);
  purgeExpiredSupportTranscripts(normalized, now);
  return normalized;
}

async function loadDatabase(): Promise<ApiDatabase> {
  const readAndParse = async (): Promise<ApiDatabase> => {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return ensureDatabaseShape(JSON.parse(raw));
  };

  try {
    return await readAndParse();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      const created = createDefaultDatabase();
      await fs.writeFile(DB_PATH, JSON.stringify(created, null, 2), "utf8");
      return created;
    }

    // A partial or corrupted read should never wipe the database. Retry once then surface the error.
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return await readAndParse();
    } catch {
      throw error;
    }
  }
}

async function saveDatabase(db: ApiDatabase): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

let databaseOperationQueue: Promise<void> = Promise.resolve();

async function withDatabase<T>(handler: (db: ApiDatabase) => Promise<T> | T): Promise<T> {
  let releaseLock: () => void = () => {};
  const waitForTurn = databaseOperationQueue;
  databaseOperationQueue = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  await waitForTurn;

  const db = await loadDatabase();
  try {
    const result = await handler(db);
    await saveDatabase(db);
    return result;
  } finally {
    releaseLock();
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, hashed: string): boolean {
  const [salt, expected] = hashed.split(":");
  if (!salt || !expected) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signAdminToken(payload: AdminTokenPayload): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function verifyAdminToken(token: string): AdminTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as AdminTokenPayload;
  } catch {
    return null;
  }

  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    return null;
  }

  if (payload.role !== "admin") {
    return null;
  }

  return payload;
}

function getIncomingAdminToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const legacyHeader = request.headers["x-admin-token"];
  if (typeof legacyHeader === "string" && legacyHeader.trim()) {
    return legacyHeader.trim();
  }

  return null;
}

function getIncomingMobileToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const mobileHeader = request.headers["x-mobile-token"];
  if (typeof mobileHeader === "string" && mobileHeader.trim()) {
    return mobileHeader.trim();
  }

  return null;
}

function hashMobileToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function createMobileAuthToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function upsertMobileAuthToken(db: ApiDatabase, userId: string, issuedAtIso: string): string {
  const authToken = createMobileAuthToken();
  const tokenHash = hashMobileToken(authToken);
  const existing = db.mobileAuthTokens.find((entry) => entry.userId === userId);

  if (existing) {
    existing.tokenHash = tokenHash;
    existing.updatedAt = issuedAtIso;
    return authToken;
  }

  db.mobileAuthTokens.push({
    userId,
    tokenHash,
    createdAt: issuedAtIso,
    updatedAt: issuedAtIso
  });

  return authToken;
}

function hasValidMobileTokenForUser(db: ApiDatabase, userId: string, token: string): boolean {
  const authRecord = db.mobileAuthTokens.find((entry) => entry.userId === userId);
  if (!authRecord || !authRecord.tokenHash) {
    return false;
  }

  const expectedBuffer = Buffer.from(authRecord.tokenHash, "hex");
  const actualBuffer = Buffer.from(hashMobileToken(token), "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function requireAdmin(request: AdminAuthRequest, response: Response, next: NextFunction): void {
  const token = getIncomingAdminToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing admin token." });
    return;
  }

  const payload = verifyAdminToken(token);
  if (!payload) {
    response.status(401).json({ error: "Invalid or expired admin token." });
    return;
  }

  request.admin = payload;
  next();
}

function applyPendingTimezoneIfDue(user: UserProfile, now: Date): boolean {
  if (!user.pendingTimezone || !user.pendingTimezoneEffectiveAt) {
    return false;
  }

  if (new Date(user.pendingTimezoneEffectiveAt).getTime() > now.getTime()) {
    return false;
  }

  user.timezone = resolveTimeZone(user.pendingTimezone);
  user.pendingTimezone = null;
  user.pendingTimezoneEffectiveAt = null;
  user.updatedAt = now.toISOString();
  return true;
}

function materializeUserTimezone(user: UserProfile, now: Date): string {
  applyPendingTimezoneIfDue(user, now);
  user.timezone = resolveTimeZone(user.timezone);
  return user.timezone;
}

function getUserById(db: ApiDatabase, userId: string): UserProfile | undefined {
  return db.users.find((user) => user.id === userId);
}

function getOrgById(db: ApiDatabase, orgId: string | null): EnterpriseOrg | undefined {
  if (!orgId) {
    return undefined;
  }

  return db.orgs.find((org) => org.id === orgId);
}

function computeUserUsage(db: ApiDatabase, user: UserProfile, now: Date, timezone: string) {
  const dayKey = getDayKey(now, timezone);
  const monthKey = getMonthKey(now, timezone);
  const userSessions = db.usageSessions.filter((session) => session.userId === user.id);
  const todaySessions = userSessions.filter(
    (session) => getDayKey(new Date(session.endedAt), timezone) === dayKey
  );
  const monthSessions = userSessions.filter(
    (session) => getMonthKey(new Date(session.endedAt), timezone) === monthKey
  );

  const rawSecondsToday = sumRawSeconds(todaySessions);
  const rawSecondsThisMonth = sumRawSeconds(monthSessions);

  return {
    rawSecondsToday,
    billedSecondsToday: calculateBilledSecondsFromRaw(rawSecondsToday),
    rawSecondsThisMonth,
    billedSecondsThisMonth: calculateBilledSecondsFromRaw(rawSecondsThisMonth),
    dayKey,
    monthKey
  };
}

function computeOrgBilledToday(db: ApiDatabase, orgId: string, now: Date, timezone: string): number {
  const dayKey = getDayKey(now, timezone);
  const orgSessions = db.usageSessions.filter(
    (session) => session.orgId === orgId && getDayKey(new Date(session.endedAt), timezone) === dayKey
  );

  const rawSeconds = sumRawSeconds(orgSessions);
  return calculateBilledSecondsFromRaw(rawSeconds);
}

function resolveTierDefinition(db: ApiDatabase, tierId: string): TierDefinition {
  return (
    getTierById(db.config.tiers, tierId as TierDefinition["id"]) ??
    DEFAULT_TIER_DEFINITIONS.find((tier) => tier.id === "free")!
  );
}

function computeEntitlements(db: ApiDatabase, user: UserProfile, now: Date): UserEntitlementsResponse {
  const timezone = materializeUserTimezone(user, now);
  const tierDefinition = resolveTierDefinition(db, user.tier);
  const usage = computeUserUsage(db, user, now, timezone);
  const org = getOrgById(db, user.orgId);

  let dailySecondsLimit: number | null = tierDefinition.dailySecondsLimit;
  let orgDailySecondsQuota: number | null = null;
  let perUserDailySecondsCap: number | null = null;
  let dailySecondsRemaining: number | null = null;
  let lockReason: string | null = null;

  if (user.accountType === "enterprise") {
    if (!org || org.status !== "active") {
      dailySecondsLimit = null;
      lockReason = "Enterprise account is not currently active.";
      dailySecondsRemaining = 0;
    } else {
      orgDailySecondsQuota = org.dailySecondsQuota + org.manualBonusSeconds;
      perUserDailySecondsCap = org.perUserDailySecondsCap + user.manualBonusSeconds;
      const orgBilledToday = computeOrgBilledToday(db, org.id, now, timezone);
      const orgRemaining = Math.max(0, orgDailySecondsQuota - orgBilledToday);
      const perUserRemaining = Math.max(0, perUserDailySecondsCap - usage.billedSecondsToday);

      dailySecondsRemaining = Math.max(0, Math.min(orgRemaining, perUserRemaining));

      if (dailySecondsRemaining <= 0) {
        if (orgRemaining <= 0) {
          lockReason = "Organization daily quota reached.";
        } else {
          lockReason = "User daily quota reached.";
        }
      }
    }
  } else if (dailySecondsLimit !== null) {
    dailySecondsLimit += user.manualBonusSeconds;
    dailySecondsRemaining = Math.max(0, dailySecondsLimit - usage.billedSecondsToday);
    if (dailySecondsRemaining <= 0) {
      lockReason = "Daily plan limit reached.";
    }
  }

  if (user.status !== "active") {
    lockReason = "User account is disabled.";
    dailySecondsRemaining = 0;
  }

  return {
    userId: user.id,
    tier: user.tier,
    accountType: user.accountType,
    status: user.status,
    features: {
      support: tierDefinition.supportIncluded || user.accountType === "enterprise",
      customScenarioBuilder: db.config.featureFlags.customScenarioBuilder && tierDefinition.canCreateCustomScenarios
    },
    limits: {
      dailySecondsLimit,
      orgDailySecondsQuota,
      perUserDailySecondsCap,
      manualBonusSeconds: user.manualBonusSeconds,
      billingIncrementSeconds: USAGE_BILLING_INCREMENT_SECONDS
    },
    usage: {
      ...usage,
      dailySecondsRemaining,
      timezoneUsed: timezone,
      nextDailyResetLabel: humanDailyResetLabel(timezone),
      nextRenewalAt: computeNextRenewalAt(user.planAnchorAt, now)
    },
    canStartSimulation: user.status === "active" && !lockReason,
    lockReason
  };
}

function resolveConfigForUser(db: ApiDatabase, user: UserProfile): AppConfig {
  if (user.accountType !== "enterprise") {
    return db.config;
  }

  const org = getOrgById(db, user.orgId);
  if (!org || org.status !== "active") {
    return db.config;
  }

  const allowedRoleSegmentIds = new Set(getRoleSegmentIdsForIndustries(org.activeIndustries));
  const filteredSegments = db.config.segments.filter((segment) => allowedRoleSegmentIds.has(segment.id));
  if (filteredSegments.length === 0) {
    return {
      ...db.config,
      segments: []
    };
  }

  const hasActiveSegment = filteredSegments.some(
    (segment) => segment.id === db.config.activeSegmentId && segment.enabled
  );
  const fallbackSegment = filteredSegments.find((segment) => segment.enabled) ?? filteredSegments[0];

  return {
    ...db.config,
    activeSegmentId: hasActiveSegment ? db.config.activeSegmentId : fallbackSegment.id,
    segments: filteredSegments
  };
}

function sanitizeConfigPatch(current: AppConfig, patch: UpdateConfigRequest): AppConfig {
  const merged: AppConfig = {
    ...current,
    activeSegmentId: patch.activeSegmentId ?? current.activeSegmentId,
    defaultDifficulty: patch.defaultDifficulty ?? current.defaultDifficulty,
    tiers: patch.tiers ?? current.tiers,
    enterprise: patch.enterprise ? { ...current.enterprise, ...patch.enterprise } : current.enterprise,
    updatedAt: nowIso()
  };

  if (!merged.segments.some((segment) => segment.id === merged.activeSegmentId && segment.enabled)) {
    const fallback = merged.segments.find((segment) => segment.enabled);
    if (fallback) {
      merged.activeSegmentId = fallback.id;
    }
  }

  return merged;
}

type MobileUpdateReason = "user" | "org" | "config" | "resync" | "unknown";

interface MobileUpdatesResponse {
  cursor: number;
  changed: boolean;
  reason: MobileUpdateReason | null;
  generatedAt: string;
  user?: UserProfile;
  config?: AppConfig;
  entitlements?: UserEntitlementsResponse;
}

interface MobileUpdateWaiter {
  since: number;
  resolved: boolean;
  response: Response;
  timeoutHandle: NodeJS.Timeout;
}

const mobileUpdateCursorByUserId = new Map<string, number>();
const mobileUpdateReasonByUserId = new Map<string, MobileUpdateReason>();
const mobileUpdatePayloadByUserId = new Map<string, MobileUpdatesResponse>();
const mobileUpdateWaitersByUserId = new Map<string, Set<MobileUpdateWaiter>>();

function getMobileUpdateCursor(userId: string): number {
  return mobileUpdateCursorByUserId.get(userId) ?? 0;
}

function bumpMobileUpdateCursor(userId: string, reason: MobileUpdateReason): number {
  const nextCursor = getMobileUpdateCursor(userId) + 1;
  mobileUpdateCursorByUserId.set(userId, nextCursor);
  mobileUpdateReasonByUserId.set(userId, reason);
  return nextCursor;
}

function buildMobileUpdatesPayload(
  db: ApiDatabase,
  user: UserProfile,
  cursor: number,
  reason: MobileUpdateReason,
): MobileUpdatesResponse {
  const now = new Date();
  materializeUserTimezone(user, now);
  return {
    cursor,
    changed: true,
    reason,
    generatedAt: now.toISOString(),
    user,
    config: resolveConfigForUser(db, user),
    entitlements: computeEntitlements(db, user, now),
  };
}

function resolveMobileWaitersSet(userId: string): Set<MobileUpdateWaiter> {
  const existing = mobileUpdateWaitersByUserId.get(userId);
  if (existing) {
    return existing;
  }
  const created = new Set<MobileUpdateWaiter>();
  mobileUpdateWaitersByUserId.set(userId, created);
  return created;
}

function cleanupWaiter(userId: string, waiter: MobileUpdateWaiter): void {
  const set = mobileUpdateWaitersByUserId.get(userId);
  if (!set) {
    return;
  }

  set.delete(waiter);
  if (set.size === 0) {
    mobileUpdateWaitersByUserId.delete(userId);
  }
}

function resolveWaiter(userId: string, waiter: MobileUpdateWaiter, payload: MobileUpdatesResponse): void {
  if (waiter.resolved) {
    return;
  }

  waiter.resolved = true;
  clearTimeout(waiter.timeoutHandle);
  cleanupWaiter(userId, waiter);

  try {
    waiter.response.setHeader("Cache-Control", "no-store");
    waiter.response.json(payload);
  } catch {
    // Ignore broken pipe / disconnected clients.
  }
}

function emitMobileUpdateForUser(db: ApiDatabase, userId: string, reason: MobileUpdateReason): void {
  const user = getUserById(db, userId);
  if (!user) {
    return;
  }

  const cursor = bumpMobileUpdateCursor(userId, reason);
  const payload = buildMobileUpdatesPayload(db, user, cursor, reason);
  mobileUpdatePayloadByUserId.set(userId, payload);

  const waiters = mobileUpdateWaitersByUserId.get(userId);
  if (!waiters || waiters.size === 0) {
    return;
  }

  for (const waiter of Array.from(waiters)) {
    if (cursor > waiter.since) {
      resolveWaiter(userId, waiter, payload);
    }
  }
}

function emitMobileUpdateForOrg(db: ApiDatabase, orgId: string, reason: MobileUpdateReason): void {
  const users = db.users.filter((user) => user.accountType === "enterprise" && user.orgId === orgId);
  for (const user of users) {
    emitMobileUpdateForUser(db, user.id, reason);
  }
}

function emitMobileUpdateForAllUsers(db: ApiDatabase, reason: MobileUpdateReason): void {
  for (const user of db.users) {
    emitMobileUpdateForUser(db, user.id, reason);
  }
}

function getSupportedTimezones(): string[] {
  const fromIntl = (() => {
    try {
      const list = Intl.supportedValuesOf?.("timeZone");
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
      return [];
    } catch {
      return [];
    }
  })();

  if (fromIntl.length > 0) {
    return fromIntl;
  }

  return COMMON_TIMEZONES;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // A 15s compressed audio clip should be well under this; keeps memory bounded.
    fileSize: 12 * 1024 * 1024
  }
});

function isRemoteAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, now: nowIso() });
});

app.get("/meta/timezones", (_request, response) => {
  response.json({ items: getSupportedTimezones() });
});

app.post("/auth/login", async (request: Request, response: Response) => {
  const body = request.body as { password?: string };
  const password = body.password?.trim();

  if (!password) {
    response.status(400).json({ error: "Password is required." });
    return;
  }

  const db = await loadDatabase();
  const valid = db.admin.passwordHash
    ? verifyPassword(password, db.admin.passwordHash)
    : password === ADMIN_BOOTSTRAP_PASSWORD;

  if (!valid) {
    response.status(401).json({ error: "Invalid admin password." });
    return;
  }

  const expiresAtMs = Date.now() + ADMIN_TOKEN_TTL_MINUTES * 60 * 1000;
  const token = signAdminToken({ role: "admin", exp: expiresAtMs });

  response.json({ token, expiresAt: new Date(expiresAtMs).toISOString() });
});

app.post("/auth/change-password", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as ChangeAdminPasswordRequest;
  const currentPassword = body.currentPassword?.trim();
  const newPassword = body.newPassword?.trim();

  if (!currentPassword || !newPassword) {
    response.status(400).json({ error: "Current and new password are required." });
    return;
  }

  if (newPassword.length < 8) {
    response.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }

  await withDatabase(async (db) => {
    const valid = db.admin.passwordHash
      ? verifyPassword(currentPassword, db.admin.passwordHash)
      : currentPassword === ADMIN_BOOTSTRAP_PASSWORD;

    if (!valid) {
      response.status(401).json({ error: "Current password is incorrect." });
      return;
    }

    db.admin.passwordHash = hashPassword(newPassword);
    response.json({ ok: true });
  });
});

app.get("/config", async (_request: Request, response: Response) => {
  const db = await loadDatabase();
  response.json(db.config);
});

app.patch("/config", requireAdmin, async (request: Request, response: Response) => {
  const patch = request.body as UpdateConfigRequest;

  await withDatabase(async (db) => {
    db.config = sanitizeConfigPatch(db.config, patch);
    emitMobileUpdateForAllUsers(db, "config");
    response.json(db.config);
  });
});

app.get("/orgs", requireAdmin, async (_request: Request, response: Response) => {
  const db = await loadDatabase();
  response.json(db.orgs);
});

app.post("/orgs", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as {
    name?: string;
    contactName?: string;
    contactEmail?: string;
    dailySecondsQuota?: number;
    perUserDailySecondsCap?: number;
    activeIndustries?: IndustryId[];
  };
  const name = body.name?.trim();

  if (!name) {
    response.status(400).json({ error: "Organization name is required." });
    return;
  }

  await withDatabase(async (db) => {
    const now = nowIso();
    const org: EnterpriseOrg = {
      id: `org_${uuid()}`,
      name,
      status: "active",
      contactName: normalizeContactName(body.contactName),
      contactEmail: normalizeContactEmail(body.contactEmail),
      activeIndustries: normalizeIndustryIds(body.activeIndustries),
      dailySecondsQuota: clampNonNegativeInteger(
        body.dailySecondsQuota,
        db.config.enterprise.defaultOrgDailySecondsQuota
      ),
      perUserDailySecondsCap: clampNonNegativeInteger(
        body.perUserDailySecondsCap,
        db.config.enterprise.defaultPerUserDailySecondsCap
      ),
      manualBonusSeconds: 0,
      createdAt: now,
      updatedAt: now
    };

    db.orgs.push(org);
    response.status(201).json(org);
  });
});

app.patch("/orgs/:orgId", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;
  const patch = request.body as Partial<EnterpriseOrg>;

  await withDatabase(async (db) => {
    const org = db.orgs.find((entry) => entry.id === orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    if (typeof patch.name === "string" && patch.name.trim()) {
      org.name = patch.name.trim();
    }

    if (typeof patch.contactName === "string") {
      org.contactName = normalizeContactName(patch.contactName);
    }

    if (typeof patch.contactEmail === "string") {
      org.contactEmail = normalizeContactEmail(patch.contactEmail);
    }

    if (typeof patch.status === "string" && (patch.status === "active" || patch.status === "disabled")) {
      org.status = patch.status;
    }

    if (patch.activeIndustries !== undefined) {
      org.activeIndustries = normalizeIndustryIds(patch.activeIndustries);
    }

    if (patch.dailySecondsQuota !== undefined) {
      org.dailySecondsQuota = clampNonNegativeInteger(patch.dailySecondsQuota, org.dailySecondsQuota);
    }

    if (patch.perUserDailySecondsCap !== undefined) {
      org.perUserDailySecondsCap = clampNonNegativeInteger(
        patch.perUserDailySecondsCap,
        org.perUserDailySecondsCap
      );
    }

    if (patch.manualBonusSeconds !== undefined) {
      org.manualBonusSeconds = clampNonNegativeInteger(patch.manualBonusSeconds, org.manualBonusSeconds);
    }

    org.updatedAt = nowIso();
    emitMobileUpdateForOrg(db, org.id, "org");
    response.json(org);
  });
});

app.get("/orgs/:orgId/dashboard", requireAdmin, async (request: Request, response: Response) => {
  const orgId = request.params.orgId;

  await withDatabase(async (db) => {
    const org = db.orgs.find((entry) => entry.id === orgId);
    if (!org) {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const now = new Date();
    const anchorAt =
      org.createdAt && !Number.isNaN(new Date(org.createdAt).getTime()) ? org.createdAt : now.toISOString();
    const billing = computeAnnualPeriodBounds(anchorAt, now);
    const periodStartMs = new Date(billing.periodStartAt).getTime();
    const periodEndMs = new Date(billing.periodEndAt).getTime();

    const orgUsers = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === org.id)
      .sort((a, b) => a.email.localeCompare(b.email));

    const sessionsForOrg = db.usageSessions.filter((session) => session.orgId === org.id);

    const users = orgUsers.map((user) => {
      const sessionsInPeriod = sessionsForOrg.filter((session) => {
        if (session.userId !== user.id) {
          return false;
        }

        const startedAtMs = new Date(session.startedAt).getTime();
        if (Number.isNaN(startedAtMs)) {
          return false;
        }

        return startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
      });

      const rawSecondsThisPeriod = sumRawSeconds(sessionsInPeriod);
      const billedSecondsThisPeriod = sessionsInPeriod.reduce(
        (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
        0
      );

      return {
        userId: user.id,
        email: user.email,
        status: user.status,
        orgRole: user.orgRole,
        rawSecondsThisPeriod,
        billedSecondsThisPeriod
      };
    });

    response.json({
      generatedAt: now.toISOString(),
      org,
      billingPeriod: {
        periodStartAt: billing.periodStartAt,
        periodEndAt: billing.periodEndAt,
        nextRenewalAt: billing.nextRenewalAt
      },
      users
    });
  });
});

app.get("/users", requireAdmin, async (_request: Request, response: Response) => {
  const db = await loadDatabase();
  response.json(db.users);
});

app.get("/users/:userId", requireAdmin, async (request: Request, response: Response) => {
  const db = await loadDatabase();
  const user = getUserById(db, request.params.userId);
  if (!user) {
    response.status(404).json({ error: "User not found." });
    return;
  }

  response.json(user);
});

app.post("/users", requireAdmin, async (request: Request, response: Response) => {
  const body = request.body as CreateUserRequest;
  const email = body.email?.trim().toLowerCase();

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }

  if (!isTierId(body.tier)) {
    response.status(400).json({ error: "Valid tier is required." });
    return;
  }

  if (!isAccountType(body.accountType)) {
    response.status(400).json({ error: "Valid account type is required." });
    return;
  }

  const timezone = resolveTimeZone(body.timezone);

  await withDatabase(async (db) => {
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      response.status(409).json({ error: "Email already exists." });
      return;
    }

    const orgId = body.accountType === "enterprise" ? body.orgId ?? null : null;
    if (body.accountType === "enterprise") {
      if (!orgId) {
        response.status(400).json({ error: "Enterprise users require an organization." });
        return;
      }

      const org = getOrgById(db, orgId);
      if (!org || org.status !== "active") {
        response.status(400).json({ error: "Enterprise users must belong to an active organization." });
        return;
      }
    }

    const now = nowIso();
    const user: UserProfile = {
      id: `usr_${uuid()}`,
      email,
      accountType: body.accountType,
      tier: body.tier,
      status: "active",
      orgId,
      orgRole: body.accountType === "enterprise" ? normalizeOrgUserRole(body.orgRole) : "user",
      timezone,
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      createdAt: now,
      updatedAt: now
    };

    db.users.push(user);
    response.status(201).json(user);
  });
});

app.patch("/users/:userId", requireAdmin, async (request: Request, response: Response) => {
  const userId = request.params.userId;
  const patch = request.body as UpdateUserRequest;

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const now = new Date();
    materializeUserTimezone(user, now);

    if (typeof patch.email === "string") {
      const email = patch.email.trim().toLowerCase();
      if (!isEmailLike(email)) {
        response.status(400).json({ error: "Invalid email format." });
        return;
      }

      const duplicate = db.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.id !== user.id);
      if (duplicate) {
        response.status(409).json({ error: "Email already exists." });
        return;
      }

      user.email = email;
    }

    if (patch.tier) {
      if (!isTierId(patch.tier)) {
        response.status(400).json({ error: "Invalid tier." });
        return;
      }

      user.tier = patch.tier;
    }

    let nextAccountType = user.accountType;
    if (patch.accountType) {
      if (!isAccountType(patch.accountType)) {
        response.status(400).json({ error: "Invalid account type." });
        return;
      }

      nextAccountType = patch.accountType;
    }

    if (patch.status) {
      if (!isUserStatus(patch.status)) {
        response.status(400).json({ error: "Invalid status." });
        return;
      }

      user.status = patch.status;
    }

    let nextOrgId = patch.orgId !== undefined ? patch.orgId : user.orgId;
    if (nextAccountType === "enterprise") {
      if (!nextOrgId) {
        response.status(400).json({ error: "Enterprise users require an organization." });
        return;
      }

      const org = getOrgById(db, nextOrgId);
      if (!org || org.status !== "active") {
        response.status(400).json({ error: "Enterprise users must belong to an active organization." });
        return;
      }
    } else {
      nextOrgId = null;
    }

    user.accountType = nextAccountType;
    user.orgId = nextOrgId;

    if (nextAccountType === "enterprise") {
      if (patch.orgRole !== undefined) {
        user.orgRole = normalizeOrgUserRole(patch.orgRole);
      } else {
        user.orgRole = normalizeOrgUserRole(user.orgRole);
      }
    } else {
      user.orgRole = "user";
    }

    if (patch.manualBonusSeconds !== undefined) {
      user.manualBonusSeconds = clampNonNegativeInteger(patch.manualBonusSeconds, user.manualBonusSeconds);
    }

    if (typeof patch.timezone === "string") {
      const timezone = resolveTimeZone(patch.timezone);
      if (timezone !== user.timezone) {
        user.pendingTimezone = timezone;
        user.pendingTimezoneEffectiveAt = computeNextRenewalAt(user.planAnchorAt, now);
      }
    }

    user.updatedAt = now.toISOString();
    emitMobileUpdateForUser(db, user.id, "user");
    response.json(user);
  });
});

app.post("/mobile/onboard", async (request: Request, response: Response) => {
  const body = request.body as MobileOnboardRequest;
  const email = body.email?.trim().toLowerCase();

  if (!email || !isEmailLike(email)) {
    response.status(400).json({ error: "Valid email is required." });
    return;
  }

  const timezone = resolveTimeZone(body.timezone);

  await withDatabase(async (db) => {
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) {
      const issuedAt = nowIso();
      const authToken = upsertMobileAuthToken(db, existing.id, issuedAt);
      const payload: MobileOnboardResponse = {
        user: existing,
        authToken
      };
      response.json(payload);
      return;
    }

    const now = nowIso();
    const user: UserProfile = {
      id: `usr_${uuid()}`,
      email,
      accountType: "individual",
      tier: "free",
      status: "active",
      orgId: null,
      orgRole: "user",
      timezone,
      pendingTimezone: null,
      pendingTimezoneEffectiveAt: null,
      planAnchorAt: now,
      manualBonusSeconds: 0,
      createdAt: now,
      updatedAt: now
    };

    db.users.push(user);
    const authToken = upsertMobileAuthToken(db, user.id, now);
    const payload: MobileOnboardResponse = {
      user,
      authToken
    };
    response.status(201).json(payload);
  });
});

app.get("/mobile/users/:userId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    materializeUserTimezone(user, new Date());
    response.json(user);
  });
});

app.get("/mobile/users/:userId/config", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    response.json(resolveConfigForUser(db, user));
  });
});

app.post("/mobile/users/:userId/support/cases", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as {
    message?: unknown;
    includeTranscript?: unknown;
    transcript?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    response.status(400).json({ error: "Feedback message is required." });
    return;
  }

  const includeTranscript = Boolean(body.includeTranscript);
  const transcriptCandidate = body.transcript as
    | {
        text?: unknown;
        fileName?: unknown;
        meta?: unknown;
      }
    | undefined;

  const transcriptText =
    includeTranscript && typeof transcriptCandidate?.text === "string"
      ? transcriptCandidate.text.trim()
      : "";

  if (includeTranscript && !transcriptText) {
    response.status(400).json({ error: "Transcript text is required when consent is enabled." });
    return;
  }

  if (transcriptText.length > 200_000) {
    response.status(400).json({ error: "Transcript is too large." });
    return;
  }

  const transcriptFileName =
    includeTranscript && typeof transcriptCandidate?.fileName === "string" && transcriptCandidate.fileName.trim()
      ? transcriptCandidate.fileName.trim().slice(0, 140)
      : null;

  const safeMeta = (() => {
    const meta = transcriptCandidate?.meta;
    if (!includeTranscript || !meta || typeof meta !== "object") {
      return null;
    }

    const getString = (value: unknown, maxLen: number): string | null => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, maxLen) : null;
    };

    const candidate = meta as Record<string, unknown>;
    const difficulty = isDifficulty(candidate.difficulty) ? candidate.difficulty : null;
    const personaStyle = isPersonaStyle(candidate.personaStyle) ? candidate.personaStyle : null;

    return {
      scenarioTitle: getString(candidate.scenarioTitle, 160),
      segmentLabel: getString(candidate.segmentLabel, 120),
      difficulty,
      personaStyle,
      startedAt: getString(candidate.startedAt, 64),
      endedAt: getString(candidate.endedAt, 64),
      model: getString(candidate.model, 80),
      promptVersion: getString(candidate.promptVersion, 80),
      rubricVersion: getString(candidate.rubricVersion, 80)
    };
  })();

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const now = nowIso();
    const record: SupportCaseRecord = {
      id: `case_${uuid()}`,
      status: "open",
      userId: user.id,
      orgId: user.orgId,
      segmentId: null,
      scenarioId: null,
      message: message.slice(0, 5_000),
      transcriptEncrypted: includeTranscript ? encryptSupportTranscript(transcriptText) : null,
      transcriptExpiresAt: includeTranscript
        ? new Date(Date.now() + SUPPORT_TRANSCRIPT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null,
      transcriptFileName: includeTranscript ? transcriptFileName ?? `transcript-${user.id}-${Date.now()}.txt` : null,
      transcriptMeta: safeMeta,
      createdAt: now,
      updatedAt: now
    };

    // Link scenario metadata if provided and known to this user.
    if (safeMeta?.scenarioTitle) {
      const configForUser = resolveConfigForUser(db, user);
      const segment = configForUser.segments.find(
        (entry) =>
          entry.enabled &&
          (entry.scenarios ?? []).some((scenario) => scenario.title === safeMeta.scenarioTitle),
      );
      if (segment) {
        record.segmentId = segment.id;
        const scenario = (segment.scenarios ?? []).find((entry) => entry.title === safeMeta.scenarioTitle);
        if (scenario) {
          record.scenarioId = scenario.id;
        }
      }
    }

    db.supportCases.push(record);
    response.status(201).json({
      caseId: record.id,
      transcriptRetainedUntil: record.transcriptExpiresAt
    });
  });
});

app.get("/mobile/users/:userId/updates", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const timeoutMs = Math.max(1_000, Math.min(30_000, clampNonNegativeInteger(request.query.timeoutMs, 25_000)));
  const since = Math.max(0, clampNonNegativeInteger(request.query.cursor, 0));

  const db = await loadDatabase();
  const user = getUserById(db, request.params.userId);
  if (!user) {
    response.status(404).json({ error: "User not found." });
    return;
  }

  if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
    response.status(401).json({ error: "Invalid mobile token." });
    return;
  }

  const currentCursor = getMobileUpdateCursor(user.id);

  if (since > currentCursor) {
    response.setHeader("Cache-Control", "no-store");
    response.json(buildMobileUpdatesPayload(db, user, currentCursor, "resync"));
    return;
  }

  if (currentCursor > since) {
    const cached = mobileUpdatePayloadByUserId.get(user.id);
    const reason = mobileUpdateReasonByUserId.get(user.id) ?? "unknown";
    response.setHeader("Cache-Control", "no-store");
    response.json(
      cached && cached.cursor === currentCursor
        ? cached
        : buildMobileUpdatesPayload(db, user, currentCursor, reason),
    );
    return;
  }

  const waiter: MobileUpdateWaiter = {
    since,
    resolved: false,
    response,
    timeoutHandle: setTimeout(() => {
      const cursor = getMobileUpdateCursor(user.id);
      resolveWaiter(user.id, waiter, {
        cursor,
        changed: false,
        reason: null,
        generatedAt: nowIso(),
      });
    }, timeoutMs),
  };

  resolveMobileWaitersSet(user.id).add(waiter);

  request.on("close", () => {
    if (waiter.resolved) {
      return;
    }

    waiter.resolved = true;
    clearTimeout(waiter.timeoutHandle);
    cleanupWaiter(user.id, waiter);
  });
});

app.patch("/mobile/users/:userId/settings", async (request: Request, response: Response) => {
  const patch = request.body as MobileUpdateSettingsRequest;
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const now = new Date();
    materializeUserTimezone(user, now);

    if (typeof patch.email === "string") {
      const email = patch.email.trim().toLowerCase();
      if (!isEmailLike(email)) {
        response.status(400).json({ error: "Invalid email format." });
        return;
      }

      const duplicate = db.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.id !== user.id);
      if (duplicate) {
        response.status(409).json({ error: "Email already exists." });
        return;
      }

      user.email = email;
    }

    if (typeof patch.timezone === "string") {
      const timezone = resolveTimeZone(patch.timezone);
      if (timezone !== user.timezone) {
        user.pendingTimezone = timezone;
        user.pendingTimezoneEffectiveAt = computeNextRenewalAt(user.planAnchorAt, now);
      }
    }

    user.updatedAt = now.toISOString();
    response.json(user);
  });
});

app.get("/users/:userId/entitlements", requireAdmin, async (request: Request, response: Response) => {
  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    response.json(entitlements);
  });
});

app.get("/mobile/users/:userId/entitlements", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, request.params.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    response.json(entitlements);
  });
});

app.post("/mobile/users/:userId/ai/transcribe", upload.single("file"), async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const file = (request as unknown as { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
  if (!file?.buffer) {
    response.status(400).json({ error: "Audio file is required." });
    return;
  }

  const context = await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    if (!entitlements.canStartSimulation) {
      response.status(403).json({ error: entitlements.lockReason ?? "Simulation unavailable." });
      return null;
    }

    return { userId: user.id };
  });

  if (!context) {
    return;
  }

  try {
    const text = await requestTranscription({
      model: OPENAI_TRANSCRIPTION_MODEL,
      audioBuffer: file.buffer,
      fileName: file.originalname || "voice-input.m4a",
      mimeType: file.mimetype || "audio/m4a"
    });

    response.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    response.status(503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/ai/opening", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as { scenarioId?: string; difficulty?: unknown; personaStyle?: unknown };
  const scenarioId = body.scenarioId?.trim();
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  const context = await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    if (!entitlements.canStartSimulation) {
      response.status(403).json({ error: entitlements.lockReason ?? "Simulation unavailable." });
      return null;
    }

    const configForUser = resolveConfigForUser(db, user);
    const segment = configForUser.segments.find(
      (entry) => entry.enabled && (entry.scenarios ?? []).some((scenario) => scenario.id === scenarioId && scenario.enabled !== false)
    );
    if (!segment) {
      response.status(400).json({ error: "Invalid scenario for this account." });
      return null;
    }

    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId && entry.enabled !== false);
    if (!scenario) {
      response.status(400).json({ error: "Scenario not found." });
      return null;
    }

    return {
      user,
      segment,
      scenario,
      difficulty: difficulty ?? configForUser.defaultDifficulty,
      personaStyle: personaStyle ?? configForUser.defaultPersonaStyle
    };
  });

  if (!context) {
    return;
  }

  try {
    const systemPrompt = buildRoleplaySystemPrompt({
      scenario: context.scenario,
      difficulty: context.difficulty,
      segmentLabel: context.segment.label,
      personaStyle: context.personaStyle
    });

    const openingPrompt = buildOpeningPrompt(context.scenario);
    const completion = await requestChatCompletion({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: openingPrompt }
      ],
      temperature: 0.8
    });

    await withDatabase(async (db) => {
      const user = getUserById(db, context.user.id);
      if (!user) {
        return;
      }

      const event: AiUsageEvent = {
        id: `ai_${uuid()}`,
        kind: "opening",
        userId: user.id,
        orgId: user.orgId,
        segmentId: context.segment.id,
        scenarioId: context.scenario.id,
        model: completion.model,
        promptVersion: AI_PROMPT_VERSION,
        rubricVersion: null,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        totalTokens: completion.usage.totalTokens,
        createdAt: nowIso()
      };

      db.aiUsageEvents.push(event);
    });

    response.json({
      assistantText: completion.text,
      usage: completion.usage,
      model: completion.model,
      promptVersion: AI_PROMPT_VERSION
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    response.status(503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/ai/turn", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as {
    scenarioId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    history?: unknown;
  };

  const scenarioId = body.scenarioId?.trim();
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;
  const history = normalizeDialogueHistory(body.history);

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  if (history.length === 0) {
    response.status(400).json({ error: "history is required." });
    return;
  }

  const context = await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    if (!entitlements.canStartSimulation) {
      response.status(403).json({ error: entitlements.lockReason ?? "Simulation unavailable." });
      return null;
    }

    const configForUser = resolveConfigForUser(db, user);
    const segment = configForUser.segments.find(
      (entry) => entry.enabled && (entry.scenarios ?? []).some((scenario) => scenario.id === scenarioId && scenario.enabled !== false)
    );
    if (!segment) {
      response.status(400).json({ error: "Invalid scenario for this account." });
      return null;
    }

    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId && entry.enabled !== false);
    if (!scenario) {
      response.status(400).json({ error: "Scenario not found." });
      return null;
    }

    return {
      user,
      segment,
      scenario,
      difficulty: difficulty ?? configForUser.defaultDifficulty,
      personaStyle: personaStyle ?? configForUser.defaultPersonaStyle
    };
  });

  if (!context) {
    return;
  }

  try {
    const systemPrompt = buildRoleplaySystemPrompt({
      scenario: context.scenario,
      difficulty: context.difficulty,
      segmentLabel: context.segment.label,
      personaStyle: context.personaStyle
    });

    const temperature = context.difficulty === "hard" ? 0.55 : 0.75;
    const completion = await requestChatCompletion({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((message) => ({ role: message.role, content: message.content }))
      ],
      temperature
    });

    await withDatabase(async (db) => {
      const user = getUserById(db, context.user.id);
      if (!user) {
        return;
      }

      const event: AiUsageEvent = {
        id: `ai_${uuid()}`,
        kind: "turn",
        userId: user.id,
        orgId: user.orgId,
        segmentId: context.segment.id,
        scenarioId: context.scenario.id,
        model: completion.model,
        promptVersion: AI_PROMPT_VERSION,
        rubricVersion: null,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        totalTokens: completion.usage.totalTokens,
        createdAt: nowIso()
      };

      db.aiUsageEvents.push(event);
    });

    response.json({
      assistantText: completion.text,
      usage: completion.usage,
      model: completion.model,
      promptVersion: AI_PROMPT_VERSION
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed.";
    response.status(503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/ai/score", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!isRemoteAiConfigured()) {
    response.status(503).json({ error: "Remote AI is disabled for this environment." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as {
    scenarioId?: string;
    difficulty?: unknown;
    personaStyle?: unknown;
    startedAt?: string;
    endedAt?: string;
    history?: unknown;
  };

  const scenarioId = body.scenarioId?.trim();
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : null;
  const personaStyle = isPersonaStyle(body.personaStyle) ? body.personaStyle : null;
  const history = normalizeDialogueHistory(body.history);

  if (!scenarioId) {
    response.status(400).json({ error: "scenarioId is required." });
    return;
  }

  const parsedStart = parseIsoDateOrNull(body.startedAt);
  const parsedEnd = parseIsoDateOrNull(body.endedAt);
  if (!parsedStart || !parsedEnd) {
    response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
    return;
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
    return;
  }

  if (history.length === 0) {
    response.status(400).json({ error: "history is required." });
    return;
  }

  const context = await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return null;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return null;
    }

    const entitlements = computeEntitlements(db, user, new Date());
    if (!entitlements.canStartSimulation) {
      response.status(403).json({ error: entitlements.lockReason ?? "Simulation unavailable." });
      return null;
    }

    const configForUser = resolveConfigForUser(db, user);
    const segment = configForUser.segments.find(
      (entry) => entry.enabled && (entry.scenarios ?? []).some((scenario) => scenario.id === scenarioId && scenario.enabled !== false)
    );
    if (!segment) {
      response.status(400).json({ error: "Invalid scenario for this account." });
      return null;
    }

    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId && entry.enabled !== false);
    if (!scenario) {
      response.status(400).json({ error: "Scenario not found." });
      return null;
    }

    return {
      user,
      segment,
      scenario,
      difficulty: difficulty ?? configForUser.defaultDifficulty,
      personaStyle: personaStyle ?? configForUser.defaultPersonaStyle
    };
  });

  if (!context) {
    return;
  }

  try {
    const evaluationPrompt = buildEvaluationSystemPrompt({
      scenario: context.scenario,
      difficulty: context.difficulty,
      segmentLabel: context.segment.label,
      personaStyle: context.personaStyle
    });

    const transcript = formatDialogueForEvaluation(history);
    const completion = await requestChatCompletion({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: evaluationPrompt },
        { role: "user", content: `Conversation transcript:\n${transcript}` }
      ],
      temperature: 0.2
    });

    const parsed = JSON.parse(extractJsonObject(completion.text)) as unknown;
    const scorecard = normalizeScorecard(parsed);

    const now = nowIso();
    const record: SimulationScoreRecord = {
      id: `score_${uuid()}`,
      userId: context.user.id,
      orgId: context.user.orgId,
      segmentId: context.segment.id,
      scenarioId: context.scenario.id,
      startedAt: parsedStart.toISOString(),
      endedAt: parsedEnd.toISOString(),
      overallScore: scorecard.overallScore,
      persuasion: scorecard.persuasion,
      clarity: scorecard.clarity,
      empathy: scorecard.empathy,
      assertiveness: scorecard.assertiveness,
      summary: scorecard.summary,
      rubricVersion: AI_RUBRIC_VERSION,
      model: completion.model,
      promptVersion: AI_PROMPT_VERSION,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      totalTokens: completion.usage.totalTokens,
      createdAt: now
    };

    await withDatabase(async (db) => {
      const user = getUserById(db, context.user.id);
      if (!user) {
        return;
      }

      db.scoreRecords.push(record);

      const event: AiUsageEvent = {
        id: `ai_${uuid()}`,
        kind: "score",
        userId: user.id,
        orgId: user.orgId,
        segmentId: context.segment.id,
        scenarioId: context.scenario.id,
        model: completion.model,
        promptVersion: AI_PROMPT_VERSION,
        rubricVersion: AI_RUBRIC_VERSION,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        totalTokens: completion.usage.totalTokens,
        createdAt: nowIso()
      };

      db.aiUsageEvents.push(event);
    });

    response.status(201).json({
      scorecard,
      record: {
        id: record.id,
        createdAt: record.createdAt,
        model: record.model,
        promptVersion: record.promptVersion,
        rubricVersion: record.rubricVersion,
        usage: {
          inputTokens: record.inputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          totalTokens: record.totalTokens ?? 0
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Score generation failed.";
    response.status(503).json({ error: message });
  }
});

app.post("/mobile/users/:userId/scores", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const body = request.body as RecordSimulationScoreRequest;
  const segmentId = body.segmentId?.trim();
  const scenarioId = body.scenarioId?.trim();

  if (!segmentId || !scenarioId) {
    response.status(400).json({ error: "segmentId and scenarioId are required." });
    return;
  }

  const parsedStart = parseIsoDateOrNull(body.startedAt);
  const parsedEnd = parseIsoDateOrNull(body.endedAt);
  if (!parsedStart || !parsedEnd) {
    response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
    return;
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const configForUser = resolveConfigForUser(db, user);
    const segment = configForUser.segments.find((entry) => entry.id === segmentId && entry.enabled);
    if (!segment) {
      response.status(400).json({ error: "Invalid segment for score record." });
      return;
    }

    const scenario = (segment.scenarios ?? []).find((entry) => entry.id === scenarioId && entry.enabled !== false);
    if (!scenario) {
      response.status(400).json({ error: "Invalid scenario for score record." });
      return;
    }

    const clampScore = (value: unknown, max: number): number => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      return Math.max(0, Math.min(max, parsed));
    };

    const now = new Date();
    const record: SimulationScoreRecord = {
      id: `score_${uuid()}`,
      userId: user.id,
      orgId: user.orgId,
      segmentId,
      scenarioId,
      startedAt: parsedStart.toISOString(),
      endedAt: parsedEnd.toISOString(),
      overallScore: clampScore(body.overallScore, 100),
      persuasion: clampScore(body.persuasion, 10),
      clarity: clampScore(body.clarity, 10),
      empathy: clampScore(body.empathy, 10),
      assertiveness: clampScore(body.assertiveness, 10),
      createdAt: now.toISOString()
    };

    db.scoreRecords.push(record);
    response.status(201).json(record);
  });
});

app.get("/mobile/users/:userId/scores/summary", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const userId = request.params.userId;
  const segmentId = typeof request.query.segmentId === "string" ? request.query.segmentId.trim() : "";
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabase(async (db) => {
    const user = getUserById(db, userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const scoreRecords = (db.scoreRecords ?? []).filter((record) => {
      if (record.userId !== user.id) {
        return false;
      }

      if (segmentId && record.segmentId !== segmentId) {
        return false;
      }

      const endedAtMs = new Date(record.endedAt).getTime();
      if (Number.isNaN(endedAtMs)) {
        return false;
      }

      return endedAtMs >= periodStartMs && endedAtMs < periodEndMs;
    });

    const safeScores = scoreRecords.map((record) => Math.max(0, Math.min(100, record.overallScore)));
    const avgOverallScore = safeScores.length > 0 ? safeScores.reduce((a, b) => a + b, 0) / safeScores.length : null;

    const toDayKeyUtc = (iso: string): string | null => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString().slice(0, 10);
    };

    const byDay = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of scoreRecords) {
      const dayKey = toDayKeyUtc(record.endedAt);
      if (!dayKey) {
        continue;
      }
      const current = byDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
      byDay.set(dayKey, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const bySegment = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of scoreRecords) {
      const current = bySegment.get(record.segmentId) ?? { sessions: 0, totalScore: 0 };
      bySegment.set(record.segmentId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    response.json({
      generatedAt: now.toISOString(),
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      filters: { segmentId: segmentId || null },
      totals: { sessions: scoreRecords.length, avgOverallScore },
      byDay: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dayKey, row]) => ({
          dayKey,
          sessions: row.sessions,
          avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
        })),
      bySegment: Array.from(bySegment.entries())
        .map(([id, row]) => ({
          segmentId: id,
          segmentLabel: segmentLabelById.get(id) ?? id,
          sessions: row.sessions,
          avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
        }))
        .sort((a, b) => b.sessions - a.sessions),
      recent: scoreRecords
        .slice()
        .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
        .slice(0, 25)
        .map((record) => ({
          id: record.id,
          endedAt: record.endedAt,
          segmentId: record.segmentId,
          scenarioId: record.scenarioId,
          overallScore: record.overallScore
        }))
    });
  });
});

app.get("/mobile/users/:userId/admin/org/dashboard", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const now = new Date();
    const anchorAt =
      org.createdAt && !Number.isNaN(new Date(org.createdAt).getTime()) ? org.createdAt : now.toISOString();
    const billing = computeAnnualPeriodBounds(anchorAt, now);
    const periodStartMs = new Date(billing.periodStartAt).getTime();
    const periodEndMs = new Date(billing.periodEndAt).getTime();

    const sessionsForOrg = db.usageSessions.filter((session) => session.orgId === org.id);
    const sessionsInPeriod = sessionsForOrg.filter((session) => {
      const startedAtMs = new Date(session.startedAt).getTime();
      if (Number.isNaN(startedAtMs)) {
        return false;
      }
      return startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
    });

    const billedSecondsThisPeriod = sessionsInPeriod.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );

    const daysInPeriod = Math.max(1, Math.round((periodEndMs - periodStartMs) / (24 * 60 * 60 * 1000)));
    const dailyQuotaSeconds = org.dailySecondsQuota + org.manualBonusSeconds;
    const annualizedAllotmentSeconds = dailyQuotaSeconds * daysInPeriod;

    response.json({
      generatedAt: now.toISOString(),
      org,
      billingPeriod: {
        periodStartAt: billing.periodStartAt,
        periodEndAt: billing.periodEndAt,
        nextRenewalAt: billing.nextRenewalAt,
        daysInPeriod
      },
      usage: {
        dailyQuotaSeconds,
        perUserDailyCapSeconds: org.perUserDailySecondsCap,
        billedSecondsThisPeriod,
        annualizedAllotmentSeconds
      }
    });
  });
});

app.get("/mobile/users/:userId/admin/org/users", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const users = db.users
      .filter((user) => user.accountType === "enterprise" && user.orgId === org.id)
      .sort((a, b) => a.email.localeCompare(b.email))
      .map((user) => ({
        userId: user.id,
        email: user.email,
        status: user.status,
        orgRole: user.orgRole
      }));

    response.json({
      generatedAt: nowIso(),
      org: { id: org.id, name: org.name },
      users
    });
  });
});

app.get("/mobile/users/:userId/admin/org/users/:targetUserId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const targetUserId = request.params.targetUserId;
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const target = getUserById(db, targetUserId);
    if (!target || target.accountType !== "enterprise" || target.orgId !== org.id) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const sessions = db.usageSessions.filter((session) => {
      if (session.userId !== target.id) {
        return false;
      }
      const startedAtMs = new Date(session.startedAt).getTime();
      if (Number.isNaN(startedAtMs)) {
        return false;
      }
      return startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
    });

    const billedSeconds = sessions.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );

    const scores = (db.scoreRecords ?? []).filter((record) => {
      if (record.userId !== target.id) {
        return false;
      }
      const endedAtMs = new Date(record.endedAt).getTime();
      if (Number.isNaN(endedAtMs)) {
        return false;
      }
      return endedAtMs >= periodStartMs && endedAtMs < periodEndMs;
    });

    const safeScores = scores.map((record) => Math.max(0, Math.min(100, record.overallScore)));
    const avgOverallScore = safeScores.length > 0 ? safeScores.reduce((a, b) => a + b, 0) / safeScores.length : null;

    response.json({
      generatedAt: now.toISOString(),
      org: { id: org.id, name: org.name },
      user: {
        userId: target.id,
        email: target.email,
        status: target.status,
        orgRole: target.orgRole
      },
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      usage: {
        sessions: sessions.length,
        billedSeconds
      },
      scores: {
        sessions: scores.length,
        avgOverallScore,
        recent: scores
          .slice()
          .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
          .slice(0, 20)
          .map((record) => ({
            id: record.id,
            endedAt: record.endedAt,
            segmentId: record.segmentId,
            scenarioId: record.scenarioId,
            overallScore: record.overallScore
          }))
      }
    });
  });
});

app.patch("/mobile/users/:userId/admin/org/users/:targetUserId", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const targetUserId = request.params.targetUserId;
  const body = request.body as { status?: UserStatus };

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin" && actor.orgRole !== "user_admin") {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    if (!body.status || !isUserStatus(body.status)) {
      response.status(400).json({ error: "Valid status is required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const target = getUserById(db, targetUserId);
    if (!target || target.accountType !== "enterprise" || target.orgId !== org.id) {
      response.status(404).json({ error: "Target user not found in organization." });
      return;
    }

    if (target.id === actor.id) {
      response.status(403).json({ error: "You cannot lock or unlock your own account." });
      return;
    }

    if (actor.orgRole === "user_admin" && target.orgRole === "org_admin") {
      response.status(403).json({ error: "User admins cannot modify org admins." });
      return;
    }

    target.status = body.status;
    target.updatedAt = nowIso();
    emitMobileUpdateForUser(db, target.id, "user");
    response.json({
      userId: target.id,
      email: target.email,
      status: target.status
    });
  });
});

app.get("/mobile/users/:userId/admin/org/analytics", async (request: Request, response: Response) => {
  const authToken = getIncomingMobileToken(request);
  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  const actorUserId = request.params.userId;
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabase(async (db) => {
    const actor = getUserById(db, actorUserId);
    if (!actor) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, actor.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    if (actor.accountType !== "enterprise" || !actor.orgId) {
      response.status(403).json({ error: "Enterprise admin access is not available for this account." });
      return;
    }

    if (actor.orgRole !== "org_admin") {
      response.status(403).json({ error: "Org admin access required." });
      return;
    }

    const org = getOrgById(db, actor.orgId);
    if (!org || org.status !== "active") {
      response.status(404).json({ error: "Organization not found." });
      return;
    }

    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const records = (db.scoreRecords ?? []).filter((record) => {
      if (record.orgId !== org.id) {
        return false;
      }
      const endedAtMs = new Date(record.endedAt).getTime();
      if (Number.isNaN(endedAtMs)) {
        return false;
      }
      return endedAtMs >= periodStartMs && endedAtMs < periodEndMs;
    });

    const safeScores = records.map((record) => Math.max(0, Math.min(100, record.overallScore)));
    const orgAvgOverallScore = safeScores.length > 0 ? safeScores.reduce((a, b) => a + b, 0) / safeScores.length : null;

    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const bySegment = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of records) {
      const current = bySegment.get(record.segmentId) ?? { sessions: 0, totalScore: 0 };
      bySegment.set(record.segmentId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const byUser = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of records) {
      const current = byUser.get(record.userId) ?? { sessions: 0, totalScore: 0 };
      byUser.set(record.userId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const userById = new Map(db.users.map((user) => [user.id, user]));
    const topUsers = Array.from(byUser.entries())
      .map(([userId, row]) => ({
        userId,
        email: userById.get(userId)?.email ?? userId,
        sessions: row.sessions,
        avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
      }))
      .sort((a, b) => (b.avgOverallScore ?? 0) - (a.avgOverallScore ?? 0))
      .slice(0, 5);

    const toDayKeyUtc = (iso: string): string | null => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString().slice(0, 10);
    };

    const trend = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of records) {
      const dayKey = toDayKeyUtc(record.endedAt);
      if (!dayKey) {
        continue;
      }
      const current = trend.get(dayKey) ?? { sessions: 0, totalScore: 0 };
      trend.set(dayKey, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    response.json({
      generatedAt: now.toISOString(),
      org: { id: org.id, name: org.name },
      period: { startAt: periodStartAt, endAt: periodEndAt, days },
      orgAvgOverallScore,
      topUsers,
      bySegment: Array.from(bySegment.entries())
        .map(([segmentId, row]) => ({
          segmentId,
          segmentLabel: segmentLabelById.get(segmentId) ?? segmentId,
          sessions: row.sessions,
          avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
        }))
        .sort((a, b) => b.sessions - a.sessions),
      trendByDay: Array.from(trend.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dayKey, row]) => ({
          dayKey,
          sessions: row.sessions,
          avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
        }))
    });
  });
});

app.post("/usage/sessions", async (request: Request, response: Response) => {
  const body = request.body as RecordUsageSessionRequest;
  const authToken = getIncomingMobileToken(request);

  if (!authToken) {
    response.status(401).json({ error: "Missing mobile token." });
    return;
  }

  if (!body.userId || !body.segmentId || !body.scenarioId) {
    response.status(400).json({ error: "userId, segmentId, and scenarioId are required." });
    return;
  }

  await withDatabase(async (db) => {
    const user = getUserById(db, body.userId);
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    if (!hasValidMobileTokenForUser(db, user.id, authToken)) {
      response.status(401).json({ error: "Invalid mobile token." });
      return;
    }

    const segment = db.config.segments.find(
      (entry) => entry.id === body.segmentId && entry.enabled
    );
    if (!segment) {
      response.status(400).json({ error: "Invalid segment for usage session." });
      return;
    }

    const scenario = segment.scenarios.find(
      (entry) => entry.id === body.scenarioId && entry.enabled !== false
    );
    if (!scenario) {
      response.status(400).json({ error: "Invalid scenario for usage session." });
      return;
    }

    const now = new Date();
    const parsedStart = parseIsoDateOrNull(body.startedAt);
    const parsedEnd = parseIsoDateOrNull(body.endedAt);
    if ((body.startedAt && !parsedStart) || (body.endedAt && !parsedEnd)) {
      response.status(400).json({ error: "startedAt and endedAt must be valid ISO timestamps." });
      return;
    }

    const sessionStart = parsedStart ?? now;
    const sessionEnd = parsedEnd ?? now;
    if (sessionEnd.getTime() < sessionStart.getTime()) {
      response.status(400).json({ error: "endedAt must be greater than or equal to startedAt." });
      return;
    }

    const entitlements = computeEntitlements(db, user, now);
    if (!entitlements.canStartSimulation) {
      response.status(403).json({ error: entitlements.lockReason ?? "Simulation unavailable." });
      return;
    }

    const rawDurationSeconds = clampNonNegativeInteger(body.rawDurationSeconds, 0);

    db.usageSessions.push({
      id: `sess_${uuid()}`,
      userId: user.id,
      orgId: user.orgId,
      segmentId: body.segmentId,
      scenarioId: body.scenarioId,
      startedAt: sessionStart.toISOString(),
      endedAt: sessionEnd.toISOString(),
      rawDurationSeconds,
      createdAt: now.toISOString()
    });

    const refreshed = computeEntitlements(db, user, now);
    response.status(201).json({
      recorded: true,
      billedSecondsAdded: Math.max(
        0,
        refreshed.usage.billedSecondsToday - entitlements.usage.billedSecondsToday
      ),
      entitlements: refreshed
    });
  });
});

app.get("/usage", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabase(async (db) => {
    const now = new Date();
    const aiUsageEvents = db.aiUsageEvents ?? [];

    const rows = db.users.map((user) => {
      const entitlements = computeEntitlements(db, user, now);
      const timezone = materializeUserTimezone(user, now);
      const dayKey = getDayKey(now, timezone);
      const monthKey = getMonthKey(now, timezone);
      let tokensUsedToday = 0;
      let tokensUsedThisMonth = 0;

      for (const event of aiUsageEvents) {
        if (event.userId !== user.id) {
          continue;
        }

        const createdAt = parseIsoDateOrNull(event.createdAt);
        if (!createdAt) {
          continue;
        }

        const eventDayKey = getDayKey(createdAt, timezone);
        const eventMonthKey = getMonthKey(createdAt, timezone);
        if (eventDayKey === dayKey) {
          tokensUsedToday += Math.max(0, clampNonNegativeInteger(event.totalTokens, 0));
        }
        if (eventMonthKey === monthKey) {
          tokensUsedThisMonth += Math.max(0, clampNonNegativeInteger(event.totalTokens, 0));
        }
      }

      return {
        userId: user.id,
        email: user.email,
        tier: user.tier,
        accountType: user.accountType,
        status: user.status,
        minutesUsedToday: secondsToWholeMinutes(entitlements.usage.billedSecondsToday),
        minutesUsedThisMonth: secondsToWholeMinutes(entitlements.usage.billedSecondsThisMonth),
        dailySecondsRemaining: entitlements.usage.dailySecondsRemaining,
        tokensUsedToday,
        tokensUsedThisMonth
      };
    });

    response.json({
      generatedAt: now.toISOString(),
      rows
    });
  });
});

app.get("/support/cases", requireAdmin, async (_request: Request, response: Response) => {
  await withDatabase(async (db) => {
    const now = nowIso();
    const userById = new Map(db.users.map((user) => [user.id, user]));
    const orgById = new Map(db.orgs.map((org) => [org.id, org]));

    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));
    const scenarioTitleById = new Map<string, string>();
    for (const segment of db.config.segments) {
      for (const scenario of segment.scenarios ?? []) {
        scenarioTitleById.set(scenario.id, scenario.title);
      }
    }

    const cases = (db.supportCases ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => {
        const user = userById.get(entry.userId);
        const org = entry.orgId ? orgById.get(entry.orgId) : undefined;
        return {
          id: entry.id,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          org: org ? { id: org.id, name: org.name } : null,
          user: user ? { id: user.id, email: user.email } : { id: entry.userId, email: entry.userId },
          segmentId: entry.segmentId,
          segmentLabel: entry.segmentId ? segmentLabelById.get(entry.segmentId) ?? entry.segmentId : null,
          scenarioId: entry.scenarioId,
          scenarioTitle: entry.scenarioId ? scenarioTitleById.get(entry.scenarioId) ?? entry.scenarioId : null,
          message: entry.message,
          transcript: {
            available: Boolean(entry.transcriptEncrypted),
            expiresAt: entry.transcriptExpiresAt,
            fileName: entry.transcriptFileName
          },
          meta: entry.transcriptMeta
        };
      });

    response.json({ generatedAt: now, cases });
  });
});

app.get("/support/cases/:caseId", requireAdmin, async (request: Request, response: Response) => {
  const caseId = request.params.caseId;
  await withDatabase(async (db) => {
    const entry = (db.supportCases ?? []).find((row) => row.id === caseId);
    if (!entry) {
      response.status(404).json({ error: "Support case not found." });
      return;
    }

    const user = getUserById(db, entry.userId);
    const org = getOrgById(db, entry.orgId);

    const transcriptText = entry.transcriptEncrypted ? decryptSupportTranscript(entry.transcriptEncrypted) : null;

    response.json({
      id: entry.id,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      org: org ? { id: org.id, name: org.name } : null,
      user: user ? { id: user.id, email: user.email } : { id: entry.userId, email: entry.userId },
      message: entry.message,
      transcript: {
        available: Boolean(entry.transcriptEncrypted),
        expiresAt: entry.transcriptExpiresAt,
        fileName: entry.transcriptFileName,
        text: transcriptText
      },
      meta: entry.transcriptMeta
    });
  });
});

app.get("/stats", requireAdmin, async (request: Request, response: Response) => {
  const queryOrgId = typeof request.query.orgId === "string" ? request.query.orgId.trim() : "";
  const querySegmentId = typeof request.query.segmentId === "string" ? request.query.segmentId.trim() : "";
  const days = Math.max(1, Math.min(3650, clampNonNegativeInteger(request.query.days, 30)));

  await withDatabase(async (db) => {
    const now = new Date();
    const periodEndAt = now.toISOString();
    const periodStartAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const periodStartMs = new Date(periodStartAt).getTime();
    const periodEndMs = now.getTime();

    const toDayKeyUtc = (iso: string): string | null => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toISOString().slice(0, 10);
    };

    const orgById = new Map(db.orgs.map((org) => [org.id, org]));
    const userById = new Map(db.users.map((user) => [user.id, user]));
    const segmentLabelById = new Map(db.config.segments.map((segment) => [segment.id, segment.label]));

    const filteredSessions = db.usageSessions.filter((session) => {
      if (!session.orgId) {
        return false;
      }
      if (queryOrgId && session.orgId !== queryOrgId) {
        return false;
      }
      if (querySegmentId && session.segmentId !== querySegmentId) {
        return false;
      }

      const startedAtMs = new Date(session.startedAt).getTime();
      if (Number.isNaN(startedAtMs)) {
        return false;
      }

      return startedAtMs >= periodStartMs && startedAtMs < periodEndMs;
    });

    const filteredScores = (db.scoreRecords ?? []).filter((record) => {
      if (!record.orgId) {
        return false;
      }
      if (queryOrgId && record.orgId !== queryOrgId) {
        return false;
      }
      if (querySegmentId && record.segmentId !== querySegmentId) {
        return false;
      }

      const endedAtMs = new Date(record.endedAt).getTime();
      if (Number.isNaN(endedAtMs)) {
        return false;
      }

      return endedAtMs >= periodStartMs && endedAtMs < periodEndMs;
    });

    const filteredAiEvents = (db.aiUsageEvents ?? []).filter((event) => {
      if (!event.orgId) {
        return false;
      }
      if (queryOrgId && event.orgId !== queryOrgId) {
        return false;
      }
      if (querySegmentId && event.segmentId !== querySegmentId) {
        return false;
      }

      const createdAtMs = new Date(event.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) {
        return false;
      }

      return createdAtMs >= periodStartMs && createdAtMs < periodEndMs;
    });

    const totalBilledSeconds = filteredSessions.reduce(
      (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
      0
    );
    const totalAiTokens = filteredAiEvents.reduce(
      (total, event) => total + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0)),
      0
    );
    const totalAvgScore =
      filteredScores.length > 0
        ? filteredScores.reduce((total, record) => total + Math.max(0, Math.min(100, record.overallScore)), 0) /
          filteredScores.length
        : null;

    const sessionsByOrgId = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
      if (!session.orgId) {
        continue;
      }
      const current = sessionsByOrgId.get(session.orgId) ?? { sessions: 0, billedSeconds: 0 };
      sessionsByOrgId.set(session.orgId, {
        sessions: current.sessions + 1,
        billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
      });
    }

    const scoresByOrgId = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      if (!record.orgId) {
        continue;
      }
      const current = scoresByOrgId.get(record.orgId) ?? { sessions: 0, totalScore: 0 };
      scoresByOrgId.set(record.orgId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const aiByOrgId = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      if (!event.orgId) {
        continue;
      }
      const current = aiByOrgId.get(event.orgId) ?? { calls: 0, totalTokens: 0 };
      aiByOrgId.set(event.orgId, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const byOrg = Array.from(new Set([...sessionsByOrgId.keys(), ...scoresByOrgId.keys(), ...aiByOrgId.keys()]))
      .map((orgId) => {
        const org = orgById.get(orgId);
        const usage = sessionsByOrgId.get(orgId) ?? { sessions: 0, billedSeconds: 0 };
        const scores = scoresByOrgId.get(orgId) ?? { sessions: 0, totalScore: 0 };
        const ai = aiByOrgId.get(orgId) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          orgId,
          orgName: org?.name ?? orgId,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      })
      .sort((a, b) => b.billedSeconds - a.billedSeconds);

    const sessionsBySegmentId = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
      const segmentId = session.segmentId;
      const current = sessionsBySegmentId.get(segmentId) ?? { sessions: 0, billedSeconds: 0 };
      sessionsBySegmentId.set(segmentId, {
        sessions: current.sessions + 1,
        billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
      });
    }

    const scoresBySegmentId = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const segmentId = record.segmentId;
      const current = scoresBySegmentId.get(segmentId) ?? { sessions: 0, totalScore: 0 };
      scoresBySegmentId.set(segmentId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const aiBySegmentId = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      if (!event.segmentId) {
        continue;
      }
      const current = aiBySegmentId.get(event.segmentId) ?? { calls: 0, totalTokens: 0 };
      aiBySegmentId.set(event.segmentId, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const bySegment = Array.from(new Set([...sessionsBySegmentId.keys(), ...scoresBySegmentId.keys(), ...aiBySegmentId.keys()]))
      .map((segmentId) => {
        const usage = sessionsBySegmentId.get(segmentId) ?? { sessions: 0, billedSeconds: 0 };
        const scores = scoresBySegmentId.get(segmentId) ?? { sessions: 0, totalScore: 0 };
        const ai = aiBySegmentId.get(segmentId) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          segmentId,
          segmentLabel: segmentLabelById.get(segmentId) ?? segmentId,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      })
      .sort((a, b) => b.billedSeconds - a.billedSeconds);

    const trendUsageByDay = new Map<string, { sessions: number; billedSeconds: number }>();
    for (const session of filteredSessions) {
      const dayKey = toDayKeyUtc(session.startedAt);
      if (!dayKey) {
        continue;
      }
      const current = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
      trendUsageByDay.set(dayKey, {
        sessions: current.sessions + 1,
        billedSeconds: current.billedSeconds + calculateBilledSecondsFromRaw(session.rawDurationSeconds)
      });
    }

    const trendScoresByDay = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const dayKey = toDayKeyUtc(record.endedAt);
      if (!dayKey) {
        continue;
      }
      const current = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
      trendScoresByDay.set(dayKey, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const trendAiByDay = new Map<string, { calls: number; totalTokens: number }>();
    for (const event of filteredAiEvents) {
      const dayKey = toDayKeyUtc(event.createdAt);
      if (!dayKey) {
        continue;
      }
      const current = trendAiByDay.get(dayKey) ?? { calls: 0, totalTokens: 0 };
      trendAiByDay.set(dayKey, {
        calls: current.calls + 1,
        totalTokens: current.totalTokens + Math.max(0, clampNonNegativeInteger(event.totalTokens, 0))
      });
    }

    const trendByDay = Array.from(new Set([...trendUsageByDay.keys(), ...trendScoresByDay.keys(), ...trendAiByDay.keys()]))
      .sort()
      .map((dayKey) => {
        const usage = trendUsageByDay.get(dayKey) ?? { sessions: 0, billedSeconds: 0 };
        const scores = trendScoresByDay.get(dayKey) ?? { sessions: 0, totalScore: 0 };
        const ai = trendAiByDay.get(dayKey) ?? { calls: 0, totalTokens: 0 };
        const avgOverallScore = scores.sessions > 0 ? scores.totalScore / scores.sessions : null;
        return {
          dayKey,
          sessions: usage.sessions,
          billedSeconds: usage.billedSeconds,
          aiCalls: ai.calls,
          aiTokens: ai.totalTokens,
          avgOverallScore
        };
      });

    const scoresByUserId = new Map<string, { sessions: number; totalScore: number }>();
    for (const record of filteredScores) {
      const current = scoresByUserId.get(record.userId) ?? { sessions: 0, totalScore: 0 };
      scoresByUserId.set(record.userId, {
        sessions: current.sessions + 1,
        totalScore: current.totalScore + Math.max(0, Math.min(100, record.overallScore))
      });
    }

    const topUsers = Array.from(scoresByUserId.entries())
      .map(([userId, scores]) => {
        const user = userById.get(userId);
        const org = user?.orgId ? orgById.get(user.orgId) : null;
        return {
          userId,
          email: user?.email ?? userId,
          orgId: user?.orgId ?? null,
          orgName: org?.name ?? null,
          sessions: scores.sessions,
          avgOverallScore: scores.sessions > 0 ? scores.totalScore / scores.sessions : null
        };
      })
      .sort((a, b) => (b.avgOverallScore ?? 0) - (a.avgOverallScore ?? 0))
      .slice(0, 10);

    response.json({
      generatedAt: now.toISOString(),
      period: {
        startAt: periodStartAt,
        endAt: periodEndAt,
        days
      },
      filters: {
        orgId: queryOrgId || null,
        segmentId: querySegmentId || null
      },
      totals: {
        sessions: filteredSessions.length,
        billedSeconds: totalBilledSeconds,
        aiCalls: filteredAiEvents.length,
        aiTokens: totalAiTokens,
        avgOverallScore: totalAvgScore
      },
      byOrg,
      bySegment,
      trendByDay,
      topUsers
    });
  });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown API error.";
  response.status(500).json({ error: message });
});

void (async () => {
  await loadDatabase();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`VoicePractice API running on http://localhost:${PORT}`);
  });
})();
