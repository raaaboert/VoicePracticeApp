import type { MutableRefObject } from "react";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { getVoiceSpeechTuning, selectSpeechVoiceIdentifier } from "../data/preferences";
import type { AiVoiceGender, AiVoiceProfile } from "../types";
import { fetchAiTtsAudio, RemoteTtsPreset } from "./api";

type TtsSource = "simulation" | "sample";
type TtsModeReason = "remoteTtsDisabled" | "remoteAiNotConfigured" | "remoteCallStarted" | "backendError";
const MIN_PLAYBACK_RATE = 0.8;
const MAX_PLAYBACK_RATE = 1.4;
const REMOTE_PLAYBACK_BASE_RATE_BY_PROFILE: Record<AiVoiceProfile, number> = {
  warm: 1.08,
  balanced: 1.15,
  bright: 1.22,
};
const REMOTE_PLAYBACK_GLOBAL_MULTIPLIER = 1.03;

interface SpeakWithTtsFallbackParams {
  source: TtsSource;
  text: string;
  preset: RemoteTtsPreset;
  userId: string;
  authToken: string;
  remoteTtsEnabled: boolean;
  remoteAiConfigured: boolean;
  allowRemoteTts?: boolean;
  voiceGender: AiVoiceGender;
  voiceProfile: AiVoiceProfile;
  selectedVoiceIdentifierRef?: MutableRefObject<string | undefined>;
  remoteTtsSoundRef?: MutableRefObject<Audio.Sound | null>;
  remoteTtsFileRef?: MutableRefObject<string | null>;
  assistantTextReceivedAtMs?: number;
  prefetchedRemoteAudio?: { bytes: Uint8Array; contentType: string } | null;
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  onPlaybackStart?: (details: { source: TtsSource; mode: "remote" | "fallback"; startedAtMs: number }) => void;
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
  phase: "request_start" | "bytes_received" | "audio_loaded" | "play_started";
  assistantTextReceivedAtMs: number;
  tsMs?: number;
  requestMs?: number;
  loadMs?: number;
  startupMs?: number;
  bytes?: number;
}) {
  const tsMs = typeof payload.tsMs === "number" ? payload.tsMs : Date.now();
  const elapsedMs = tsMs - payload.assistantTextReceivedAtMs;
  // eslint-disable-next-line no-console
  console.log("[TTS-TIMING]", {
    source: payload.source,
    preset: payload.preset,
    phase: payload.phase,
    tsMs,
    elapsedMs,
    ...(typeof payload.requestMs === "number" ? { requestMs: payload.requestMs } : {}),
    ...(typeof payload.loadMs === "number" ? { loadMs: payload.loadMs } : {}),
    ...(typeof payload.startupMs === "number" ? { startupMs: payload.startupMs } : {}),
    ...(typeof payload.bytes === "number" ? { bytes: payload.bytes } : {}),
  });
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
    try {
      let ttsAudio = params.prefetchedRemoteAudio ?? null;
      if (!ttsAudio) {
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          phase: "request_start",
          assistantTextReceivedAtMs,
          tsMs: requestStartedAtMs,
        });
        ttsAudio = await fetchAiTtsAudio({
          userId: params.userId,
          authToken: params.authToken,
          text: params.text,
          preset: params.preset,
          signal: params.abortSignal,
        });
        throwIfCancelled();
        const audioBytesReceivedAtMs = Date.now();
        logTtsTiming({
          source: params.source,
          preset: params.preset,
          phase: "bytes_received",
          assistantTextReceivedAtMs,
          tsMs: audioBytesReceivedAtMs,
          requestMs: audioBytesReceivedAtMs - requestStartedAtMs,
          bytes: ttsAudio.bytes.byteLength,
        });
      }
      const cacheDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!cacheDirectory) {
        throw new Error("No writable cache directory available for TTS playback.");
      }

      const fileUri = `${cacheDirectory}vp-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
      remoteTtsFileRef.current = fileUri;
      await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(ttsAudio.bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      throwIfCancelled();

      const sound = new Audio.Sound();
      remoteTtsSoundRef.current = sound;
      const audioLoadStartedAtMs = Date.now();
      await sound.loadAsync({ uri: fileUri }, { shouldPlay: false });
      const audioLoadedAtMs = Date.now();
      logTtsTiming({
        source: params.source,
        preset: params.preset,
        phase: "audio_loaded",
        assistantTextReceivedAtMs,
        tsMs: audioLoadedAtMs,
        requestMs: audioLoadedAtMs - requestStartedAtMs,
        loadMs: audioLoadedAtMs - audioLoadStartedAtMs,
      });
      throwIfCancelled();
      const remotePlaybackRate = resolveRemotePlaybackRate(params.voiceProfile);
      // eslint-disable-next-line no-console
      console.log(`[TTS-PLAY] profile=${params.voiceProfile} rate=${remotePlaybackRate}`);
      try {
        await sound.setRateAsync(remotePlaybackRate, true);
      } catch {
        // Ignore rate-control errors and continue with default playback speed.
      }
      await new Promise<void>((resolve, reject) => {
        let playbackStartedMarked = false;
        const markPlaybackStarted = (startedAtMs: number) => {
          if (playbackStartedMarked) {
            return;
          }
          playbackStartedMarked = true;
          logTtsTiming({
            source: params.source,
            preset: params.preset,
            phase: "play_started",
            assistantTextReceivedAtMs,
            tsMs: startedAtMs,
            requestMs: startedAtMs - requestStartedAtMs,
            startupMs: startedAtMs - audioLoadedAtMs,
          });
          params.onPlaybackStart?.({ source: params.source, mode: "remote", startedAtMs });
        };
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) {
            if (status.error) {
              reject(new Error(status.error));
              return;
            }
            resolve();
            return;
          }

          if (status.isPlaying) {
            markPlaybackStarted(Date.now());
          }

          if (status.didJustFinish) {
            resolve();
          }
        });
        void (async () => {
          try {
            throwIfCancelled();
            await sound.playAsync();
          } catch (playbackError) {
            reject(playbackError instanceof Error ? playbackError : new Error("TTS playback failed."));
          }
        })();
      });

      await stopRemoteTtsPlayback({
        remoteTtsSoundRef,
        remoteTtsFileRef,
      });
      return;
    } catch (error) {
      if (error instanceof TtsPlaybackCancelledError || isCancelled()) {
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
