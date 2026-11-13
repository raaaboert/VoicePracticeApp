import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const MODEL_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";
export const MAX_PCM_BYTES = 16_000 * 2 * 180;

export async function detectSpeech(pcm) {
  const started = performance.now();
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_PCM_BYTES) throw Error("invalid_pcm");
  const model = await readFile(new URL("../assets/speech/silero_vad.onnx", import.meta.url));
  if (createHash("sha256").update(model).digest("hex") !== MODEL_SHA256) throw Error("invalid_model");
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(model, { executionProviders: ["cpu"],
    intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" });
  let state = new ort.Tensor("float32", new Float32Array(256), [2, 1, 128]);
  const sampleRate = new ort.Tensor("int64", new BigInt64Array([16000n]), []);
  const frame = new Float32Array(576), context = new Float32Array(64);
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i) / 32768));
  // Level is never the speech decision. Bounded gain preserves soft speech;
  // noise controls must still be rejected by the neural speech probability.
  const gain = peak > 0 ? Math.min(100, 0.5 / peak) : 1;
  let maximumProbability = 0, speechFrames = 0, run = 0, longestRun = 0;
  try {
    for (let offset = 0; offset < pcm.length / 2; offset += 512) {
      frame.fill(0); frame.set(context);
      const count = Math.min(512, pcm.length / 2 - offset);
      for (let i = 0; i < count; i++) frame[64 + i] = pcm.readInt16LE((offset + i) * 2) / 32768 * gain;
      const input = new ort.Tensor("float32", frame, [1, 576]);
      let result;
      try { result = await session.run({ input, state, sr: sampleRate }); }
      finally { input.dispose(); }
      const probability = Number(result.output.data[0]);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error("invalid_probability");
      state.dispose(); state = result.stateN;
      result.output.dispose();
      context.set(frame.subarray(512));
      maximumProbability = Math.max(maximumProbability, probability);
      if (probability >= 0.5) { speechFrames++; run++; longestRun = Math.max(longestRun, run); } else run = 0;
    }
    const decision = longestRun >= 3 && maximumProbability >= 0.7 ? "speech"
      : maximumProbability < 0.2 ? "no_speech" : "uncertain";
    return { decision, durationMs: pcm.length / 32, speechMs: speechFrames * 32,
      longestSpeechMs: longestRun * 32, maximumProbability, inferenceMs: performance.now() - started,
      maxRssKb: process.resourceUsage().maxRSS };
  } finally {
    context.fill(0); frame.fill(0); state.dispose(); sampleRate.dispose();
    await session.release();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_PCM_BYTES) throw Error("pcm_limit");
      chunks.push(chunk);
    }
    const pcm = Buffer.concat(chunks, size);
    try { process.stdout.write(JSON.stringify(await detectSpeech(pcm))); }
    finally { pcm.fill(0); for (const chunk of chunks) chunk.fill(0); }
  } catch {
    process.stdout.write(JSON.stringify({ error: "vad_unavailable" }));
    process.exitCode = 1;
  }
}
