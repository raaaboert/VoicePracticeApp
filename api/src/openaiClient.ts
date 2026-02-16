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
  temperature: number;
}): Promise<{ text: string; usage: OpenAiTokenUsage; model: string }> {
  const apiKey = getOpenAiApiKey();

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature
    })
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
