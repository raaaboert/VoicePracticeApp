export type OpenAiCompletionApiFamily = "chat_completions" | "responses";
export type OpenAiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SimulationRoute = "opening" | "turn" | "score";

export interface OpenAiCompletionModelConfig {
  model: string;
  apiFamily: OpenAiCompletionApiFamily;
  reasoningEffort: OpenAiReasoningEffort | null;
}
export interface OpenAiSimulationRouteConfig {
  maxOutputTokens: number;
  reasoningEffort: OpenAiReasoningEffort | null;
}

export interface OpenAiSimulationModelConfig {
  model: string;
  apiFamily: OpenAiCompletionApiFamily;
  routes: Record<SimulationRoute, OpenAiSimulationRouteConfig>;
}

export interface OpenAiModelConfig {
  chat: OpenAiCompletionModelConfig;
  simulation: OpenAiSimulationModelConfig;
  transcription: {
    model: string;
  };
  speech: {
    model: string;
  };
}

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_SPEECH_MODEL = "tts-1";
const DEFAULT_SIMULATION_MAX_OUTPUT_TOKENS: Record<SimulationRoute, number> = {
  opening: 160,
  turn: 220,
  score: 1200,
};

const OPENAI_REASONING_EFFORTS = new Set<OpenAiReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

// Preserve the currently deployed simulation path until Render opts into an explicit API family.
const LEGACY_RESPONSES_SIMULATION_MODELS = new Set(["gpt-5.2-chat-latest"]);

function parseApiFamily(
  envName: string,
  rawValue: string | undefined,
  fallback: OpenAiCompletionApiFamily
): OpenAiCompletionApiFamily {
  const candidate = rawValue?.trim().toLowerCase();
  if (!candidate) {
    return fallback;
  }
  if (candidate === "chat_completions" || candidate === "responses") {
    return candidate;
  }

  throw new Error(`${envName} must be either "chat_completions" or "responses".`);
}

function parseReasoningEffort(envName: string, rawValue: string | undefined): OpenAiReasoningEffort | null {
  const candidate = rawValue?.trim().toLowerCase();
  if (!candidate) {
    return null;
  }
  if (OPENAI_REASONING_EFFORTS.has(candidate as OpenAiReasoningEffort)) {
    return candidate as OpenAiReasoningEffort;
  }

  throw new Error(`${envName} must be one of: none, minimal, low, medium, high, xhigh.`);
}

function parseLegacySimulationMaxOutputTokens(rawValue: string | undefined): number | null {
  const candidate = rawValue?.trim();
  if (!candidate) {
    return null;
  }

  const parsed = Number(candidate);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("OPENAI_SIMULATION_MAX_OUTPUT_TOKENS must be a non-negative integer when provided.");
  }

  return Math.floor(parsed);
}

function parseRouteMaxOutputTokens(envName: string, rawValue: string | undefined): number | null {
  const candidate = rawValue?.trim();
  if (!candidate) {
    return null;
  }

  const parsed = Number(candidate);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer when provided.`);
  }

  return Math.floor(parsed);
}

function resolveSimulationApiFamily(env: NodeJS.ProcessEnv, model: string): OpenAiCompletionApiFamily {
  const legacyFallback = LEGACY_RESPONSES_SIMULATION_MODELS.has(model.trim().toLowerCase())
    ? "responses"
    : "chat_completions";
  return parseApiFamily("OPENAI_SIMULATION_API_FAMILY", env.OPENAI_SIMULATION_API_FAMILY, legacyFallback);
}

function resolveSimulationMaxOutputTokens(params: {
  envName: string;
  routeValue: string | undefined;
  legacyValue: number | null;
  defaultValue: number;
}): number {
  const routeValue = parseRouteMaxOutputTokens(params.envName, params.routeValue);
  if (routeValue !== null) {
    return routeValue;
  }
  if (params.legacyValue !== null && params.legacyValue > 0) {
    return params.legacyValue;
  }
  return params.defaultValue;
}

export function loadOpenAiModelConfig(env: NodeJS.ProcessEnv = process.env): OpenAiModelConfig {
  const chatModel = env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const simulationModel = env.OPENAI_SIMULATION_MODEL?.trim() || chatModel;
  const legacySimulationMaxOutputTokens = parseLegacySimulationMaxOutputTokens(
    env.OPENAI_SIMULATION_MAX_OUTPUT_TOKENS
  );

  return {
    chat: {
      model: chatModel,
      apiFamily: parseApiFamily("OPENAI_CHAT_API_FAMILY", env.OPENAI_CHAT_API_FAMILY, "chat_completions"),
      reasoningEffort: parseReasoningEffort("OPENAI_CHAT_REASONING_EFFORT", env.OPENAI_CHAT_REASONING_EFFORT),
    },
    simulation: {
      model: simulationModel,
      apiFamily: resolveSimulationApiFamily(env, simulationModel),
      routes: {
        opening: {
          maxOutputTokens: resolveSimulationMaxOutputTokens({
            envName: "OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS",
            routeValue: env.OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS,
            legacyValue: legacySimulationMaxOutputTokens,
            defaultValue: DEFAULT_SIMULATION_MAX_OUTPUT_TOKENS.opening,
          }),
          reasoningEffort: parseReasoningEffort(
            "OPENAI_SIMULATION_OPENING_REASONING_EFFORT",
            env.OPENAI_SIMULATION_OPENING_REASONING_EFFORT
          ),
        },
        turn: {
          maxOutputTokens: resolveSimulationMaxOutputTokens({
            envName: "OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS",
            routeValue: env.OPENAI_SIMULATION_TURN_MAX_OUTPUT_TOKENS,
            legacyValue: legacySimulationMaxOutputTokens,
            defaultValue: DEFAULT_SIMULATION_MAX_OUTPUT_TOKENS.turn,
          }),
          reasoningEffort: parseReasoningEffort(
            "OPENAI_SIMULATION_TURN_REASONING_EFFORT",
            env.OPENAI_SIMULATION_TURN_REASONING_EFFORT
          ),
        },
        score: {
          maxOutputTokens: resolveSimulationMaxOutputTokens({
            envName: "OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS",
            routeValue: env.OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS,
            legacyValue: legacySimulationMaxOutputTokens,
            defaultValue: DEFAULT_SIMULATION_MAX_OUTPUT_TOKENS.score,
          }),
          reasoningEffort: parseReasoningEffort(
            "OPENAI_SIMULATION_SCORE_REASONING_EFFORT",
            env.OPENAI_SIMULATION_SCORE_REASONING_EFFORT
          ),
        },
      },
    },
    transcription: {
      model: env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
    },
    speech: {
      model: env.OPENAI_TTS_MODEL?.trim() || DEFAULT_SPEECH_MODEL,
    },
  };
}
