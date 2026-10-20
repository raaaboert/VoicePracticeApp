import { readFileSync } from "node:fs";
import ts from "typescript";
import * as session from "./ttsPlaybackSession";
import * as time from "./ttsPlaybackTime";
import { analyzeTtsCancellation } from "./simulationDiagnostics";
import { isOrganizationAccessRequiredError } from "./apiError";
import type { AudioStatus } from "expo-audio";

// Execute the actual complete playback module with only native/network bindings
// replaced. No copied playback algorithm or Expo native modification.
const source = readFileSync(new URL("./ttsPlayback.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("ttsPlayback.ts", source, ts.ScriptTarget.Latest, true);
const moduleText = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast, ast.statements.filter((s) => !ts.isImportDeclaration(s))));
const compiled = ts.transpileModule(moduleText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
export const ready = { isLoaded: true, playing: false, didJustFinish: false, currentTime: 0, duration: 1,
  isBuffering: false, playbackState: "readyToPlay", error: null } as AudioStatus;
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createTtsPlaybackHarness() {
  const sounds: FakePlayer[] = []; const logs: unknown[] = []; const deleted: string[] = [];
  let configure = (_sound: FakePlayer) => {};
  let deleteBarrier: Promise<void> | undefined;
  let fetchError: Error | undefined;
  class FakePlayer {
    status = { ...ready }; listeners: Array<(status: AudioStatus) => void> = [];
    reads = 0; removedListeners = 0; removed = 0; plays = 0; pauses = 0; volume = 1;
    read?: () => AudioStatus;
    onSubscribe?: () => void;
    onPlay?: () => void;
    get currentStatus() { this.reads++; return this.read ? this.read() : { ...this.status }; }
    addListener(_name: string, callback: (status: AudioStatus) => void) {
      this.listeners.push(callback); this.onSubscribe?.();
      return { remove: () => { this.removedListeners++; } };
    }
    emit(change: Partial<AudioStatus>) {
      this.status = { ...this.status, ...change };
      // Also exercise stale delivery after listener removal.
      this.listeners.forEach((callback) => callback(this.status));
    }
    play() { this.plays++; this.onPlay?.(); }
    pause() { this.pauses++; }
    remove() { this.removed++; }
    setPlaybackRate() {}
  }
  let fetches = 0;
  const fetchRequests: unknown[] = [];
  const bindings = {
    ...time, ...session, createPlaybackSettlementSession: session.createPlaybackSession,
    analyzeTtsCancellation, isOrganizationAccessRequiredError,
    createAudioPlayer: () => { const sound = new FakePlayer(); configure(sound); sounds.push(sound); return sound; },
    Platform: { OS: "ios" }, Speech: { stop() {}, getAvailableVoicesAsync() { throw Error("unexpected device fallback"); } },
    FileSystem: { cacheDirectory: "memory://", EncodingType: { Base64: "base64" }, writeAsStringAsync: async () => {},
      deleteAsync: async (uri: string) => { deleted.push(uri); await deleteBarrier; } },
    fetchAiTtsAudio: async (request: unknown) => { fetchRequests.push(request); fetches++; if (fetchError) throw fetchError;
      return { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" }; },
    getVoiceSpeechTuning: () => ({}), selectSpeechVoiceIdentifier: () => undefined,
    console: { log: (...values: unknown[]) => logs.push(values), warn: (...values: unknown[]) => logs.push(values) },
  };
  const exported: any = {};
  new Function("exports", ...Object.keys(bindings), compiled)(exported, ...Object.values(bindings));
  const refs = { remoteTtsSoundRef: { current: null }, remoteTtsFileRef: { current: null } };
  const make = (abort = new AbortController()) => {
    let started = 0;
    const promise = exported.speakWithRemoteTtsFallback({ ...refs, source: "simulation", text: "PRIVATE_SPEECH_SENTINEL",
      userId: "learner", authToken: "PRIVATE_TOKEN_SENTINEL", preset: "male-balanced", remoteTtsEnabled: true,
      remoteAiConfigured: true, allowFallbackSpeech: false, voiceGender: "male", voiceProfile: "balanced",
      abortSignal: abort.signal, onPlaybackStart: () => { started++; } });
    return { promise, abort, started: () => started };
  };
  return { sounds, logs, deleted, refs, make, playback: exported, stop: () => exported.stopRemoteTtsPlayback(refs),
    configure: (callback: typeof configure) => { configure = callback; },
    delayDeletion: (promise?: Promise<void>) => { deleteBarrier = promise; },
    failFetch: (error: Error) => { fetchError = error; }, fetches: () => fetches, fetchRequests };
}
