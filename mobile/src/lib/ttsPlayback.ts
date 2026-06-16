import type { MutableRefObject } from "react";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { getVoiceSpeechTuning, selectSpeechVoiceIdentifier } from "../data/preferences";
import type { AiVoiceGender, AiVoiceProfile } from "../types";
import { fetchAiTtsAudio, RemoteTtsPreset } from "./api";
import type { PrefetchedRemoteSpeechChunk } from "./api";
import { analyzeTtsCancellation, TtsCancellationAnalysis } from "./simulationDiagnostics";

type TtsSource = "simulation" | "sample";
type TtsModeReason = "remoteTtsDisabled" | "remoteAiNotConfigured" | "remoteCallStarted" | "backendError";
export type RemoteAudioSourceKind = "inline" | "file";
type TtsDiagnosticEvent =
  | "remote_tts_success"
  | "remote_tts_fetch_failure"
  | "remote_tts_playback_failure"
  | "remote_tts_playback_timeout"
  | "fallback_tts_used"
  | "fallback_tts_success"
  | "fallback_tts_failed"
  | "fallback_tts_timeout"
  | "final_user_visible_outcome";
const MIN_PLAYBACK_RATE = 0.8;
const MAX_PLAYBACK_RATE = 1.4;
const TTS_PLAYBACK_TIMEOUT_MIN_MS = 10_000;
const TTS_PLAYBACK_TIMEOUT_MAX_MS = 60_000;
const TTS_AUDIO_LOAD_TIMEOUT_MS = 20_000;
const REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE: Record<AiVoiceProfile, number> = {
  warm: 1.08,
  balanced: 1.15,
  bright: 1.22,
};
const REMOTE_PLAYBACK_GLOBAL_MULTIPLIER = 1.03;
const ttsDiagnosticCounters = new Map<TtsDiagnosticEvent, number>();
let inlineRemoteAudioPlaybackSupported: boolean | null = Platform.OS === "web" ? false : null;

interface SpeakWithTtsFallbackParams {
  source: TtsSource;
  text: string;
  preset: RemoteTtsPreset;
  userId: string;
  authToken: string;
  correlationId?: string;
  simulationSessionId?: string;
  remoteTtsEnabled: boolean;
  remoteAiConfigured: boolean;
  allowRemoteTts?: boolean;
  allowFallbackSpeech?: boolean;
  voiceGender: AiVoiceGender;
  voiceProfile: AiVoiceProfile;
  selectedVoiceIdentifierRef?: MutableRefObject<string | undefined>;
  remoteTtsSoundRef?: MutableRefObject<Audio.Sound | null>;
  remoteTtsFileRef?: MutableRefObject<string | null>;
  assistantTextReceivedAtMs?: number;
  prefetchedRemoteAudio?: PrefetchedRemoteSpeechChunk | null;
  preparedRemoteSource?: PreparedRemoteAudioSource | null;
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  chunkIndex?: number;
  chunkCount?: number;
  describeCancellation?: () => {
    superseded?: boolean;
    sessionEnding?: boolean;
    screenChanging?: boolean;
  };
  onRemoteCancellation?: (details: TtsCancellationAnalysis) => void;
  onPlaybackStart?: (details: { source: TtsSource; mode: "remote" | "fallback"; startedAtMs: number }) => void;
}

export interface PreparedRemoteAudioSource {
  audio: PrefetchedRemoteSpeechChunk;
  sourceKind: RemoteAudioSourceKind;
  sourceUri: string;
  cleanupFileUri: string | null;
  preparedAtMs: number;
}

export interface TtsPlaybackResult {
  outcome:
    | "remote_tts_completed"
    | "fallback_tts_completed"
    | "remote_started_then_failed_unblocked"
    | "tts_cancelled";
  mode: "remote" | "fallback" | "cancelled";
  degraded: boolean;
  timedOut: boolean;
  reason: string;
  sourceKind?: RemoteAudioSourceKind | null;
  playbackStarted?: boolean;
  chunkIndex?: number;
  chunkCount?: number;
}

class TtsPlaybackCancelledError extends Error {
  constructor() {
    super("TTS playback cancelled.");
    this.name = "TtsPlaybackCancelledError";
  }
}

class TtsPlaybackTimeoutError extends Error {
  constructor(message = "Remote TTS playback timed out before completion.") {
    super(message);
    this.name = "TtsPlaybackTimeoutError";
  }
}

class TtsAudioLoadTimeoutError extends Error {
  constructor(message = "Remote TTS audio load timed out.") {
    super(message);
    this.name = "TtsAudioLoadTimeoutError";
  }
}

class TtsFallbackTimeoutError extends Error {
  constructor(message = "Fallback speech timed out before completion.") {
    super(message);
    this.name = "TtsFallbackTimeoutError";
  }
}

export function toRemoteTtsPreset(voiceGender: AiVoiceGender, voiceProfile: AiVoiceProfile): RemoteTtsPreset {
  return `${voiceGender}-${voiceProfile}` as RemoteTtsPreset;
}

function clampDurationMs(value: number, minMs: number, maxMs: number): number {
  return Math.max(minMs, Math.min(maxMs, Math.ceil(value)));
}

export function resolveTtsPlaybackTimeoutMs(params: {
  text: string;
  audioDurationMs?: number | null;
}): number {
  const words = params.text.trim().split(/\s+/).filter(Boolean).length;
  const textChars = params.text.trim().length;
  const spokenEstimateMs =
    words > 0
      ? (words / 2.15) * 1000
      : textChars > 0
        ? textChars * 70
        : 1000;
  const audioDurationMs =
    typeof params.audioDurationMs === "number" && Number.isFinite(params.audioDurationMs) && params.audioDurationMs > 0
      ? params.audioDurationMs
      : null;
  const timeoutEstimateMs = Math.max(
    spokenEstimateMs * 1.9 + 8_000,
    audioDurationMs !== null ? audioDurationMs * 1.65 + 8_000 : 0,
  );

  return clampDurationMs(timeoutEstimateMs, TTS_PLAYBACK_TIMEOUT_MIN_MS, TTS_PLAYBACK_TIMEOUT_MAX_MS);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let index = 0;

  while (index + 2 < bytes.length) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      alphabet[(value >> 18) & 63] +
      alphabet[(value >> 12) & 63] +
      alphabet[(value >> 6) & 63] +
      alphabet[value & 63];
    index += 3;
  }

  if (index < bytes.length) {
    const remaining = bytes.length - index;
    const value = (bytes[index] << 16) | (remaining === 2 ? bytes[index + 1] << 8 : 0);
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += remaining === 2 ? alphabet[(value >> 6) & 63] : "=";
    output += "=";
  }

  return output;
}

function buildInlineAudioDataUri(contentType: string, bytes: Uint8Array): string {
  const safeContentType = contentType?.trim() || "audio/mpeg";
  return `data:${safeContentType};base64,${bytesToBase64(bytes)}`;
}

function logTtsMode(source: TtsSource, preset: RemoteTtsPreset, mode: "remote" | "fallback", reason: TtsModeReason) {
  // eslint-disable-next-line no-console
  console.log(`[TTS-MODE] source=${source} preset=${preset} mode=${mode} reason=${reason}`);
}

function shouldAttemptInlineRemoteAudio(contentType: string): boolean {
  return Platform.OS !== "ios" && contentType.startsWith("audio/") && inlineRemoteAudioPlaybackSupported !== false;
}

function logIosRemoteTtsFilePlaybackPreference(params: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  correlationId?: string;
  contentType: string;
  chunkIndex?: number;
  chunkCount?: number;
}) {
  if (Platform.OS !== "ios" || !params.contentType.startsWith("audio/")) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[TTS-MODE]", {
    source: params.source,
    preset: params.preset,
    mode: "remote",
    reason: "iosFilePlaybackPreferred",
    sourceKind: "file",
    correlationId: params.correlationId ?? null,
    contentType: params.contentType,
    ...(typeof params.chunkIndex === "number" ? { chunkIndex: params.chunkIndex } : {}),
    ...(typeof params.chunkCount === "number" ? { chunkCount: params.chunkCount } : {}),
  });
}

function logIosTtsSelection(params: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  voiceGender: AiVoiceGender;
  voiceProfile: AiVoiceProfile;
  stage: "remote_attempt" | "remote_success" | "remote_failure" | "fallback_blocked" | "fallback_speech";
  sourceKind?: RemoteAudioSourceKind | "fallback" | null;
  fallbackReason?: string | null;
  error?: string | null;
  playbackRate?: number;
  remoteTtsEnabled?: boolean;
  remoteAiConfigured?: boolean;
  allowRemoteTts?: boolean;
  correlationId?: string;
}) {
  if (Platform.OS !== "ios") {
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[TTS-SELECTION]", {
    platform: Platform.OS,
    source: params.source,
    preset: params.preset,
    voiceGender: params.voiceGender,
    voiceProfile: params.voiceProfile,
    stage: params.stage,
    sourceKind: params.sourceKind ?? null,
    fallbackReason: params.fallbackReason ?? null,
    error: params.error ?? null,
    playbackRate: params.playbackRate ?? null,
    remoteTtsEnabled: params.remoteTtsEnabled ?? null,
    remoteAiConfigured: params.remoteAiConfigured ?? null,
    allowRemoteTts: params.allowRemoteTts ?? null,
    correlationId: params.correlationId ?? null,
  });
}

function clampPlaybackRate(value: number): number {
  return Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, value));
}

function resolveRemotePlaybackRate(profile: AiVoiceProfile): number {
  const baseRate = REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE[profile] ?? REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE.balanced;
  return clampPlaybackRate(baseRate * REMOTE_PLAYBACK_GLOBAL_MULTIPLIER);
}

function resolvePlatformRemotePlaybackRate(gender: AiVoiceGender, profile: AiVoiceProfile): number {
  if (Platform.OS !== "ios") {
    return resolveRemotePlaybackRate(profile);
  }

  if (profile === "warm") {
    return gender === "male" ? 1.0 : 1.04;
  }

  if (profile === "balanced") {
    return 1.06;
  }

  if (profile === "bright") {
    return gender === "male" ? 1.04 : 1.08;
  }

  return 1.0;
}

function logTtsTiming(payload: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  correlationId?: string;
  phase:
    | "request_start"
    | "bytes_received"
    | "prefetched_bytes_ready"
    | "source_prepared"
    | "file_written"
    | "audio_loaded"
    | "play_started";
  assistantTextReceivedAtMs: number;
  tsMs?: number;
  requestMs?: number;
  sourceKind?: RemoteAudioSourceKind;
  preparationMs?: number;
  fileWriteMs?: number;
  loadMs?: number;
  startupMs?: number;
  bytes?: number;
  chunkIndex?: number;
  chunkCount?: number;
}) {
  const tsMs = typeof payload.tsMs === "number" ? payload.tsMs : Date.now();
  const elapsedMs = tsMs - payload.assistantTextReceivedAtMs;
  // eslint-disable-next-line no-console
  console.log("[TTS-TIMING]", {
    source: payload.source,
    preset: payload.preset,
    correlationId: payload.correlationId ?? null,
    phase: payload.phase,
    tsMs,
    elapsedMs,
    ...(typeof payload.requestMs === "number" ? { requestMs: payload.requestMs } : {}),
    ...(typeof payload.preparationMs === "number" ? { preparationMs: payload.preparationMs } : {}),
    ...(typeof payload.fileWriteMs === "number" ? { fileWriteMs: payload.fileWriteMs } : {}),
    ...(typeof payload.loadMs === "number" ? { loadMs: payload.loadMs } : {}),
    ...(typeof payload.startupMs === "number" ? { startupMs: payload.startupMs } : {}),
    ...(typeof payload.bytes === "number" ? { bytes: payload.bytes } : {}),
    ...(typeof payload.chunkIndex === "number" ? { chunkIndex: payload.chunkIndex } : {}),
    ...(typeof payload.chunkCount === "number" ? { chunkCount: payload.chunkCount } : {}),
    ...(payload.sourceKind ? { sourceKind: payload.sourceKind } : {}),
  });
}

function logTtsLifecycle(payload: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  correlationId?: string;
  phase: string;
  sourceKind?: RemoteAudioSourceKind | null;
  textChars?: number;
  bytes?: number;
  timeoutMs?: number;
  elapsedMs?: number;
  error?: string;
  chunkIndex?: number;
  chunkCount?: number;
  details?: Record<string, unknown>;
}) {
  // eslint-disable-next-line no-console
  console.log("[TTS-LIFECYCLE]", {
    source: payload.source,
    preset: payload.preset,
    correlationId: payload.correlationId ?? null,
    phase: payload.phase,
    ...(payload.sourceKind ? { sourceKind: payload.sourceKind } : {}),
    ...(typeof payload.textChars === "number" ? { textChars: payload.textChars } : {}),
    ...(typeof payload.bytes === "number" ? { bytes: payload.bytes } : {}),
    ...(typeof payload.timeoutMs === "number" ? { timeoutMs: payload.timeoutMs } : {}),
    ...(typeof payload.elapsedMs === "number" ? { elapsedMs: payload.elapsedMs } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    ...(typeof payload.chunkIndex === "number" ? { chunkIndex: payload.chunkIndex } : {}),
    ...(typeof payload.chunkCount === "number" ? { chunkCount: payload.chunkCount } : {}),
    ...(payload.details ?? {}),
  });
}

function logTtsDiagnosticCounter(
  event: TtsDiagnosticEvent,
  payload: {
    source: TtsSource;
    preset: RemoteTtsPreset;
    correlationId?: string;
    reason?: string;
    sourceKind?: RemoteAudioSourceKind | null;
    playbackStarted?: boolean;
    fallbackAttempted?: boolean;
    chunkIndex?: number;
    chunkCount?: number;
    error?: string;
    outcome?: string;
  },
) {
  const nextCount = (ttsDiagnosticCounters.get(event) ?? 0) + 1;
  ttsDiagnosticCounters.set(event, nextCount);
  // eslint-disable-next-line no-console
  console.log("[TTS-DIAGNOSTIC]", {
    event,
    count: nextCount,
    source: payload.source,
    preset: payload.preset,
    correlationId: payload.correlationId ?? null,
    reason: payload.reason ?? null,
    sourceKind: payload.sourceKind ?? null,
    playbackStarted: payload.playbackStarted ?? null,
    fallbackAttempted: payload.fallbackAttempted ?? null,
    ...(typeof payload.chunkIndex === "number" ? { chunkIndex: payload.chunkIndex } : {}),
    ...(typeof payload.chunkCount === "number" ? { chunkCount: payload.chunkCount } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    ...(payload.outcome ? { outcome: payload.outcome } : {}),
  });
}

async function withTimeout<T>(params: {
  promise: Promise<T>;
  timeoutMs: number;
  createTimeoutError: () => Error;
  onTimeout?: () => void;
}): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      params.promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          params.onTimeout?.();
          reject(params.createTimeoutError());
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function writeRemoteAudioBytesToFile(bytes: Uint8Array): Promise<string> {
  const cacheDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!cacheDirectory) {
    throw new Error("No writable cache directory available for TTS playback.");
  }

  const fileUri = `${cacheDirectory}vp-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

export async function preparePrefetchedRemoteAudioSource(params: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  assistantTextReceivedAtMs?: number;
  prefetchedRemoteAudio: PrefetchedRemoteSpeechChunk;
  correlationId?: string;
  chunkIndex?: number;
  chunkCount?: number;
}): Promise<PreparedRemoteAudioSource> {
  const assistantTextReceivedAtMs = params.assistantTextReceivedAtMs ?? Date.now();
  const preparationStartedAtMs = Date.now();
  const shouldAttemptInlineAudio = shouldAttemptInlineRemoteAudio(params.prefetchedRemoteAudio.contentType);

  if (shouldAttemptInlineAudio) {
    const sourcePreparedAtMs = Date.now();
    const prepared = {
      audio: params.prefetchedRemoteAudio,
      sourceKind: "inline" as const,
      sourceUri: buildInlineAudioDataUri(params.prefetchedRemoteAudio.contentType, params.prefetchedRemoteAudio.bytes),
      cleanupFileUri: null,
      preparedAtMs: sourcePreparedAtMs,
    };
    logTtsTiming({
      source: params.source,
      preset: params.preset,
      correlationId: params.correlationId,
      phase: "source_prepared",
      assistantTextReceivedAtMs,
      tsMs: sourcePreparedAtMs,
      preparationMs: sourcePreparedAtMs - preparationStartedAtMs,
      bytes: params.prefetchedRemoteAudio.bytes.byteLength,
      sourceKind: "inline",
      chunkIndex: params.chunkIndex,
      chunkCount: params.chunkCount,
    });
    return prepared;
  }
  logIosRemoteTtsFilePlaybackPreference({
    source: params.source,
    preset: params.preset,
    correlationId: params.correlationId,
    contentType: params.prefetchedRemoteAudio.contentType,
    chunkIndex: params.chunkIndex,
    chunkCount: params.chunkCount,
  });

  const fileWriteStartedAtMs = Date.now();
  const fileUri = await writeRemoteAudioBytesToFile(params.prefetchedRemoteAudio.bytes);
  const fileWrittenAtMs = Date.now();
  logTtsTiming({
    source: params.source,
    preset: params.preset,
    correlationId: params.correlationId,
    phase: "file_written",
    assistantTextReceivedAtMs,
    tsMs: fileWrittenAtMs,
    fileWriteMs: fileWrittenAtMs - fileWriteStartedAtMs,
    bytes: params.prefetchedRemoteAudio.bytes.byteLength,
    sourceKind: "file",
    chunkIndex: params.chunkIndex,
    chunkCount: params.chunkCount,
  });
  logTtsTiming({
    source: params.source,
    preset: params.preset,
    correlationId: params.correlationId,
    phase: "source_prepared",
    assistantTextReceivedAtMs,
    tsMs: fileWrittenAtMs,
    preparationMs: fileWrittenAtMs - preparationStartedAtMs,
    bytes: params.prefetchedRemoteAudio.bytes.byteLength,
    sourceKind: "file",
    chunkIndex: params.chunkIndex,
    chunkCount: params.chunkCount,
  });
  return {
    audio: params.prefetchedRemoteAudio,
    sourceKind: "file",
    sourceUri: fileUri,
    cleanupFileUri: fileUri,
    preparedAtMs: fileWrittenAtMs,
  };
}

export async function releasePreparedRemoteAudioSource(prepared: PreparedRemoteAudioSource | null | undefined): Promise<void> {
  if (!prepared?.cleanupFileUri) {
    return;
  }

  try {
    await FileSystem.deleteAsync(prepared.cleanupFileUri, { idempotent: true });
  } catch {
    // Ignore cleanup failures for discarded prefetched audio.
  }
}

export async function stopRemoteTtsPlayback(params: {
  remoteTtsSoundRef: MutableRefObject<Audio.Sound | null>;
  remoteTtsFileRef: MutableRefObject<string | null>;
}): Promise<void> {
  const sound = params.remoteTtsSoundRef.current;
  params.remoteTtsSoundRef.current = null;
  if (sound) {
    try {
      sound.setOnPlaybackStatusUpdate(null);
    } catch {
      // Ignore listener cleanup failures.
    }
    try {
      await sound.stopAsync();
    } catch {
      // Ignore stop failures.
    }
    try {
      await sound.unloadAsync();
    } catch {
      // Ignore unload failures.
    }
  }

  const fileUri = params.remoteTtsFileRef.current;
  params.remoteTtsFileRef.current = null;
  if (fileUri) {
    try {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
}

async function speakWithRemoteTtsFallbackBounded(params: SpeakWithTtsFallbackParams): Promise<TtsPlaybackResult> {
  const selectedVoiceIdentifierRef = params.selectedVoiceIdentifierRef ?? { current: undefined };
  const remoteTtsSoundRef = params.remoteTtsSoundRef ?? { current: null };
  const remoteTtsFileRef = params.remoteTtsFileRef ?? { current: null };
  const assistantTextReceivedAtMs = params.assistantTextReceivedAtMs ?? Date.now();
  const textChars = params.text.trim().length;
  const remoteAllowed = params.allowRemoteTts ?? true;
  const fallbackSpeechAllowed = params.allowFallbackSpeech ?? true;
  const shouldAttemptRemote =
    params.remoteTtsEnabled &&
    params.remoteAiConfigured &&
    remoteAllowed &&
    Platform.OS !== "web";
  const remotePlaybackRate = resolvePlatformRemotePlaybackRate(params.voiceGender, params.voiceProfile);
  const isCancelled = (): boolean => Boolean(params.abortSignal?.aborted) || Boolean(params.isCancelled?.());
  const throwIfCancelled = () => {
    if (isCancelled()) {
      throw new TtsPlaybackCancelledError();
    }
  };
  const logFinalOutcome = (payload: {
    outcome: string;
    reason?: string;
    sourceKind?: RemoteAudioSourceKind | null;
    playbackStarted?: boolean;
    fallbackAttempted?: boolean;
    error?: string;
  }) => {
    logTtsDiagnosticCounter("final_user_visible_outcome", {
      source: params.source,
      preset: params.preset,
      correlationId: params.correlationId,
      reason: payload.reason,
      sourceKind: payload.sourceKind,
      playbackStarted: payload.playbackStarted,
      fallbackAttempted: payload.fallbackAttempted,
      chunkIndex: params.chunkIndex,
      chunkCount: params.chunkCount,
      error: payload.error,
      outcome: payload.outcome,
    });
  };
  const buildResult = (payload: Omit<TtsPlaybackResult, "chunkIndex" | "chunkCount">): TtsPlaybackResult => ({
    ...payload,
    ...(typeof params.chunkIndex === "number" ? { chunkIndex: params.chunkIndex } : {}),
    ...(typeof params.chunkCount === "number" ? { chunkCount: params.chunkCount } : {}),
  });

  await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
  try {
    Speech.stop();
  } catch {
    // Ignore stale fallback speech cleanup failures.
  }

  let fallbackReason: string | null = null;

  if (shouldAttemptRemote) {
    throwIfCancelled();
    logTtsMode(params.source, params.preset, "remote", "remoteCallStarted");
    logIosTtsSelection({
      source: params.source,
      preset: params.preset,
      voiceGender: params.voiceGender,
      voiceProfile: params.voiceProfile,
      stage: "remote_attempt",
      playbackRate: remotePlaybackRate,
      remoteTtsEnabled: params.remoteTtsEnabled,
      remoteAiConfigured: params.remoteAiConfigured,
      allowRemoteTts: remoteAllowed,
      correlationId: params.correlationId,
    });
    const requestStartedAtMs = Date.now();
    let playbackStarted = false;
    let sourceKind: RemoteAudioSourceKind | null = null;
    let remoteStage: "fetch" | "source_prepare" | "audio_load" | "playback" =
      params.preparedRemoteSource || params.prefetchedRemoteAudio ? "source_prepare" : "fetch";
    let deviceFallbackAttempted = false;
    let deviceFallbackSucceeded = false;

    const logLifecycle = (payload: {
      phase: string;
      sourceKind?: RemoteAudioSourceKind | null;
      bytes?: number;
      timeoutMs?: number;
      elapsedMs?: number;
      error?: string;
      details?: Record<string, unknown>;
    }) => {
      logTtsLifecycle({
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        phase: payload.phase,
        sourceKind: payload.sourceKind ?? sourceKind,
        textChars,
        bytes: payload.bytes,
        timeoutMs: payload.timeoutMs,
        elapsedMs: payload.elapsedMs,
        error: payload.error,
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
        details: payload.details,
      });
    };

    const logRemoteFailureCounter = (error: unknown) => {
      const errorMessage = getErrorMessage(error, "Remote TTS failed.");
      const event: TtsDiagnosticEvent =
        error instanceof TtsPlaybackTimeoutError
          ? "remote_tts_playback_timeout"
          : remoteStage === "fetch"
            ? "remote_tts_fetch_failure"
            : "remote_tts_playback_failure";
      logTtsDiagnosticCounter(event, {
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        reason: remoteStage,
        sourceKind,
        playbackStarted,
        fallbackAttempted: deviceFallbackAttempted,
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
        error: errorMessage,
      });
    };

    const completeRemoteSuccess = async (): Promise<TtsPlaybackResult> => {
      logTtsDiagnosticCounter("remote_tts_success", {
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        reason: "remote_completed",
        sourceKind,
        playbackStarted,
        fallbackAttempted: deviceFallbackAttempted,
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
      });
      logFinalOutcome({
        outcome: "remote_tts_completed",
        reason: "remote_completed",
        sourceKind,
        playbackStarted,
        fallbackAttempted: deviceFallbackAttempted,
      });
      logIosTtsSelection({
        source: params.source,
        preset: params.preset,
        voiceGender: params.voiceGender,
        voiceProfile: params.voiceProfile,
        stage: "remote_success",
        sourceKind,
        playbackRate: remotePlaybackRate,
        remoteTtsEnabled: params.remoteTtsEnabled,
        remoteAiConfigured: params.remoteAiConfigured,
        allowRemoteTts: remoteAllowed,
        correlationId: params.correlationId,
      });
      await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
      return buildResult({
        outcome: "remote_tts_completed",
        mode: "remote",
        degraded: false,
        timedOut: false,
        reason: "remote_completed",
        sourceKind,
        playbackStarted,
      });
    };

    const createPlaybackSession = (sessionSourceKind: RemoteAudioSourceKind, bytes: number) => {
      const sound = new Audio.Sound();
      remoteTtsSoundRef.current = sound;
      let audioLoadedAtMs = 0;
      let playbackStartedMarked = false;
      let lastStatusKey: string | null = null;
      let playbackTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let resolvePlayback!: () => void;
      let rejectPlayback!: (error: unknown) => void;
      const playbackFinished = new Promise<void>((resolve, reject) => {
        resolvePlayback = resolve;
        rejectPlayback = reject;
      });
      const clearPlaybackTimeout = () => {
        if (playbackTimeoutHandle) {
          clearTimeout(playbackTimeoutHandle);
          playbackTimeoutHandle = null;
        }
      };
      const clearStatusListener = () => {
        try {
          sound.setOnPlaybackStatusUpdate(null);
        } catch {
          // Ignore listener cleanup failures.
        }
      };
      const settlePlayback = (kind: "resolve" | "reject", error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearPlaybackTimeout();
        clearStatusListener();
        if (kind === "resolve") {
          resolvePlayback();
        } else {
          rejectPlayback(error);
        }
      };
      const markPlaybackStarted = (startedAtMs: number) => {
        if (playbackStartedMarked || settled) {
          return;
        }
        if (isCancelled() || remoteTtsSoundRef.current !== sound) {
          settlePlayback("reject", new TtsPlaybackCancelledError());
          return;
        }
        playbackStartedMarked = true;
        playbackStarted = true;
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "play_started",
          assistantTextReceivedAtMs,
          tsMs: startedAtMs,
          requestMs: startedAtMs - requestStartedAtMs,
          startupMs: audioLoadedAtMs > 0 ? startedAtMs - audioLoadedAtMs : undefined,
          sourceKind: sessionSourceKind,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        logLifecycle({
          phase: "playback_start",
          sourceKind: sessionSourceKind,
          bytes,
          elapsedMs: startedAtMs - requestStartedAtMs,
        });
        params.onPlaybackStart?.({ source: params.source, mode: "remote", startedAtMs });
      };
      const startPlaybackTimeout = (timeoutMs: number) => {
        clearPlaybackTimeout();
        playbackTimeoutHandle = setTimeout(() => {
          logLifecycle({
            phase: "playback_timeout",
            sourceKind: sessionSourceKind,
            bytes,
            timeoutMs,
            elapsedMs: Date.now() - requestStartedAtMs,
          });
          settlePlayback(
            "reject",
            new TtsPlaybackTimeoutError(`Remote TTS playback timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`),
          );
          void stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
        }, timeoutMs);
      };

      sound.setOnPlaybackStatusUpdate((status) => {
        if (settled) {
          return;
        }
        if (isCancelled() || remoteTtsSoundRef.current !== sound) {
          logLifecycle({
            phase: "playback_stale_sound_ignored",
            sourceKind: sessionSourceKind,
            bytes,
            elapsedMs: Date.now() - requestStartedAtMs,
          });
          settlePlayback("reject", new TtsPlaybackCancelledError());
          return;
        }

        if (!status.isLoaded) {
          const statusKey = `unloaded:${status.error ?? "none"}`;
          if (statusKey !== lastStatusKey) {
            lastStatusKey = statusKey;
            logLifecycle({
              phase: "playback_status",
              sourceKind: sessionSourceKind,
              bytes,
              error: status.error,
              elapsedMs: Date.now() - requestStartedAtMs,
              details: { loaded: false },
            });
          }
          if (status.error) {
            logLifecycle({
              phase: "playback_error",
              sourceKind: sessionSourceKind,
              bytes,
              error: status.error,
              elapsedMs: Date.now() - requestStartedAtMs,
            });
            settlePlayback("reject", new Error(status.error));
          }
          return;
        }

        const statusKey = `loaded:${status.isPlaying}:${status.isBuffering}:${status.didJustFinish}`;
        if (statusKey !== lastStatusKey) {
          lastStatusKey = statusKey;
          logLifecycle({
            phase: "playback_status",
            sourceKind: sessionSourceKind,
            bytes,
            elapsedMs: Date.now() - requestStartedAtMs,
            details: {
              loaded: true,
              isPlaying: status.isPlaying,
              isBuffering: status.isBuffering,
              didJustFinish: status.didJustFinish,
              positionMillis: status.positionMillis,
              durationMillis: status.durationMillis ?? null,
            },
          });
        }

        if (status.isPlaying) {
          markPlaybackStarted(Date.now());
        }

        if (status.didJustFinish) {
          logLifecycle({
            phase: "did_just_finish",
            sourceKind: sessionSourceKind,
            bytes,
            elapsedMs: Date.now() - requestStartedAtMs,
            details: {
              positionMillis: status.positionMillis,
              durationMillis: status.durationMillis ?? null,
            },
          });
          settlePlayback("resolve");
        }
      });

      return {
        sound,
        setAudioLoadedAtMs(value: number) {
          audioLoadedAtMs = value;
        },
        markPlaybackStarted,
        startPlaybackTimeout,
        playbackFinished,
      };
    };

    const loadAndPlayPreparedSource = async (paramsForSource: {
      sourceKind: RemoteAudioSourceKind;
      sourceUri: string;
      preparationStartedAtMs: number;
      audio: PrefetchedRemoteSpeechChunk;
      cleanupFileUri?: string | null;
      skipSourcePreparedLog?: boolean;
    }): Promise<void> => {
      throwIfCancelled();
      await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
      sourceKind = paramsForSource.sourceKind;
      remoteTtsFileRef.current = paramsForSource.cleanupFileUri ?? null;
      const bytes = paramsForSource.audio.bytes.byteLength;
      const playbackSession = createPlaybackSession(paramsForSource.sourceKind, bytes);
      const sourcePreparedAtMs = Date.now();
      if (!paramsForSource.skipSourcePreparedLog) {
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "source_prepared",
          assistantTextReceivedAtMs,
          tsMs: sourcePreparedAtMs,
          requestMs: sourcePreparedAtMs - requestStartedAtMs,
          preparationMs: sourcePreparedAtMs - paramsForSource.preparationStartedAtMs,
          bytes,
          sourceKind: paramsForSource.sourceKind,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
      }
      remoteStage = "audio_load";
      const audioLoadStartedAtMs = Date.now();
      logLifecycle({
        phase: "audio_load_start",
        sourceKind: paramsForSource.sourceKind,
        bytes,
        timeoutMs: TTS_AUDIO_LOAD_TIMEOUT_MS,
        elapsedMs: audioLoadStartedAtMs - requestStartedAtMs,
      });

      try {
        const loadStatus = await withTimeout({
          promise: playbackSession.sound.loadAsync(
            {
              uri: paramsForSource.sourceUri,
            },
            {
              shouldPlay: true,
              rate: remotePlaybackRate,
              shouldCorrectPitch: true,
            },
            false,
          ),
          timeoutMs: TTS_AUDIO_LOAD_TIMEOUT_MS,
          createTimeoutError: () => new TtsAudioLoadTimeoutError(),
          onTimeout: () => {
            logLifecycle({
              phase: "audio_load_timeout",
              sourceKind: paramsForSource.sourceKind,
              bytes,
              timeoutMs: TTS_AUDIO_LOAD_TIMEOUT_MS,
              elapsedMs: Date.now() - requestStartedAtMs,
            });
            void stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
          },
        });
        throwIfCancelled();
        const audioLoadedAtMs = Date.now();
        playbackSession.setAudioLoadedAtMs(audioLoadedAtMs);
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "audio_loaded",
          assistantTextReceivedAtMs,
          tsMs: audioLoadedAtMs,
          requestMs: audioLoadedAtMs - requestStartedAtMs,
          loadMs: audioLoadedAtMs - audioLoadStartedAtMs,
          bytes,
          sourceKind: paramsForSource.sourceKind,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        const durationMs = loadStatus.isLoaded ? loadStatus.durationMillis ?? null : null;
        const playbackTimeoutMs = resolveTtsPlaybackTimeoutMs({
          text: params.text,
          audioDurationMs: durationMs,
        });
        logLifecycle({
          phase: "audio_load_success",
          sourceKind: paramsForSource.sourceKind,
          bytes,
          timeoutMs: playbackTimeoutMs,
          elapsedMs: audioLoadedAtMs - requestStartedAtMs,
          details: {
            durationMillis: durationMs,
            shouldPlay: loadStatus.isLoaded ? loadStatus.shouldPlay : null,
            isPlaying: loadStatus.isLoaded ? loadStatus.isPlaying : null,
          },
        });
        remoteStage = "playback";
        playbackSession.startPlaybackTimeout(playbackTimeoutMs);
        if (loadStatus.isLoaded && loadStatus.isPlaying) {
          playbackSession.markPlaybackStarted(audioLoadedAtMs);
        }
        await playbackSession.playbackFinished;
        logLifecycle({
          phase: "playback_completed",
          sourceKind: paramsForSource.sourceKind,
          bytes,
          elapsedMs: Date.now() - requestStartedAtMs,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error, "Remote TTS playback failed.");
        logLifecycle({
          phase: remoteStage === "audio_load" ? "audio_load_failure" : "playback_failure",
          sourceKind: paramsForSource.sourceKind,
          bytes,
          elapsedMs: Date.now() - requestStartedAtMs,
          error: errorMessage,
        });
        throw error;
      }
    };

    try {
      let preparedRemoteSource = params.preparedRemoteSource ?? null;
      let ttsAudio = preparedRemoteSource?.audio ?? params.prefetchedRemoteAudio ?? null;
      if (!ttsAudio) {
        remoteStage = "fetch";
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "request_start",
          assistantTextReceivedAtMs,
          tsMs: requestStartedAtMs,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        ttsAudio = await fetchAiTtsAudio({
          userId: params.userId,
          authToken: params.authToken,
          text: params.text,
          preset: params.preset,
          signal: params.abortSignal,
          correlationId: params.correlationId,
        });
        throwIfCancelled();
        const audioBytesReceivedAtMs = Date.now();
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "bytes_received",
          assistantTextReceivedAtMs,
          tsMs: audioBytesReceivedAtMs,
          requestMs: audioBytesReceivedAtMs - requestStartedAtMs,
          bytes: ttsAudio.bytes.byteLength,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        logLifecycle({
          phase: "remote_audio_ready",
          sourceKind: null,
          bytes: ttsAudio.bytes.byteLength,
          elapsedMs: audioBytesReceivedAtMs - requestStartedAtMs,
          details: { contentType: ttsAudio.contentType },
        });
      } else {
        const prefetchedReadyAtMs = Date.now();
        if (!preparedRemoteSource) {
          logTtsTiming({
            source: params.source,
            preset: params.preset,
            correlationId: params.correlationId,
            phase: "prefetched_bytes_ready",
            assistantTextReceivedAtMs,
            tsMs: prefetchedReadyAtMs,
            requestMs: ttsAudio.ttsLatencyMs ?? undefined,
            bytes: ttsAudio.bytes.byteLength,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
        }
        logLifecycle({
          phase: "remote_audio_ready",
          sourceKind: preparedRemoteSource?.sourceKind ?? null,
          bytes: ttsAudio.bytes.byteLength,
          elapsedMs: prefetchedReadyAtMs - requestStartedAtMs,
          details: {
            contentType: ttsAudio.contentType,
            prefetched: true,
            prepared: Boolean(preparedRemoteSource),
          },
        });
      }

      // eslint-disable-next-line no-console
      console.log(`[TTS-PLAY] profile=${params.voiceProfile} rate=${remotePlaybackRate}`);

      if (preparedRemoteSource) {
        try {
          await loadAndPlayPreparedSource({
            sourceKind: preparedRemoteSource.sourceKind,
            sourceUri: preparedRemoteSource.sourceUri,
            preparationStartedAtMs: preparedRemoteSource.preparedAtMs,
            audio: preparedRemoteSource.audio,
            cleanupFileUri: preparedRemoteSource.cleanupFileUri,
            skipSourcePreparedLog: true,
          });
          if (preparedRemoteSource.sourceKind === "inline") {
            inlineRemoteAudioPlaybackSupported = true;
          }
          return await completeRemoteSuccess();
        } catch (preparedPlaybackError) {
          if (preparedPlaybackError instanceof TtsPlaybackCancelledError || isCancelled()) {
            throw preparedPlaybackError;
          }
          if (preparedRemoteSource.sourceKind === "inline" && !playbackStarted) {
            inlineRemoteAudioPlaybackSupported = false;
            await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
            // eslint-disable-next-line no-console
            console.log("[TTS-MODE]", {
              source: params.source,
              preset: params.preset,
              mode: "remote",
              reason: "inlineFallbackToFile",
              correlationId: params.correlationId ?? null,
              error: getErrorMessage(preparedPlaybackError, "Inline TTS playback failed."),
            });
            preparedRemoteSource = null;
          } else {
            throw preparedPlaybackError;
          }
        }
      }

      const shouldAttemptInlineAudio = shouldAttemptInlineRemoteAudio(ttsAudio.contentType);

      if (shouldAttemptInlineAudio) {
        const inlinePreparationStartedAtMs = Date.now();
        try {
          await loadAndPlayPreparedSource({
            sourceKind: "inline",
            sourceUri: buildInlineAudioDataUri(ttsAudio.contentType, ttsAudio.bytes),
            preparationStartedAtMs: inlinePreparationStartedAtMs,
            audio: ttsAudio,
          });
          inlineRemoteAudioPlaybackSupported = true;
          return await completeRemoteSuccess();
        } catch (inlinePlaybackError) {
          if (inlinePlaybackError instanceof TtsPlaybackCancelledError || isCancelled()) {
            throw inlinePlaybackError;
          }
          inlineRemoteAudioPlaybackSupported = false;
          await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
          if (playbackStarted) {
            throw inlinePlaybackError;
          }
          // eslint-disable-next-line no-console
          console.log("[TTS-MODE]", {
            source: params.source,
            preset: params.preset,
            mode: "remote",
            reason: "inlineFallbackToFile",
            correlationId: params.correlationId ?? null,
            error: getErrorMessage(inlinePlaybackError, "Inline TTS playback failed."),
          });
        }
      } else {
        logIosRemoteTtsFilePlaybackPreference({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          contentType: ttsAudio.contentType,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
      }

      remoteStage = "source_prepare";
      const fileWriteStartedAtMs = Date.now();
      const fileUri = await writeRemoteAudioBytesToFile(ttsAudio.bytes);
      const fileWrittenAtMs = Date.now();
      logTtsTiming({
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        phase: "file_written",
        assistantTextReceivedAtMs,
        tsMs: fileWrittenAtMs,
        requestMs: fileWrittenAtMs - requestStartedAtMs,
        fileWriteMs: fileWrittenAtMs - fileWriteStartedAtMs,
        bytes: ttsAudio.bytes.byteLength,
        sourceKind: "file",
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
      });
      throwIfCancelled();

      await loadAndPlayPreparedSource({
        sourceKind: "file",
        sourceUri: fileUri,
        preparationStartedAtMs: fileWriteStartedAtMs,
        audio: ttsAudio,
        cleanupFileUri: fileUri,
      });
      return await completeRemoteSuccess();
    } catch (error) {
      if (error instanceof TtsPlaybackCancelledError || isCancelled()) {
        const cancellationState = params.describeCancellation?.() ?? {};
        const cancellationDetails = analyzeTtsCancellation({
          source: params.source,
          correlationId: params.correlationId ?? null,
          simulationSessionId: params.simulationSessionId ?? null,
          sourceKind,
          playbackStarted,
          fallbackAttempted: deviceFallbackAttempted,
          fallbackSucceeded: deviceFallbackSucceeded,
          chunkIndex: typeof params.chunkIndex === "number" ? params.chunkIndex : null,
          chunkCount: typeof params.chunkCount === "number" ? params.chunkCount : null,
          abortSignaled: Boolean(params.abortSignal?.aborted),
          superseded: Boolean(cancellationState.superseded),
          sessionEnding: Boolean(cancellationState.sessionEnding),
          screenChanging: Boolean(cancellationState.screenChanging),
        });
        // eslint-disable-next-line no-console
        console.warn("[TTS-CANCEL]", cancellationDetails);
        params.onRemoteCancellation?.(cancellationDetails);
        await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });
        logFinalOutcome({
          outcome: "tts_cancelled",
          reason: cancellationDetails.reason,
          sourceKind,
          playbackStarted,
          fallbackAttempted: deviceFallbackAttempted,
        });
        return buildResult({
          outcome: "tts_cancelled",
          mode: "cancelled",
          degraded: true,
          timedOut: false,
          reason: cancellationDetails.reason,
          sourceKind,
          playbackStarted,
        });
      }

      const errorMessage = getErrorMessage(error, "Remote TTS failed.");
      const remoteTimedOut = error instanceof TtsPlaybackTimeoutError;
      logRemoteFailureCounter(error);
      logIosTtsSelection({
        source: params.source,
        preset: params.preset,
        voiceGender: params.voiceGender,
        voiceProfile: params.voiceProfile,
        stage: "remote_failure",
        sourceKind,
        fallbackReason: remoteStage,
        error: errorMessage,
        playbackRate: remotePlaybackRate,
        remoteTtsEnabled: params.remoteTtsEnabled,
        remoteAiConfigured: params.remoteAiConfigured,
        allowRemoteTts: remoteAllowed,
        correlationId: params.correlationId,
      });
      logLifecycle({
        phase: "remote_path_failed",
        sourceKind,
        elapsedMs: Date.now() - requestStartedAtMs,
        error: errorMessage,
        details: {
          stage: remoteStage,
          playbackStarted,
        },
      });
      await stopRemoteTtsPlayback({ remoteTtsSoundRef, remoteTtsFileRef });

      if (playbackStarted) {
        logFinalOutcome({
          outcome: "remote_started_then_failed_unblocked",
          reason: remoteStage,
          sourceKind,
          playbackStarted,
          fallbackAttempted: false,
          error: errorMessage,
        });
        return buildResult({
          outcome: "remote_started_then_failed_unblocked",
          mode: "remote",
          degraded: true,
          timedOut: remoteTimedOut,
          reason: remoteStage,
          sourceKind,
          playbackStarted,
        });
      }

      deviceFallbackAttempted = true;
      fallbackReason = remoteStage;
      if (fallbackSpeechAllowed) {
        logTtsMode(params.source, params.preset, "fallback", "backendError");
      }
    }
  } else {
    fallbackReason =
      !params.remoteTtsEnabled || !remoteAllowed || Platform.OS === "web"
        ? "remoteTtsDisabled"
        : "remoteAiNotConfigured";
    if (fallbackSpeechAllowed) {
      logTtsMode(
        params.source,
        params.preset,
        "fallback",
        fallbackReason === "remoteAiNotConfigured" ? "remoteAiNotConfigured" : "remoteTtsDisabled",
      );
    }
  }

  if (!fallbackSpeechAllowed) {
    const reason = fallbackReason ?? "remote_unavailable";
    logIosTtsSelection({
      source: params.source,
      preset: params.preset,
      voiceGender: params.voiceGender,
      voiceProfile: params.voiceProfile,
      stage: "fallback_blocked",
      sourceKind: "fallback",
      fallbackReason: reason,
      playbackRate: remotePlaybackRate,
      remoteTtsEnabled: params.remoteTtsEnabled,
      remoteAiConfigured: params.remoteAiConfigured,
      allowRemoteTts: remoteAllowed,
      correlationId: params.correlationId,
    });
    throw new Error(`Remote voice sample unavailable (${reason}).`);
  }

  if (!selectedVoiceIdentifierRef.current) {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      selectedVoiceIdentifierRef.current = selectSpeechVoiceIdentifier(voices ?? [], params.voiceGender);
    } catch {
      selectedVoiceIdentifierRef.current = undefined;
    }
  }

  throwIfCancelled();
  const voiceTuning = getVoiceSpeechTuning(params.voiceProfile, params.voiceGender);
  const fallbackTimeoutMs = resolveTtsPlaybackTimeoutMs({ text: params.text });
  logTtsDiagnosticCounter("fallback_tts_used", {
    source: params.source,
    preset: params.preset,
    correlationId: params.correlationId,
    reason: fallbackReason ?? "remote_unavailable",
    fallbackAttempted: true,
    chunkIndex: params.chunkIndex,
    chunkCount: params.chunkCount,
  });
  // eslint-disable-next-line no-console
  console.warn("[TTS-DEGRADED]", {
    source: params.source,
    preset: params.preset,
    correlationId: params.correlationId ?? null,
    reason: fallbackReason ?? "remote_unavailable",
    textChars,
    timeoutMs: fallbackTimeoutMs,
    chunkIndex: params.chunkIndex ?? null,
    chunkCount: params.chunkCount ?? null,
  });
  logIosTtsSelection({
    source: params.source,
    preset: params.preset,
    voiceGender: params.voiceGender,
    voiceProfile: params.voiceProfile,
    stage: "fallback_speech",
    sourceKind: "fallback",
    fallbackReason: fallbackReason ?? "remote_unavailable",
    playbackRate: remotePlaybackRate,
    remoteTtsEnabled: params.remoteTtsEnabled,
    remoteAiConfigured: params.remoteAiConfigured,
    allowRemoteTts: remoteAllowed,
    correlationId: params.correlationId,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let playbackStartedMarked = false;
      const fallbackStartedAtMs = Date.now();
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const settle = (kind: "resolve" | "reject", error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (kind === "resolve") {
          resolve();
        } else {
          reject(error);
        }
      };
      const markPlaybackStarted = () => {
        if (playbackStartedMarked || settled) {
          return;
        }
        playbackStartedMarked = true;
        logTtsLifecycle({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "fallback_speech_start",
          textChars,
          timeoutMs: fallbackTimeoutMs,
          elapsedMs: Date.now() - fallbackStartedAtMs,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        params.onPlaybackStart?.({ source: params.source, mode: "fallback", startedAtMs: Date.now() });
      };

      timeoutHandle = setTimeout(() => {
        logTtsLifecycle({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "fallback_speech_timeout",
          textChars,
          timeoutMs: fallbackTimeoutMs,
          elapsedMs: Date.now() - fallbackStartedAtMs,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        try {
          Speech.stop();
        } catch {
          // Ignore fallback speech stop failures after timeout.
        }
        settle(
          "reject",
          new TtsFallbackTimeoutError(`Fallback speech timed out after ${Math.ceil(fallbackTimeoutMs / 1000)} seconds.`),
        );
      }, fallbackTimeoutMs);

      logTtsLifecycle({
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        phase: "fallback_speech_invoked",
        textChars,
        timeoutMs: fallbackTimeoutMs,
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
      });
      try {
        Speech.stop();
      } catch {
        // Ignore stale fallback speech cleanup failures.
      }
      Speech.speak(params.text, {
        language: "en-US",
        voice: selectedVoiceIdentifierRef.current,
        rate: voiceTuning.speechRate,
        pitch: voiceTuning.speechPitch,
        onStart: () => {
          markPlaybackStarted();
        },
        onDone: () => {
          logTtsLifecycle({
            source: params.source,
            preset: params.preset,
            correlationId: params.correlationId,
            phase: "fallback_speech_done",
            textChars,
            elapsedMs: Date.now() - fallbackStartedAtMs,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
          settle("resolve");
        },
        onStopped: () => {
          logTtsLifecycle({
            source: params.source,
            preset: params.preset,
            correlationId: params.correlationId,
            phase: "fallback_speech_stopped",
            textChars,
            elapsedMs: Date.now() - fallbackStartedAtMs,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
          settle("resolve");
        },
        onError: (speechError?: unknown) => {
          markPlaybackStarted();
          const errorMessage = getErrorMessage(speechError, "Fallback speech failed.");
          logTtsLifecycle({
            source: params.source,
            preset: params.preset,
            correlationId: params.correlationId,
            phase: "fallback_speech_error",
            textChars,
            elapsedMs: Date.now() - fallbackStartedAtMs,
            error: errorMessage,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
          settle("reject", new Error(errorMessage));
        },
      });
    });
    logTtsDiagnosticCounter("fallback_tts_success", {
      source: params.source,
      preset: params.preset,
      correlationId: params.correlationId,
      reason: fallbackReason ?? "remote_unavailable",
      fallbackAttempted: true,
      chunkIndex: params.chunkIndex,
      chunkCount: params.chunkCount,
    });
    logFinalOutcome({
      outcome: "fallback_tts_completed",
      reason: fallbackReason ?? "remote_unavailable",
      fallbackAttempted: true,
    });
    return buildResult({
      outcome: "fallback_tts_completed",
      mode: "fallback",
      degraded: true,
      timedOut: false,
      reason: fallbackReason ?? "remote_unavailable",
      sourceKind: null,
      playbackStarted: true,
    });
  } catch (fallbackError) {
    const errorMessage = getErrorMessage(fallbackError, "Fallback speech failed.");
    logTtsDiagnosticCounter(
      fallbackError instanceof TtsFallbackTimeoutError ? "fallback_tts_timeout" : "fallback_tts_failed",
      {
        source: params.source,
        preset: params.preset,
        correlationId: params.correlationId,
        reason: fallbackReason ?? "remote_unavailable",
        fallbackAttempted: true,
        chunkIndex: params.chunkIndex,
        chunkCount: params.chunkCount,
        error: errorMessage,
      },
    );
    logFinalOutcome({
      outcome: "fallback_tts_failed",
      reason: fallbackReason ?? "remote_unavailable",
      fallbackAttempted: true,
      error: errorMessage,
    });
    throw fallbackError;
  }
}

export async function speakWithRemoteTtsFallback(params: SpeakWithTtsFallbackParams): Promise<TtsPlaybackResult> {
  return speakWithRemoteTtsFallbackBounded(params);
}
