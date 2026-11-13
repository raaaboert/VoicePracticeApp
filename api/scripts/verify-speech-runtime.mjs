import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
try {
  const decoder = require("ffmpeg-static");
  if (typeof decoder !== "string") throw Error("decoder_missing");
  const version = spawnSync(decoder, ["-version"], { windowsHide: true, shell: false, timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
  if (version.status !== 0 || version.error) throw Error("decoder_unavailable");
  // API build compiles this module before running the check. Use the actual
  // production path (including seekable M4A input and its cleanup), not a second
  // decoder/VAD implementation or a remote ASR substitute.
  const { analyzeSpeechActivity, speechActivityCapacityForTest } = await import("../dist/services/speechActivity.js");
  for (const [fixture, expected] of [["digital-silence", "no_speech"], ["normal-speech", "speech"]]) {
    const audio = await readFile(new URL(`../test-fixtures/speech/${fixture}.m4a`, import.meta.url));
    try {
      if ((await analyzeSpeechActivity(audio)).decision !== expected) throw Error("speech_control_failed");
    } finally { audio.fill(0); }
  }
  if (speechActivityCapacityForTest().active !== 0) throw Error("speech_capacity_leaked");
  console.log("[speech-runtime] packaged decoder, pinned model, native CPU and seekable M4A silence/speech verified", { platform: process.platform, architecture: process.arch, node: process.version });
} catch {
  console.error("[speech-runtime] verification failed; inspect packaged FFmpeg/ONNX CPU assets and pinned model before deployment.");
  process.exitCode = 1;
}
