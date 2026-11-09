import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, copyFile, utimes, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeSpeechActivity, cleanupAbandonedSpeechInputs, speechActivityCapacityForTest,
  SPEECH_MAX_INPUT_BYTES, SPEECH_QUEUE_WAIT_MS, SPEECH_TOTAL_TIMEOUT_MS } from "./speechActivity.js";

const require = createRequire(import.meta.url);
const fixture = (name: string) => readFile(new URL(`../../test-fixtures/speech/${name}.m4a`, import.meta.url));
const capacityEmpty = () => assert.deepEqual(speechActivityCapacityForTest(), { active: 0, queued: 0, queuedBytes: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function withTemporaryTest(action: (root: string, inputs: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "peritio-speech-test-"));
  const inputs = path.join(root, "inputs");
  await mkdir(inputs);
  try { await action(root, inputs); }
  finally {
    capacityEmpty();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("peritio-speech-test-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("actual packaged decoder and Silero reject noise and accept quiet, short and ordinary speech", async (t) => {
  for (const [name, expected] of [
    ["digital-silence", "no_speech"], ["hiss", "no_speech"], ["room-noise-surrogate", "no_speech"],
    ["mechanical-noise-surrogate", "no_speech"], ["quiet-speech", "speech"], ["short-word", "speech"], ["normal-speech", "speech"],
  ]) await t.test(name, async () => {
    const result = await analyzeSpeechActivity(await fixture(name));
    assert.equal(result.decision, expected);
    assert.ok(result.durationMs! > 0);
    t.diagnostic(JSON.stringify({ fixture: name, ...result }));
    capacityEmpty();
  });
});

test("WAV, MP3, FLAC, Ogg and WebM inputs decode through the same speech decision", async (t) => {
  await withTemporaryTest(async (root) => {
  for (const [format, codec] of [["wav", "pcm_s16le"], ["mp3", "libmp3lame"], ["flac", "flac"], ["ogg", "libopus"], ["webm", "libopus"]]) {
    const output = path.join(root, `control.${format}`);
    // A seekable output finalizes WAV/FLAC length headers. Unknown-length
    // streaming WAV headers are deliberately not a valid/truncated-file control.
    const converted = spawnSync(require("ffmpeg-static"), ["-nostdin", "-v", "error", "-i",
      fileURLToPath(new URL("../../test-fixtures/speech/normal-speech.m4a", import.meta.url)), "-c:a", codec, "-f", format, output],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 });
    assert.equal(converted.status, 0, `fixture conversion failed: ${format}`);
    assert.equal((await analyzeSpeechActivity(await readFile(output))).decision, "speech", format);
    t.diagnostic(`${format} accepted`);
  }
  });
});

test("invalid/truncated audio and byte limits reject without speech inference", async () => {
  assert.equal((await analyzeSpeechActivity(Buffer.alloc(0))).decision, "invalid_audio");
  assert.equal((await analyzeSpeechActivity(Buffer.alloc(SPEECH_MAX_INPUT_BYTES + 1))).decision, "invalid_audio");
  for (const bytes of [Buffer.from("not audio"), (await fixture("normal-speech")).subarray(0, 128)]) {
    assert.equal((await analyzeSpeechActivity(bytes)).decision, "invalid_audio");
  }
  capacityEmpty();
});

test("decoded-duration ceiling rejects compressed expansion rather than accepting a truncated prefix", async () => {
  const header = Buffer.alloc(44 + 16000 * 2 * 181);
  header.write("RIFF"); header.writeUInt32LE(header.length - 8, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(header.length - 44, 40);
  assert.equal((await analyzeSpeechActivity(header)).decision, "invalid_audio");
  capacityEmpty();
});

test("duration boundary accepts 180 seconds and rejects a 185-second M4A with speech before the unverified tail", async () => {
  await withTemporaryTest(async (root, inputs) => {
    const wav = Buffer.alloc(44 + 16000 * 2 * 180);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    assert.equal((await analyzeSpeechActivity(wav, { temporaryRoot: inputs })).decision, "no_speech");
    const output = path.join(root, "long.m4a");
    const converted = spawnSync(require("ffmpeg-static"), ["-nostdin", "-v", "error", "-i",
      fileURLToPath(new URL("../../test-fixtures/speech/normal-speech.m4a", import.meta.url)),
      "-af", "apad", "-t", "185", "-ar", "16000", "-ac", "1", "-c:a", "aac", output],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
    assert.equal(converted.status, 0);
    assert.equal((await analyzeSpeechActivity(await readFile(output), { temporaryRoot: inputs })).decision, "invalid_audio");
    assert.deepEqual(await readdir(inputs), []);
  });
});

test("startup cleanup removes only old dead-owner inputs, preserving active, fresh, legacy and unrelated folders", async () => {
  await withTemporaryTest(async (root, inputs) => {
    const deadPid = 2147483647;
    assert.throws(() => process.kill(deadPid, 0), (error: any) => error.code === "ESRCH");
    const old = new Date(Date.now() - 3600_000);
    const create = async (name: string, stale: boolean, extra?: string) => {
      const directory = path.join(inputs, name); await mkdir(directory);
      await writeFile(path.join(directory, extra ?? "input.audio"), "synthetic");
      if (stale) await utimes(directory, old, old);
      return directory;
    };
    await create(`peritio-speech-${deadPid}-aaaaaa`, true);
    await create(`peritio-speech-${process.pid}-bbbbbb`, true);
    await create(`peritio-speech-${deadPid}-cccccc`, false);
    await create("peritio-speech-legacy", true);
    await create("unrelated", true);
    await create(`peritio-speech-${deadPid}-dddddd`, true, "unexpected");
    const outside = path.join(root, "outside"); await mkdir(outside);
    await writeFile(path.join(outside, "input.audio"), "synthetic");
    await symlink(outside, path.join(inputs, `peritio-speech-${deadPid}-eeeeee`), process.platform === "win32" ? "junction" : "dir");
    const result = await cleanupAbandonedSpeechInputs(inputs);
    assert.equal(result.removed, 1); assert.equal(result.failed, 0);
    assert.equal((await readdir(inputs)).length, 6);
    assert.equal(await readFile(path.join(outside, "input.audio"), "utf8"), "synthetic");
    const bounded = path.join(root, "bounded"); await mkdir(bounded);
    for (let i = 0; i < 40; i++) {
      const directory = path.join(bounded, `peritio-speech-${deadPid}-${String(i).padStart(6, "0")}`);
      await mkdir(directory); await utimes(directory, old, old);
    }
    const limited = await cleanupAbandonedSpeechInputs(bounded);
    assert.equal(limited.removed, 32); assert.ok(limited.scanned <= 256);
    assert.equal((await readdir(bounded)).length, 8);
    assert.equal((await cleanupAbandonedSpeechInputs(path.join(root, "missing"))).failed, 1);
  });
});

test("queue waits eight seconds, then rejects without leaking a slot", async (t) => {
  await withTemporaryTest(async (root, inputs) => {
    assert.equal(SPEECH_QUEUE_WAIT_MS, 8000); assert.equal(SPEECH_TOTAL_TIMEOUT_MS, 12000);
    const worker = path.join(root, "queue.mjs"); await writeFile(worker, "process.stdin.resume();setInterval(()=>{},1000);");
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const bytes = await fixture("normal-speech"), abort = new AbortController(), entered = deferred<void>();
    const first = analyzeSpeechActivity(bytes, { temporaryRoot: inputs, vadWorkerPath: worker, vadTimeoutMs: 20000,
      signal: abort.signal, onProcessStarted: (_pid, stage) => { if (stage === "vad") entered.resolve(); } });
    const firstRejected = assert.rejects(first); await entered.promise;
    try {
      const queued = analyzeSpeechActivity(bytes, { temporaryRoot: inputs });
      let settled = false; const rejection = assert.rejects(queued).then(() => { settled = true; });
      t.mock.timers.tick(7999); await Promise.resolve();
      assert.equal(settled, false); assert.equal(speechActivityCapacityForTest().queued, 1);
      t.mock.timers.tick(1); await rejection;
      assert.equal(speechActivityCapacityForTest().queued, 0);
    } finally { t.mock.timers.reset(); abort.abort(); await firstRejected; }
  });
});

test("twelve-second total deadline includes queue time and kills active inference after admission", async (t) => {
  await withTemporaryTest(async (root, inputs) => {
    const worker = path.join(root, "deadline.mjs"); await writeFile(worker, "process.stdin.resume();setInterval(()=>{},1000);");
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const bytes = await fixture("normal-speech"), abort = new AbortController(), firstEntered = deferred<void>(), secondEntered = deferred<void>();
    const first = analyzeSpeechActivity(bytes, { temporaryRoot: inputs, vadWorkerPath: worker, vadTimeoutMs: 20000,
      signal: abort.signal, onProcessStarted: (_pid, stage) => { if (stage === "vad") firstEntered.resolve(); } });
    const firstRejected = assert.rejects(first); await firstEntered.promise;
    let secondRejected: Promise<void> | undefined;
    try {
      const second = analyzeSpeechActivity(bytes, { temporaryRoot: inputs, vadWorkerPath: worker, vadTimeoutMs: 20000,
        onProcessStarted: (_pid, stage) => { if (stage === "vad") secondEntered.resolve(); } });
      let settled = false; secondRejected = assert.rejects(second).then(() => { settled = true; });
      t.mock.timers.tick(7000); abort.abort(); await firstRejected; await secondEntered.promise;
      t.mock.timers.tick(4999); await Promise.resolve(); assert.equal(settled, false);
      t.mock.timers.tick(1); await secondRejected;
      capacityEmpty(); assert.deepEqual(await readdir(inputs), []);
    } finally { t.mock.timers.reset(); abort.abort(); await firstRejected; }
  });
});

test("decoder failure, VAD failure and timeout remove private inputs and release child processes", async () => {
  await withTemporaryTest(async (root, inputs) => {
    const audio = await fixture("normal-speech");
    const broken = path.join(root, "broken.mjs"), hanging = path.join(root, "hanging.mjs");
    await writeFile(broken, "throw Error('PRIVATE_NATIVE_ERROR');");
    await writeFile(hanging, "process.stdin.resume();setInterval(()=>{},1000);");
    const scripts = path.join(root, "missing-model", "scripts"); await mkdir(scripts, { recursive: true });
    const missingModel = path.join(scripts, "worker.mjs");
    await copyFile(new URL("../../scripts/speech-vad-worker.mjs", import.meta.url), missingModel);
    for (const options of [
      { decoderPath: path.join(root, "missing-decoder") }, { vadWorkerPath: broken }, { vadWorkerPath: missingModel },
      { vadWorkerPath: hanging, vadTimeoutMs: 150 },
    ]) {
      const pids: number[] = [];
      await assert.rejects(analyzeSpeechActivity(audio, { ...options, temporaryRoot: inputs, onProcessStarted: pid => { pids.push(pid); } }),
        error => error instanceof Error && error.message === "We couldn't check your recording. Please try again.");
      for (const pid of pids) assert.throws(() => process.kill(pid, 0), `child ${pid} must be gone`);
      assert.deepEqual(await readdir(inputs), []);
      capacityEmpty();
    }
  });
});

test("cancellation while decoding and while doing VAD closes each owned child before cleanup", async () => {
  await withTemporaryTest(async (_root, inputs) => {
    for (const stage of ["decoder", "vad"] as const) {
      const controller = new AbortController(), started = deferred<number>();
      const pending = analyzeSpeechActivity(await fixture("normal-speech"), { signal: controller.signal, temporaryRoot: inputs,
        onProcessStarted: (pid, currentStage) => { if (currentStage === stage) { started.resolve(pid); controller.abort(); } } });
      const rejection = assert.rejects(pending);
      const pid = await started.promise;
      await rejection;
      assert.throws(() => process.kill(pid, 0));
      assert.deepEqual(await readdir(inputs), []);
      capacityEmpty();
    }
  });
});

test("bounded concurrency and queued cancellation recover without starvation or abandoned slots", async () => {
  await withTemporaryTest(async (root, inputs) => {
    const hanging = path.join(root, "hanging.mjs");
    await writeFile(hanging, "process.stdin.resume();setInterval(()=>{},1000);");
    const first = new AbortController(), queued = new AbortController(), entered = deferred<void>();
    const bytes = await fixture("normal-speech");
    const running = analyzeSpeechActivity(bytes, { signal: first.signal, vadWorkerPath: hanging, temporaryRoot: inputs,
      onProcessStarted: (_pid, stage) => { if (stage === "vad") entered.resolve(); } });
    const runningSettled = Promise.allSettled([running]);
    await entered.promise;
    const waiting = Array.from({ length: 8 }, () => analyzeSpeechActivity(bytes, { signal: queued.signal, temporaryRoot: inputs }));
    const allWaiting = Promise.allSettled(waiting);
    assert.deepEqual(speechActivityCapacityForTest(), { active: 1, queued: 8, queuedBytes: bytes.length * 8 });
    await assert.rejects(analyzeSpeechActivity(bytes));
    queued.abort();
    assert.ok((await allWaiting).every(result => result.status === "rejected"));
    const large = Buffer.alloc(SPEECH_MAX_INPUT_BYTES), byteAbort = new AbortController();
    const byteQueue = Promise.allSettled([1, 2].map(() => analyzeSpeechActivity(large, { signal: byteAbort.signal })));
    assert.equal(speechActivityCapacityForTest().queuedBytes, SPEECH_MAX_INPUT_BYTES * 2);
    await assert.rejects(analyzeSpeechActivity(Buffer.alloc(1)));
    byteAbort.abort(); await byteQueue;
    first.abort();
    assert.equal((await runningSettled)[0].status, "rejected");
    capacityEmpty(); assert.deepEqual(await readdir(inputs), []);
    assert.equal((await analyzeSpeechActivity(bytes, { temporaryRoot: inputs })).decision, "speech");
    assert.deepEqual(await readdir(inputs), []);
  });
});
