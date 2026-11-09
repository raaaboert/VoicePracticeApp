import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile, opendir, lstat, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { SafeAiRouteError } from "./safeErrors.js";

const require = createRequire(import.meta.url);
export const SPEECH_MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const SPEECH_MAX_DURATION_SECONDS = 180;
export const SPEECH_QUEUE_WAIT_MS = 8000;
export const SPEECH_TOTAL_TIMEOUT_MS = 12_000;
const MAX_PCM_BYTES = 16000 * 2 * SPEECH_MAX_DURATION_SECONDS;
const MAX_QUEUED_BYTES = 24 * 1024 * 1024;
const workerPath = fileURLToPath(new URL("../../scripts/speech-vad-worker.mjs", import.meta.url));
export type SpeechActivityDecision = "speech" | "no_speech" | "uncertain" | "invalid_audio";
export interface SpeechActivityResult {
  decision: SpeechActivityDecision;
  durationMs?: number;
  speechMs?: number;
  longestSpeechMs?: number;
  maximumProbability?: number;
  inferenceMs?: number;
  maxRssKb?: number;
}
const unavailable = () => new SafeAiRouteError({ status: 503, code: "ai_unavailable",
  error: "We couldn't check your recording. Please try again." });

// A bounded FIFO allows normal bursts without unbounded CPU/process creation.
// Queue entries hold existing upload buffers, not extra copies.
let active = 0, queuedBytes = 0;
const queue: Array<{ bytes: number; enter: () => void }> = [];
function acquire(bytes: number, signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let entry: (typeof queue)[number] | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
    const cancel = () => {
      if (!entry) return;
      const index = queue.indexOf(entry);
      if (index >= 0) { queue.splice(index, 1); queuedBytes -= bytes; }
      clear(); reject(unavailable());
    };
    const enter = () => {
      clear(); active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true; active--;
        const next = queue.shift();
        if (next) { queuedBytes -= next.bytes; next.enter(); }
      });
    };
    if (signal.aborted) { reject(unavailable()); return; }
    if (active === 0) { enter(); return; }
    if (queue.length >= 8 || queuedBytes + bytes > MAX_QUEUED_BYTES) { reject(unavailable()); return; }
    entry = { bytes, enter }; queue.push(entry); queuedBytes += bytes;
    timer = setTimeout(cancel, SPEECH_QUEUE_WAIT_MS);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export function speechActivityCapacityForTest() {
  return { active, queued: queue.length, queuedBytes };
}

// Startup only. PID-qualified folders allow us to prove the previous owner has
// exited. Unknown/legacy folders and live/permission-denied owners are preserved.
// Bound scanning/removal, never recurse, and never follow directory symlinks.
export async function cleanupAbandonedSpeechInputs(temporaryRoot = os.tmpdir()) {
  const root = path.resolve(temporaryRoot);
  const result = { scanned: 0, removed: 0, failed: 0 };
  const ownerExited = (pid: number) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  };
  try {
    const entries = await opendir(root);
    const deadline = Date.now() + 2000;
    for await (const entry of entries) {
      if (result.scanned >= 256 || result.removed >= 32 || Date.now() >= deadline) break;
      result.scanned++;
      const match = /^peritio-speech-(\d+)-[A-Za-z0-9]{6}$/.exec(entry.name);
      if (!match || !entry.isDirectory() || !ownerExited(Number(match[1]))) continue;
      const directory = path.resolve(root, entry.name);
      if (path.dirname(directory) !== root) continue;
      try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || Date.now() - info.mtimeMs < 5 * 60_000) continue;
        const children = await opendir(directory);
        let valid = true, inputPresent = false, count = 0;
        for await (const child of children) {
          if (++count > 1 || child.name !== "input.audio" || !child.isFile()) { valid = false; break; }
          inputPresent = true;
        }
        if (!valid || !ownerExited(Number(match[1]))) continue;
        if (inputPresent) {
          const input = path.join(directory, "input.audio"), info = await lstat(input);
          if (!info.isFile() || info.isSymbolicLink() || info.size > SPEECH_MAX_INPUT_BYTES) continue;
          await unlink(input);
        }
        await rmdir(directory); // Nonrecursive: unexpected files are never deleted.
        result.removed++;
      } catch { result.failed++; }
    }
  } catch { result.failed++; }
  return result;
}

interface ProcessResult { code: number | null; output: Buffer; exceeded: boolean }
// The parent owns each direct child and waits for close before releasing capacity
// or removing its input. No shell, process tree, raw stderr or detached work.
function runProcess(executable: string, args: string[], options: {
  input?: Buffer; maxOutput: number; timeoutMs: number; signal: AbortSignal;
  onSpawn?: (pid: number) => void;
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(unavailable()); return; }
    let child: ChildProcessWithoutNullStreams;
    try {
      const env: NodeJS.ProcessEnv = { OMP_NUM_THREADS: "1" };
      for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
      child = spawn(executable, args, { windowsHide: true, shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch { reject(unavailable()); return; }
    const chunks: Buffer[] = [];
    let size = 0, exceeded = false, failed = false, killed = false;
    const kill = () => { if (!killed) { killed = true; child.kill("SIGKILL"); } };
    const abort = () => { failed = true; kill(); };
    const timer = setTimeout(abort, options.timeoutMs);
    options.signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => { failed = true; kill(); });
    child.once("spawn", () => {
      try { if (child.pid) options.onSpawn?.(child.pid); } catch { failed = true; kill(); }
    });
    child.stdin.on("error", () => { /* EPIPE is resolved by the process close/exit result. */ });
    child.stderr.on("data", () => { /* Discard diagnostics that could include input filenames/data. */ });
    child.stdout.on("data", (chunk: Buffer) => {
      if (failed || exceeded) return;
      size += chunk.length;
      if (size > options.maxOutput) { exceeded = true; kill(); return; }
      chunks.push(chunk);
    });
    child.once("close", (code) => {
      clearTimeout(timer); options.signal.removeEventListener("abort", abort);
      if (failed || options.signal.aborted) {
        for (const chunk of chunks) chunk.fill(0);
        reject(unavailable());
      } else {
        const output = Buffer.concat(chunks);
        for (const chunk of chunks) chunk.fill(0);
        resolve({ code, exceeded, output });
      }
    });
    if (options.signal.aborted) abort();
    child.stdin.end(options.input);
  });
}

export interface SpeechActivityOptions {
  signal?: AbortSignal;
  // Dependency injection for focused failure/timeout regressions, not environment overrides.
  decoderPath?: string;
  vadWorkerPath?: string;
  decoderTimeoutMs?: number;
  vadTimeoutMs?: number;
  temporaryRoot?: string;
  onProcessStarted?: (pid: number, stage: "decoder" | "vad") => void;
}

let testOptions: SpeechActivityOptions | undefined;
export function setSpeechActivityOptionsForTest(options?: SpeechActivityOptions): void {
  if (process.env.NODE_ENV !== "test" || process.env.PERITIO_ENV !== "development") throw Error("Speech test options require isolated tests.");
  testOptions = options;
}

export async function analyzeSpeechActivity(audio: Buffer, options: SpeechActivityOptions = {}): Promise<SpeechActivityResult> {
  options = { ...testOptions, ...options };
  if (!audio.length || audio.length > SPEECH_MAX_INPUT_BYTES) return { decision: "invalid_audio" };
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), SPEECH_TOTAL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  let release: (() => void) | undefined;
  const temporaryRoot = path.resolve(options.temporaryRoot ?? os.tmpdir());
  const removeInput = async (directory: string) => {
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith("peritio-speech-")) throw unavailable();
    await rm(directory, { recursive: true, force: true });
  };
  let temporaryDirectory: string | undefined, pcm: Buffer | undefined;
  const startedAt = Date.now();
  try {
    release = await acquire(audio.length, signal);
    signal.throwIfAborted();
    // Lazy resolution: missing assets cannot crash unrelated API startup/routes.
    const decoder: unknown = options.decoderPath ?? require("ffmpeg-static");
    if (typeof decoder !== "string" || !decoder) throw unavailable();
    temporaryDirectory = await mkdtemp(path.join(temporaryRoot, `peritio-speech-${process.pid}-`));
    const input = path.join(temporaryDirectory, "input.audio");
    await writeFile(input, audio, { flag: "wx", mode: 0o600, signal });
    const decoded = await runProcess(decoder, ["-nostdin", "-hide_banner", "-v", "error", "-xerror",
      "-max_alloc", "16777216", "-threads", "1", "-probesize", "1048576", "-analyzeduration", "3000000",
      "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,wav,mp3,ogg,flac,aac,mpeg,mpegts",
      "-err_detect", "explode", "-i", input, "-map", "0:a:0", "-vn", "-sn", "-dn", "-threads", "1",
      "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
    { maxOutput: MAX_PCM_BYTES + 2048, timeoutMs: options.decoderTimeoutMs ?? 4000, signal,
      onSpawn: pid => options.onProcessStarted?.(pid, "decoder") });
    pcm = decoded.output;
    // Delete seekable compressed input before inference; PCM is never written to disk.
    await removeInput(temporaryDirectory); temporaryDirectory = undefined;
    if (decoded.exceeded || decoded.code !== 0 || !pcm.length || pcm.length % 2 || pcm.length > MAX_PCM_BYTES) {
      return { decision: "invalid_audio" };
    }
    const result = await runProcess(process.execPath, ["--max-old-space-size=96", options.vadWorkerPath ?? workerPath],
      { input: pcm, maxOutput: 8192, timeoutMs: options.vadTimeoutMs ?? 5000, signal,
        onSpawn: pid => options.onProcessStarted?.(pid, "vad") });
    if (result.code !== 0 || result.exceeded || Date.now() - startedAt >= SPEECH_TOTAL_TIMEOUT_MS || signal.aborted) throw unavailable();
    let parsed: SpeechActivityResult;
    try { parsed = JSON.parse(result.output.toString("utf8")) as SpeechActivityResult; } catch { throw unavailable(); }
    if (!["speech", "no_speech", "uncertain"].includes(parsed.decision)
      || !Number.isFinite(parsed.maximumProbability) || parsed.maximumProbability! < 0 || parsed.maximumProbability! > 1
      || !Number.isFinite(parsed.durationMs) || parsed.durationMs! <= 0 || parsed.durationMs! > 180_000) throw unavailable();
    return parsed;
  } catch { throw unavailable(); }
  finally {
    clearTimeout(deadlineTimer);
    pcm?.fill(0);
    try { if (temporaryDirectory) await removeInput(temporaryDirectory); }
    finally { release?.(); }
  }
}
