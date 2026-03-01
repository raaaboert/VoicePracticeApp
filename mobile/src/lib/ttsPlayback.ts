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
const PLAYBACK_RATE = 1.1;
const MIN_PLAYBACK_RATE = 0.8;
const MAX_PLAYBACK_RATE = 1.4;

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

function logTtsTiming(payload: {
  source: TtsSource;
  preset: RemoteTtsPreset;
  event: "assistantTextReceived" | "ttsRequestStart" | "audioBytesReceived" | "playbackStarted";
  sinceAssistantTextMs: number;
  requestDurationMs?: number;
  networkMs?: number;
  playbackStartupMs?: number;
  bytes?: number;
}) {
  // eslint-disable-next-line no-console
  console.log("[TTS-TIMING]", payload);
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

  if (shouldAttemptRemote) {
    logTtsMode(params.source, params.preset, "remote", "remoteCallStarted");
    const requestStartedAtMs = Date.now();
    logTtsTiming({
      source: params.source,
      preset: params.preset,
      event: "ttsRequestStart",
      sinceAssistantTextMs: requestStartedAtMs - assistantTextReceivedAtMs,
    });
    try {
      const ttsAudio = await fetchAiTtsAudio({
        userId: params.userId,
        authToken: params.authToken,
        text: params.text,
        preset: params.preset,
      });
      const audioBytesReceivedAtMs = Date.now();
      logTtsTiming({
        source: params.source,
        preset: params.preset,
        event: "audioBytesReceived",
        sinceAssistantTextMs: audioBytesReceivedAtMs - assistantTextReceivedAtMs,
        requestDurationMs: audioBytesReceivedAtMs - requestStartedAtMs,
        networkMs: audioBytesReceivedAtMs - requestStartedAtMs,
        bytes: ttsAudio.bytes.byteLength,
      });
      const cacheDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!cacheDirectory) {
        throw new Error("No writable cache directory available for TTS playback.");
      }

      const fileUri = `${cacheDirectory}vp-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
      remoteTtsFileRef.current = fileUri;
      await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(ttsAudio.bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });

      const sound = new Audio.Sound();
      remoteTtsSoundRef.current = sound;
      await sound.loadAsync({ uri: fileUri }, { shouldPlay: false });
      try {
        await sound.setRateAsync(clampPlaybackRate(PLAYBACK_RATE), true);
      } catch {
        // Ignore rate-control errors and continue with default playback speed.
      }
      await new Promise<void>((resolve, reject) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) {
            if (status.error) {
              reject(new Error(status.error));
              return;
            }
            resolve();
            return;
          }

          if (status.didJustFinish) {
            resolve();
          }
        });
        void (async () => {
          try {
            await sound.playAsync();
            const playbackStartedAtMs = Date.now();
            logTtsTiming({
              source: params.source,
              preset: params.preset,
              event: "playbackStarted",
              sinceAssistantTextMs: playbackStartedAtMs - assistantTextReceivedAtMs,
              requestDurationMs: playbackStartedAtMs - requestStartedAtMs,
              networkMs: audioBytesReceivedAtMs - requestStartedAtMs,
              playbackStartupMs: playbackStartedAtMs - audioBytesReceivedAtMs,
            });
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
    } catch {
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
    Speech.stop();
    Speech.speak(params.text, {
      language: "en-US",
      voice: selectedVoiceIdentifierRef.current,
      rate: voiceTuning.speechRate,
      pitch: voiceTuning.speechPitch,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}
