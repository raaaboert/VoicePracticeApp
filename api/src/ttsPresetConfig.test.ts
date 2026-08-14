import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTtsSpeechRequest,
  parseTtsPreset,
  resolveTtsRequestConfig,
  TTS_PRESETS,
} from "./ttsPresetConfig.js";
import type { TtsPreset } from "./ttsPresetConfig.js";

const MODEL = "gpt-4o-mini-tts";
const expected: Record<TtsPreset, { voice: string; speed: number }> = {
  "male-balanced": { voice: "cedar", speed: 1.03 },
  "male-warm": { voice: "cedar", speed: 0.98 },
  "male-bright": { voice: "cedar", speed: 1.13 },
  "female-balanced": { voice: "marin", speed: 0.98 },
  "female-warm": { voice: "shimmer", speed: 1.03 },
  "female-bright": { voice: "marin", speed: 1.13 },
};

test("all six TTS presets explicitly resolve the tuned provider voice and speed", () => {
  assert.deepEqual([...TTS_PRESETS], Object.keys(expected));

  for (const preset of TTS_PRESETS) {
    const config = resolveTtsRequestConfig(preset, MODEL);
    assert.equal(config.voice, expected[preset].voice, `${preset} voice`);
    assert.equal(config.speed, expected[preset].speed, `${preset} speed`);
    assert.equal(config.model, MODEL);
    assert.equal(config.responseFormat, "mp3");
    assert.equal(config.instructionsIncluded, true);
    assert.ok(config.instructions.length > 0, `${preset} instructions`);
  }
});

test("preset instructions preserve distinct tone and conservative pacing intent", () => {
  const balanced = ["male-balanced", "female-balanced"] as const;
  const warm = ["male-warm", "female-warm"] as const;
  const bright = ["male-bright", "female-bright"] as const;

  for (const preset of balanced) {
    const instructions = resolveTtsRequestConfig(preset, MODEL).instructions;
    assert.match(instructions, /professional/i);
    assert.match(instructions, /natural conversational pace/i);
    assert.match(instructions, /not sound drawn-out/i);
  }
  for (const preset of warm) {
    const instructions = resolveTtsRequestConfig(preset, MODEL).instructions;
    assert.match(instructions, /warm/i);
    assert.match(instructions, /natural conversational pace/i);
    assert.match(instructions, /not sound slow or sleepy/i);
  }
  for (const preset of bright) {
    const instructions = resolveTtsRequestConfig(preset, MODEL).instructions;
    assert.match(instructions, /professional/i);
    assert.match(instructions, /slightly brisk/i);
    assert.match(instructions, /not rushed/i);
  }
  assert.match(resolveTtsRequestConfig("male-bright", MODEL).instructions, /not sound shrill, squeaky/i);
});

test("standalone and prefetch paths share the same provider preset resolution", () => {
  for (const preset of TTS_PRESETS) {
    const standalone = buildTtsSpeechRequest({
      preset,
      model: MODEL,
      text: "Standalone request",
    });
    const prefetch = buildTtsSpeechRequest({
      preset,
      model: MODEL,
      text: "Prefetched first chunk",
      timeoutMs: 12_000,
    });

    assert.deepEqual(prefetch.config, standalone.config);
    assert.equal(standalone.request.voice, prefetch.request.voice);
    assert.equal(standalone.request.speed, prefetch.request.speed);
    assert.equal(standalone.request.instructions, prefetch.request.instructions);
    assert.equal(standalone.request.format, "mp3");
    assert.equal(prefetch.request.format, "mp3");
  }
});

test("unknown and malformed TTS presets are rejected while valid trimmed values remain safe", () => {
  assert.equal(parseTtsPreset("female-bright"), "female-bright");
  assert.equal(parseTtsPreset("  male-warm  "), "male-warm");
  assert.equal(parseTtsPreset("female-fast"), null);
  assert.equal(parseTtsPreset(""), null);
  assert.equal(parseTtsPreset(null), null);
  assert.equal(parseTtsPreset({ preset: "male-balanced" }), null);
});

test("instructions are sent only for the supported speech model", () => {
  const supported = buildTtsSpeechRequest({
    preset: "female-balanced",
    model: MODEL,
    text: "Supported model",
  });
  const unsupported = buildTtsSpeechRequest({
    preset: "female-balanced",
    model: "legacy-speech-model",
    text: "Unsupported model",
  });

  assert.equal(supported.request.instructions, supported.config.instructions);
  assert.equal(unsupported.config.instructionsIncluded, false);
  assert.equal(unsupported.request.instructions, undefined);
});
