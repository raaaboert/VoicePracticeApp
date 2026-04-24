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
  StartSimulationSessionRequest,
  StartSimulationSessionResponse,
  SuperUserOrgOptionsResponse,
  UserEntitlementsResponse,
  UserProfile,
} from "@voicepractice/shared";
import { NativeModules, Platform } from "react-native";
import { DialogueMessage, SimulationEvaluationResult } from "../types";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TURN_HISTORY_MESSAGES = 24;
const MAX_TURN_HISTORY_MESSAGE_CHARS = 2_500;
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
let activeSuperUserOrgId: string | null = null;

export function setActiveSuperUserOrgId(orgId: string | null): void {
  const trimmed = typeof orgId === "string" ? orgId.trim() : "";
  activeSuperUserOrgId = trimmed ? trimmed : null;
}

export type RemoteTtsPreset =
  | "male-balanced"
  | "male-warm"
  | "male-bright"
  | "female-balanced"
  | "female-warm"
  | "female-bright";

export interface PrefetchedRemoteSpeechChunk {
  bytes: Uint8Array;
  contentType: string;
  preset?: RemoteTtsPreset | null;
  chunkCount?: number | null;
  firstChunkChars?: number | null;
  ttsLatencyMs?: number | null;
}

interface TimezoneResponse {
  items: string[];
}

interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX_BY_CHAR = Object.fromEntries(
  [...BASE64_ALPHABET].map((character, index) => [character, index]),
) as Record<string, number>;

function decodeBase64ToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!normalized) {
    return new Uint8Array(0);
  }

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const outputLength = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let index = 0; index < normalized.length; index += 4) {
    const chunk = normalized.slice(index, index + 4);
    const a = BASE64_INDEX_BY_CHAR[chunk[0] ?? ""] ?? 0;
    const b = BASE64_INDEX_BY_CHAR[chunk[1] ?? ""] ?? 0;
    const c = chunk[2] === "=" ? 0 : BASE64_INDEX_BY_CHAR[chunk[2] ?? ""] ?? 0;
    const d = chunk[3] === "=" ? 0 : BASE64_INDEX_BY_CHAR[chunk[3] ?? ""] ?? 0;
    const value24 = (a << 18) | (b << 12) | (c << 6) | d;

    if (outputIndex < outputLength) {
      output[outputIndex] = (value24 >> 16) & 0xff;
      outputIndex += 1;
    }
    if (chunk[2] !== "=" && outputIndex < outputLength) {
      output[outputIndex] = (value24 >> 8) & 0xff;
      outputIndex += 1;
    }
    if (chunk[3] !== "=" && outputIndex < outputLength) {
      output[outputIndex] = value24 & 0xff;
      outputIndex += 1;
    }
  }

  return output;
}

function normalizeTurnHistoryForApi(history: DialogueMessage[]): Array<{ role: DialogueMessage["role"]; content: string }> {
  return history
    .slice(-MAX_TURN_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().replace(/\s+/g, " ").slice(0, MAX_TURN_HISTORY_MESSAGE_CHARS),
    }))
    .filter((message) => message.content.length > 0);
}

function normalizeSpeechPrefetchPayload(value: unknown): PrefetchedRemoteSpeechChunk | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as {
    audioBase64?: unknown;
    contentType?: unknown;
    preset?: unknown;
    chunkCount?: unknown;
    firstChunkChars?: unknown;
    ttsLatencyMs?: unknown;
  };
  const audioBase64 = typeof payload.audioBase64 === "string" ? payload.audioBase64.trim() : "";
  const contentType = typeof payload.contentType === "string" ? payload.contentType.trim() : "";
  const preset = typeof payload.preset === "string" ? payload.preset.trim() : "";
  const chunkCount =
    typeof payload.chunkCount === "number" && Number.isFinite(payload.chunkCount)
      ? Math.max(1, Math.floor(payload.chunkCount))
      : 1;
  const firstChunkChars =
    typeof payload.firstChunkChars === "number" && Number.isFinite(payload.firstChunkChars)
      ? Math.max(0, Math.floor(payload.firstChunkChars))
      : 0;
  const ttsLatencyMs =
    typeof payload.ttsLatencyMs === "number" && Number.isFinite(payload.ttsLatencyMs)
      ? Math.max(0, Math.floor(payload.ttsLatencyMs))
      : null;

  if (
    !audioBase64 ||
    !contentType ||
    !(
      preset === "male-balanced" ||
      preset === "male-warm" ||
      preset === "male-bright" ||
      preset === "female-balanced" ||
      preset === "female-warm" ||
      preset === "female-bright"
    )
  ) {
    return null;
  }

  return {
    bytes: decodeBase64ToBytes(audioBase64),
    contentType,
    preset: preset as RemoteTtsPreset,
    chunkCount,
    firstChunkChars,
    ttsLatencyMs,
  };
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  authToken?: string,
  options?: RequestOptions,
): Promise<T> {
  const apiBase = API_BASE_URL.trim();
  if (!apiBase) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const forwardAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", forwardAbort);
  let response: Response;

  try {
    const fetchPromise = fetch(`${apiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(activeSuperUserOrgId ? { "X-Superuser-Org-Id": activeSuperUserOrgId } : {}),
        ...(options?.headers ?? {}),
      },
    });

    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
    });

    response = await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
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
  options?: RequestOptions,
): Promise<T> {
  const apiBase = API_BASE_URL.trim();
  if (!apiBase) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const forwardAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", forwardAbort);

  let response: Response;
  try {
    const fetchPromise = fetch(`${apiBase}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(activeSuperUserOrgId ? { "X-Superuser-Org-Id": activeSuperUserOrgId } : {}),
        ...(options?.headers ?? {}),
      },
      body: formData,
    });

    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
    });

    response = await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
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
  options: RequestOptions | undefined,
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

function isPersistedSimulationScoreMissingError(error: unknown): boolean {
  return error instanceof Error && error.message.trim().toLowerCase().includes("score not found for this session");
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
  return requestJson<MobileOnboardResponse>(
    "/mobile/onboard",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    undefined,
    { timeoutMs: 12_000 },
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

export async function fetchSuperUserOrgOptions(
  userId: string,
  authToken: string,
): Promise<SuperUserOrgOptionsResponse> {
  return requestJson<SuperUserOrgOptionsResponse>(
    `/mobile/users/${encodeURIComponent(userId)}/superuser/orgs`,
    undefined,
    authToken,
  );
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
  options?: { correlationId?: string },
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
  }, authToken, options?.correlationId ? { headers: { "X-Correlation-Id": options.correlationId } } : undefined);
}

export async function startSimulationSession(
  userId: string,
  input: StartSimulationSessionRequest,
  authToken: string,
  options?: { correlationId?: string },
): Promise<StartSimulationSessionResponse> {
  return requestJson<StartSimulationSessionResponse>(
    `/mobile/users/${encodeURIComponent(userId)}/simulation-sessions/start`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    authToken,
    options?.correlationId ? { headers: { "X-Correlation-Id": options.correlationId } } : undefined,
  );
}

export async function recordSimulationScore(
  userId: string,
  input: RecordSimulationScoreRequest,
  authToken: string,
): Promise<unknown> {
  // Legacy manual scoring path. Normal mobile scoring should use `fetchAiScore`, and the server
  // now keeps this endpoint behind the internal-debug flag to avoid polluting real score history.
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
  correlationId?: string;
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
    {
      timeoutMs: 30_000,
      ...(params.correlationId ? { headers: { "X-Correlation-Id": params.correlationId } } : {}),
    },
  );
  return payload.text?.trim() ?? "";
}

function normalizeUnifiedTurnRuntime(value: unknown): UnifiedSimulationTurnRuntimeDiagnostics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as {
    path?: unknown;
    transcriptionMs?: unknown;
    cacheStatus?: unknown;
    cacheReason?: unknown;
    contextBuildMs?: unknown;
    trainingPackLookupMs?: unknown;
    modelLatencyMs?: unknown;
    speechPrefetchTtsLatencyMs?: unknown;
    routeElapsedMs?: unknown;
  };
  if (payload.path !== "unified_submit") {
    return null;
  }

  const normalizeOptionalDuration = (candidate: unknown): number | null =>
    typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(0, Math.floor(candidate)) : null;

  return {
    path: "unified_submit",
    transcriptionMs:
      typeof payload.transcriptionMs === "number" && Number.isFinite(payload.transcriptionMs)
        ? Math.max(0, Math.floor(payload.transcriptionMs))
        : 0,
    cacheStatus:
      payload.cacheStatus === "hit" || payload.cacheStatus === "miss" || payload.cacheStatus === "bypass"
        ? payload.cacheStatus
        : "bypass",
    cacheReason: typeof payload.cacheReason === "string" && payload.cacheReason.trim() ? payload.cacheReason.trim() : null,
    contextBuildMs: normalizeOptionalDuration(payload.contextBuildMs),
    trainingPackLookupMs: normalizeOptionalDuration(payload.trainingPackLookupMs),
    modelLatencyMs: normalizeOptionalDuration(payload.modelLatencyMs),
    speechPrefetchTtsLatencyMs: normalizeOptionalDuration(payload.speechPrefetchTtsLatencyMs),
    routeElapsedMs: normalizeOptionalDuration(payload.routeElapsedMs),
  };
}

interface AiUsagePayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UnifiedSimulationTurnRuntimeDiagnostics {
  path: "unified_submit";
  transcriptionMs: number;
  cacheStatus: "hit" | "miss" | "bypass";
  cacheReason?: string | null;
  contextBuildMs?: number | null;
  trainingPackLookupMs?: number | null;
  modelLatencyMs?: number | null;
  speechPrefetchTtsLatencyMs?: number | null;
  routeElapsedMs?: number | null;
}

export type UnifiedSimulationTurnPayload =
  | {
      outcome: "assistant_reply";
      transcriptText: string;
      assistantText: string;
      model: string;
      promptVersion: string;
      usage: AiUsagePayload;
      speechPrefetch: PrefetchedRemoteSpeechChunk | null;
      runtime: UnifiedSimulationTurnRuntimeDiagnostics | null;
    }
  | {
      outcome: "no_clear_speech";
      transcriptText: string;
      noClearSpeechReason: "empty_transcript" | "assistant_echo" | null;
      runtime: UnifiedSimulationTurnRuntimeDiagnostics | null;
    }
  | {
      outcome: "transcript_ready";
      transcriptText: string;
      runtime: UnifiedSimulationTurnRuntimeDiagnostics | null;
    };

export type AwaitedSimulationTurnPayload =
  | {
      outcome: "assistant_reply";
      transcriptText: string;
      assistantText: string;
      model: string;
      promptVersion: string;
      usage: AiUsagePayload;
      speechPrefetch: PrefetchedRemoteSpeechChunk | null;
      runtime: UnifiedSimulationTurnRuntimeDiagnostics | null;
    }
  | {
      outcome: "no_clear_speech";
      transcriptText: string;
      noClearSpeechReason: "empty_transcript" | "assistant_echo" | null;
      runtime: UnifiedSimulationTurnRuntimeDiagnostics | null;
    };

export async function submitSimulationTurnViaApi(params: {
  userId: string;
  authToken: string;
  audioUri: string;
  mimeType: string;
  simulationSessionId: string;
  scenarioId: string;
  trainingId?: string;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
  trainingPackId?: string;
  speechPrefetch?: { preset: RemoteTtsPreset } | null;
  responseMode?: "complete" | "transcript_first_v1";
  correlationId?: string;
}): Promise<UnifiedSimulationTurnPayload> {
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

  formData.append(
    "payload",
    JSON.stringify({
      scenarioId: params.scenarioId,
      simulationSessionId: params.simulationSessionId,
      ...(params.trainingId ? { trainingId: params.trainingId } : {}),
      ...(params.industryId ? { industryId: params.industryId } : {}),
      difficulty: params.difficulty,
      personaStyle: params.personaStyle,
      ...(params.trainingPackId ? { trainingPackId: params.trainingPackId } : {}),
      ...(params.speechPrefetch ? { speechPrefetch: { preset: params.speechPrefetch.preset } } : {}),
      ...(params.responseMode === "transcript_first_v1" ? { responseMode: "transcript_first_v1" } : {}),
      history: normalizeTurnHistoryForApi(params.history),
    }),
  );

  const payload = await requestFormData<{
    outcome?: unknown;
    transcriptText?: unknown;
    noClearSpeechReason?: unknown;
    assistantText?: unknown;
    model?: unknown;
    promptVersion?: unknown;
    usage?: unknown;
    speechPrefetch?: unknown;
    runtime?: unknown;
  }>(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/submit-turn`,
    formData,
    params.authToken,
    {
      timeoutMs: 75_000,
      ...(params.correlationId ? { headers: { "X-Correlation-Id": params.correlationId } } : {}),
    },
  );

  const runtime = normalizeUnifiedTurnRuntime(payload.runtime);
  const transcriptText = typeof payload.transcriptText === "string" ? payload.transcriptText.trim() : "";
  if (payload.outcome === "assistant_reply") {
    const usagePayload = payload.usage as {
      inputTokens?: unknown;
      outputTokens?: unknown;
      totalTokens?: unknown;
    } | null;

    return {
      outcome: "assistant_reply",
      transcriptText,
      assistantText: typeof payload.assistantText === "string" ? payload.assistantText.trim() : "",
      model: typeof payload.model === "string" ? payload.model.trim() : "",
      promptVersion: typeof payload.promptVersion === "string" ? payload.promptVersion.trim() : "",
      usage: {
        inputTokens:
          typeof usagePayload?.inputTokens === "number" && Number.isFinite(usagePayload.inputTokens)
            ? Math.max(0, Math.floor(usagePayload.inputTokens))
            : 0,
        outputTokens:
          typeof usagePayload?.outputTokens === "number" && Number.isFinite(usagePayload.outputTokens)
            ? Math.max(0, Math.floor(usagePayload.outputTokens))
            : 0,
        totalTokens:
          typeof usagePayload?.totalTokens === "number" && Number.isFinite(usagePayload.totalTokens)
            ? Math.max(0, Math.floor(usagePayload.totalTokens))
            : 0,
      },
      speechPrefetch: normalizeSpeechPrefetchPayload(payload.speechPrefetch),
      runtime,
    };
  }

  if (payload.outcome === "transcript_ready") {
    return {
      outcome: "transcript_ready",
      transcriptText,
      runtime,
    };
  }

  return {
    outcome: "no_clear_speech",
    transcriptText,
    noClearSpeechReason:
      payload.noClearSpeechReason === "empty_transcript" || payload.noClearSpeechReason === "assistant_echo"
        ? payload.noClearSpeechReason
        : null,
    runtime,
  };
}

export async function awaitSimulationTurnResultViaApi(params: {
  userId: string;
  authToken: string;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<AwaitedSimulationTurnPayload> {
  const payload = await requestJson<{
    outcome?: unknown;
    transcriptText?: unknown;
    noClearSpeechReason?: unknown;
    assistantText?: unknown;
    model?: unknown;
    promptVersion?: unknown;
    usage?: unknown;
    speechPrefetch?: unknown;
    runtime?: unknown;
  }>(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/submit-turn-await/${encodeURIComponent(params.correlationId)}`,
    {
      method: "GET",
    },
    params.authToken,
    {
      timeoutMs: 75_000,
      signal: params.signal,
      ...(params.correlationId ? { headers: { "X-Correlation-Id": params.correlationId } } : {}),
    },
  );

  const runtime = normalizeUnifiedTurnRuntime(payload.runtime);
  const transcriptText = typeof payload.transcriptText === "string" ? payload.transcriptText.trim() : "";
  if (payload.outcome === "assistant_reply") {
    const usagePayload = payload.usage as {
      inputTokens?: unknown;
      outputTokens?: unknown;
      totalTokens?: unknown;
    } | null;

    return {
      outcome: "assistant_reply",
      transcriptText,
      assistantText: typeof payload.assistantText === "string" ? payload.assistantText.trim() : "",
      model: typeof payload.model === "string" ? payload.model.trim() : "",
      promptVersion: typeof payload.promptVersion === "string" ? payload.promptVersion.trim() : "",
      usage: {
        inputTokens:
          typeof usagePayload?.inputTokens === "number" && Number.isFinite(usagePayload.inputTokens)
            ? Math.max(0, Math.floor(usagePayload.inputTokens))
            : 0,
        outputTokens:
          typeof usagePayload?.outputTokens === "number" && Number.isFinite(usagePayload.outputTokens)
            ? Math.max(0, Math.floor(usagePayload.outputTokens))
            : 0,
        totalTokens:
          typeof usagePayload?.totalTokens === "number" && Number.isFinite(usagePayload.totalTokens)
            ? Math.max(0, Math.floor(usagePayload.totalTokens))
            : 0,
      },
      speechPrefetch: normalizeSpeechPrefetchPayload(payload.speechPrefetch),
      runtime,
    };
  }

  return {
    outcome: "no_clear_speech",
    transcriptText,
    noClearSpeechReason:
      payload.noClearSpeechReason === "empty_transcript" || payload.noClearSpeechReason === "assistant_echo"
        ? payload.noClearSpeechReason
        : null,
    runtime,
  };
}

export async function fetchAiOpeningLine(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenarioId: string;
  trainingId?: string;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  speechPrefetch?: { preset: RemoteTtsPreset } | null;
  correlationId?: string;
}): Promise<{
  assistantText: string;
  model: string;
  promptVersion: string;
  usage: AiUsagePayload;
  trainingPack: { applied: boolean; id?: string; title?: string };
  speechPrefetch: PrefetchedRemoteSpeechChunk | null;
}> {
  const payload = await requestJson<{
    assistantText: string;
    model: string;
    promptVersion: string;
    usage: AiUsagePayload;
    trainingPack: { applied: boolean; id?: string; title?: string };
    speechPrefetch?: unknown;
  }>(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/opening`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        simulationSessionId: params.simulationSessionId,
        ...(params.trainingId ? { trainingId: params.trainingId } : {}),
        ...(params.industryId ? { industryId: params.industryId } : {}),
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
        ...(params.speechPrefetch ? { speechPrefetch: { preset: params.speechPrefetch.preset } } : {}),
      }),
    },
    params.authToken,
    {
      timeoutMs: 45_000,
      ...(params.correlationId ? { headers: { "X-Correlation-Id": params.correlationId } } : {}),
    },
  );

  return {
    ...payload,
    speechPrefetch: normalizeSpeechPrefetchPayload(payload.speechPrefetch),
  };
}

export async function fetchAiTurn(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenarioId: string;
  trainingId?: string;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
  trainingPackId?: string;
  speechPrefetch?: { preset: RemoteTtsPreset } | null;
  correlationId?: string;
}): Promise<{
  assistantText: string;
  model: string;
  promptVersion: string;
  usage: AiUsagePayload;
  speechPrefetch: PrefetchedRemoteSpeechChunk | null;
}> {
  const payload = await requestJson<{
    assistantText: string;
    model: string;
    promptVersion: string;
    usage: AiUsagePayload;
    speechPrefetch?: unknown;
  }>(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/turn`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        simulationSessionId: params.simulationSessionId,
        ...(params.trainingId ? { trainingId: params.trainingId } : {}),
        ...(params.industryId ? { industryId: params.industryId } : {}),
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
        ...(params.trainingPackId ? { trainingPackId: params.trainingPackId } : {}),
        ...(params.speechPrefetch ? { speechPrefetch: { preset: params.speechPrefetch.preset } } : {}),
        history: normalizeTurnHistoryForApi(params.history),
      }),
    },
    params.authToken,
    {
      timeoutMs: 45_000,
      ...(params.correlationId ? { headers: { "X-Correlation-Id": params.correlationId } } : {}),
    },
  );

  return {
    ...payload,
    speechPrefetch: normalizeSpeechPrefetchPayload(payload.speechPrefetch),
  };
}

export async function fetchAiScore(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenarioId: string;
  trainingId?: string;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  startedAt: string;
  endedAt: string;
  history: DialogueMessage[];
  trainingPackId?: string;
}): Promise<SimulationEvaluationResult> {
  // Scoring writes a server-side record keyed by simulationSessionId. If the response is lost,
  // recover by session id instead of blindly retrying the POST and regenerating the score.
  return requestJson(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/score`,
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: params.scenarioId,
        simulationSessionId: params.simulationSessionId,
        ...(params.trainingId ? { trainingId: params.trainingId } : {}),
        ...(params.industryId ? { industryId: params.industryId } : {}),
        difficulty: params.difficulty,
        personaStyle: params.personaStyle,
        startedAt: params.startedAt,
        endedAt: params.endedAt,
        ...(params.trainingPackId ? { trainingPackId: params.trainingPackId } : {}),
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

export async function fetchPersistedAiScore(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
}): Promise<SimulationEvaluationResult> {
  const query = new URLSearchParams({
    simulationSessionId: params.simulationSessionId,
  });

  return requestJson(
    `/mobile/users/${encodeURIComponent(params.userId)}/ai/score?${query.toString()}`,
    undefined,
    params.authToken,
    { timeoutMs: 15_000 },
  );
}

export async function recoverPersistedAiScore(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
}): Promise<SimulationEvaluationResult | null> {
  const attempts = 5;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchPersistedAiScore(params);
    } catch (error) {
      const shouldRetry =
        attempt < attempts
        && (isTransientRequestError(error) || isPersistedSimulationScoreMissingError(error));

      if (!shouldRetry) {
        return null;
      }

      await sleep(600 * attempt);
    }
  }

  return null;
}

export async function fetchAiTtsAudio(params: {
  userId: string;
  authToken: string;
  text: string;
  preset: RemoteTtsPreset;
  signal?: AbortSignal;
  correlationId?: string;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const apiBase = API_BASE_URL.trim();
  if (!apiBase) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL for this build.");
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  params.signal?.addEventListener("abort", forwardAbort);
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);

  try {
    const response = await fetch(`${apiBase}/mobile/users/${encodeURIComponent(params.userId)}/ai/tts`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.authToken}`,
        ...(activeSuperUserOrgId ? { "X-Superuser-Org-Id": activeSuperUserOrgId } : {}),
        ...(params.correlationId ? { "X-Correlation-Id": params.correlationId } : {}),
      },
      body: JSON.stringify({
        text: params.text,
        preset: params.preset,
      }),
    });

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

    const arrayBuffer = await response.arrayBuffer();
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";

    return {
      bytes: new Uint8Array(arrayBuffer),
      contentType,
    };
  } catch (error) {
    if (timedOut) {
      throw new Error("Request timed out after 30 seconds.");
    }
    if (error instanceof Error && error.name === "AbortError") {
      if (params.signal?.aborted) {
        throw new Error("Request aborted.");
      }
      throw new Error("Request timed out after 30 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    params.signal?.removeEventListener("abort", forwardAbort);
  }
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

export async function createPublicSupportErrorCase(params: {
  message: string;
  context?: string;
  screen?: string;
  platform?: string;
  appVersion?: string;
  details?: Record<string, unknown>;
}): Promise<{ caseId: string }> {
  return requestJsonWithRetry(
    "/mobile/public/support/errors",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
    undefined,
    { timeoutMs: 30_000 },
    { attempts: 2, initialDelayMs: 600 },
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
  totals: {
    sessions: number;
    conclusiveSessions: number;
    outcomeAwareSessions: number;
    successfulSessions: number;
    avgOverallScore: number | null;
  };
  byDay: Array<{ dayKey: string; sessions: number; avgOverallScore: number | null }>;
  bySegment: Array<{ segmentId: string; segmentLabel: string; sessions: number; avgOverallScore: number | null }>;
  byIndustry: Array<{ industryId: string; industryLabel: string; sessions: number; avgOverallScore: number | null }>;
  recent: Array<{
    id: string;
    endedAt: string;
    segmentId: string;
    scenarioId: string;
    industryId: string | null;
    overallScore: number;
  }>;
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
    pendingPerUserDailySecondsCap: number | null;
    pendingPerUserDailySecondsCapEffectiveAt: string | null;
    manualBonusSeconds: number;
    monthlyMinutesAllotted: number;
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
    monthlyAllottedSeconds: number;
    billedSecondsThisPeriod: number;
    remainingSecondsThisPeriod: number;
    usagePercentThisPeriod: number;
    perUserDailyCapSeconds: number;
    activeUserCount: number;
    projectedAllocatedUserSecondsThisPeriod: number;
    projectedAllocatedUtilizationPercent: number;
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
  patch: {
    maxSimulationMinutes?: number;
    monthlyMinutesAllotted?: number;
    perUserDailySecondsCap?: number;
    applyPerUserDailySecondsCapNextCycle?: boolean;
    clearPendingPerUserDailySecondsCap?: boolean;
  },
): Promise<{
  ok: boolean;
  org: {
    id: string;
    maxSimulationMinutes: number;
    monthlyMinutesAllotted: number;
    perUserDailySecondsCap: number;
    pendingPerUserDailySecondsCap: number | null;
    pendingPerUserDailySecondsCapEffectiveAt: string | null;
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
  users: Array<{
    userId: string;
    email: string;
    status: string;
    orgRole: string;
    dailySecondsCapOverride: number | null;
    effectiveDailySecondsCap: number;
    allowDailyOverageThisCycle: boolean;
    dailyOverageExpiresAt: string | null;
  }>;
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
  user: {
    userId: string;
    email: string;
    status: string;
    orgRole: string;
    dailySecondsCapOverride: number | null;
    effectiveDailySecondsCap: number;
    allowDailyOverageThisCycle: boolean;
    dailyOverageExpiresAt: string | null;
  };
  period: { startAt: string; endAt: string; days: number };
  usage: { sessions: number; billedSeconds: number };
  scores: {
    sessions: number;
    avgOverallScore: number | null;
    recent: Array<{
      id: string;
      endedAt: string;
      segmentId: string;
      scenarioId: string;
      industryId: string | null;
      overallScore: number;
    }>;
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

export async function setOrgAdminUserControls(
  userId: string,
  targetUserId: string,
  authToken: string,
  patch: {
    status?: "active" | "disabled";
    allowDailyOverageThisCycle?: boolean;
    dailySecondsCapOverride?: number | null;
  },
): Promise<{
  userId: string;
  email: string;
  status: string;
  allowDailyOverageThisCycle: boolean;
  dailySecondsCapOverride: number | null;
  dailyOverageExpiresAt: string | null;
}> {
  return requestJson(
    `/mobile/users/${encodeURIComponent(userId)}/admin/org/users/${encodeURIComponent(targetUserId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
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
  conclusiveSessions: number;
  outcomeAwareSessions: number;
  successfulSessions: number;
  topUsers: Array<{ userId: string; email: string; sessions: number; avgOverallScore: number | null }>;
  bySegment: Array<{ segmentId: string; segmentLabel: string; sessions: number; avgOverallScore: number | null }>;
  byIndustry: Array<{ industryId: string; industryLabel: string; sessions: number; avgOverallScore: number | null }>;
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
