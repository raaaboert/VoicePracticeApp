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

interface TranscriptionResponse {
  text?: string;
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

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI responses request failed: ${await parseOpenAiError(response)}`);
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
