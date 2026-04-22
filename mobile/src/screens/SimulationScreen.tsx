import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system/legacy";
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
import {
  createSupportCase,
  fetchAiTtsAudio,
  getApiBaseUrl,
  startSimulationSession,
} from "../lib/api";
import type { PrefetchedRemoteSpeechChunk } from "../lib/api";
import {
  awaitSubmittedSimulationTurnReply,
  createOpeningLine,
  generateAssistantReply,
  isOpenAiConfigured,
  isUnifiedSimulationSubmitEnabled,
  shouldFallbackToLegacyUnifiedSubmit,
  submitRecordedSimulationTurn,
  transcribeAudio,
} from "../lib/openai";
import {
  createSimulationCorrelationId,
  getPrimarySimulationAction,
  getSimulationStartPlan,
  getTurnRecordingSafetySignal,
  TurnRecordingSafetySignal,
  TurnFinalizeTrigger,
} from "../lib/simulationInteractionModel";
import { buildNoTranscriptDiagnostics } from "../lib/simulationDiagnostics";
import {
  getSimulationTranscriptionMimeType,
  SIMULATION_RECORDING_OPTIONS,
} from "../lib/simulationRecordingProfile";
import { buildSimulationTurnTimingSummary, SimulationTurnSummaryMode } from "../lib/simulationTimingSummary";
import {
  preparePrefetchedRemoteAudioSource,
  releasePreparedRemoteAudioSource,
  speakWithRemoteTtsFallback,
  stopRemoteTtsPlayback as stopRemoteTtsPlaybackHelper,
  toRemoteTtsPreset,
} from "../lib/ttsPlayback";
import type { PreparedRemoteAudioSource } from "../lib/ttsPlayback";
import { splitTextForRemoteTtsFastStart } from "../lib/ttsFastStart";
import { AppColorScheme, DialogueMessage, SessionTiming, SimulationConfig } from "../types";

interface SimulationScreenProps {
  config: SimulationConfig;
  colorScheme: AppColorScheme;
  userId: string;
  authToken: string;
  onExit: () => void;
  onSessionComplete: (
    history: DialogueMessage[],
    config: SimulationConfig,
    timing: SessionTiming,
  ) => void;
}

const SOFT_TURN_NOTICE_MS = 35000;
const ABSOLUTE_TURN_NOTICE_MS = 60000;
const MIN_TURN_DURATION_FOR_LONG_PAUSE_NOTICE_MS = 1600;
const LONG_PAUSE_NOTICE_MS = 6500;
const STATUS_POLL_INTERVAL_MS = 120;
const VOICE_METER_THRESHOLD_DB = -42;
const MIN_VOICE_HIT_COUNT = 3;
const AUTO_ERROR_REPORT_THROTTLE_MS = 10 * 60 * 1000;
const MAX_AUTO_ERROR_MESSAGE_LENGTH = 4_800;

type SimulationThemeVariant = "light" | "dark";

type SimulationPalette = {
  heroStart: string;
  heroEnd: string;
  heroBorder: string;
  heroMetaBg: string;
  heroMetaBorder: string;
  heroMetaText: string;
  panel: string;
  panelStrong: string;
  panelMuted: string;
  stagePanel: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  hint: string;
  accent: string;
  accentStrong: string;
  accentText: string;
  statusEyebrow: string;
  modePillBg: string;
  modePillBorder: string;
  modePillText: string;
  timerBg: string;
  timerBorder: string;
  transcriptBg: string;
  transcriptHeaderBg: string;
  transcriptStatBg: string;
  transcriptStatBorder: string;
  transcriptStatText: string;
  userBubble: string;
  userBubbleBorder: string;
  aiBubble: string;
  aiBubbleBorder: string;
  ghostBg: string;
  primaryButton: string;
  submitButton: string;
  busyButton: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonBorder: string;
  secondaryButtonText: string;
  danger: string;
  shadow: string;
};

const SIMULATION_PALETTES: Record<SimulationThemeVariant, SimulationPalette> = {
  light: {
    heroStart: "rgba(255, 250, 242, 0.98)",
    heroEnd: "rgba(236, 240, 229, 0.96)",
    heroBorder: "rgba(98, 119, 100, 0.16)",
    heroMetaBg: "rgba(250, 251, 245, 0.94)",
    heroMetaBorder: "rgba(98, 119, 100, 0.12)",
    heroMetaText: "#50624f",
    panel: "rgba(255, 252, 246, 0.96)",
    panelStrong: "rgba(249, 246, 238, 0.98)",
    panelMuted: "rgba(243, 245, 238, 0.92)",
    stagePanel: "rgba(251, 249, 242, 0.98)",
    border: "rgba(98, 119, 100, 0.16)",
    borderStrong: "rgba(98, 119, 100, 0.24)",
    text: "#1f2921",
    textMuted: "#667166",
    hint: "#768175",
    accent: "#617861",
    accentStrong: "#536753",
    accentText: "#f8f0df",
    statusEyebrow: "#8d7452",
    modePillBg: "rgba(249, 245, 235, 0.94)",
    modePillBorder: "rgba(98, 119, 100, 0.14)",
    modePillText: "#50624f",
    timerBg: "rgba(244, 246, 240, 0.96)",
    timerBorder: "rgba(98, 119, 100, 0.14)",
    transcriptBg: "rgba(255, 253, 249, 0.98)",
    transcriptHeaderBg: "rgba(246, 247, 241, 0.94)",
    transcriptStatBg: "rgba(245, 248, 242, 0.94)",
    transcriptStatBorder: "rgba(98, 119, 100, 0.12)",
    transcriptStatText: "#5e6d5f",
    userBubble: "#6a816d",
    userBubbleBorder: "rgba(88, 111, 92, 0.24)",
    aiBubble: "#eef2ea",
    aiBubbleBorder: "rgba(98, 119, 100, 0.14)",
    ghostBg: "rgba(245, 247, 241, 0.95)",
    primaryButton: "#596f5c",
    submitButton: "#617a63",
    busyButton: "#b79d6f",
    primaryButtonText: "#f8f0df",
    secondaryButtonBg: "rgba(112, 43, 43, 0.08)",
    secondaryButtonBorder: "rgba(158, 77, 77, 0.24)",
    secondaryButtonText: "#8d3c3c",
    danger: "#b64c4c",
    shadow: "#121813",
  },
  dark: {
    heroStart: "rgba(35, 45, 36, 0.98)",
    heroEnd: "rgba(22, 30, 23, 0.96)",
    heroBorder: "rgba(244, 231, 206, 0.12)",
    heroMetaBg: "rgba(31, 39, 31, 0.72)",
    heroMetaBorder: "rgba(244, 231, 206, 0.08)",
    heroMetaText: "#e0d1b4",
    panel: "rgba(22, 30, 24, 0.92)",
    panelStrong: "rgba(19, 26, 21, 0.97)",
    panelMuted: "rgba(26, 35, 28, 0.88)",
    stagePanel: "rgba(20, 27, 21, 0.96)",
    border: "rgba(154, 174, 156, 0.22)",
    borderStrong: "rgba(244, 231, 206, 0.12)",
    text: "#eef4ec",
    textMuted: "#aebdaf",
    hint: "#a0b19f",
    accent: "#8caf93",
    accentStrong: "#6f9175",
    accentText: "#102017",
    statusEyebrow: "#d9c7a7",
    modePillBg: "rgba(28, 36, 29, 0.9)",
    modePillBorder: "rgba(244, 231, 206, 0.08)",
    modePillText: "#f4ead4",
    timerBg: "rgba(24, 34, 26, 0.88)",
    timerBorder: "rgba(154, 174, 156, 0.16)",
    transcriptBg: "rgba(15, 23, 17, 0.86)",
    transcriptHeaderBg: "rgba(22, 31, 24, 0.9)",
    transcriptStatBg: "rgba(24, 35, 27, 0.92)",
    transcriptStatBorder: "rgba(154, 174, 156, 0.14)",
    transcriptStatText: "#d7dece",
    userBubble: "#4d6552",
    userBubbleBorder: "rgba(140, 175, 147, 0.16)",
    aiBubble: "#28362b",
    aiBubbleBorder: "rgba(244, 231, 206, 0.08)",
    ghostBg: "rgba(28, 41, 32, 0.54)",
    primaryButton: "#8caf93",
    submitButton: "#6f9175",
    busyButton: "#9b845d",
    primaryButtonText: "#102017",
    secondaryButtonBg: "rgba(92, 24, 24, 0.7)",
    secondaryButtonBorder: "rgba(255, 124, 124, 0.45)",
    secondaryButtonText: "#ffe4e4",
    danger: "#ff7c7c",
    shadow: "#0f1510",
  },
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

function getFileExtensionFromUri(uri: string): string | null {
  const match = uri.trim().match(/(\.[a-z0-9]+)(?:\?.*)?$/i);
  return match ? match[1].toLowerCase() : null;
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

export function SimulationScreen({ config, colorScheme, userId, authToken, onExit, onSessionComplete }: SimulationScreenProps) {
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [mode, setMode] = useState<OrbMode>("thinking");
  const [status, setStatus] = useState("Preparing scenario...");
  const [error, setError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [useLocalMockMode, setUseLocalMockMode] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const apiConfigured = useMemo(() => isOpenAiConfigured(), []);
  const unifiedSubmitEnabled = useMemo(() => isUnifiedSimulationSubmitEnabled(), []);
  const voiceOption = useMemo(() => getAiVoiceOption(config.voiceProfile), [config.voiceProfile]);
  const themeVariant: SimulationThemeVariant = colorScheme === "soft_light" ? "light" : "dark";
  const palette = useMemo(() => SIMULATION_PALETTES[themeVariant], [themeVariant]);
  const styles = useMemo(() => createStyles(palette), [palette]);
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
  const pendingOpeningSpeechPrefetchRef = useRef<PrefetchedRemoteSpeechChunk | null>(null);
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
  const turnSubmitStartedAtRef = useRef<number | null>(null);
  const currentTurnCorrelationIdRef = useRef<string | null>(null);
  const recordingSafetySignalRef = useRef<TurnRecordingSafetySignal | null>(null);

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

  const commitAssistantMessage = (params: {
    message: DialogueMessage;
    correlationId: string;
    phase: string;
    startedAtMs?: number | null;
  }): number => {
    if (!messagesRef.current.some((entry) => entry.id === params.message.id)) {
      appendMessage(params.message);
    }
    const committedAtMs = Date.now();
    logSimulationTiming({
      correlationId: params.correlationId,
      phase: params.phase,
      startedAtMs: params.startedAtMs ?? committedAtMs,
      details: {
        messageChars: params.message.content.length,
      },
    });
    return committedAtMs;
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

  const handleTtsCancellation = useCallback((details: {
    correlationId?: string | null;
    reason: string;
    expected: boolean;
    likelyUserFacing: boolean;
    sourceKind?: string | null;
    playbackStarted: boolean;
    fallbackAttempted: boolean;
    fallbackSucceeded: boolean;
    chunkIndex?: number | null;
    chunkCount?: number | null;
    sessionEnding: boolean;
    screenChanging: boolean;
    abortSignaled: boolean;
    summary: string;
  }) => {
    const correlationId = details.correlationId?.trim() || createSimulationCorrelationId(config.simulationSessionId, "tts-cancel");
    logSimulationTiming({
      correlationId,
      phase: "tts_cancelled",
      details: {
        reason: details.reason,
        expected: details.expected,
        likelyUserFacing: details.likelyUserFacing,
        sourceKind: details.sourceKind ?? null,
        playbackStarted: details.playbackStarted,
        fallbackAttempted: details.fallbackAttempted,
        fallbackSucceeded: details.fallbackSucceeded,
        chunkIndex: details.chunkIndex ?? null,
        chunkCount: details.chunkCount ?? null,
        sessionEnding: details.sessionEnding,
        screenChanging: details.screenChanging,
        abortSignaled: details.abortSignaled,
      },
    });

    if (details.expected) {
      return;
    }

    void submitAutoErrorReport("simulation.tts_cancelled", new Error(details.summary), {
      simulationSessionId: config.simulationSessionId,
      correlationId,
      reason: details.reason,
      sourceKind: details.sourceKind ?? null,
      playbackStarted: details.playbackStarted,
      fallbackAttempted: details.fallbackAttempted,
      fallbackSucceeded: details.fallbackSucceeded,
      chunkIndex: details.chunkIndex ?? null,
      chunkCount: details.chunkCount ?? null,
      likelyUserFacing: details.likelyUserFacing,
      sessionEnding: details.sessionEnding,
      screenChanging: details.screenChanging,
    });
  }, [config.simulationSessionId, logSimulationTiming, submitAutoErrorReport]);

  const speakSingleUtterance = async (
    text: string,
    assistantTextReceivedAtMs?: number,
    onPlaybackStart?: (startedAtMs: number) => void,
    prefetchedRemoteAudio?: PrefetchedRemoteSpeechChunk | null,
    preparedRemoteSource?: PreparedRemoteAudioSource | null,
    correlationId?: string,
    chunkIndex?: number,
    chunkCount?: number,
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
        simulationSessionId: config.simulationSessionId,
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
        preparedRemoteSource,
        abortSignal: abortController.signal,
        chunkIndex,
        chunkCount,
        describeCancellation: () => ({
          superseded: ttsRequestGenerationRef.current !== requestGeneration,
          sessionEnding: simulationClosedRef.current,
          screenChanging: unmountedRef.current,
        }),
        onRemoteCancellation: handleTtsCancellation,
        isCancelled: () =>
          ttsRequestGenerationRef.current !== requestGeneration || simulationClosedRef.current || unmountedRef.current,
        onPlaybackStart: (details) => {
          onPlaybackStart?.(details.startedAtMs);
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
      assistantTextReceivedAtMs?: number,
      correlationId?: string,
      chunkIndex?: number,
      chunkCount?: number,
    ): Promise<PreparedRemoteAudioSource | null> => {
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
        return await preparePrefetchedRemoteAudioSource({
          source: "simulation",
          preset,
          assistantTextReceivedAtMs,
          prefetchedRemoteAudio: prefetched,
          correlationId,
          chunkIndex,
          chunkCount,
        });
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
    prefetchedFirstChunk?: PrefetchedRemoteSpeechChunk | null,
  ): Promise<void> => {
    const chunks = shouldUseFastStartRemoteTts ? splitTextForRemoteTtsFastStart(text) : [text];
    const requestGeneration = ttsRequestGenerationRef.current;
    const preset = toRemoteTtsPreset(config.voiceGender, config.voiceProfile);
    const preparedChunkByIndex = new Map<number, Promise<PreparedRemoteAudioSource | null>>();
    const resolvedPreparedChunkByIndex = new Map<number, PreparedRemoteAudioSource>();
    let playbackStartHandled = false;
    let previousChunkCompletedAtMs: number | null = null;
    const handlePlaybackStart = () => {
      if (playbackStartHandled) {
        return;
      }
      playbackStartHandled = true;
      startPrefetchForChunk(2);
      onPlaybackStart?.();
    };
    const startPrefetchForChunk = (targetIndex: number) => {
      if (!shouldUseFastStartRemoteTts || targetIndex >= chunks.length) {
        return;
      }
      if (preparedChunkByIndex.has(targetIndex)) {
        return;
      }
      preparedChunkByIndex.set(
        targetIndex,
        prefetchRemoteTtsChunk(
          chunks[targetIndex],
          requestGeneration,
          preset,
          targetIndex === 0 ? assistantTextReceivedAtMs : Date.now(),
          correlationId,
          targetIndex,
          chunks.length,
        ),
      );
    };

    if (prefetchedFirstChunk) {
      preparedChunkByIndex.set(
        0,
        preparePrefetchedRemoteAudioSource({
          source: "simulation",
          preset,
          assistantTextReceivedAtMs,
          prefetchedRemoteAudio: prefetchedFirstChunk,
          correlationId,
          chunkIndex: 0,
          chunkCount: chunks.length,
        }),
      );
    }
    startPrefetchForChunk(1);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        let preparedRemoteAudio: PreparedRemoteAudioSource | null = null;
        const preparedPromise = preparedChunkByIndex.get(index);
        if (preparedPromise) {
          preparedRemoteAudio = await preparedPromise;
          if (preparedRemoteAudio) {
            resolvedPreparedChunkByIndex.set(index, preparedRemoteAudio);
            logSimulationTiming({
              correlationId: correlationId ?? createSimulationCorrelationId(config.simulationSessionId, `chunk-${index + 1}`),
              phase: "tts_chunk_prepared",
              details: {
                chunkIndex: index,
                chunkCount: chunks.length,
                sourceKind: preparedRemoteAudio.sourceKind,
              },
            });
          }
        }
        await speakSingleUtterance(
          chunk,
          index === 0 ? assistantTextReceivedAtMs : Date.now(),
          (startedAtMs) => {
            if (index === 0) {
              handlePlaybackStart();
            }
            logSimulationTiming({
              correlationId: correlationId ?? createSimulationCorrelationId(config.simulationSessionId, `chunk-${index + 1}`),
              phase: "tts_chunk_playback_started",
              details: {
                chunkIndex: index,
                chunkCount: chunks.length,
                boundaryGapMs:
                  index > 0 && typeof previousChunkCompletedAtMs === "number"
                    ? Math.max(0, startedAtMs - previousChunkCompletedAtMs)
                    : null,
              },
            });
            startPrefetchForChunk(index + 1);
          },
          preparedRemoteAudio?.audio ?? (index === 0 ? prefetchedFirstChunk ?? null : null),
          preparedRemoteAudio,
          correlationId,
          index,
          chunks.length,
        );
        if (preparedRemoteAudio) {
          resolvedPreparedChunkByIndex.delete(index);
        }
        if (index === 0) {
          handlePlaybackStart();
        }
        previousChunkCompletedAtMs = Date.now();
        logSimulationTiming({
          correlationId: correlationId ?? createSimulationCorrelationId(config.simulationSessionId, `chunk-${index + 1}`),
          phase: "tts_chunk_completed",
          details: {
            chunkIndex: index,
            chunkCount: chunks.length,
          },
        });
        startPrefetchForChunk(index + 1);
      }
    } finally {
      for (const [index, preparedChunk] of resolvedPreparedChunkByIndex) {
        await releasePreparedRemoteAudioSource(preparedChunk);
        resolvedPreparedChunkByIndex.delete(index);
      }
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

  const updateRecordingSafetyStatus = (signal: TurnRecordingSafetySignal | null) => {
    if (recordingSafetySignalRef.current === signal) {
      return;
    }

    recordingSafetySignalRef.current = signal;

    if (signal === "long-pause") {
      setStatus("Still recording. Tap Submit Response when you're ready, or keep speaking.");
      return;
    }

    if (signal === "soft-limit") {
      setStatus("Long response still recording. Tap Submit Response when you're done.");
      return;
    }

    if (signal === "absolute-limit") {
      setStatus("Very long response still recording. Tap Submit Response to process, or end the session.");
      return;
    }

    setStatus("Listening... Tap Submit Response when you're done.");
  };

  const requestFinalizeTurn = () => {
    if (finalizeRequestedRef.current || processingRef.current || !recordingRef.current) {
      return;
    }

    const correlationId = currentTurnCorrelationIdRef.current ?? createTurnCorrelationId();
    currentTurnCorrelationIdRef.current = correlationId;
    turnSubmitStartedAtRef.current = Date.now();
    const trigger: TurnFinalizeTrigger = "submit";
    setStatus("Submitting your response...");
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

      const safetySignal = getTurnRecordingSafetySignal({
        elapsedMs: elapsed,
        silenceMs: heardVoiceRef.current ? now - lastVoiceAtRef.current : null,
        heardVoice: heardVoiceRef.current,
        meteringSeen: meteringSeenRef.current,
        minTurnDurationMs: MIN_TURN_DURATION_FOR_LONG_PAUSE_NOTICE_MS,
        longPauseNoticeMs: LONG_PAUSE_NOTICE_MS,
        softTurnNoticeMs: SOFT_TURN_NOTICE_MS,
        absoluteTurnNoticeMs: ABSOLUTE_TURN_NOTICE_MS,
      });
      updateRecordingSafetyStatus(safetySignal);
    } catch {
      // Ignore transient polling errors and keep the manual-submit loop intact.
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
      await recording.prepareToRecordAsync(SIMULATION_RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
      finalizeRequestedRef.current = false;
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
      recordingSafetySignalRef.current = null;

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
    const finalizeTrigger: TurnFinalizeTrigger = "submit";
    const effectiveSubmitStartedAtMs = submitStartedAtMs ?? Date.now();
    const transcriptionMimeType = getSimulationTranscriptionMimeType(Platform.OS);
    let audioModeResetPromise: Promise<void> | null = null;
    let recordingFinalizeCompletedAtMs: number | null = null;
    let audioBytes: number | undefined;
    let audioFileExtension: string | null = null;
    let turnDurationSeconds = 0;
    let transcriptionAttempted = false;
    let transcriptionFailed = false;
    let transcriptionErrorMessage: string | null = null;
    let usedLocalTranscriptionFallback = false;
    let localTranscriptionFallbackReason: string | null = null;
    let unifiedSubmitRequestStartedAtMs: number | null = null;
    let unifiedSubmitResponseAtMs: number | null = null;
    let transcribeRequestStartedAtMs: number | null = null;
    let transcribeResponseAtMs: number | null = null;
    let assistantRequestStartedAtMs: number | null = null;
    let assistantResponseAtMs: number | null = null;
    let assistantTextCommittedAtMs: number | null = null;
    let ttsPipelineStartedAtMs: number | null = null;
    let audioModeResetAwaitStartedAtMs: number | null = null;
    let audioModeResetCompletedAtMs: number | null = null;
    let playbackStartedAtMs: number | null = null;
    let speakingCompletedAtMs: number | null = null;
    let transcriptChars = 0;
    let replyChars = 0;
    let measureRecordingPayload: () => Promise<void> = async () => {};
    let summaryMode: SimulationTurnSummaryMode = apiConfigured && !useLocalMockMode ? "remote" : "local_mock";
    const remoteTtsPreset = toRemoteTtsPreset(config.voiceGender, config.voiceProfile);
    let turnSummaryLogged = false;
    const emitTurnSummary = (params: {
      outcome: "playback_started" | "no_clear_speech" | "error" | "playback_signal_missing";
      errorMessage?: string | null;
    }) => {
      if (turnSummaryLogged) {
        return;
      }
      turnSummaryLogged = true;
      // eslint-disable-next-line no-console
      console.log("[simulation-turn-summary]", buildSimulationTurnTimingSummary({
        simulationSessionId: config.simulationSessionId,
        correlationId,
        trigger: finalizeTrigger,
        mode: summaryMode,
        outcome: params.outcome,
        submitStartedAtMs: effectiveSubmitStartedAtMs,
        recordingFinalizeCompletedAtMs,
        unifiedSubmitRequestStartedAtMs,
        unifiedSubmitResponseAtMs,
        transcribeRequestStartedAtMs,
        transcribeResponseAtMs,
        assistantRequestStartedAtMs,
        assistantResponseAtMs,
        assistantTextCommittedAtMs,
        ttsPipelineStartedAtMs,
        audioModeResetAwaitStartedAtMs,
        audioModeResetCompletedAtMs,
        playbackStartedAtMs,
        speakingCompletedAtMs,
        transcriptChars,
        replyChars,
        errorMessage: params.errorMessage ?? null,
      }));
    };

    try {
      logSimulationTiming({
        correlationId,
        phase: "recording_finalize_start",
        startedAtMs: effectiveSubmitStartedAtMs,
        details: {
          trigger: finalizeTrigger,
        },
      });
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
      audioModeResetPromise = setAudioMode(false).catch(() => {
        // Ignore mode reset errors and allow the turn pipeline to continue.
      });
      recordingFinalizeCompletedAtMs = Date.now();

      const audioUri = recording.getURI();
      if (!audioUri) {
        throw new Error("Recorded audio file could not be read.");
      }
      turnDurationSeconds = Math.max(
        1,
        Math.round((Date.now() - turnStartedAtRef.current) / 1000),
      );
      audioFileExtension = getFileExtensionFromUri(audioUri);
      const audioFileInfoPromise = FileSystem.getInfoAsync(audioUri).catch(() => null);
      measureRecordingPayload = async () => {
        if (typeof audioBytes === "number") {
          return;
        }
        const audioFileInfo = await audioFileInfoPromise;
        audioBytes =
          audioFileInfo?.exists && typeof audioFileInfo.size === "number" && Number.isFinite(audioFileInfo.size)
            ? audioFileInfo.size
            : undefined;
        if (typeof audioBytes === "number") {
          logSimulationTiming({
            correlationId,
            phase: "recording_payload_measured",
            startedAtMs: effectiveSubmitStartedAtMs,
            details: {
              audioBytes,
            },
          });
        }
      };
      logSimulationTiming({
        correlationId,
        phase: "recording_finalize_complete",
        startedAtMs: effectiveSubmitStartedAtMs,
        details: {
          turnDurationSeconds,
        },
      });
      const inferredVoiceWithoutMeter =
        !meteringSeenRef.current && (turnDurationSeconds >= 3 || finalizeTrigger === "submit");
      const shouldAttemptTranscription =
        detectedVoiceRef.current ||
        heardVoiceRef.current ||
        inferredVoiceWithoutMeter;

      let userText = "";
      let replyPayload: { assistantText: string; speechPrefetch: PrefetchedRemoteSpeechChunk | null } | null = null;
      let unifiedAssistantAwaitPromise:
        | Promise<{
            outcome: "assistant_reply" | "no_clear_speech";
            transcriptText: string;
            noClearSpeechReason?: "empty_transcript" | "assistant_echo" | null;
            assistantText?: string;
            speechPrefetch?: PrefetchedRemoteSpeechChunk | null;
            runtime: { modelLatencyMs?: number | null; speechPrefetchTtsLatencyMs?: number | null } | null;
          }>
        | null = null;
      let unifiedAssistantAwaitAbortController: AbortController | null = null;
      let useLiveApiThisTurn = apiConfigured && !useLocalMockMode;
      let shouldAttemptLegacyRemotePath = useLiveApiThisTurn && shouldAttemptTranscription;
      if (!useLiveApiThisTurn) {
        usedMockModeDuringSessionRef.current = true;
      }
      if (useLiveApiThisTurn && shouldAttemptTranscription && unifiedSubmitEnabled) {
        try {
          transcriptionAttempted = true;
          setStatus("Processing your response...");
          unifiedSubmitRequestStartedAtMs = Date.now();
          transcribeRequestStartedAtMs = unifiedSubmitRequestStartedAtMs;
          assistantRequestStartedAtMs = unifiedSubmitRequestStartedAtMs;
          unifiedAssistantAwaitAbortController = new AbortController();
          unifiedAssistantAwaitPromise = awaitSubmittedSimulationTurnReply({
            userId,
            authToken,
            correlationId,
            signal: unifiedAssistantAwaitAbortController.signal,
          });
          logSimulationTiming({
            correlationId,
            phase: "assistant_await_request_start",
            startedAtMs: effectiveSubmitStartedAtMs,
          });
          logSimulationTiming({
            correlationId,
            phase: "unified_submit_request_start",
            startedAtMs: effectiveSubmitStartedAtMs,
          });
          logSimulationApiCall("submitRecordedSimulationTurn");
          const unifiedPayload = await submitRecordedSimulationTurn({
            userId,
            authToken,
            audioUri,
            preferredMimeType: transcriptionMimeType,
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
            speechPrefetchPreset: shouldUseFastStartRemoteTts ? remoteTtsPreset : null,
            responseMode: "transcript_first_v1",
            correlationId,
          });
          unifiedSubmitResponseAtMs = Date.now();
          transcribeResponseAtMs = unifiedSubmitResponseAtMs;
          assistantResponseAtMs =
            unifiedPayload.outcome === "assistant_reply" ? unifiedSubmitResponseAtMs : assistantResponseAtMs;
          shouldAttemptLegacyRemotePath = false;
          userText = unifiedPayload.transcriptText.trim();
          transcriptChars = userText.length;
          logSimulationTiming({
            correlationId,
            phase: "unified_submit_response",
            startedAtMs: effectiveSubmitStartedAtMs,
            details: {
              transcriptChars: userText.length,
              outcome: unifiedPayload.outcome,
              cacheStatus: unifiedPayload.runtime?.cacheStatus ?? null,
              contextBuildMs: unifiedPayload.runtime?.contextBuildMs ?? null,
              modelLatencyMs: unifiedPayload.runtime?.modelLatencyMs ?? null,
            },
          });
          if (userText) {
            logSimulationTiming({
              correlationId,
              phase: "transcribe_response",
              startedAtMs: effectiveSubmitStartedAtMs,
              details: {
                transcriptChars: userText.length,
              },
            });
          }
          if (unifiedPayload.outcome === "assistant_reply") {
            unifiedAssistantAwaitAbortController?.abort();
            unifiedAssistantAwaitPromise = null;
            replyPayload = {
              assistantText: unifiedPayload.assistantText,
              speechPrefetch: unifiedPayload.speechPrefetch,
            };
            replyChars = unifiedPayload.assistantText.length;
            logSimulationTiming({
              correlationId,
              phase: "assistant_response_received",
              startedAtMs: effectiveSubmitStartedAtMs,
              details: {
                replyChars,
                path: "unified_submit",
                modelLatencyMs: unifiedPayload.runtime?.modelLatencyMs ?? null,
                speechPrefetchTtsLatencyMs: unifiedPayload.runtime?.speechPrefetchTtsLatencyMs ?? null,
              },
            });
          } else if (unifiedPayload.outcome === "no_clear_speech") {
            unifiedAssistantAwaitAbortController.abort();
          }
        } catch (unifiedError) {
          unifiedAssistantAwaitAbortController?.abort();
          const shouldFallbackToLegacy = shouldFallbackToLegacyUnifiedSubmit(unifiedError);
          if (shouldFallbackToLegacy) {
            logSimulationTiming({
              correlationId,
              phase: "unified_submit_fallback_legacy",
              startedAtMs: effectiveSubmitStartedAtMs,
            });
          } else {
            transcriptionAttempted = true;
            transcriptionFailed = true;
            transcriptionErrorMessage = getErrorMessage(unifiedError, "Unified submit failed.");
            if (isApiError(unifiedError)) {
              setUseLocalMockMode(true);
              usedMockModeDuringSessionRef.current = true;
              usedLocalTranscriptionFallback = true;
              localTranscriptionFallbackReason = "api_error_local_fallback";
              setError(null);
              setStatus("Live AI unavailable. Switched to local test mode.");
              useLiveApiThisTurn = false;
              shouldAttemptLegacyRemotePath = false;
              summaryMode = "local_fallback";
              if (detectedVoiceRef.current || heardVoiceRef.current || inferredVoiceWithoutMeter) {
                userText = buildLocalCapturedText(turnDurationSeconds);
                transcriptChars = userText.length;
              }
              logSimulationTiming({
                correlationId,
                phase: "transcribe_fallback_local_mode",
                startedAtMs: effectiveSubmitStartedAtMs,
              });
            } else {
              throw unifiedError;
            }
          }
        }
      }
      if (shouldAttemptLegacyRemotePath) {
        try {
          transcriptionAttempted = true;
          setStatus("Transcribing your response...");
          transcribeRequestStartedAtMs = Date.now();
          logSimulationTiming({
            correlationId,
            phase: "transcribe_request_start",
            startedAtMs: effectiveSubmitStartedAtMs,
          });
          logSimulationApiCall("transcribeAudio");
          userText = (
            await transcribeAudio({
              userId,
              authToken,
              audioUri,
              preferredMimeType: transcriptionMimeType,
              correlationId,
            })
          ).trim();
          transcribeResponseAtMs = Date.now();
          transcriptChars = userText.length;
          logSimulationTiming({
            correlationId,
            phase: "transcribe_response",
            startedAtMs: effectiveSubmitStartedAtMs,
            details: {
              transcriptChars: userText.length,
            },
          });
        } catch (transcriptionError) {
          transcriptionAttempted = true;
          transcriptionFailed = true;
          transcriptionErrorMessage = getErrorMessage(transcriptionError, "Transcription failed.");
          if (isApiError(transcriptionError)) {
            setUseLocalMockMode(true);
            usedMockModeDuringSessionRef.current = true;
            usedLocalTranscriptionFallback = true;
            localTranscriptionFallbackReason = "api_error_local_fallback";
            setError(null);
            setStatus("Live AI unavailable. Switched to local test mode.");
            useLiveApiThisTurn = false;
            summaryMode = "local_fallback";
            if (detectedVoiceRef.current || heardVoiceRef.current || inferredVoiceWithoutMeter) {
              userText = buildLocalCapturedText(turnDurationSeconds);
              transcriptChars = userText.length;
            }
            logSimulationTiming({
              correlationId,
              phase: "transcribe_fallback_local_mode",
              startedAtMs: effectiveSubmitStartedAtMs,
            });
          } else {
            throw transcriptionError;
          }
        }
      } else if (!useLiveApiThisTurn && shouldAttemptTranscription) {
        usedLocalTranscriptionFallback = true;
        localTranscriptionFallbackReason = "local_test_mode";
        userText = buildLocalCapturedText(turnDurationSeconds);
        transcriptChars = userText.length;
      }

      if (!userText && transcriptionAttempted) {
        await measureRecordingPayload();
        // eslint-disable-next-line no-console
        console.warn("[simulation-no-transcript]", {
          simulationSessionId: config.simulationSessionId,
          correlationId,
          ...buildNoTranscriptDiagnostics({
            audioBytes: audioBytes ?? null,
            recordingDurationSeconds: turnDurationSeconds,
            contentType: transcriptionMimeType,
            fileExtension: audioFileExtension,
            remoteTranscriptionAttempted: transcriptionAttempted,
            transcriptionRequestFailed: transcriptionFailed,
            transcriptionErrorMessage,
            transcriptText: userText,
            usedLocalFallback: usedLocalTranscriptionFallback,
            localFallbackReason: localTranscriptionFallbackReason,
          }),
        });
      }

      if (userText && appearsToEchoAssistantReply(userText, messagesRef.current)) {
        userText = "";
        replyPayload = null;
        unifiedAssistantAwaitAbortController?.abort();
        unifiedAssistantAwaitPromise = null;
      }

      if (userText) {
        const userMessage = { id: createMessageId(), role: "user" as const, content: userText };
        let userMessageCommitted = false;
        const commitUserMessageIfNeeded = () => {
          if (userMessageCommitted || unmountedRef.current || simulationClosedRef.current) {
            return;
          }
          userMessageCommitted = true;
          appendMessage(userMessage);
          logSimulationTiming({
            correlationId,
            phase: "user_transcript_committed",
            startedAtMs: effectiveSubmitStartedAtMs,
            details: {
              transcriptChars: userText.length,
            },
          });
        };

        setStatus(replyPayload || unifiedAssistantAwaitPromise ? "Preparing AI response..." : "Crafting AI reply...");

        if (sessionActiveRef.current && !unmountedRef.current) {
          if (!replyPayload && unifiedAssistantAwaitPromise) {
            commitUserMessageIfNeeded();
            try {
              const awaitedPayload = await unifiedAssistantAwaitPromise;
              if (awaitedPayload.outcome === "assistant_reply" && awaitedPayload.assistantText) {
                replyPayload = {
                  assistantText: awaitedPayload.assistantText,
                  speechPrefetch: awaitedPayload.speechPrefetch ?? null,
                };
                assistantResponseAtMs = Date.now();
                replyChars = awaitedPayload.assistantText.length;
                logSimulationTiming({
                  correlationId,
                  phase: "assistant_response_received",
                  startedAtMs: effectiveSubmitStartedAtMs,
                  details: {
                    replyChars,
                    path: "unified_submit_await",
                    modelLatencyMs: awaitedPayload.runtime?.modelLatencyMs ?? null,
                    speechPrefetchTtsLatencyMs: awaitedPayload.runtime?.speechPrefetchTtsLatencyMs ?? null,
                  },
                });
              }
            } catch (awaitError) {
              const awaitErrorMessage = getErrorMessage(awaitError, "Assistant reply wait failed.");
              logSimulationTiming({
                correlationId,
                phase: "assistant_await_fallback_generate",
                startedAtMs: effectiveSubmitStartedAtMs,
                details: {
                  error: awaitErrorMessage,
                },
              });
            } finally {
              unifiedAssistantAwaitAbortController?.abort();
              unifiedAssistantAwaitPromise = null;
            }
          }

          if (!replyPayload) {
            commitUserMessageIfNeeded();
            assistantRequestStartedAtMs = assistantRequestStartedAtMs ?? Date.now();
            logSimulationTiming({
              correlationId,
              phase: "assistant_request_start",
              startedAtMs: effectiveSubmitStartedAtMs,
            });
            replyPayload = useLiveApiThisTurn
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
                  speechPrefetchPreset: shouldUseFastStartRemoteTts ? remoteTtsPreset : null,
                  correlationId,
                }))
              : {
                  assistantText: createLocalAssistantReply({
                    scenario: config.scenario,
                    difficulty: config.difficulty,
                    personaStyle: config.personaStyle,
                    turnIndex: messagesRef.current.filter((message) => message.role === "assistant").length,
                    userText,
                    recentAssistantMessages: messagesRef.current
                      .filter((message) => message.role === "assistant")
                      .map((message) => message.content),
                    turnDurationSeconds,
                  }),
                  speechPrefetch: null,
                };
            assistantResponseAtMs = Date.now();
            replyChars = replyPayload.assistantText.length;
            logSimulationTiming({
              correlationId,
              phase: "assistant_response_received",
              startedAtMs: effectiveSubmitStartedAtMs,
              details: {
                replyChars: replyPayload.assistantText.length,
              },
            });
          }
          const reply = replyPayload.assistantText;
          const prefetchedAssistantSpeech = replyPayload.speechPrefetch;

          if (sessionActiveRef.current && !unmountedRef.current) {
            commitUserMessageIfNeeded();
            const assistantTextReceivedAtMs = Date.now();
            const assistantMessage = { id: createMessageId(), role: "assistant" as const, content: reply };
            let assistantMessageCommitted = false;
            const commitAssistantMessageIfNeeded = () => {
              if (assistantMessageCommitted || unmountedRef.current || simulationClosedRef.current) {
                return;
              }
              assistantMessageCommitted = true;
              assistantTextCommittedAtMs = commitAssistantMessage({
                message: assistantMessage,
                correlationId,
                phase: "assistant_message_committed",
                startedAtMs: effectiveSubmitStartedAtMs,
              });
            };
            // eslint-disable-next-line no-console
            console.log("[TTS-TIMING]", {
              source: "simulation",
              preset: remoteTtsPreset,
              correlationId,
              phase: "assistant_text_received",
              tsMs: assistantTextReceivedAtMs,
              elapsedMs: 0,
            });
            setStatus("Preparing AI voice...");
            // eslint-disable-next-line no-console
            console.log("[TTS-TIMING]", {
              source: "simulation",
              preset: remoteTtsPreset,
              correlationId,
              phase: "speak_invoked",
              tsMs: Date.now(),
              elapsedMs: Date.now() - assistantTextReceivedAtMs,
            });
            ttsPipelineStartedAtMs = Date.now();
            logSimulationTiming({
              correlationId,
              phase: "tts_pipeline_start",
              startedAtMs: effectiveSubmitStartedAtMs,
            });
            if (audioModeResetPromise) {
              audioModeResetAwaitStartedAtMs = Date.now();
              await audioModeResetPromise;
              audioModeResetCompletedAtMs = Date.now();
              logSimulationTiming({
                correlationId,
                phase: "audio_mode_reset_complete",
                startedAtMs: effectiveSubmitStartedAtMs,
                details: {
                  waitMs: Math.max(0, audioModeResetCompletedAtMs - audioModeResetAwaitStartedAtMs),
                },
              });
            } else {
              audioModeResetAwaitStartedAtMs = Date.now();
              audioModeResetCompletedAtMs = audioModeResetAwaitStartedAtMs;
            }
            const speakPromise = speakAssistantResponse(
              reply,
              assistantTextReceivedAtMs,
              () => {
                commitAssistantMessageIfNeeded();
                setMode("speaking");
                setStatus("AI is speaking...");
                playbackStartedAtMs = Date.now();
                logSimulationTiming({
                  correlationId,
                  phase: "assistant_playback_started",
                  startedAtMs: effectiveSubmitStartedAtMs,
                });
                emitTurnSummary({
                  outcome: "playback_started",
                });
              },
              correlationId,
              prefetchedAssistantSpeech,
            );
            await speakPromise;
            speakingCompletedAtMs = Date.now();
            logSimulationTiming({
              correlationId,
              phase: "assistant_speaking_complete",
              startedAtMs: effectiveSubmitStartedAtMs,
            });
            commitAssistantMessageIfNeeded();
            if (!turnSummaryLogged) {
              emitTurnSummary({
                outcome: "playback_signal_missing",
              });
            }
          }
        }
      } else {
        setStatus("No clear speech detected. Listening again...");
        emitTurnSummary({
          outcome: "no_clear_speech",
        });
      }

      continueLoop = sessionActiveRef.current;
    } catch (turnError) {
      const turnErrorMessage = getErrorMessage(turnError, "Could not process voice response.");
      setError(turnErrorMessage);
      if (isPlaceholderTranscriptError(turnError)) {
        setStatus("Transcription missing. Please verify REMOTE mode.");
      }
      await measureRecordingPayload();
      void submitAutoErrorReport("simulation.turn_finalize", turnError, {
        simulationSessionId: config.simulationSessionId,
        correlationId,
        trigger: finalizeTrigger,
        audioBytes: audioBytes ?? null,
        turnDurationSeconds,
        remoteTranscriptionAttempted: transcriptionAttempted,
        transcriptionRequestFailed: transcriptionFailed,
        transcriptionErrorMessage,
        usedLocalTranscriptionFallback,
        localTranscriptionFallbackReason,
        noTranscriptDiagnostics:
          isPlaceholderTranscriptError(turnError) || (transcriptionAttempted && transcriptChars === 0)
            ? buildNoTranscriptDiagnostics({
                audioBytes: audioBytes ?? null,
                recordingDurationSeconds: turnDurationSeconds,
                contentType: transcriptionMimeType,
                fileExtension: audioFileExtension,
                remoteTranscriptionAttempted: transcriptionAttempted,
                transcriptionRequestFailed: transcriptionFailed,
                transcriptionErrorMessage,
                transcriptText: "",
                usedLocalFallback: usedLocalTranscriptionFallback,
                localFallbackReason: localTranscriptionFallbackReason,
              })
            : null,
      });
      emitTurnSummary({
        outcome: "error",
        errorMessage: turnErrorMessage,
      });
      continueLoop = sessionActiveRef.current;
    } finally {
      if (audioModeResetPromise) {
        if (!audioModeResetAwaitStartedAtMs) {
          audioModeResetAwaitStartedAtMs = Date.now();
        }
        await audioModeResetPromise;
        if (!audioModeResetCompletedAtMs) {
          audioModeResetCompletedAtMs = Date.now();
        }
      }
      processingRef.current = false;
      finalizeRequestedRef.current = false;
      turnSubmitStartedAtRef.current = null;
      currentTurnCorrelationIdRef.current = null;
      recordingSafetySignalRef.current = null;

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
    const remoteTtsPreset = toRemoteTtsPreset(config.voiceGender, config.voiceProfile);
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
          pendingOpeningSpeechPrefetchRef.current = null;
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
              speechPrefetchPreset: shouldUseFastStartRemoteTts ? remoteTtsPreset : null,
              correlationId: openingCorrelationId,
            });
            openingLine = openingPayload.assistantText;
            sessionTrainingPackIdRef.current = openingPayload.trainingPackId;
            pendingOpeningSpeechPrefetchRef.current = openingPayload.speechPrefetch;
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
              pendingOpeningSpeechPrefetchRef.current = null;
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
        const openingSpeechPrefetch = pendingOpeningSpeechPrefetchRef.current;
        const openingAssistantMessage = { id: createMessageId(), role: "assistant" as const, content: openingLine };
        let openingMessageCommitted = false;
        const commitOpeningAssistantMessageIfNeeded = () => {
          if (openingMessageCommitted || unmountedRef.current || simulationClosedRef.current) {
            return;
          }
          openingMessageCommitted = true;
          commitAssistantMessage({
            message: openingAssistantMessage,
            correlationId: openingCorrelationId,
            phase: "opening_message_committed",
          });
        };
        // eslint-disable-next-line no-console
        console.log("[TTS-TIMING]", {
          source: "simulation",
          preset: remoteTtsPreset,
          correlationId: openingCorrelationId,
          phase: "assistant_text_received",
          tsMs: assistantTextReceivedAtMs,
          elapsedMs: 0,
        });
        setStatus("Preparing AI voice...");
        // eslint-disable-next-line no-console
        console.log("[TTS-TIMING]", {
          source: "simulation",
          preset: remoteTtsPreset,
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
            commitOpeningAssistantMessageIfNeeded();
            setMode("speaking");
            setStatus("AI is speaking...");
            logSimulationTiming({
              correlationId: openingCorrelationId,
              phase: "opening_playback_started",
            });
          },
          openingCorrelationId,
          openingSpeechPrefetch,
        );
        pendingOpeningLineRef.current = null;
        pendingOpeningSpeechPrefetchRef.current = null;
        await speakPromise;
        commitOpeningAssistantMessageIfNeeded();
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
    turnSubmitStartedAtRef.current = null;
    currentTurnCorrelationIdRef.current = null;
    recordingSafetySignalRef.current = null;
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
        requestFinalizeTurn();
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
      pendingOpeningSpeechPrefetchRef.current = null;
      setElapsedSeconds(0);
      sessionCompletionInProgressRef.current = false;
      simulationClosedRef.current = false;
      usedMockModeDuringSessionRef.current = false;
      turnSubmitStartedAtRef.current = null;
      currentTurnCorrelationIdRef.current = null;
      recordingSafetySignalRef.current = null;

      if (localTestMode) {
        pendingOpeningLineRef.current = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
        sessionTrainingPackIdRef.current = null;
        pendingOpeningSpeechPrefetchRef.current = null;
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
          speechPrefetchPreset: shouldUseFastStartRemoteTts
            ? toRemoteTtsPreset(config.voiceGender, config.voiceProfile)
            : null,
          correlationId: createSimulationCorrelationId(config.simulationSessionId, "opening-prefetch"),
        });

        if (cancelled || unmountedRef.current) {
          return;
        }

        pendingOpeningLineRef.current = openingPayload.assistantText;
        sessionTrainingPackIdRef.current = openingPayload.trainingPackId;
        pendingOpeningSpeechPrefetchRef.current = openingPayload.speechPrefetch;
        setMode("idle");
        setStatus("Scenario ready. Press Start Simulation.");
      } catch (initError) {
        if (isApiError(initError)) {
          setUseLocalMockMode(true);
          usedMockModeDuringSessionRef.current = true;
          pendingOpeningLineRef.current = createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle);
          sessionTrainingPackIdRef.current = null;
          pendingOpeningSpeechPrefetchRef.current = null;
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
        ? "Voice-first mode with explicit turn control. The app keeps listening until you tap Submit Response."
        : mode === "thinking"
          ? messages[messages.length - 1]?.role === "user"
            ? "Your transcript is ready. The AI reply is still being prepared."
            : "Your response is being transcribed and the AI reply is being prepared."
          : "The AI response is readying for playback or currently speaking."
      : "Press Start Simulation to begin, then tap Submit Response to end each turn.";
  const stateTitle = !sessionActive
    ? "Scenario prepared"
    : mode === "recording"
      ? "Listening for your response"
      : mode === "thinking"
        ? messages[messages.length - 1]?.role === "user"
          ? "Building the next reply"
          : "Preparing the first exchange"
        : mode === "speaking"
          ? "Delivering the AI reply"
          : "Ready for your response";
  const statusEyebrow = localTestMode ? "Local practice mode" : "Peritio response engine";
  const sessionModeLabel = sessionActive ? "Live session" : "Scenario ready";
  const responseModeLabel = localTestMode ? "Mocked AI" : "Remote AI";
  const transcriptCountLabel =
    messages.length === 0 ? "No turns yet" : `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;
  const scenarioMeta = [
    `Difficulty: ${DIFFICULTY_LABELS[config.difficulty]}`,
    `Persona: ${PERSONA_LABELS[config.personaStyle]}`,
    `AI voice: ${config.voiceGender === "male" ? "Male" : "Female"} ${voiceOption.label}`,
    ...(config.maxSimulationMinutes !== null ? [`Org max: ${config.maxSimulationMinutes} minute(s)`] : []),
  ];

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

      <LinearGradient
        colors={[palette.heroStart, palette.heroEnd]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.scenarioCard}
      >
        <Text style={styles.label}>{config.segmentLabel}</Text>
        <Text style={styles.cardTitle}>{config.scenario.title}</Text>
        <Text style={styles.cardBody}>{config.scenario.description}</Text>
        <View style={styles.metaRow}>
          {scenarioMeta.map((item) => (
            <View key={item} style={styles.metaChip}>
              <Text style={styles.metaChipText}>{item}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

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

      <View style={styles.statusStageCard}>
        <View style={styles.statusHeaderRow}>
          <View style={styles.statusTitleBlock}>
            <Text style={styles.statusEyebrow}>{statusEyebrow}</Text>
            <Text style={styles.statusTitle}>{stateTitle}</Text>
          </View>
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>{sessionModeLabel}</Text>
          </View>
        </View>
        <Text style={styles.status}>{status}</Text>
        <VoiceOrb mode={mode} variant={themeVariant} />
        <Text style={styles.hint}>{hintText}</Text>
        <View style={styles.statusMetaRow}>
          <View style={[styles.timerCard, styles.statusMiniPanel]}>
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
          <View style={[styles.statusMiniPanel, styles.systemCard]}>
            <Text style={styles.timerLabel}>Response Mode</Text>
            <Text style={styles.systemTitle}>{responseModeLabel}</Text>
            <Text style={styles.systemBody}>
              {localTestMode ? "Useful for flow checks and UI review." : "Live assistant replies and voice playback."}
            </Text>
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.chatCard}>
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.chatEyebrow}>Transcript</Text>
            <Text style={styles.chatTitle}>Live turn history</Text>
          </View>
          <View style={styles.chatStatPill}>
            <Text style={styles.chatStatText}>{transcriptCountLabel}</Text>
          </View>
        </View>
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
              <Text style={[styles.messageRole, message.role === "user" ? styles.userMessageRole : styles.aiMessageRole]}>
                {message.role === "user" ? "You" : "AI"}
              </Text>
              <Text style={[styles.messageText, message.role === "user" ? styles.userMessageText : styles.aiMessageText]}>
                {message.content}
              </Text>
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

function createStyles(palette: SimulationPalette) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    screenContent: {
      flexGrow: 1,
      paddingBottom: 22,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    spacer: {
      width: 76,
    },
    title: {
      color: palette.text,
      fontSize: 19,
      fontWeight: "700",
    },
    ghostButton: {
      minWidth: 76,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.ghostBg,
    },
    ghostButtonText: {
      color: palette.text,
      fontWeight: "700",
      fontSize: 14,
    },
    scenarioCard: {
      borderRadius: 24,
      borderWidth: 1,
      borderColor: palette.heroBorder,
      paddingHorizontal: 18,
      paddingVertical: 20,
      marginBottom: 14,
      gap: 10,
      overflow: "hidden",
      shadowColor: palette.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    label: {
      color: palette.statusEyebrow,
      fontWeight: "700",
      fontSize: 11.5,
      textTransform: "uppercase",
      letterSpacing: 1.2,
    },
    cardTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 24,
      lineHeight: 30,
    },
    cardBody: {
      color: palette.textMuted,
      fontSize: 14.5,
      lineHeight: 22,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    metaChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.heroMetaBorder,
      backgroundColor: palette.heroMetaBg,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    metaChipText: {
      color: palette.heroMetaText,
      fontSize: 12,
      fontWeight: "700",
    },
    statusStageCard: {
      borderRadius: 24,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      backgroundColor: palette.stagePanel,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 18,
      marginBottom: 14,
      shadowColor: palette.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    statusHeaderRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 8,
    },
    statusTitleBlock: {
      flex: 1,
      gap: 3,
    },
    statusEyebrow: {
      color: palette.statusEyebrow,
      fontSize: 11.5,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.2,
    },
    statusTitle: {
      color: palette.text,
      fontSize: 24,
      lineHeight: 29,
      fontWeight: "800",
    },
    modePill: {
      minHeight: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.modePillBorder,
      backgroundColor: palette.modePillBg,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    modePillText: {
      color: palette.modePillText,
      fontSize: 11.5,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    status: {
      color: palette.textMuted,
      textAlign: "center",
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 8,
      paddingHorizontal: 6,
    },
    hint: {
      color: palette.hint,
      textAlign: "center",
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 8,
      marginBottom: 12,
      paddingHorizontal: 8,
    },
    statusMetaRow: {
      flexDirection: "row",
      gap: 10,
      flexWrap: "wrap",
    },
    statusMiniPanel: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.timerBorder,
      backgroundColor: palette.timerBg,
      paddingVertical: 12,
      paddingHorizontal: 12,
    },
    timerCard: {
      flex: 1,
      minWidth: 180,
      alignItems: "center",
      gap: 2,
    },
    timerLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "600",
      textAlign: "center",
    },
    timerValue: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "800",
    },
    timerRemaining: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "700",
    },
    timerValueDanger: {
      color: palette.danger,
    },
    systemCard: {
      flex: 1,
      minWidth: 140,
      justifyContent: "center",
      gap: 4,
    },
    systemTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
      lineHeight: 20,
    },
    systemBody: {
      color: palette.textMuted,
      fontSize: 12.5,
      lineHeight: 18,
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
      color: palette.danger,
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
      color: palette.text,
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 0.5,
    },
    chatCard: {
      minHeight: 250,
      height: 344,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.transcriptBg,
      marginBottom: 16,
      overflow: "hidden",
    },
    chatHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      backgroundColor: palette.transcriptHeaderBg,
    },
    chatEyebrow: {
      color: palette.statusEyebrow,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.1,
      marginBottom: 2,
    },
    chatTitle: {
      color: palette.text,
      fontSize: 16,
      fontWeight: "800",
    },
    chatStatPill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.transcriptStatBorder,
      backgroundColor: palette.transcriptStatBg,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    chatStatText: {
      color: palette.transcriptStatText,
      fontSize: 11.5,
      fontWeight: "700",
    },
    chatScroll: {
      flex: 1,
    },
    chatContent: {
      padding: 14,
      gap: 12,
    },
    messageBubble: {
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      maxWidth: "92%",
      gap: 4,
    },
    userBubble: {
      backgroundColor: palette.userBubble,
      borderColor: palette.userBubbleBorder,
      alignSelf: "flex-end",
    },
    aiBubble: {
      backgroundColor: palette.aiBubble,
      borderColor: palette.aiBubbleBorder,
      alignSelf: "flex-start",
    },
    messageRole: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    userMessageRole: {
      color: "#f8eed9",
    },
    aiMessageRole: {
      color: palette.heroMetaText,
    },
    messageText: {
      fontSize: 14.5,
      lineHeight: 21,
    },
    userMessageText: {
      color: "#f8f0df",
    },
    aiMessageText: {
      color: palette.text,
    },
    primaryButton: {
      minHeight: 56,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryButton,
      borderWidth: 1,
      borderColor: "rgba(244, 231, 206, 0.08)",
      shadowColor: palette.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    submitButton: {
      backgroundColor: palette.submitButton,
    },
    busyButton: {
      backgroundColor: palette.busyButton,
    },
    primaryButtonText: {
      color: palette.primaryButtonText,
      fontWeight: "800",
      fontSize: 16,
      letterSpacing: 0.2,
    },
    primaryButtonTextLight: {
      color: "#f8f0df",
    },
    secondaryActionButton: {
      minHeight: 50,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: palette.secondaryButtonBorder,
      backgroundColor: palette.secondaryButtonBg,
      marginTop: 10,
    },
    secondaryActionButtonText: {
      color: palette.secondaryButtonText,
      fontWeight: "800",
      fontSize: 15,
    },
    disabled: {
      opacity: 0.55,
    },
  });
}
