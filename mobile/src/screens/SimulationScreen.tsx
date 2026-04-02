import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Speech from "expo-speech";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VoiceOrb, OrbMode } from "../components/VoiceOrb";
import {
  getAiVoiceOption,
  selectSpeechVoiceIdentifier,
} from "../data/preferences";
import { DIFFICULTY_LABELS, PERSONA_LABELS } from "../data/prompts";
import {
  createLocalAssistantReply,
  createLocalOpeningLine,
} from "../lib/mockAi";
import { createSupportCase, fetchAiTtsAudio, getApiBaseUrl, startSimulationSession } from "../lib/api";
import { createOpeningLine, generateAssistantReply, isOpenAiConfigured, transcribeAudio } from "../lib/openai";
import {
  createSimulationCorrelationId,
  getPrimarySimulationAction,
  getSimulationStartPlan,
  getTurnFinalizeFallbackReason,
  TurnFinalizeTrigger,
} from "../lib/simulationInteractionModel";
import {
  speakWithRemoteTtsFallback,
  stopRemoteTtsPlayback as stopRemoteTtsPlaybackHelper,
  toRemoteTtsPreset,
} from "../lib/ttsPlayback";
import { splitTextForRemoteTtsFastStart } from "../lib/ttsFastStart";
import { DialogueMessage, SessionTiming, SimulationConfig } from "../types";

interface SimulationScreenProps {
  config: SimulationConfig;
  userId: string;
  authToken: string;
  onExit: () => void;
  onSessionComplete: (
    history: DialogueMessage[],
    config: SimulationConfig,
    timing: SessionTiming,
  ) => void;
}

const SOFT_MAX_TURN_DURATION_MS = 35000;
const ABSOLUTE_MAX_TURN_DURATION_MS = 60000;
const MIN_TURN_DURATION_MS = 1600;
const BACKUP_SILENCE_CUTOFF_MS = 6500;
const STATUS_POLL_INTERVAL_MS = 120;
const VOICE_METER_THRESHOLD_DB = -42;
const MIN_VOICE_HIT_COUNT = 3;
const AUTO_ERROR_REPORT_THROTTLE_MS = 10 * 60 * 1000;
const MAX_AUTO_ERROR_MESSAGE_LENGTH = 4_800;

const COLORS = {
  panel: "rgba(17, 37, 64, 0.84)",
  border: "rgba(143, 183, 232, 0.28)",
  text: "#eaf2ff",
  textMuted: "#9eb6d5",
  accent: "#35c2ff",
  danger: "#ff7c7c",
  userBubble: "#245790",
  aiBubble: "#163657",
};

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.toLowerCase().includes("no transcribed user text received")) {
      return "No transcribed user text received; check remote mode / transcription.";
    }
    if (message) {
      return message;
    }
  }

  return fallback;
}

function isPlaceholderTranscriptError(error: unknown): boolean {
  if (error instanceof Error && error.message.trim()) {
    return error.message.toLowerCase().includes("no transcribed user text received");
  }
  return false;
}

function isApiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("openai") ||
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("incorrect") ||
    message.includes("401") ||
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("remote ai") ||
    (message.includes("ai") && message.includes("disabled")) ||
    message.includes("503")
  );
}

function buildLocalCapturedText(turnDurationSeconds: number): string {
  return `Voice input captured (${turnDurationSeconds}s) in local test mode.`;
}

function normalizeTranscriptForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appearsToEchoAssistantReply(userText: string, history: DialogueMessage[]): boolean {
  const normalizedUser = normalizeTranscriptForComparison(userText);
  if (!normalizedUser || normalizedUser.length < 24) {
    return false;
  }

  const assistantMessages = history
    .filter((message) => message.role === "assistant")
    .slice(-2)
    .map((message) => normalizeTranscriptForComparison(message.content))
    .filter(Boolean);

  return assistantMessages.some((assistantText) => {
    if (!assistantText) {
      return false;
    }
    if (assistantText.includes(normalizedUser) || normalizedUser.includes(assistantText)) {
      return true;
    }

    const assistantTokens = new Set(assistantText.split(" "));
    const userTokens = normalizedUser.split(" ");
    const overlap = userTokens.filter((token) => assistantTokens.has(token)).length;
    return userTokens.length >= 6 && overlap / userTokens.length >= 0.72;
  });
}

function shouldAutoReportMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const ignoreFragments = [
    "microphone permission is required",
    "no clear speech detected",
  ];

  return !ignoreFragments.some((fragment) => normalized.includes(fragment));
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SimulationScreen({ config, userId, authToken, onExit, onSessionComplete }: SimulationScreenProps) {
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [mode, setMode] = useState<OrbMode>("thinking");
  const [status, setStatus] = useState("Preparing scenario...");
  const [error, setError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [useLocalMockMode, setUseLocalMockMode] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const apiConfigured = useMemo(() => isOpenAiConfigured(), []);
  const voiceOption = useMemo(() => getAiVoiceOption(config.voiceProfile), [config.voiceProfile]);
  const localTestMode = !apiConfigured || useLocalMockMode;
  const shouldUseFastStartRemoteTts =
    config.remoteTtsEnabled &&
    apiConfigured &&
    !useLocalMockMode &&
    Platform.OS !== "web";
  const logSimulationApiCall = useCallback((callName: string) => {
    // eslint-disable-next-line no-console
    console.log(
      `[simulation-api] call=${callName} apiBaseUrl=${getApiBaseUrl() || "(empty)"} remoteConfigured=${apiConfigured} localMockMode=${useLocalMockMode} localTestMode=${localTestMode}`,
    );
  }, [apiConfigured, localTestMode, useLocalMockMode]);
  const selectedVoiceIdentifierRef = useRef<string | undefined>(undefined);
  const messagesRef = useRef<DialogueMessage[]>([]);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionActiveRef = useRef(false);
  const processingRef = useRef(false);
  const finalizeRequestedRef = useRef(false);
  const micGrantedRef = useRef(false);
  const unmountedRef = useRef(false);
  const turnStartedAtRef = useRef(0);
  const sessionStartedAtRef = useRef<Date | null>(null);
  const sessionTrainingPackIdRef = useRef<string | null>(null);
  const pendingOpeningLineRef = useRef<string | null>(null);
  const lastVoiceAtRef = useRef(0);
  const heardVoiceRef = useRef(false);
  const detectedVoiceRef = useRef(false);
  const meteringSeenRef = useRef(false);
  const voiceHitCountRef = useRef(0);
  const noiseFloorDbRef = useRef<number | null>(null);
  const openingDeliveredRef = useRef(false);
  const recognizedStartRegisteredRef = useRef(false);
  const sessionCompletionInProgressRef = useRef(false);
  const autoErrorReportByKeyRef = useRef(new Map<string, number>());
  const localModeConfirmedRef = useRef(false);
  const remoteTtsSoundRef = useRef<Audio.Sound | null>(null);
  const remoteTtsFileRef = useRef<string | null>(null);
  const remoteTtsAbortControllerRef = useRef<AbortController | null>(null);
  const ttsRequestGenerationRef = useRef(0);
  const simulationClosedRef = useRef(false);
  const usedMockModeDuringSessionRef = useRef(false);
  const turnFinalizeTriggerRef = useRef<TurnFinalizeTrigger | null>(null);
  const turnSubmitStartedAtRef = useRef<number | null>(null);
  const currentTurnCorrelationIdRef = useRef<string | null>(null);

  const maxSessionSeconds = useMemo(() => {
    const maxMinutes = Number(config.maxSimulationMinutes);
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) {
      return null;
    }
    return Math.floor(maxMinutes * 60);
  }, [config.maxSimulationMinutes]);
  const remainingSeconds = maxSessionSeconds === null ? null : Math.max(0, maxSessionSeconds - elapsedSeconds);
  const inFinalMinute = Boolean(sessionActive && remainingSeconds !== null && remainingSeconds <= 60);

  const clearTurnMonitoring = () => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }

    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
  };

  const logSimulationTiming = useCallback((params: {
    phase: string;
    correlationId: string;
    startedAtMs?: number | null;
    details?: Record<string, unknown>;
  }) => {
    const tsMs = Date.now();
    // eslint-disable-next-line no-console
    console.log("[simulation-timing]", {
      simulationSessionId: config.simulationSessionId,
      correlationId: params.correlationId,
      phase: params.phase,
      tsMs,
      elapsedMs: typeof params.startedAtMs === "number" ? Math.max(0, tsMs - params.startedAtMs) : undefined,
      ...(params.details ?? {}),
    });
  }, [config.simulationSessionId]);

  const createTurnCorrelationId = useCallback(() => {
    const turnIndex = messagesRef.current.filter((message) => message.role === "user").length + 1;
    return createSimulationCorrelationId(config.simulationSessionId, `turn-${turnIndex}`);
  }, [config.simulationSessionId]);

  const submitAutoErrorReport = useCallback(
    async (context: string, error: unknown, details?: Record<string, unknown>) => {
      const message = getErrorMessage(error, "Unexpected simulation error.");
      if (!shouldAutoReportMessage(message)) {
        return;
      }

      const key = `${context}::${message}`.slice(0, 512);
      const nowMs = Date.now();
      const lastReportedAt = autoErrorReportByKeyRef.current.get(key) ?? 0;
      if (nowMs - lastReportedAt < AUTO_ERROR_REPORT_THROTTLE_MS) {
        return;
      }
      autoErrorReportByKeyRef.current.set(key, nowMs);

      const lines = [
        "[AUTO-ERROR] Simulation runtime report",
        `Context: ${context}`,
        `Platform: ${Platform.OS}`,
        `User ID: ${userId}`,
        `Segment ID: ${config.scenario.segmentId}`,
        `Scenario ID: ${config.scenario.id}`,
        `Scenario: ${config.scenario.title}`,
        `Difficulty: ${config.difficulty}`,
        `Persona: ${config.personaStyle}`,
        `Timestamp: ${new Date(nowMs).toISOString()}`,
        `Error: ${message}`,
      ];

      if (details && Object.keys(details).length > 0) {
        try {
          lines.push(`Details: ${JSON.stringify(details)}`);
        } catch {
          lines.push("Details: (unserializable)");
        }
      }

      try {
        logSimulationApiCall("createSupportCase");
        await createSupportCase({
          userId,
          authToken,
          message: lines.join("\n").slice(0, MAX_AUTO_ERROR_MESSAGE_LENGTH),
          includeTranscript: false,
        });
      } catch {
        // Best-effort only.
      }
    },
    [
      authToken,
      config.difficulty,
      config.personaStyle,
      config.scenario.id,
      config.scenario.segmentId,
      config.scenario.title,
      userId,
      logSimulationApiCall,
    ],
  );

  const appendMessage = (message: DialogueMessage) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  };

  const stopRemoteTtsPlayback = useCallback(async () => {
    await stopRemoteTtsPlaybackHelper({
      remoteTtsSoundRef,
      remoteTtsFileRef,
    });
  }, []);

  const cancelPendingTts = useCallback(async (markClosed = false) => {
    if (markClosed) {
      simulationClosedRef.current = true;
    }
    ttsRequestGenerationRef.current += 1;
    const activeController = remoteTtsAbortControllerRef.current;
    remoteTtsAbortControllerRef.current = null;
    if (activeController) {
      activeController.abort();
    }
    await stopRemoteTtsPlayback();
    Speech.stop();
  }, [stopRemoteTtsPlayback]);

  const speakSingleUtterance = async (
    text: string,
    assistantTextReceivedAtMs?: number,
    onPlaybackStart?: () => void,
    prefetchedRemoteAudio?: { bytes: Uint8Array; contentType: string } | null,
    correlationId?: string,
  ): Promise<void> => {
    const requestGeneration = ttsRequestGenerationRef.current;
    const abortController = new AbortController();
    const priorController = remoteTtsAbortControllerRef.current;
    remoteTtsAbortControllerRef.current = abortController;
    if (priorController) {
      priorController.abort();
    }

    try {
      await speakWithRemoteTtsFallback({
        source: "simulation",
        text,
        preset: toRemoteTtsPreset(config.voiceGender, config.voiceProfile),
        userId,
        authToken,
        correlationId,
        remoteTtsEnabled: config.remoteTtsEnabled,
        remoteAiConfigured: apiConfigured,
        allowRemoteTts: !useLocalMockMode,
        voiceGender: config.voiceGender,
        voiceProfile: config.voiceProfile,
        selectedVoiceIdentifierRef,
        remoteTtsSoundRef,
        remoteTtsFileRef,
        assistantTextReceivedAtMs,
        prefetchedRemoteAudio,
        abortSignal: abortController.signal,
        isCancelled: () =>
          ttsRequestGenerationRef.current !== requestGeneration || simulationClosedRef.current || unmountedRef.current,
        onPlaybackStart: () => {
          onPlaybackStart?.();
        },
      });
    } finally {
      if (remoteTtsAbortControllerRef.current === abortController) {
        remoteTtsAbortControllerRef.current = null;
      }
    }
  };

  const prefetchRemoteTtsChunk = useCallback(
    async (
      text: string,
      requestGeneration: number,
      preset: ReturnType<typeof toRemoteTtsPreset>,
      correlationId?: string,
    ): Promise<{ bytes: Uint8Array; contentType: string } | null> => {
      if (!shouldUseFastStartRemoteTts || !text.trim()) {
        return null;
      }
      if (
        ttsRequestGenerationRef.current !== requestGeneration ||
        simulationClosedRef.current ||
        unmountedRef.current
      ) {
        return null;
      }

      try {
        const prefetched = await fetchAiTtsAudio({
          userId,
          authToken,
          text,
          preset,
          correlationId,
        });
        if (
          ttsRequestGenerationRef.current !== requestGeneration ||
          simulationClosedRef.current ||
          unmountedRef.current
        ) {
          return null;
        }
        return prefetched;
      } catch {
        return null;
      }
    },
    [authToken, shouldUseFastStartRemoteTts, userId],
  );

  const speakAssistantResponse = async (
    text: string,
    assistantTextReceivedAtMs?: number,
    onPlaybackStart?: () => void,
    correlationId?: string,
  ): Promise<void> => {
    const chunks = shouldUseFastStartRemoteTts ? splitTextForRemoteTtsFastStart(text) : [text];
    const requestGeneration = ttsRequestGenerationRef.current;
    const preset = toRemoteTtsPreset(config.voiceGender, config.voiceProfile);
    const prefetchedChunkByIndex = new Map<number, Promise<{ bytes: Uint8Array; contentType: string } | null>>();
    let playbackStartHandled = false;
    const handlePlaybackStart = () => {
      if (playbackStartHandled) {
        return;
      }
      playbackStartHandled = true;
      onPlaybackStart?.();
    };
    const startPrefetchForChunk = (targetIndex: number) => {
      if (!shouldUseFastStartRemoteTts || targetIndex >= chunks.length) {
        return;
      }
      if (prefetchedChunkByIndex.has(targetIndex)) {
        return;
      }
      prefetchedChunkByIndex.set(
        targetIndex,
        prefetchRemoteTtsChunk(chunks[targetIndex], requestGeneration, preset, correlationId),
      );
    };

    startPrefetchForChunk(1);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      let prefetchedRemoteAudio: { bytes: Uint8Array; contentType: string } | null = null;
      if (index > 0) {
        const prefetchedPromise = prefetchedChunkByIndex.get(index);
        if (prefetchedPromise) {
          prefetchedRemoteAudio = await prefetchedPromise;
        }
      }
      await speakSingleUtterance(
        chunk,
        index === 0 ? assistantTextReceivedAtMs : Date.now(),
        () => {
          if (index === 0) {
            handlePlaybackStart();
          }
          startPrefetchForChunk(index + 1);
        },
        prefetchedRemoteAudio,
        correlationId,
      );
      if (index === 0) {
        handlePlaybackStart();
      }
      startPrefetchForChunk(index + 1);
    }
  };

  const setAudioMode = async (allowsRecording: boolean) => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: allowsRecording,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    });
  };

  const ensureMicPermission = async () => {
    if (micGrantedRef.current) {
      return true;
    }

    const permission = await Audio.requestPermissionsAsync();
    if (permission.granted) {
      micGrantedRef.current = true;
      return true;
    }

    return false;
  };

  const stopRecordingSafely = async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;

    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // Ignore stop errors from already-stopped recordings.
      }
    }

    try {
      await setAudioMode(false);
    } catch {
      // Ignore mode reset errors.
    }
  };

  const requestFinalizeTurn = (trigger: TurnFinalizeTrigger) => {
    if (finalizeRequestedRef.current || processingRef.current || !recordingRef.current) {
      return;
    }

    const correlationId = currentTurnCorrelationIdRef.current ?? createTurnCorrelationId();
    currentTurnCorrelationIdRef.current = correlationId;
    turnFinalizeTriggerRef.current = trigger;
    turnSubmitStartedAtRef.current = Date.now();
    if (trigger === "submit") {
      setStatus("Submitting your response...");
    }
    logSimulationTiming({
      correlationId,
      phase: "turn_finalize_requested",
      startedAtMs: turnSubmitStartedAtRef.current,
      details: {
        trigger,
      },
    });
    finalizeRequestedRef.current = true;
    void finalizeTurn();
  };

  const monitorCurrentTurn = async () => {
    if (processingRef.current || finalizeRequestedRef.current) {
      return;
    }

    const recording = recordingRef.current;
    if (!recording || !sessionActiveRef.current) {
      return;
    }

    try {
      const status = await recording.getStatusAsync();
      if (!status.isRecording) {
        return;
      }

      const now = Date.now();
      const elapsed = status.durationMillis ?? now - turnStartedAtRef.current;

      if (typeof status.metering === "number") {
        meteringSeenRef.current = true;
        const priorNoiseFloor = noiseFloorDbRef.current ?? status.metering;
        const adaptiveThreshold = Math.max(
          VOICE_METER_THRESHOLD_DB,
          Math.min(-28, priorNoiseFloor + 10),
        );

        if (status.metering > adaptiveThreshold) {
          voiceHitCountRef.current += 1;
          detectedVoiceRef.current = true;
          if (voiceHitCountRef.current >= MIN_VOICE_HIT_COUNT) {
            heardVoiceRef.current = true;
          }
          lastVoiceAtRef.current = now;
        } else if (voiceHitCountRef.current > 0) {
          voiceHitCountRef.current = Math.max(0, voiceHitCountRef.current - 1);
        }

        if (!heardVoiceRef.current || status.metering <= adaptiveThreshold) {
          noiseFloorDbRef.current = priorNoiseFloor * 0.85 + status.metering * 0.15;
        }
      }

      const fallbackReason = getTurnFinalizeFallbackReason({
        elapsedMs: elapsed,
        silenceMs: heardVoiceRef.current ? now - lastVoiceAtRef.current : null,
        heardVoice: heardVoiceRef.current,
        meteringSeen: meteringSeenRef.current,
        minTurnDurationMs: MIN_TURN_DURATION_MS,
        backupSilenceCutoffMs: BACKUP_SILENCE_CUTOFF_MS,
        softMaxTurnDurationMs: SOFT_MAX_TURN_DURATION_MS,
        absoluteMaxTurnDurationMs: ABSOLUTE_MAX_TURN_DURATION_MS,
      });

      if (fallbackReason === "backup-silence") {
        setStatus("No submit detected. Processing from silence fallback...");
        requestFinalizeTurn("backup-silence");
        return;
      }

      if (fallbackReason === "soft-limit") {
        setStatus("Turn length limit reached. Processing...");
        requestFinalizeTurn("soft-limit");
        return;
      }

      if (fallbackReason === "absolute-limit") {
        setStatus("Max turn length reached. Processing...");
        requestFinalizeTurn("absolute-limit");
      }
    } catch {
      // If status polling fails, max-duration safety timer will still finalize the turn.
    }
  };

  const startListeningTurn = async () => {
    if (!sessionActiveRef.current || processingRef.current || unmountedRef.current) {
      return;
    }

    try {
      await cancelPendingTts();
      await setAudioMode(true);
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      finalizeRequestedRef.current = false;
      turnFinalizeTriggerRef.current = null;
      turnSubmitStartedAtRef.current = null;
      const turnCorrelationId = createTurnCorrelationId();
      currentTurnCorrelationIdRef.current = turnCorrelationId;
      turnStartedAtRef.current = Date.now();
      lastVoiceAtRef.current = turnStartedAtRef.current;
      heardVoiceRef.current = false;
      detectedVoiceRef.current = false;
      meteringSeenRef.current = false;
      voiceHitCountRef.current = 0;
      noiseFloorDbRef.current = null;

      setMode("recording");
      setStatus("Listening... Tap Submit Response when you're done.");
      logSimulationTiming({
        correlationId: turnCorrelationId,
        phase: "turn_recording_started",
      });
      clearTurnMonitoring();
      monitorIntervalRef.current = setInterval(() => {
        void monitorCurrentTurn();
      }, STATUS_POLL_INTERVAL_MS);
      safetyTimerRef.current = setTimeout(() => {
        setStatus("Processing...");
        requestFinalizeTurn("absolute-limit");
      }, ABSOLUTE_MAX_TURN_DURATION_MS + 500);
    } catch (recordingError) {
      setError(getErrorMessage(recordingError, "Could not start recording."));
      void submitAutoErrorReport("simulation.recording_start", recordingError);
      sessionActiveRef.current = false;
      setSessionActive(false);
      setMode("idle");
    }
  };

  const finalizeTurn = async () => {
    if (processingRef.current) {
      return;
    }

    const recording = recordingRef.current;
    if (!recording) {
      return;
    }

    processingRef.current = true;
    clearTurnMonitoring();
    setMode("thinking");
    setStatus("Finalizing your audio...");
    setError(null);
    let continueLoop = false;
    const correlationId = currentTurnCorrelationIdRef.current ?? createTurnCorrelationId();
    const submitStartedAtMs = turnSubmitStartedAtRef.current;
    const finalizeTrigger = turnFinalizeTriggerRef.current ?? "submit";

    try {
      logSimulationTiming({
        correlationId,
        phase: "recording_finalize_start",
        startedAtMs: submitStartedAtMs,
        details: {
          trigger: finalizeTrigger,
        },
      });
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
      await setAudioMode(false);
      logSimulationTiming({
        correlationId,
        phase: "recording_finalize_complete",
        startedAtMs: submitStartedAtMs,
      });

      const audioUri = recording.getURI();
      if (!audioUri) {
        throw new Error("Recorded audio file could not be read.");
      }
      const turnDurationSeconds = Math.max(
        1,
        Math.round((Date.now() - turnStartedAtRef.current) / 1000),
      );
      const inferredVoiceWithoutMeter =
        !meteringSeenRef.current && (turnDurationSeconds >= 3 || finalizeTrigger === "submit");
      const shouldAttemptTranscription =
        detectedVoiceRef.current ||
        heardVoiceRef.current ||
        inferredVoiceWithoutMeter;

      let userText = "";
      let useLiveApiThisTurn = apiConfigured && !useLocalMockMode;
      if (!useLiveApiThisTurn) {
        usedMockModeDuringSessionRef.current = true;
      }
      if (useLiveApiThisTurn && shouldAttemptTranscription) {
        try {
          setStatus("Transcribing your response...");
          logSimulationTiming({
            correlationId,
            phase: "transcribe_request_start",
            startedAtMs: submitStartedAtMs,
          });
          logSimulationApiCall("transcribeAudio");
          userText = (
            await transcribeAudio({
              userId,
              authToken,
              audioUri,
              preferredMimeType: Platform.OS === "web" ? "audio/webm" : "audio/m4a",
              correlationId,
            })
          ).trim();
          logSimulationTiming({
            correlationId,
            phase: "transcribe_response",
            startedAtMs: submitStartedAtMs,
            details: {
              transcriptChars: userText.length,
            },
          });
        } catch (transcriptionError) {
          if (isApiError(transcriptionError)) {
            setUseLocalMockMode(true);
            usedMockModeDuringSessionRef.current = true;
            setError(null);
            setStatus("Live AI unavailable. Switched to local test mode.");
            useLiveApiThisTurn = false;
            if (detectedVoiceRef.current || heardVoiceRef.current || inferredVoiceWithoutMeter) {
              userText = buildLocalCapturedText(turnDurationSeconds);
            }
            logSimulationTiming({
              correlationId,
              phase: "transcribe_fallback_local_mode",
              startedAtMs: submitStartedAtMs,
            });
          } else {
            throw transcriptionError;
          }
        }
      } else if (!useLiveApiThisTurn && shouldAttemptTranscription) {
        userText = buildLocalCapturedText(turnDurationSeconds);
      }

      if (userText && appearsToEchoAssistantReply(userText, messagesRef.current)) {
        userText = "";
      }

      if (userText) {
        appendMessage({ id: createMessageId(), role: "user", content: userText });

        if (sessionActiveRef.current && !unmountedRef.current) {
          setStatus("Crafting AI reply...");
          logSimulationTiming({
            correlationId,
            phase: "assistant_request_start",
            startedAtMs: submitStartedAtMs,
          });
          const reply = useLiveApiThisTurn
            ? (logSimulationApiCall("generateAssistantReply"),
              await generateAssistantReply({
                userId,
                authToken,
                simulationSessionId: config.simulationSessionId,
                scenario: config.scenario,
                trainingId: config.trainingId ?? null,
                industryId: config.industryId,
                industryBaseline: config.industryBaseline,
                difficulty: config.difficulty,
                segmentLabel: config.segmentLabel,
                personaStyle: config.personaStyle,
                history: [...messagesRef.current],
                trainingPackId: sessionTrainingPackIdRef.current,
                correlationId,
              }))
            : createLocalAssistantReply({
                scenario: config.scenario,
                difficulty: config.difficulty,
                personaStyle: config.personaStyle,
                turnIndex: messagesRef.current.filter((message) => message.role === "assistant").length,
                userText,
                recentAssistantMessages: messagesRef.current
                  .filter((message) => message.role === "assistant")
                  .map((message) => message.content),
                turnDurationSeconds,
              });
          logSimulationTiming({
            correlationId,
            phase: "assistant_response_received",
            startedAtMs: submitStartedAtMs,
            details: {
              replyChars: reply.length,
            },
          });

          if (sessionActiveRef.current && !unmountedRef.current) {
            const assistantTextReceivedAtMs = Date.now();
            // eslint-disable-next-line no-console
            console.log("[TTS-TIMING]", {
              source: "simulation",
              preset: toRemoteTtsPreset(config.voiceGender, config.voiceProfile),
              correlationId,
              phase: "assistant_text_received",
              tsMs: assistantTextReceivedAtMs,
              elapsedMs: 0,
            });
            const assistantMessage = { id: createMessageId(), role: "assistant" as const, content: reply };
            appendMessage(assistantMessage);
            setStatus("AI response ready. Starting voice...");
            // eslint-disable-next-line no-console
            console.log("[TTS-TIMING]", {
              source: "simulation",
              preset: toRemoteTtsPreset(config.voiceGender, config.voiceProfile),
              correlationId,
              phase: "speak_invoked",
              tsMs: Date.now(),
              elapsedMs: Date.now() - assistantTextReceivedAtMs,
            });
            logSimulationTiming({
              correlationId,
              phase: "tts_pipeline_start",
              startedAtMs: submitStartedAtMs,
            });
            const speakPromise = speakAssistantResponse(
              reply,
              assistantTextReceivedAtMs,
              () => {
                setMode("speaking");
                setStatus("AI is speaking...");
                logSimulationTiming({
                  correlationId,
                  phase: "assistant_playback_started",
                  startedAtMs: submitStartedAtMs,
                });
              },
              correlationId,
            );
            await speakPromise;
          }
        }
      } else {
        setStatus("No clear speech detected. Listening again...");
      }

      continueLoop = sessionActiveRef.current;
    } catch (turnError) {
      setError(getErrorMessage(turnError, "Could not process voice response."));
      if (isPlaceholderTranscriptError(turnError)) {
        setStatus("Transcription missing. Please verify REMOTE mode.");
      }
      void submitAutoErrorReport("simulation.turn_finalize", turnError);
      continueLoop = sessionActiveRef.current;
    } finally {
      processingRef.current = false;
      finalizeRequestedRef.current = false;
      turnFinalizeTriggerRef.current = null;
      turnSubmitStartedAtRef.current = null;
      currentTurnCorrelationIdRef.current = null;

      if (continueLoop && !unmountedRef.current) {
        void startListeningTurn();
      } else if (!unmountedRef.current) {
        setMode("idle");
      }
    }
  };

  const startSession = async () => {
    if (sessionActiveRef.current || isInitializing) {
      return;
    }

    const granted = await ensureMicPermission();
    if (!granted) {
      setError("Microphone permission is required to start the simulation.");
      return;
    }

    setError(null);
    simulationClosedRef.current = false;
    if (localTestMode) {
      usedMockModeDuringSessionRef.current = true;
    }
    const startPlan = getSimulationStartPlan({
      openingDelivered: openingDeliveredRef.current,
      recognizedStartRegistered: recognizedStartRegisteredRef.current,
    });
    const openingCorrelationId = createSimulationCorrelationId(config.simulationSessionId, "opening");
    const startRegistrationCorrelationId = createSimulationCorrelationId(
      config.simulationSessionId,
      "session-start",
    );

    if (startPlan.shouldDeliverOpening) {
      let openingLine = pendingOpeningLineRef.current;
      if (!openingLine) {
        if (localTestMode) {
          openingLine = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
          sessionTrainingPackIdRef.current = null;
        } else {
          try {
            logSimulationTiming({
              correlationId: openingCorrelationId,
              phase: "opening_request_start",
            });
            logSimulationApiCall("createOpeningLine:startSession");
            const openingPayload = await createOpeningLine({
              userId,
              authToken,
              simulationSessionId: config.simulationSessionId,
              scenario: config.scenario,
              trainingId: config.trainingId ?? null,
              industryId: config.industryId,
              industryBaseline: config.industryBaseline,
              difficulty: config.difficulty,
              segmentLabel: config.segmentLabel,
              personaStyle: config.personaStyle,
              correlationId: openingCorrelationId,
            });
            openingLine = openingPayload.assistantText;
            sessionTrainingPackIdRef.current = openingPayload.trainingPackId;
            logSimulationTiming({
              correlationId: openingCorrelationId,
              phase: "opening_response_received",
            });
          } catch (openingError) {
            if (isApiError(openingError)) {
              setUseLocalMockMode(true);
              usedMockModeDuringSessionRef.current = true;
              openingLine = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
              sessionTrainingPackIdRef.current = null;
            } else {
              setError(getErrorMessage(openingError, "Could not initialize simulation."));
              void submitAutoErrorReport("simulation.opening_line", openingError);
              return;
            }
          }
        }
      }

      if (openingLine) {
        const assistantTextReceivedAtMs = Date.now();
        // eslint-disable-next-line no-console
        console.log("[TTS-TIMING]", {
          source: "simulation",
          preset: toRemoteTtsPreset(config.voiceGender, config.voiceProfile),
          correlationId: openingCorrelationId,
          phase: "assistant_text_received",
          tsMs: assistantTextReceivedAtMs,
          elapsedMs: 0,
        });
        const openingAssistantMessage = { id: createMessageId(), role: "assistant" as const, content: openingLine };
        appendMessage(openingAssistantMessage);
        setStatus("AI response ready. Starting voice...");
        // eslint-disable-next-line no-console
        console.log("[TTS-TIMING]", {
          source: "simulation",
          preset: toRemoteTtsPreset(config.voiceGender, config.voiceProfile),
          correlationId: openingCorrelationId,
          phase: "speak_invoked",
          tsMs: Date.now(),
          elapsedMs: Date.now() - assistantTextReceivedAtMs,
        });
        logSimulationTiming({
          correlationId: openingCorrelationId,
          phase: "opening_tts_pipeline_start",
        });
        const speakPromise = speakAssistantResponse(
          openingLine,
          assistantTextReceivedAtMs,
          () => {
            setMode("speaking");
            setStatus("AI is speaking...");
            logSimulationTiming({
              correlationId: openingCorrelationId,
              phase: "opening_playback_started",
            });
          },
          openingCorrelationId,
        );
        pendingOpeningLineRef.current = null;
        await speakPromise;
        openingDeliveredRef.current = true;
      }
    }

    if (!recognizedStartRegisteredRef.current) {
      logSimulationTiming({
        correlationId: startRegistrationCorrelationId,
        phase: "recognized_start_request_start",
      });

      try {
        await startSimulationSession(
          userId,
          {
            simulationSessionId: config.simulationSessionId,
            segmentId: config.scenario.segmentId,
            scenarioId: config.scenario.id,
            trainingId: config.trainingId ?? null,
            trainingPackId: sessionTrainingPackIdRef.current,
            clientStartedAt: new Date().toISOString(),
          },
          authToken,
          { correlationId: startRegistrationCorrelationId },
        );
        recognizedStartRegisteredRef.current = true;
        logSimulationTiming({
          correlationId: startRegistrationCorrelationId,
          phase: "recognized_start_request_complete",
        });
      } catch (startError) {
        setMode("idle");
        setStatus("Simulation start failed. Tap Start Simulation to retry.");
        setError(getErrorMessage(startError, "Could not register simulation start."));
        logSimulationTiming({
          correlationId: startRegistrationCorrelationId,
          phase: "recognized_start_request_failed",
        });
        void submitAutoErrorReport("simulation.session_start", startError, {
          simulationSessionId: config.simulationSessionId,
          scenarioId: config.scenario.id,
        });
        return;
      }
    }

    sessionActiveRef.current = true;
    sessionStartedAtRef.current = new Date();
    sessionCompletionInProgressRef.current = false;
    setElapsedSeconds(0);
    setSessionActive(true);
    setStatus("Simulation active. Speak, then tap Submit Response.");
    void startListeningTurn();
  };

  const endSession = async (showEndedText: boolean) => {
    simulationClosedRef.current = true;
    sessionActiveRef.current = false;
    setSessionActive(false);
    clearTurnMonitoring();
    turnFinalizeTriggerRef.current = null;
    turnSubmitStartedAtRef.current = null;
    currentTurnCorrelationIdRef.current = null;
    await cancelPendingTts(true);
    await stopRecordingSafely();

    if (showEndedText) {
      setMode("idle");
      setStatus("Session ended.");
    }
  };

  const completeSessionAndScore = useCallback(async () => {
    if (!sessionActiveRef.current || sessionCompletionInProgressRef.current) {
      return;
    }

    sessionCompletionInProgressRef.current = true;
    try {
      const startedAt = sessionStartedAtRef.current ?? new Date();
      const endedAt = new Date();
      const rawDurationSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
      );
      await endSession(false);
      sessionStartedAtRef.current = null;
      setElapsedSeconds(rawDurationSeconds);
      onSessionComplete([...messagesRef.current], config, {
        simulationSessionId: config.simulationSessionId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        rawDurationSeconds,
        usedMockMode: usedMockModeDuringSessionRef.current,
        trainingId: config.trainingId ?? null,
        trainingPackId: sessionTrainingPackIdRef.current,
      });
    } finally {
      sessionCompletionInProgressRef.current = false;
    }
  }, [config, onSessionComplete]);

  const onPrimaryButton = async () => {
    if (isInitializing) {
      return;
    }

    if (sessionActiveRef.current) {
      if (mode === "recording") {
        requestFinalizeTurn("submit");
      }
      return;
    }

    if (!apiConfigured && !localModeConfirmedRef.current) {
      if (Platform.OS === "web") {
        localModeConfirmedRef.current = true;
        setError("Remote AI is disabled. Press Start Simulation again to confirm LOCAL TEST mode.");
        return;
      }

        Alert.alert(
          "Remote AI disabled",
          "This build is in LOCAL TEST mode. Transcripts may use placeholders and simulation quality results are not valid. Continue anyway?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              style: "destructive",
              onPress: () => {
                localModeConfirmedRef.current = true;
                void startSession();
              },
            },
          ],
          { cancelable: true },
        );
        return;
    }

    await startSession();
  };

  const onExitPress = async () => {
    await endSession(false);
    sessionStartedAtRef.current = null;
    setElapsedSeconds(0);
    sessionCompletionInProgressRef.current = false;
    onExit();
  };

  useEffect(() => {
    let cancelled = false;
    unmountedRef.current = false;

    const initialize = async () => {
      setIsInitializing(true);
      messagesRef.current = [];
      sessionStartedAtRef.current = null;
      sessionTrainingPackIdRef.current = null;
      setMessages([]);
      setError(null);
      openingDeliveredRef.current = false;
      recognizedStartRegisteredRef.current = false;
      localModeConfirmedRef.current = false;
      pendingOpeningLineRef.current = null;
      setElapsedSeconds(0);
      sessionCompletionInProgressRef.current = false;
      simulationClosedRef.current = false;
      usedMockModeDuringSessionRef.current = false;
      turnFinalizeTriggerRef.current = null;
      turnSubmitStartedAtRef.current = null;
      currentTurnCorrelationIdRef.current = null;

      if (localTestMode) {
        pendingOpeningLineRef.current = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
        sessionTrainingPackIdRef.current = null;
        setMode("idle");
        setStatus("Scenario ready. Press Start Simulation.");
        setIsInitializing(false);
        return;
      }

      try {
        logSimulationApiCall("createOpeningLine:initialize");
        const openingPayload = await createOpeningLine({
          userId,
          authToken,
          simulationSessionId: config.simulationSessionId,
          scenario: config.scenario,
          trainingId: config.trainingId ?? null,
          industryId: config.industryId,
          industryBaseline: config.industryBaseline,
          difficulty: config.difficulty,
          segmentLabel: config.segmentLabel,
          personaStyle: config.personaStyle,
          correlationId: createSimulationCorrelationId(config.simulationSessionId, "opening-prefetch"),
        });

        if (cancelled || unmountedRef.current) {
          return;
        }

        pendingOpeningLineRef.current = openingPayload.assistantText;
        sessionTrainingPackIdRef.current = openingPayload.trainingPackId;
        setMode("idle");
        setStatus("Scenario ready. Press Start Simulation.");
      } catch (initError) {
        if (isApiError(initError)) {
          setUseLocalMockMode(true);
          usedMockModeDuringSessionRef.current = true;
          pendingOpeningLineRef.current = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
          sessionTrainingPackIdRef.current = null;
          setMode("idle");
          setStatus("Local test mode ready. Press Start Simulation.");
          setError(null);
        } else {
          setMode("idle");
          setStatus("Ready.");
          setError(getErrorMessage(initError, "Could not initialize simulation."));
          void submitAutoErrorReport("simulation.initialize", initError);
        }
      } finally {
        if (!cancelled && !unmountedRef.current) {
          setIsInitializing(false);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      simulationClosedRef.current = true;
      sessionActiveRef.current = false;
      clearTurnMonitoring();
      void cancelPendingTts(true);
      void stopRecordingSafely();
      sessionCompletionInProgressRef.current = false;
    };
  }, [
    apiConfigured,
    authToken,
    config.difficulty,
    config.personaStyle,
    config.scenario,
    config.simulationSessionId,
    config.trainingId,
    config.segmentLabel,
    submitAutoErrorReport,
    userId,
    logSimulationApiCall,
    cancelPendingTts,
  ]);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }

    const tick = () => {
      const startedAt = sessionStartedAtRef.current;
      if (!startedAt) {
        setElapsedSeconds(0);
        return;
      }

      const nextElapsed = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
      setElapsedSeconds(nextElapsed);

      if (
        maxSessionSeconds !== null
        && nextElapsed >= maxSessionSeconds
        && !sessionCompletionInProgressRef.current
      ) {
        setStatus("Session max length reached. Ending and scoring...");
        void completeSessionAndScore();
      }
    };

    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [completeSessionAndScore, maxSessionSeconds, sessionActive]);

  useEffect(() => {
    let cancelled = false;

    const resolveSpeechVoice = async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (cancelled) {
          return;
        }

        selectedVoiceIdentifierRef.current = selectSpeechVoiceIdentifier(voices ?? [], config.voiceGender);
      } catch {
        if (!cancelled) {
          selectedVoiceIdentifierRef.current = undefined;
        }
      }
    };

    void resolveSpeechVoice();
    return () => {
      cancelled = true;
    };
  }, [config.voiceGender]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const timeout = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);

    return () => clearTimeout(timeout);
  }, [messages]);

  const primaryAction = getPrimarySimulationAction({
    sessionActive,
    isInitializing,
    mode,
  });
  const endButtonDisabled = isInitializing || !sessionActive || sessionCompletionInProgressRef.current;
  const hintText = localTestMode
    ? "Local test mode: replies are mocked. Tap Submit Response when you finish speaking."
    : sessionActive
      ? mode === "recording"
        ? "Voice-first mode with explicit turn control. Tap Submit Response when you're ready."
        : mode === "thinking"
          ? "Your response is being transcribed and the AI reply is being prepared."
          : "The AI response is readying for playback or currently speaking."
      : "Press Start Simulation to begin, then tap Submit Response to end each turn. A long-silence fallback still protects forgotten submits.";

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => void onExitPress()}>
          <Text style={styles.ghostButtonText}>Exit</Text>
        </Pressable>
        <Text style={styles.title}>Simulation</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{config.segmentLabel}</Text>
        <Text style={styles.cardTitle}>{config.scenario.title}</Text>
        <Text style={styles.cardBody}>{config.scenario.description}</Text>
        <Text style={styles.cardBody}>Difficulty: {DIFFICULTY_LABELS[config.difficulty]}</Text>
        <Text style={styles.cardBody}>Persona: {PERSONA_LABELS[config.personaStyle]}</Text>
        {config.maxSimulationMinutes !== null ? (
          <Text style={styles.cardBody}>
            Org max session length: {config.maxSimulationMinutes} minute(s)
          </Text>
        ) : null}
        <Text style={styles.cardBody}>
          AI voice: {config.voiceGender === "male" ? "Male" : "Female"} {voiceOption.label}
        </Text>
      </View>

      {__DEV__ ? (
        <View style={[styles.debugModeCard, localTestMode ? styles.debugModeLocal : styles.debugModeRemote]}>
          <Text style={styles.debugModeText}>Mode: {localTestMode ? "LOCAL TEST" : "REMOTE"}</Text>
        </View>
      ) : null}

      {!apiConfigured ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            Remote AI is disabled for this build. This session runs in LOCAL TEST mode unless rebuilt with
            EXPO_PUBLIC_REMOTE_AI_ENABLED=true.
          </Text>
        </View>
      ) : null}

      <VoiceOrb mode={mode} />
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.hint}>{hintText}</Text>
      <View style={styles.timerCard}>
        <Text style={styles.timerLabel}>
          Session Timer
          {maxSessionSeconds !== null ? ` (max ${formatDurationClock(maxSessionSeconds)})` : ""}
        </Text>
        <Text style={[styles.timerValue, inFinalMinute ? styles.timerValueDanger : null]}>
          {formatDurationClock(elapsedSeconds)}
        </Text>
        {remainingSeconds !== null ? (
          <Text style={[styles.timerRemaining, inFinalMinute ? styles.timerValueDanger : null]}>
            Remaining: {formatDurationClock(remainingSeconds)}
          </Text>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.chatCard}>
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          nestedScrollEnabled
        >
          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.role === "user" ? styles.userBubble : styles.aiBubble,
              ]}
            >
              <Text style={styles.messageRole}>{message.role === "user" ? "You" : "AI"}</Text>
              <Text style={styles.messageText}>{message.content}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <Pressable
        style={[
          styles.primaryButton,
          primaryAction.kind === "submit" ? styles.submitButton : null,
          primaryAction.kind === "busy" ? styles.busyButton : null,
          primaryAction.disabled ? styles.disabled : null,
        ]}
        onPress={() => {
          void onPrimaryButton();
        }}
        disabled={primaryAction.disabled}
      >
        <Text style={[styles.primaryButtonText, primaryAction.kind === "busy" ? styles.primaryButtonTextLight : null]}>
          {primaryAction.label}
        </Text>
      </Pressable>
      {sessionActive ? (
        <Pressable
          style={[
            styles.secondaryActionButton,
            endButtonDisabled ? styles.disabled : null,
          ]}
          onPress={() => {
            void completeSessionAndScore();
          }}
          disabled={endButtonDisabled}
        >
          <Text style={styles.secondaryActionButtonText}>End Session and Score</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  screenContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  spacer: {
    width: 76,
  },
  title: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "700",
  },
  ghostButton: {
    minWidth: 76,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 40, 70, 0.5)",
  },
  ghostButtonText: {
    color: COLORS.text,
    fontWeight: "700",
    fontSize: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 15,
    marginBottom: 14,
    gap: 8,
  },
  label: {
    color: COLORS.accent,
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  cardTitle: {
    color: COLORS.text,
    fontWeight: "700",
    fontSize: 21,
    lineHeight: 27,
  },
  cardBody: {
    color: COLORS.textMuted,
    fontSize: 14.5,
    lineHeight: 21,
  },
  status: {
    color: COLORS.textMuted,
    textAlign: "center",
    marginBottom: 4,
  },
  hint: {
    color: "#8fb4e5",
    textAlign: "center",
    fontSize: 12.5,
    marginBottom: 10,
  },
  timerCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(9, 26, 45, 0.62)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    alignItems: "center",
    gap: 2,
  },
  timerLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  timerValue: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "800",
  },
  timerRemaining: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  timerValueDanger: {
    color: COLORS.danger,
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 124, 124, 0.55)",
    backgroundColor: "rgba(70, 20, 20, 0.58)",
    padding: 10,
    marginBottom: 10,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
  },
  warningCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 203, 107, 0.6)",
    backgroundColor: "rgba(84, 53, 7, 0.62)",
    padding: 10,
    marginBottom: 10,
  },
  warningText: {
    color: "#ffd992",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  debugModeCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
    alignSelf: "center",
  },
  debugModeRemote: {
    borderColor: "rgba(62, 214, 166, 0.6)",
    backgroundColor: "rgba(8, 77, 58, 0.55)",
  },
  debugModeLocal: {
    borderColor: "rgba(255, 124, 124, 0.6)",
    backgroundColor: "rgba(97, 23, 23, 0.58)",
  },
  debugModeText: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  chatCard: {
    minHeight: 230,
    height: 320,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(8, 23, 40, 0.62)",
    marginBottom: 14,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 14,
    gap: 12,
  },
  messageBubble: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: "92%",
    gap: 4,
  },
  userBubble: {
    backgroundColor: COLORS.userBubble,
    alignSelf: "flex-end",
  },
  aiBubble: {
    backgroundColor: COLORS.aiBubble,
    alignSelf: "flex-start",
  },
  messageRole: {
    color: "#bcddff",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  messageText: {
    color: COLORS.text,
    fontSize: 14.5,
    lineHeight: 21,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accent,
  },
  submitButton: {
    backgroundColor: "#49d7a8",
  },
  busyButton: {
    backgroundColor: "rgba(85, 134, 179, 0.78)",
  },
  primaryButtonText: {
    color: "#062235",
    fontWeight: "800",
    fontSize: 16,
  },
  primaryButtonTextLight: {
    color: "#eaf2ff",
  },
  secondaryActionButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 124, 124, 0.45)",
    backgroundColor: "rgba(92, 24, 24, 0.7)",
    marginTop: 10,
  },
  secondaryActionButtonText: {
    color: "#ffe4e4",
    fontWeight: "800",
    fontSize: 15,
  },
  disabled: {
    opacity: 0.55,
  },
});
