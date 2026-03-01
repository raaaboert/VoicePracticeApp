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

export async function requestChatCompletion(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
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
  if (typeof params.maxOutputTokens === "number") {
    body.max_output_tokens = params.maxOutputTokens;
  }

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
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
}): Promise<{ text: string; usage: OpenAiTokenUsage; model: string }> {
  const apiKey = getOpenAiApiKey();
  const modelKey = params.model.trim().toLowerCase();
  const isGpt5Model = modelKey.startsWith("gpt-5");
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  };

  if (!isGpt5Model && typeof params.temperature === "number") {
    body.temperature = params.temperature;
  }
  if (typeof params.maxOutputTokens === "number") {
    body.max_output_tokens = params.maxOutputTokens;
  }

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
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

export async function requestTranscription(params: {
  model: string;
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const apiKey = getOpenAiApiKey();

  const formData = new FormData();
  formData.append("model", params.model);

  const bytes = new Uint8Array(params.audioBuffer);
  const file = new File([bytes], params.fileName, { type: params.mimeType });
  formData.append("file", file);

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
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

export async function requestSpeechSynthesis(params: {
  model: string;
  voice: string;
  text: string;
  format?: SpeechFormat;
}): Promise<{ audioBuffer: Buffer; contentType: string }> {
  const apiKey = getOpenAiApiKey();
  const responseFormat: SpeechFormat = params.format ?? "mp3";
  const body: Record<string, unknown> = {
    model: params.model,
    voice: params.voice,
    input: params.text,
    response_format: responseFormat
  };

  const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS request failed: ${await parseOpenAiError(response)}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const contentTypeHeader = response.headers.get("content-type")?.split(";")[0]?.trim();
  const contentType = contentTypeHeader || (responseFormat === "mp3" ? "audio/mpeg" : "application/octet-stream");

  return {
    audioBuffer,
    contentType
  };
}
