import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteTtsPreset } from "../lib/api";
import {
  AI_VOICE_GENDER_OPTIONS,
  AI_VOICE_OPTIONS,
  selectSpeechVoiceIdentifier,
} from "./preferences";

const femaleVoice = {
  identifier: "en-US-female-1",
  name: "English Female",
  language: "en-US",
};
const maleVoice = {
  identifier: "en-US-male-1",
  name: "English Male",
  language: "en-US",
};

test("male device voice selection does not match female through substring overlap", () => {
  assert.equal(selectSpeechVoiceIdentifier([femaleVoice, maleVoice], "male"), maleVoice.identifier);
});

test("female device voice selection still recognizes boundary-delimited metadata", () => {
  assert.equal(selectSpeechVoiceIdentifier([maleVoice, femaleVoice], "female"), femaleVoice.identifier);
});

test("device voice no-match selection uses the first neutral candidate deterministically", () => {
  const voices = [
    { identifier: "en-US-neutral-primary", name: "Primary", language: "en-US" },
    { identifier: "en-US-neutral-secondary", name: "Secondary", language: "en-US" },
  ];

  assert.equal(selectSpeechVoiceIdentifier(voices, "male"), "en-US-neutral-primary");
  assert.equal(selectSpeechVoiceIdentifier(voices, "female"), "en-US-neutral-primary");
});

test("device voice no-match selection defers to the platform instead of choosing an identified opposite gender", () => {
  assert.equal(selectSpeechVoiceIdentifier([femaleVoice], "male"), undefined);
  assert.equal(selectSpeechVoiceIdentifier([maleVoice], "female"), undefined);
});

test("mobile voice options produce exactly the six server-supported preset values", () => {
  const presets: RemoteTtsPreset[] = AI_VOICE_GENDER_OPTIONS.flatMap((gender) =>
    AI_VOICE_OPTIONS.map((profile) => `${gender.id}-${profile.id}` as RemoteTtsPreset),
  );

  assert.deepEqual(presets, [
    "female-balanced",
    "female-warm",
    "female-bright",
    "male-balanced",
    "male-warm",
    "male-bright",
  ]);
});
