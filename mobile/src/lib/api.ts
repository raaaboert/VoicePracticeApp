import {
  AppConfig,
  Difficulty,
  EnterpriseDomainMatch,
  MobileOnboardRequest,
  MobileOnboardResponse,
  MobileResendVerificationRequest,
  MobileSubmitOrgJoinRequest,
  MobileUpdateSettingsRequest,
  MobileVerifyEmailRequest,
  PersonaStyle,
  RecordUsageSessionRequest,
  RecordSimulationScoreRequest,
  UserEntitlementsResponse,
  UserProfile,
} from "@voicepractice/shared";
import { NativeModules, Platform } from "react-native";
import { DialogueMessage, SimulationScorecard } from "../types";

const REQUEST_TIMEOUT_MS = 10_000;
const TRANSIENT_ERROR_PATTERNS = [
  "request timed out",
  "request failed (429)",
  "request failed (502)",
  "request failed (503)",
  "request failed (504)",
];

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  );
}

function normalizeHostForPlatform(hostname: string): string {
  if (Platform.OS === "android" && isLoopbackHost(hostname)) {
    return "10.0.2.2";
  }

  return hostname;
}

function normalizeExplicitBaseUrl(value: string): string {
  const normalized = normalizeBaseUrl(value);
  try {
    const parsed = new URL(normalized);
    parsed.hostname = normalizeHostForPlatform(parsed.hostname);
    return normalizeBaseUrl(parsed.toString());
  } catch {
    return normalized;
  }
}

function inferApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) {
    return normalizeExplicitBaseUrl(explicit);
  }

  const scriptUrl = NativeModules?.SourceCode?.scriptURL as string | undefined;
  if (scriptUrl) {
    try {
      const parsed = new URL(scriptUrl);
      if (parsed.hostname) {
        const protocol = parsed.protocol === "https:" ? "https:" : "http:";
        const host = normalizeHostForPlatform(parsed.hostname);
        return `${protocol}//${host}:4100`;
      }
    } catch {
      // Falls through to platform defaults.
    }
  }

  if (!__DEV__) {
    return "";
  }

  if (Platform.OS === "android") {
    return "http://10.0.2.2:4100";
  }

  return "http://localhost:4100";
}

const API_BASE_URL = inferApiBaseUrl();

interface TimezoneResponse {
  items: string[];
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  authToken?: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const apiBase = API_BASE_URL.trim();
  if (!apiBase) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", forwardAbort);
  let response: Response;

  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Fall back to status message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function requestFormData<T>(
  path: string,
  formData: FormData,
  authToken: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const apiBase = API_BASE_URL.trim();
  if (!apiBase) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", forwardAbort);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: formData,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Fall back to status message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

function isTransientRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const lower = error.message.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJsonWithRetry<T>(
  path: string,
  init: RequestInit | undefined,
  authToken: string | undefined,
  options: { timeoutMs?: number; signal?: AbortSignal } | undefined,
  retryOptions: { attempts: number; initialDelayMs: number },
): Promise<T> {
  for (let attempt = 1; attempt <= retryOptions.attempts; attempt += 1) {
    try {
      return await requestJson<T>(path, init, authToken, options);
    } catch (error) {
      const shouldRetry = isTransientRequestError(error) && attempt < retryOptions.attempts;
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = retryOptions.initialDelayMs * attempt;
      await sleep(delayMs);
    }
  }

  throw new Error("Request failed after multiple attempts.");
}

export async function fetchAppConfig(): Promise<AppConfig> {
  return requestJsonWithRetry<AppConfig>(
    "/config",
    undefined,
    undefined,
    { timeoutMs: 15_000 },
    { attempts: 3, initialDelayMs: 700 },
  );
}

export async function fetchTimezones(): Promise<string[]> {
  const payload = await requestJson<TimezoneResponse>("/meta/timezones");
  return payload.items;
}

export async function onboardMobileUser(input: MobileOnboardRequest): Promise<MobileOnboardResponse> {
  return requestJsonWithRetry<MobileOnboardResponse>(
    "/mobile/onboard",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    undefined,
    { timeoutMs: 20_000 },
    { attempts: 3, initialDelayMs: 900 },
  );
}

export async function resendMobileVerificationEmail(
  userId: string,
  authToken: string,
): Promise<{ ok: boolean; verificationExpiresAt: string }> {
  const body: MobileResendVerificationRequest = { userId };
  return requestJson("/mobile/onboard/resend-verification", {
    method: "POST",
    body: JSON.stringify(body),
  }, authToken);
}

export async function verifyMobileEmail(
  userId: string,
  code: string,
  authToken: string,
): Promise<{
  user: UserProfile;
  authToken: string;
  verificationRequired: boolean;
  verificationExpiresAt: string | null;
  domainMatch: EnterpriseDomainMatch | null;
}> {
  const body: MobileVerifyEmailRequest = { userId, code };
  return requestJson("/mobile/onboard/verify-email", {
    method: "POST",
    body: JSON.stringify(body),
  }, authToken);
}

export async function fetchMobileUser(userId: string, authToken: string): Promise<UserProfile> {
  return requestJson<UserProfile>(`/mobile/users/${encodeURIComponent(userId)}`, undefined, authToken);
}

export async function fetchMobileConfig(userId: string, authToken: string): Promise<AppConfig> {
  return requestJson<AppConfig>(`/mobile/users/${encodeURIComponent(userId)}/config`, undefined, authToken);
}

export async function updateMobileSettings(
  userId: string,
  patch: MobileUpdateSettingsRequest,
  authToken: string,
): Promise<UserProfile> {
  return requestJson<UserProfile>(`/mobile/users/${encodeURIComponent(userId)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, authToken);
}

export async function fetchEntitlements(userId: string, authToken: string): Promise<UserEntitlementsResponse> {
  return requestJson<UserEntitlementsResponse>(
    `/mobile/users/${encodeURIComponent(userId)}/entitlements`,
    undefined,
    authToken,
  );
}

export async function fetchMyOrgAccessRequests(
  userId: string,
  authToken: string,
): Promise<{
  generatedAt: string;
  requests: Array<{
    id: string;
    status: string;
    email: string;
    emailDomain: string;
    orgId: string;
    orgName: string;
    joinCodeHint: string;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
  }>;
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/org-access-requests`,
    undefined,
    authToken,
  );
}

export async function submitOrgAccessRequest(
  userId: string,
  joinCode: string,
  authToken: string,
): Promise<{
  created: boolean;
  request: {
    id: string;
    status: string;
    orgId: string;
    orgName: string;
    emailDomain: string;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
  };
}> {
  const body: MobileSubmitOrgJoinRequest = { joinCode };
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/org-access-requests`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    authToken,
  );
}

export async function recordUsageSession(
  input: RecordUsageSessionRequest,
  authToken: string,
): Promise<{
  recorded: boolean;
  billedSecondsAdded: number;
  entitlements: UserEntitlementsResponse;
}> {
  return requestJson<{
    recorded: boolean;
    billedSecondsAdded: number;
    entitlements: UserEntitlementsResponse;
  }>("/usage/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  }, authToken);
}

export async function recordSimulationScore(
  userId: string,
  input: RecordSimulationScoreRequest,
  authToken: string,
): Promise<unknown> {
  return requestJson<unknown>(`/mobile/users/${encodeURIComponent(userId)}/scores`, {
    method: "POST",
    body: JSON.stringify(input),
  }, authToken);
}

export async function transcribeAudioViaApi(params: {
  userId: string;
  authToken: string;
  audioUri: string;
  mimeType: string;
}): Promise<string> {
  const formData = new FormData();
  const resolvedMimeType = params.mimeType || (Platform.OS === "web" ? "audio/webm" : "audio/m4a");

  if (Platform.OS === "web") {
    const localResponse = await fetch(params.audioUri);
    const originalBlob = await localResponse.blob();
    const blob =
      originalBlob.type && originalBlob.type.length > 0
        ? originalBlob
        : new Blob([originalBlob], { type: resolvedMimeType });
    formData.append("file", blob, "voice-input.webm");
  } else {
    formData.append(
      "file",
      {
        uri: params.audioUri,
        name: "voice-input.m4a",
        type: resolvedMimeType,
      } as any,
    );
  }

  const payload = await requestFormData<{ text: string }>(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/transcribe`,
    formData,
    params.authToken,
    { timeoutMs: 30_000 },
  );
  return payload.text?.trim() ?? "";
}

interface AiUsagePayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export async function fetchAiOpeningLine(params: {
  userId: string;
  authToken: string;
  scenarioId: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
}): Promise<{ assistantText: string; model: string; promptVersion: string; usage: AiUsagePayload }> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/opening`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
      }),
    },
    params.authToken,
    { timeoutMs: 30_000 },
  );
}

export async function fetchAiTurn(params: {
  userId: string;
  authToken: string;
  scenarioId: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
}): Promise<{ assistantText: string; model: string; promptVersion: string; usage: AiUsagePayload }> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/turn`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
        history: params.history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    },
    params.authToken,
    { timeoutMs: 30_000 },
  );
}

export async function fetchAiScore(params: {
  userId: string;
  authToken: string;
  scenarioId: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  startedAt: string;
  endedAt: string;
  history: DialogueMessage[];
}): Promise<{
  scorecard: SimulationScorecard;
  record: {
    id: string;
    createdAt: string;
    model: string | null;
    promptVersion: string | null;
    rubricVersion: string | null;
    usage: AiUsagePayload;
  };
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/score`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
        startedAt: params.startedAt,
        endedAt: params.endedAt,
        history: params.history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    },
    params.authToken,
    { timeoutMs: 45_000 },
  );
}

export async function createSupportCase(params: {
  userId: string;
  authToken: string;
  message: string;
  includeTranscript: boolean;
  transcript?: { text: string; fileName: string; meta: Record<string, unknown> };
}): Promise<{ caseId: string; transcriptRetainedUntil: string | null }> {
  return requestJsonWithRetry(
    `/mobile/users/${encodeURIComponent(params.userId)}/support/cases`,
    {
      method: "POST",
      body: JSON.stringify({
        message: params.message,
        includeTranscript: params.includeTranscript,
        transcript: params.includeTranscript ? params.transcript : undefined,
      }),
    },
    params.authToken,
    { timeoutMs: 45_000 },
    { attempts: 3, initialDelayMs: 900 },
  );
}

export async function fetchScoreSummary(
  userId: string,
  authToken: string,
  options: { days: number; segmentId?: string },
): Promise<{
  generatedAt: string;
  period: { startAt: string; endAt: string; days: number };
  filters: { segmentId: string | null };
  totals: { sessions: number; avgOverallScore: number | null };
  byDay: Array<{ dayKey: string; sessions: number; avgOverallScore: number | null }>;
  bySegment: Array<{ segmentId: string; segmentLabel: string; sessions: number; avgOverallScore: number | null }>;
  recent: Array<{ id: string; endedAt: string; segmentId: string; scenarioId: string; overallScore: number }>;
}> {
  const params = new URLSearchParams();
  params.set("days", String(options.days));
  if (options.segmentId) {
    params.set("segmentId", options.segmentId);
  }

  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/scores/summary?${params.toString()}`,
    undefined,
    authToken,
  );
}

export async function longPollMobileUpdates(
  userId: string,
  authToken: string,
  options: { cursor: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<{
  cursor: number;
  changed: boolean;
  reason: string | null;
  generatedAt: string;
  user?: UserProfile;
  config?: AppConfig;
  entitlements?: UserEntitlementsResponse;
}> {
  const serverTimeoutMs = Math.max(1_000, Math.min(30_000, Math.floor(options.timeoutMs ?? 25_000)));
  const qs = new URLSearchParams();
  qs.set("cursor", String(Math.max(0, Math.floor(options.cursor ?? 0))));
  qs.set("timeoutMs", String(serverTimeoutMs));

  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/updates?${qs.toString()}`,
    undefined,
    authToken,
    { timeoutMs: serverTimeoutMs + 10_000, signal: options.signal },
  );
}

export async function fetchOrgAdminDashboard(
  userId: string,
  authToken: string,
): Promise<{
  generatedAt: string;
  org: {
    id: string;
    name: string;
    status: string;
    contactName: string;
    contactEmail: string;
    activeIndustries: string[];
    dailySecondsQuota: number;
    perUserDailySecondsCap: number;
    manualBonusSeconds: number;
    maxSimulationMinutes: number;
    createdAt: string;
    updatedAt: string;
  };
  billingPeriod: {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
    daysInPeriod: number;
  };
  usage: {
    dailyQuotaSeconds: number;
    perUserDailyCapSeconds: number;
    billedSecondsThisPeriod: number;
    annualizedAllotmentSeconds: number;
  };
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/dashboard`,
    undefined,
    authToken,
  );
}

export async function updateOrgAdminOrgSettings(
  userId: string,
  authToken: string,
  patch: { maxSimulationMinutes: number },
): Promise<{
  ok: boolean;
  org: {
    id: string;
    maxSimulationMinutes: number;
    updatedAt: string;
  };
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/settings`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    authToken,
  );
}

export async function fetchOrgAdminUsers(
  userId: string,
  authToken: string,
): Promise<{
  generatedAt: string;
  org: { id: string; name: string };
  users: Array<{ userId: string; email: string; status: string; orgRole: string }>;
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/users`,
    undefined,
    authToken,
  );
}

export async function fetchOrgAdminAccessRequests(
  userId: string,
  authToken: string,
): Promise<{
  generatedAt: string;
  org: { id: string; name: string; emailDomain: string | null; joinCode: string };
  requests: Array<{
    id: string;
    status: string;
    userId: string;
    email: string;
    emailDomain: string;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
  }>;
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/access-requests`,
    undefined,
    authToken,
  );
}

export async function decideOrgAdminAccessRequest(
  userId: string,
  requestId: string,
  action: "approve" | "reject",
  authToken: string,
  reason?: string,
): Promise<{
  ok: boolean;
  request: {
    id: string;
    status: string;
    userId: string;
    email: string;
    orgId: string;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
  };
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/access-requests/${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action,
        ...(reason ? { reason } : {}),
      }),
    },
    authToken,
  );
}

export async function fetchOrgAdminUserDetail(
  userId: string,
  targetUserId: string,
  authToken: string,
  options: { days: number },
): Promise<{
  generatedAt: string;
  org: { id: string; name: string };
  user: { userId: string; email: string; status: string; orgRole: string };
  period: { startAt: string; endAt: string; days: number };
  usage: { sessions: number; billedSeconds: number };
  scores: {
    sessions: number;
    avgOverallScore: number | null;
    recent: Array<{ id: string; endedAt: string; segmentId: string; scenarioId: string; overallScore: number }>;
  };
}> {
  const params = new URLSearchParams();
  params.set("days", String(options.days));
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/users/${encodeURIComponent(targetUserId)}?${params.toString()}`,
    undefined,
    authToken,
  );
}

export async function setOrgAdminUserStatus(
  userId: string,
  targetUserId: string,
  authToken: string,
  status: "active" | "disabled",
): Promise<{ userId: string; email: string; status: string }> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/users/${encodeURIComponent(targetUserId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
    authToken,
  );
}

export async function fetchOrgAdminAnalytics(
  userId: string,
  authToken: string,
  options: { days: number },
): Promise<{
  generatedAt: string;
  org: { id: string; name: string };
  period: { startAt: string; endAt: string; days: number };
  orgAvgOverallScore: number | null;
  topUsers: Array<{ userId: string; email: string; sessions: number; avgOverallScore: number | null }>;
  bySegment: Array<{ segmentId: string; segmentLabel: string; sessions: number; avgOverallScore: number | null }>;
  trendByDay: Array<{ dayKey: string; sessions: number; avgOverallScore: number | null }>;
}> {
  const params = new URLSearchParams();
  params.set("days", String(options.days));
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/analytics?${params.toString()}`,
    undefined,
    authToken,
  );
}
