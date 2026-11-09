import { readFileSync } from "node:fs";

export function syntheticSpeechAudio(size?: number): Uint8Array<ArrayBuffer> {
  const speech = readFileSync(new URL("../../test-fixtures/speech/normal-speech.m4a", import.meta.url));
  if (size === undefined) return new Uint8Array(speech);
  const result = new Uint8Array(size);
  if (size < speech.length + 8) return result;
  result.set(speech);
  // Valid MP4 free-space atom exercises the original upload byte limit without
  // bypassing the real speech detector or constructing minutes of test audio.
  const free = Buffer.from(result.buffer, speech.length);
  free.writeUInt32BE(size - speech.length, 0); free.write("free", 4);
  return result;
}
