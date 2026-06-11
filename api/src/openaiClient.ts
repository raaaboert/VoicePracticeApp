import type { OpenAiCompletionApiFamily, OpenAiReasoningEffort } from "./openaiModelConfig.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

interface ResponsesCompletionResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
}

interface OpenAiErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string | null;
  };
}

interface TranscriptionResponse {
  text?: string;
}

type SpeechFormat = "mp3" | "wav" | "opus" | "flac" | "aac" | "pcm";
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSCRIPTION_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_SPEECH_REQUEST_TIMEOUT_MS = 12_000;

interface OpenAiRequestLogContext {
  apiPath: string;
  model: string;
  route?: string;
  correlationId?: string;
}

function getOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OpenAI is not configured (missing OPENAI_API_KEY).");
  }

  return key;
}

async function parseOpenAiError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    const message = json.error?.message?.trim();
    if (message) {
      return message;
    }
  } catch {
    // ignore
  }

  return response.statusText || `OpenAI request failed (${response.status})`;
}

function resolveOpenAiRequestTimeoutMs(value: number | undefined, fallbackMs: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  return fallbackMs;
}

function formatTimeoutSeconds(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function logOpenAiRequest(
  stage: "openai_request_start" | "openai_request_end" | "openai_request_timeout" | "openai_request_error",
  context: OpenAiRequestLogContext,
  startedAtMs: number,
  timeoutMs: number,
  extra: Record<string, unknown> = {},
): void {
  const payload = {
    stage,
    correlationId: context.correlationId ?? null,
    route: context.route ?? null,
    model: context.model,
    apiPath: context.apiPath,
    timeoutMs,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    ...extra,
  };

  if (stage === "openai_request_error" || stage === "openai_request_timeout") {
    // eslint-disable-next-line no-console
    console.warn("[openai-request]", payload);
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[openai-request]", payload);
}

async function runOpenAiRequestWithTimeout<T>(params: OpenAiRequestLogContext & {
  fallbackTimeoutMs: number;
  timeoutMs?: number;
  createTimeoutError: (timeoutMs: number) => Error;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const timeoutMs = resolveOpenAiRequestTimeoutMs(params.timeoutMs, params.fallbackTimeoutMs);
  const startedAtMs = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  logOpenAiRequest("openai_request_start", params, startedAtMs, timeoutMs);

  try {
    const result = await params.operation(controller.signal);
    logOpenAiRequest("openai_request_end", params, startedAtMs, timeoutMs);
    return result;
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      const timeoutError = params.createTimeoutError(timeoutMs);
      logOpenAiRequest("openai_request_timeout", params, startedAtMs, timeoutMs, {
        error: timeoutError.message,
      });
      throw timeoutError;
    }

    logOpenAiRequest("openai_request_error", params, startedAtMs, timeoutMs, {
      error: getErrorMessage(error),
    });
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export class OpenAiResponsesRequestError extends Error {
  readonly statusCode?: number;
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;

  constructor(params: {
    statusCode?: number;
    errorType?: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const message =
      typeof params.errorMessage === "string" && params.errorMessage.trim()
        ? `OpenAI responses request failed: ${params.errorMessage.trim()}`
        : `OpenAI responses request failed (${params.statusCode ?? "unknown"})`;
    super(message);
    this.name = "OpenAiResponsesRequestError";
    this.statusCode = params.statusCode;
    this.errorType = params.errorType;
    this.errorCode = params.errorCode;
    this.errorMessage = params.errorMessage;
  }
}

export class OpenAiSpeechRequestError extends Error {
  readonly statusCode?: number;
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;

  constructor(params: {
    statusCode?: number;
    errorType?: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const message =
      typeof params.errorMessage === "string" && params.errorMessage.trim()
        ? `OpenAI TTS request failed: ${params.errorMessage.trim()}`
        : `OpenAI TTS request failed (${params.statusCode ?? "unknown"})`;
    super(message);
    this.name = "OpenAiSpeechRequestError";
    this.statusCode = params.statusCode;
    this.errorType = params.errorType;
    this.errorCode = params.errorCode;
    this.errorMessage = params.errorMessage;
  }
}

function createOpenAiChatTimeoutError(timeoutMs: number): Error {
  const error = new Error(`OpenAI chat request timed out after ${formatTimeoutSeconds(timeoutMs)} seconds.`);
  error.name = "OpenAiChatRequestTimeoutError";
  return error;
}

function createOpenAiTranscriptionTimeoutError(timeoutMs: number): Error {
  const error = new Error(`OpenAI transcription request timed out after ${formatTimeoutSeconds(timeoutMs)} seconds.`);
  error.name = "OpenAiTranscriptionRequestTimeoutError";
  return error;
}

export async function requestChatCompletion(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  timeoutMs?: number;
  route?: string;
  correlationId?: string;
}): Promise<{ text: string; usage: OpenAiTokenUsage; model: string }> {
  const apiKey = getOpenAiApiKey();
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages
  };
  if (typeof params.temperature === "number") {
    body.temperature = params.temperature;
  }
  if (typeof params.topP === "number") {
    body.top_p = params.topP;
  }
  if (typeof params.frequencyPenalty === "number") {
    body.frequency_penalty = params.frequencyPenalty;
  }
  if (typeof params.presencePenalty === "number") {
    body.presence_penalty = params.presencePenalty;
  }
  if (typeof params.maxTokens === "number") {
    body.max_tokens = params.maxTokens;
  }

  return runOpenAiRequestWithTimeout({
    apiPath: "chat_completions",
    model: params.model,
    route: params.route,
    correlationId: params.correlationId,
    timeoutMs: params.timeoutMs,
    fallbackTimeoutMs: DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
    createTimeoutError: createOpenAiChatTimeoutError,
    operation: async (signal) => {
      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`OpenAI chat request failed: ${await parseOpenAiError(response)}`);
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const message = payload.choices?.[0]?.message?.content?.trim();
      if (!message) {
        throw new Error("OpenAI returned an empty chat response.");
      }

      const promptTokens = Number(payload.usage?.prompt_tokens ?? 0);
      const completionTokens = Number(payload.usage?.completion_tokens ?? 0);
      const totalTokens = Number(payload.usage?.total_tokens ?? promptTokens + completionTokens);

      return {
        text: message,
        usage: {
          inputTokens: Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0,
          outputTokens: Number.isFinite(completionTokens) ? Math.max(0, completionTokens) : 0,
          totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0
        },
        model: typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : params.model
      };
    }
  });
}

function extractResponseText(payload: ResponsesCompletionResponse): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  if (chunks.length === 0) {
    return null;
  }

  return chunks.join("\n");
}

export async function requestResponsesCompletion(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: OpenAiReasoningEffort | null;
  timeoutMs?: number;
  route?: string;
  correlationId?: string;
}): Promise<{ text: string; usage: OpenAiTokenUsage; model: string }> {
  const apiKey = getOpenAiApiKey();
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  };

  if (typeof params.temperature === "number") {
    body.temperature = params.temperature;
  }
  if (typeof params.maxOutputTokens === "number") {
    body.max_output_tokens = params.maxOutputTokens;
  }
  if (params.reasoningEffort) {
    body.reasoning = {
      effort: params.reasoningEffort,
    };
  }

  return runOpenAiRequestWithTimeout({
    apiPath: "responses",
    model: params.model,
    route: params.route,
    correlationId: params.correlationId,
    timeoutMs: params.timeoutMs,
    fallbackTimeoutMs: DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
    createTimeoutError: (timeoutMs) =>
      new OpenAiResponsesRequestError({
        errorType: "timeout",
        errorCode: "timeout",
        errorMessage: `OpenAI responses request timed out after ${formatTimeoutSeconds(timeoutMs)} seconds.`
      }),
    operation: async (signal) => {
      const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let errorMessage = response.statusText || "";
        let errorType: string | undefined;
        let errorCode: string | undefined;

        try {
          const payload = (await response.json()) as OpenAiErrorPayload;
          const maybeMessage = payload.error?.message?.trim();
          if (maybeMessage) {
            errorMessage = maybeMessage;
          }
          const maybeType = payload.error?.type?.trim();
          if (maybeType) {
            errorType = maybeType;
          }
          const maybeCode = typeof payload.error?.code === "string" ? payload.error.code.trim() : "";
          if (maybeCode) {
            errorCode = maybeCode;
          }
        } catch {
          // Ignore parsing errors and use status text fallback.
        }

        throw new OpenAiResponsesRequestError({
          statusCode: response.status,
          errorType,
          errorCode,
          errorMessage: errorMessage || `OpenAI request failed (${response.status})`
        });
      }

      const payload = (await response.json()) as ResponsesCompletionResponse;
      const message = extractResponseText(payload);
      if (!message) {
        throw new Error("OpenAI returned an empty responses output.");
      }

      const promptTokens = Number(payload.usage?.input_tokens ?? payload.usage?.prompt_tokens ?? 0);
      const completionTokens = Number(payload.usage?.output_tokens ?? payload.usage?.completion_tokens ?? 0);
      const totalTokens = Number(payload.usage?.total_tokens ?? promptTokens + completionTokens);

      return {
        text: message,
        usage: {
          inputTokens: Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0,
          outputTokens: Number.isFinite(completionTokens) ? Math.max(0, completionTokens) : 0,
          totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0
        },
        model: typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : params.model
      };
    }
  });
}

export async function requestCompletion(params: {
  apiFamily: OpenAiCompletionApiFamily;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: OpenAiReasoningEffort | null;
  timeoutMs?: number;
  route?: string;
  correlationId?: string;
}): Promise<{ text: string; usage: OpenAiTokenUsage; model: string }> {
  if (params.apiFamily === "responses") {
    return requestResponsesCompletion({
      model: params.model,
      messages: params.messages,
      maxOutputTokens: params.maxOutputTokens,
      reasoningEffort: params.reasoningEffort,
      timeoutMs: params.timeoutMs,
      route: params.route,
      correlationId: params.correlationId,
    });
  }

  return requestChatCompletion({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: params.maxOutputTokens,
    timeoutMs: params.timeoutMs,
    route: params.route,
    correlationId: params.correlationId,
  });
}

export async function requestTranscription(params: {
  model: string;
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
  language?: string;
  timeoutMs?: number;
  route?: string;
  correlationId?: string;
}): Promise<string> {
  const apiKey = getOpenAiApiKey();

  const formData = new FormData();
  formData.append("model", params.model);
  if (typeof params.language === "string" && params.language.trim()) {
    formData.append("language", params.language.trim());
  }

  const bytes = new Uint8Array(params.audioBuffer);
  const file = new File([bytes], params.fileName, { type: params.mimeType });
  formData.append("file", file);

  return runOpenAiRequestWithTimeout({
    apiPath: "audio_transcriptions",
    model: params.model,
    route: params.route,
    correlationId: params.correlationId,
    timeoutMs: params.timeoutMs,
    fallbackTimeoutMs: DEFAULT_TRANSCRIPTION_REQUEST_TIMEOUT_MS,
    createTimeoutError: createOpenAiTranscriptionTimeoutError,
    operation: async (signal) => {
      const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`OpenAI transcription failed: ${await parseOpenAiError(response)}`);
      }

      const payload = (await response.json()) as TranscriptionResponse;
      return payload.text?.trim() ?? "";
    }
  });
}

export async function requestSpeechSynthesis(params: {
  model: string;
  voice: string;
  text: string;
  format?: SpeechFormat;
  timeoutMs?: number;
}): Promise<{ audioBuffer: Buffer; contentType: string }> {
  const apiKey = getOpenAiApiKey();
  const responseFormat: SpeechFormat = params.format ?? "mp3";
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
      ? Math.floor(params.timeoutMs)
      : DEFAULT_SPEECH_REQUEST_TIMEOUT_MS;
  const body: Record<string, unknown> = {
    model: params.model,
    voice: params.voice,
    input: params.text,
    response_format: responseFormat
  };

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorMessage = response.statusText || "";
      let errorType: string | undefined;
      let errorCode: string | undefined;

      try {
        const payload = (await response.json()) as OpenAiErrorPayload;
        const maybeMessage = payload.error?.message?.trim();
        if (maybeMessage) {
          errorMessage = maybeMessage;
        }
        const maybeType = payload.error?.type?.trim();
        if (maybeType) {
          errorType = maybeType;
        }
        const maybeCode = typeof payload.error?.code === "string" ? payload.error.code.trim() : "";
        if (maybeCode) {
          errorCode = maybeCode;
        }
      } catch {
        // Ignore parsing errors and use status text fallback.
      }

      throw new OpenAiSpeechRequestError({
        statusCode: response.status,
        errorType,
        errorCode,
        errorMessage: errorMessage || `OpenAI request failed (${response.status})`
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const contentTypeHeader = response.headers.get("content-type")?.split(";")[0]?.trim();
    const contentType = contentTypeHeader || (responseFormat === "mp3" ? "audio/mpeg" : "application/octet-stream");

    return {
      audioBuffer,
      contentType
    };
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      if (timedOut) {
        throw new OpenAiSpeechRequestError({
          errorType: "timeout",
          errorCode: "timeout",
          errorMessage: `OpenAI TTS request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        });
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
