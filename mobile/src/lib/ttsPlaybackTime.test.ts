import assert from "node:assert/strict";
import test from "node:test";
import {
  getKnownPlaybackDurationMilliseconds,
  playbackSecondsToMilliseconds,
} from "./ttsPlaybackTime";

test("converts expo-audio playback seconds to milliseconds and treats zero duration as unknown", () => {
  assert.equal(playbackSecondsToMilliseconds(12.25), 12_250);
  assert.equal(playbackSecondsToMilliseconds(0), 0);
  assert.equal(getKnownPlaybackDurationMilliseconds(12.25), 12_250);
  assert.equal(getKnownPlaybackDurationMilliseconds(0), null);
  assert.equal(getKnownPlaybackDurationMilliseconds(Number.NaN), null);
});
