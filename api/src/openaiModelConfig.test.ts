import assert from "node:assert/strict";
import test from "node:test";

import {
  loadOpenAiModelConfig,
  resolveSimulationRequestConfig,
} from "./openaiModelConfig.js";

test("uses the recommended OpenAI defaults", () => {
  const config = loadOpenAiModelConfig({});

  assert.deepEqual(config, {
    chat: {
      model: "gpt-4o-mini",
      apiFamily: "chat_completions",
      reasoningEffort: null,
    },
    simulation: {
      model: "gpt-5.4",
      apiFamily: "responses",
      routes: {
        opening: {
          maxOutputTokens: 160,
          reasoningEffort: "low",
        },
        turn: {
          maxOutputTokens: 220,
          reasoningEffort: "low",
        },
      },
    },
    scoring: {
      model: "gpt-5.4",
      apiFamily: "responses",
      maxOutputTokens: 1200,
      reasoningEffort: "low",
    },
    transcription: {
      model: "whisper-1",
    },
    speech: {
      model: "gpt-4o-mini-tts",
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
  assert.equal(config.simulation.routes.opening.reasoningEffort, null);
  assert.equal(config.simulation.routes.turn.reasoningEffort, null);
  assert.equal(config.scoring.model, "gpt-5.2-chat-latest");
  assert.equal(config.scoring.apiFamily, "responses");
  assert.equal(config.scoring.reasoningEffort, null);
});

test("supports the recommended GPT-5.4 Responses profile with low reasoning", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_CHAT_MODEL: "gpt-4o-mini",
    OPENAI_CHAT_API_FAMILY: "chat_completions",
    OPENAI_SIMULATION_MODEL: "gpt-5.4",
    OPENAI_SIMULATION_API_FAMILY: "responses",
    OPENAI_SIMULATION_OPENING_REASONING_EFFORT: "low",
    OPENAI_SIMULATION_TURN_REASONING_EFFORT: "low",
    OPENAI_SIMULATION_SCORE_REASONING_EFFORT: "low",
  });

  assert.equal(config.chat.model, "gpt-4o-mini");
  assert.equal(config.chat.apiFamily, "chat_completions");
  assert.equal(config.simulation.model, "gpt-5.4");
  assert.equal(config.simulation.apiFamily, "responses");
  assert.equal(config.simulation.routes.opening.reasoningEffort, "low");
  assert.equal(config.simulation.routes.turn.reasoningEffort, "low");
  assert.equal(config.scoring.model, "gpt-5.4");
  assert.equal(config.scoring.apiFamily, "responses");
  assert.equal(config.scoring.reasoningEffort, "low");
  assert.equal(config.transcription.model, "whisper-1");
  assert.equal(config.speech.model, "gpt-4o-mini-tts");
});

test("supports the deployed GPT-5.4 mini chat Responses profile with low reasoning", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_CHAT_MODEL: "gpt-5.4-mini",
    OPENAI_CHAT_API_FAMILY: "responses",
    OPENAI_CHAT_REASONING_EFFORT: "low",
  });

  assert.equal(config.chat.model, "gpt-5.4-mini");
  assert.equal(config.chat.apiFamily, "responses");
  assert.equal(config.chat.reasoningEffort, "low");
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
    OPENAI_SCORING_MODEL: "scoring-model",
    OPENAI_SCORING_API_FAMILY: "chat_completions",
    OPENAI_SCORING_REASONING_EFFORT: "high",
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
      },
    },
    scoring: {
      model: "scoring-model",
      apiFamily: "chat_completions",
      maxOutputTokens: 1300,
      reasoningEffort: "high",
    },
    transcription: {
      model: "transcription-model",
    },
    speech: {
      model: "speech-model",
    },
  });
});

test("routes opening and live turns to Luna while independently routing scoring to Terra", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_SIMULATION_MODEL: "gpt-5.6-luna",
    OPENAI_SIMULATION_API_FAMILY: "responses",
    OPENAI_SIMULATION_REASONING_EFFORT: "low",
    OPENAI_SCORING_MODEL: "gpt-5.6-terra",
    OPENAI_SCORING_API_FAMILY: "responses",
    OPENAI_SCORING_REASONING_EFFORT: "medium",
  });

  const opening = resolveSimulationRequestConfig(config, "opening");
  const turn = resolveSimulationRequestConfig(config, "turn");
  const score = resolveSimulationRequestConfig(config, "score");

  assert.deepEqual(opening, {
    model: "gpt-5.6-luna",
    apiFamily: "responses",
    maxOutputTokens: 160,
    reasoningEffort: "low",
  });
  assert.deepEqual(turn, {
    model: "gpt-5.6-luna",
    apiFamily: "responses",
    maxOutputTokens: 220,
    reasoningEffort: "low",
  });
  assert.deepEqual(score, {
    model: "gpt-5.6-terra",
    apiFamily: "responses",
    maxOutputTokens: 1200,
    reasoningEffort: "medium",
  });
  assert.notEqual(score.model, opening.model);
  assert.notEqual(score.reasoningEffort, turn.reasoningEffort);
});

test("explicit scoring config wins without leaking into opening or live turns", () => {
  const config = loadOpenAiModelConfig({
    OPENAI_SIMULATION_MODEL: "live-model",
    OPENAI_SIMULATION_API_FAMILY: "responses",
    OPENAI_SIMULATION_REASONING_EFFORT: "low",
    OPENAI_SIMULATION_SCORE_REASONING_EFFORT: "high",
    OPENAI_SCORING_MODEL: "score-model",
    OPENAI_SCORING_API_FAMILY: "chat_completions",
    OPENAI_SCORING_REASONING_EFFORT: "medium",
  });

  assert.deepEqual(resolveSimulationRequestConfig(config, "opening"), {
    model: "live-model",
    apiFamily: "responses",
    maxOutputTokens: 160,
    reasoningEffort: "low",
  });
  assert.deepEqual(resolveSimulationRequestConfig(config, "turn"), {
    model: "live-model",
    apiFamily: "responses",
    maxOutputTokens: 220,
    reasoningEffort: "low",
  });
  assert.deepEqual(resolveSimulationRequestConfig(config, "score"), {
    model: "score-model",
    apiFamily: "chat_completions",
    maxOutputTokens: 1200,
    reasoningEffort: "medium",
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
  assert.throws(
    () => loadOpenAiModelConfig({ OPENAI_SCORING_API_FAMILY: "auto" }),
    /OPENAI_SCORING_API_FAMILY must be either "chat_completions" or "responses"/
  );
  assert.throws(
    () => loadOpenAiModelConfig({ OPENAI_SCORING_REASONING_EFFORT: "fast" }),
    /OPENAI_SCORING_REASONING_EFFORT must be one of/
  );
});
