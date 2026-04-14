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
type RemoteAudioSourceKind = "inline" | "file";
const MIN_PLAYBACK_RATE = 0.8;
const MAX_PLAYBACK_RATE = 1.4;
const REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE: Record<AiVoiceProfile, number> = {
  warm: 1.08,
  balanced: 1.15,
  bright: 1.22,
};
const REMOTE_PLAYBACK_GLOBAL_MULTIPLIER = 1.03;
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

class TtsPlaybackCancelledError extends Error {
  constructor() {
    super("TTS playback cancelled.");
    this.name = "TtsPlaybackCancelledError";
  }
}

export function toRemoteTtsPreset(voiceGender: AiVoiceGender, voiceProfile: AiVoiceProfile): RemoteTtsPreset {
  return `${voiceGender}-${voiceProfile}` as RemoteTtsPreset;
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

function clampPlaybackRate(value: number): number {
  return Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, value));
}

function resolveRemotePlaybackRate(profile: AiVoiceProfile): number {
  const baseRate = REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE[profile] ?? REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE.balanced;
  return clampPlaybackRate(baseRate * REMOTE_PLAYBACK_GLOBAL_MULTIPLIER);
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
  const shouldAttemptInlineAudio =
    params.prefetchedRemoteAudio.contentType.startsWith("audio/") && inlineRemoteAudioPlaybackSupported !== false;

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

export async function speakWithRemoteTtsFallback(params: SpeakWithTtsFallbackParams): Promise<void> {
  const selectedVoiceIdentifierRef = params.selectedVoiceIdentifierRef ?? { current: undefined };
  const remoteTtsSoundRef = params.remoteTtsSoundRef ?? { current: null };
  const remoteTtsFileRef = params.remoteTtsFileRef ?? { current: null };
  const assistantTextReceivedAtMs = params.assistantTextReceivedAtMs ?? Date.now();
  const shouldAttemptRemote =
    params.remoteTtsEnabled &&
    params.remoteAiConfigured &&
    (params.allowRemoteTts ?? true) &&
    Platform.OS !== "web";
  const isCancelled = (): boolean => Boolean(params.abortSignal?.aborted) || Boolean(params.isCancelled?.());
  const throwIfCancelled = () => {
    if (isCancelled()) {
      throw new TtsPlaybackCancelledError();
    }
  };

  if (shouldAttemptRemote) {
    throwIfCancelled();
    logTtsMode(params.source, params.preset, "remote", "remoteCallStarted");
    const requestStartedAtMs = Date.now();
    let playbackStarted = false;
    let sourceKind: RemoteAudioSourceKind | null = null;
    let fallbackAttempted = false;
    let fallbackSucceeded = false;
    try {
      let preparedRemoteSource = params.preparedRemoteSource ?? null;
      let ttsAudio = preparedRemoteSource?.audio ?? params.prefetchedRemoteAudio ?? null;
      if (!ttsAudio) {
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
      } else if (!preparedRemoteSource) {
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          correlationId: params.correlationId,
          phase: "prefetched_bytes_ready",
          assistantTextReceivedAtMs,
          tsMs: Date.now(),
          requestMs: ttsAudio.ttsLatencyMs ?? undefined,
          bytes: ttsAudio.bytes.byteLength,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
      }
      const remotePlaybackRate = resolveRemotePlaybackRate(params.voiceProfile);
      // eslint-disable-next-line no-console
      console.log(`[TTS-PLAY] profile=${params.voiceProfile} rate=${remotePlaybackRate}`);

      const createPlaybackSession = () => {
        const sound = new Audio.Sound();
        remoteTtsSoundRef.current = sound;
        let audioLoadedAtMs = 0;
        let playbackStartedMarked = false;
        let sawLoadedStatus = false;
        const markPlaybackStarted = (startedAtMs: number) => {
          if (playbackStartedMarked) {
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
            startupMs: startedAtMs - audioLoadedAtMs,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
          params.onPlaybackStart?.({ source: params.source, mode: "remote", startedAtMs });
        };
        const playbackFinished = new Promise<void>((resolve, reject) => {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (!status.isLoaded) {
              if (status.error) {
                reject(new Error(status.error));
                return;
              }
              if (sawLoadedStatus) {
                resolve();
              }
              return;
            }
            sawLoadedStatus = true;

            if (status.isPlaying) {
              markPlaybackStarted(Date.now());
            }

            if (status.didJustFinish) {
              resolve();
            }
          });
        });

        return {
          sound,
          setAudioLoadedAtMs(value: number) {
            audioLoadedAtMs = value;
          },
          markPlaybackStarted,
          playbackFinished,
        };
      };

      const loadAndPlayPreparedSource = async (paramsForSource: {
        sourceKind: RemoteAudioSourceKind;
        sourceUri: string;
        preparationStartedAtMs: number;
        cleanupFileUri?: string | null;
        skipSourcePreparedLog?: boolean;
      }): Promise<void> => {
        sourceKind = paramsForSource.sourceKind;
        remoteTtsFileRef.current = paramsForSource.cleanupFileUri ?? null;
        const playbackSession = createPlaybackSession();
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
            bytes: ttsAudio.bytes.byteLength,
            sourceKind: paramsForSource.sourceKind,
            chunkIndex: params.chunkIndex,
            chunkCount: params.chunkCount,
          });
        }
        const audioLoadStartedAtMs = Date.now();
        const loadStatus = await playbackSession.sound.loadAsync({
          uri: paramsForSource.sourceUri,
        }, {
          shouldPlay: true,
          rate: remotePlaybackRate,
          shouldCorrectPitch: true,
        }, false);
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
          sourceKind: paramsForSource.sourceKind,
          chunkIndex: params.chunkIndex,
          chunkCount: params.chunkCount,
        });
        if (loadStatus.isLoaded && loadStatus.isPlaying) {
          playbackSession.markPlaybackStarted(audioLoadedAtMs);
        }
        await playbackSession.playbackFinished;
      };

      if (preparedRemoteSource) {
        try {
          await loadAndPlayPreparedSource({
            sourceKind: preparedRemoteSource.sourceKind,
            sourceUri: preparedRemoteSource.sourceUri,
            preparationStartedAtMs: preparedRemoteSource.preparedAtMs,
            cleanupFileUri: preparedRemoteSource.cleanupFileUri,
            skipSourcePreparedLog: true,
          });
          if (preparedRemoteSource.sourceKind === "inline") {
            inlineRemoteAudioPlaybackSupported = true;
          }
          await stopRemoteTtsPlayback({
            remoteTtsSoundRef,
            remoteTtsFileRef,
          });
          return;
        } catch (preparedPlaybackError) {
          if (preparedRemoteSource.sourceKind === "inline") {
            fallbackAttempted = true;
            inlineRemoteAudioPlaybackSupported = false;
            await stopRemoteTtsPlayback({
              remoteTtsSoundRef,
              remoteTtsFileRef,
            });
            if (isCancelled()) {
              throw new TtsPlaybackCancelledError();
            }
            // eslint-disable-next-line no-console
            console.log("[TTS-MODE]", {
              source: params.source,
              preset: params.preset,
              mode: "remote",
              reason: "inlineFallbackToFile",
              correlationId: params.correlationId ?? null,
              error: preparedPlaybackError instanceof Error ? preparedPlaybackError.message : String(preparedPlaybackError),
            });
            preparedRemoteSource = null;
          } else {
            throw preparedPlaybackError;
          }
        }
      }

      const shouldAttemptInlineAudio =
        ttsAudio.contentType.startsWith("audio/") && inlineRemoteAudioPlaybackSupported !== false;

      if (shouldAttemptInlineAudio) {
        const inlinePreparationStartedAtMs = Date.now();
        try {
          await loadAndPlayPreparedSource({
            sourceKind: "inline",
            sourceUri: buildInlineAudioDataUri(ttsAudio.contentType, ttsAudio.bytes),
            preparationStartedAtMs: inlinePreparationStartedAtMs,
          });
          inlineRemoteAudioPlaybackSupported = true;
          await stopRemoteTtsPlayback({
            remoteTtsSoundRef,
            remoteTtsFileRef,
          });
          return;
        } catch (inlinePlaybackError) {
          fallbackAttempted = true;
          inlineRemoteAudioPlaybackSupported = false;
          await stopRemoteTtsPlayback({
            remoteTtsSoundRef,
            remoteTtsFileRef,
          });
          if (isCancelled()) {
            throw new TtsPlaybackCancelledError();
          }
          // eslint-disable-next-line no-console
          console.log("[TTS-MODE]", {
            source: params.source,
            preset: params.preset,
            mode: "remote",
            reason: "inlineFallbackToFile",
            correlationId: params.correlationId ?? null,
            error: inlinePlaybackError instanceof Error ? inlinePlaybackError.message : String(inlinePlaybackError),
          });
        }
      }

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
        cleanupFileUri: fileUri,
      });
      if (fallbackAttempted) {
        fallbackSucceeded = true;
      }

      await stopRemoteTtsPlayback({
        remoteTtsSoundRef,
        remoteTtsFileRef,
      });
      return;
    } catch (error) {
      if (error instanceof TtsPlaybackCancelledError || isCancelled()) {
        const cancellationState = params.describeCancellation?.() ?? {};
        const cancellationDetails = analyzeTtsCancellation({
          source: params.source,
          correlationId: params.correlationId ?? null,
          simulationSessionId: params.simulationSessionId ?? null,
          sourceKind,
          playbackStarted,
          fallbackAttempted,
          fallbackSucceeded,
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
        await stopRemoteTtsPlayback({
          remoteTtsSoundRef,
          remoteTtsFileRef,
        });
        return;
      }
      logTtsMode(params.source, params.preset, "fallback", "backendError");
      await stopRemoteTtsPlayback({
        remoteTtsSoundRef,
        remoteTtsFileRef,
      });
    }
  } else {
    const reason: TtsModeReason = params.remoteTtsEnabled ? "remoteAiNotConfigured" : "remoteTtsDisabled";
    logTtsMode(params.source, params.preset, "fallback", reason);
  }

  if (!selectedVoiceIdentifierRef.current) {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      selectedVoiceIdentifierRef.current = selectSpeechVoiceIdentifier(voices ?? [], params.voiceGender);
    } catch {
      selectedVoiceIdentifierRef.current = undefined;
    }
  }

  const voiceTuning = getVoiceSpeechTuning(params.voiceProfile, params.voiceGender);
  await new Promise<void>((resolve) => {
    let playbackStartedMarked = false;
    const markPlaybackStarted = () => {
      if (playbackStartedMarked) {
        return;
      }
      playbackStartedMarked = true;
      params.onPlaybackStart?.({ source: params.source, mode: "fallback", startedAtMs: Date.now() });
    };
    Speech.stop();
    Speech.speak(params.text, {
      language: "en-US",
      voice: selectedVoiceIdentifierRef.current,
      rate: voiceTuning.speechRate,
      pitch: voiceTuning.speechPitch,
      onStart: () => {
        markPlaybackStarted();
      },
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => {
        markPlaybackStarted();
        resolve();
      },
    });
  });
}
