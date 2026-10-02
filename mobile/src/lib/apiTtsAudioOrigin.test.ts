import assert from "node:assert/strict";
import test from "node:test";

import { buildRemoteTtsAudioResult } from "./ttsAudioOrigin";

test("recognized TTS response sources propagate as diagnostic metadata", () => {
  for (const audioOrigin of [
    "server_payload_prefetch",
    "in_flight_prefetch",
    "foreground_generation",
  ] as const) {
    const result = buildRemoteTtsAudioResult({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      audioSourceHeader: audioOrigin,
    });
    assert.equal(result.audioOrigin, audioOrigin);
  }
});

test("missing and unknown TTS response sources use the safe foreground diagnostic default", () => {
  for (const audioSourceHeader of [null, "", "unknown", "device_fallback"]) {
    const result = buildRemoteTtsAudioResult({
      bytes: new Uint8Array([4, 5, 6]),
      contentType: "audio/mpeg",
      audioSourceHeader,
    });
    assert.equal(result.audioOrigin, "foreground_generation");
  }
});

test("diagnostic source metadata cannot replace audio bytes or content type", () => {
  const bytes = new Uint8Array([7, 8, 9]);
  for (const audioSourceHeader of ["in_flight_prefetch", "foreground_generation", "untrusted"]) {
    const result = buildRemoteTtsAudioResult({
      bytes,
      contentType: "audio/test",
      audioSourceHeader,
    });
    assert.strictEqual(result.bytes, bytes);
    assert.equal(result.contentType, "audio/test");
  }
});
