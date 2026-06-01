import assert from "node:assert/strict";
import test from "node:test";

import { loadOpenAiModelConfig } from "./openaiModelConfig.js";

test("uses behavior-preserving OpenAI defaults", () => {
  const config = loadOpenAiModelConfig({});

  assert.deepEqual(config, {
    chat: {
      model: "gpt-4o-mini",
      apiFamily: "chat_completions",
      reasoningEffort: null,
    },
    simulation: {
      model: "gpt-4o-mini",
      apiFamily: "chat_completions",
      routes: {
        opening: {
          maxOutputTokens: 160,
          reasoningEffort: null,
        },
        turn: {
          maxOutputTokens: 220,
          reasoningEffort: null,
        },
        score: {
          maxOutputTokens: 1200,
          reasoningEffort: null,
        },
      },
    },
    transcription: {
      model: "whisper-1",
    },
    speech: {
      model: "tts-1",
    },
  });
});
test("preserves Responses API routing for the currently deployed simulation model", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_CHAT_MODEL: "gpt-4o-mini",
    OPENAI_SIMULATION_MODEL: "gpt-5.2-chat-latest",
  });

  assert.equal(config.chat.apiFamily, "chat_completions");
  assert.equal(config.simulation.apiFamily, "responses");
});

test("applies explicit API families, reasoning efforts, and route-specific simulation caps", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_CHAT_MODEL: "chat-model",
    OPENAI_CHAT_API_FAMILY: "responses",
    OPENAI_CHAT_REASONING_EFFORT: "low",
    OPENAI_SIMULATION_MODEL: "simulation-model",
    OPENAI_SIMULATION_API_FAMILY: "responses",
    OPENAI_SIMULATION_MAX_OUTPUT_TOKENS: "700",
    OPENAI_SIMULATION_OPENING_MAX_OUTPUT_TOKENS: "180",
    OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS: "1300",
    OPENAI_SIMULATION_OPENING_REASONING_EFFORT: "none",
    OPENAI_SIMULATION_TURN_REASONING_EFFORT: "minimal",
    OPENAI_SIMULATION_SCORE_REASONING_EFFORT: "medium",
    OPENAI_TRANSCRIPTION_MODEL: "transcription-model",
    OPENAI_TTS_MODEL: "speech-model",
  });

  assert.deepEqual(config, {
    chat: {
      model: "chat-model",
      apiFamily: "responses",
      reasoningEffort: "low",
    },
    simulation: {
      model: "simulation-model",
      apiFamily: "responses",
      routes: {
        opening: {
          maxOutputTokens: 180,
          reasoningEffort: "none",
        },
        turn: {
          maxOutputTokens: 700,
          reasoningEffort: "minimal",
        },
        score: {
          maxOutputTokens: 1300,
          reasoningEffort: "medium",
        },
      },
    },
    transcription: {
      model: "transcription-model",
    },
    speech: {
      model: "speech-model",
    },
  });
});

test("rejects invalid explicit OpenAI configuration", () => {
  assert.throws(
    () => loadOpenAiModelConfig({ OPENAI_SIMULATION_API_FAMILY: "auto" }),
    /OPENAI_SIMULATION_API_FAMILY must be either "chat_completions" or "responses"/
  );
  assert.throws(
    () => loadOpenAiModelConfig({ OPENAI_SIMULATION_TURN_REASONING_EFFORT: "fast" }),
    /OPENAI_SIMULATION_TURN_REASONING_EFFORT must be one of/
  );
  assert.throws(
    () => loadOpenAiModelConfig({ OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS: "0" }),
    /OPENAI_SIMULATION_SCORE_MAX_OUTPUT_TOKENS must be a positive integer/
  );
});
