import { useEffect, useMemo, useRef, useState } from "react";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Speech from "expo-speech";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VoiceOrb, OrbMode } from "../components/VoiceOrb";
import {
  getAiVoiceOption,
  getVoiceSpeechTuning,
  selectSpeechVoiceIdentifier,
} from "../data/preferences";
import { DIFFICULTY_LABELS, PERSONA_LABELS } from "../data/prompts";
import {
  createLocalAssistantReply,
  createLocalOpeningLine,
  createLocalSessionKickoffLine,
} from "../lib/mockAi";
import { createOpeningLine, generateAssistantReply, isOpenAiConfigured, transcribeAudio } from "../lib/openai";
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

const MAX_TURN_DURATION_MS = 15000;
const MIN_TURN_DURATION_MS = 1200;
const SILENCE_CUTOFF_MS = 1200;
const STATUS_POLL_INTERVAL_MS = 250;
const VOICE_METER_THRESHOLD_DB = -45;

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
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
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

export function SimulationScreen({ config, userId, authToken, onExit, onSessionComplete }: SimulationScreenProps) {
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [mode, setMode] = useState<OrbMode>("thinking");
  const [status, setStatus] = useState("Preparing scenario...");
  const [error, setError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [useLocalMockMode, setUseLocalMockMode] = useState(false);

  const apiConfigured = useMemo(() => isOpenAiConfigured(), []);
  const voiceOption = useMemo(() => getAiVoiceOption(config.voiceProfile), [config.voiceProfile]);
  const voiceTuning = useMemo(
    () => getVoiceSpeechTuning(config.voiceProfile, config.voiceGender),
    [config.voiceGender, config.voiceProfile],
  );
  const localTestMode = !apiConfigured || useLocalMockMode;
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
  const lastVoiceAtRef = useRef(0);
  const heardVoiceRef = useRef(false);
  const meteringSeenRef = useRef(false);
  const kickoffSentRef = useRef(false);

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

  const appendMessage = (message: DialogueMessage) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  };

  const speak = async (text: string): Promise<void> => {
    if (!selectedVoiceIdentifierRef.current) {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        selectedVoiceIdentifierRef.current = selectSpeechVoiceIdentifier(voices ?? [], config.voiceGender);
      } catch {
        selectedVoiceIdentifierRef.current = undefined;
      }
    }

    return new Promise((resolve) => {
      Speech.stop();
      Speech.speak(text, {
        language: "en-US",
        voice: selectedVoiceIdentifierRef.current,
        rate: voiceTuning.speechRate,
        pitch: voiceTuning.speechPitch,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });
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

  const requestFinalizeTurn = () => {
    if (finalizeRequestedRef.current || processingRef.current || !recordingRef.current) {
      return;
    }

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

        if (status.metering > VOICE_METER_THRESHOLD_DB) {
          heardVoiceRef.current = true;
          lastVoiceAtRef.current = now;
        }
      }

      if (
        meteringSeenRef.current &&
        heardVoiceRef.current &&
        elapsed >= MIN_TURN_DURATION_MS &&
        now - lastVoiceAtRef.current >= SILENCE_CUTOFF_MS
      ) {
        setStatus("Silence detected. Processing...");
        requestFinalizeTurn();
        return;
      }

      if (elapsed >= MAX_TURN_DURATION_MS) {
        setStatus("Max turn length reached. Processing...");
        requestFinalizeTurn();
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
      await Speech.stop();
      await setAudioMode(true);
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      finalizeRequestedRef.current = false;
      turnStartedAtRef.current = Date.now();
      lastVoiceAtRef.current = turnStartedAtRef.current;
      heardVoiceRef.current = false;
      meteringSeenRef.current = false;

      setMode("recording");
      setStatus("Listening...");
      clearTurnMonitoring();
      monitorIntervalRef.current = setInterval(() => {
        void monitorCurrentTurn();
      }, STATUS_POLL_INTERVAL_MS);
      safetyTimerRef.current = setTimeout(() => {
        setStatus("Processing...");
        requestFinalizeTurn();
      }, MAX_TURN_DURATION_MS + 500);
    } catch (recordingError) {
      setError(getErrorMessage(recordingError, "Could not start recording."));
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
    setStatus("Processing your response...");
    setError(null);
    let continueLoop = false;

    try {
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
      await setAudioMode(false);

      const audioUri = recording.getURI();
      if (!audioUri) {
        throw new Error("Recorded audio file could not be read.");
      }
      const turnDurationSeconds = Math.max(
        1,
        Math.round((Date.now() - turnStartedAtRef.current) / 1000),
      );
      const inferredVoiceWithoutMeter =
        !meteringSeenRef.current && turnDurationSeconds >= 2;

      let userText = "";
      let useLiveApiThisTurn = apiConfigured && !useLocalMockMode;
      if (useLiveApiThisTurn) {
        try {
          userText = (
            await transcribeAudio({
              userId,
              authToken,
              audioUri,
              preferredMimeType: Platform.OS === "web" ? "audio/webm" : "audio/m4a",
            })
          ).trim();
        } catch (transcriptionError) {
          if (isApiError(transcriptionError)) {
            setUseLocalMockMode(true);
            setError(null);
            setStatus("Live AI unavailable. Switched to local test mode.");
            useLiveApiThisTurn = false;
            if (heardVoiceRef.current || inferredVoiceWithoutMeter) {
              userText = buildLocalCapturedText(turnDurationSeconds);
            }
          } else {
            throw transcriptionError;
          }
        }
      } else if (heardVoiceRef.current || inferredVoiceWithoutMeter) {
        userText = buildLocalCapturedText(turnDurationSeconds);
      }

      if (userText) {
        appendMessage({ id: createMessageId(), role: "user", content: userText });

        if (sessionActiveRef.current && !unmountedRef.current) {
          const reply = useLiveApiThisTurn
            ? await generateAssistantReply({
                userId,
                authToken,
                scenario: config.scenario,
                difficulty: config.difficulty,
                segmentLabel: config.segmentLabel,
                personaStyle: config.personaStyle,
                history: [...messagesRef.current],
              })
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

          if (sessionActiveRef.current && !unmountedRef.current) {
            appendMessage({ id: createMessageId(), role: "assistant", content: reply });
            setMode("speaking");
            setStatus("AI is speaking...");
            await speak(reply);
          }
        }
      } else {
        setStatus("No clear speech detected. Continuing...");
      }

      continueLoop = sessionActiveRef.current;
    } catch (turnError) {
      setError(getErrorMessage(turnError, "Could not process voice response."));
      continueLoop = sessionActiveRef.current;
    } finally {
      processingRef.current = false;
      finalizeRequestedRef.current = false;

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
      setError("Microphone permission is required for continuous mode.");
      return;
    }

    setError(null);

    if (!kickoffSentRef.current) {
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: createLocalSessionKickoffLine(config.scenario, config.personaStyle),
      });
      kickoffSentRef.current = true;
    }

    sessionActiveRef.current = true;
    sessionStartedAtRef.current = new Date();
    setSessionActive(true);
    setStatus("Continuous mode active.");
    void startListeningTurn();
  };

  const endSession = async (showEndedText: boolean) => {
    sessionActiveRef.current = false;
    setSessionActive(false);
    clearTurnMonitoring();
    Speech.stop();
    await stopRecordingSafely();

    if (showEndedText) {
      setMode("idle");
      setStatus("Session ended.");
    }
  };

  const onPrimaryButton = async () => {
    if (isInitializing) {
      return;
    }

    if (sessionActiveRef.current) {
      const startedAt = sessionStartedAtRef.current ?? new Date();
      const endedAt = new Date();
      const rawDurationSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
      );
      await endSession(false);
      sessionStartedAtRef.current = null;
      onSessionComplete([...messagesRef.current], config, {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        rawDurationSeconds,
      });
      return;
    }

    await startSession();
  };

  const onExitPress = async () => {
    await endSession(false);
    sessionStartedAtRef.current = null;
    onExit();
  };

  useEffect(() => {
    let cancelled = false;
    unmountedRef.current = false;

    const initialize = async () => {
      setIsInitializing(true);
      messagesRef.current = [];
      sessionStartedAtRef.current = null;
      setMessages([]);
      setError(null);
      kickoffSentRef.current = false;

      if (localTestMode) {
        appendMessage({
          id: createMessageId(),
          role: "assistant",
          content: createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle),
        });
        setMode("idle");
        setStatus("Local test mode ready. Press Start Continuous Mode.");
        setIsInitializing(false);
        return;
      }

      try {
        const openingLine = await createOpeningLine({
          userId,
          authToken,
          scenario: config.scenario,
          difficulty: config.difficulty,
          segmentLabel: config.segmentLabel,
          personaStyle: config.personaStyle,
        });

        if (cancelled || unmountedRef.current) {
          return;
        }

        appendMessage({ id: createMessageId(), role: "assistant", content: openingLine });
        setMode("speaking");
        setStatus("AI is speaking...");
        await speak(openingLine);

        if (!cancelled && !unmountedRef.current) {
          setMode("idle");
          setStatus("Press Start Continuous Mode.");
        }
      } catch (initError) {
        if (isApiError(initError)) {
          setUseLocalMockMode(true);
          appendMessage({
            id: createMessageId(),
            role: "assistant",
            content: createLocalOpeningLine(config.scenario, config.difficulty, config.personaStyle),
          });
          setMode("idle");
          setStatus("Live AI unavailable. Local test mode is active.");
          setError(null);
        } else {
          setMode("idle");
          setStatus("Ready.");
          setError(getErrorMessage(initError, "Could not initialize simulation."));
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
      sessionActiveRef.current = false;
      clearTurnMonitoring();
      Speech.stop();
      void stopRecordingSafely();
    };
  }, [apiConfigured, config.difficulty, config.scenario, config.segmentLabel]);

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

  const buttonDisabled =
    isInitializing || (!sessionActive && (mode === "thinking" || mode === "speaking"));

  return (
    <View style={styles.fill}>
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
        <Text style={styles.cardBody}>
          AI voice: {config.voiceGender === "male" ? "Male" : "Female"} {voiceOption.label}
        </Text>
      </View>

      <VoiceOrb mode={mode} />
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.hint}>
        {localTestMode
          ? "Local test mode: no API key needed. Replies are mocked."
          : "Auto-cutoff runs on silence detection (with max-turn fallback)."}
      </Text>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.chatCard}>
        <ScrollView ref={scrollRef} style={styles.chatScroll} contentContainerStyle={styles.chatContent}>
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
          sessionActive ? styles.endButton : null,
          buttonDisabled ? styles.disabled : null,
        ]}
        onPress={() => {
          void onPrimaryButton();
        }}
        disabled={buttonDisabled}
      >
        <Text style={styles.primaryButtonText}>
          {sessionActive ? "End Session and Score" : "Start Continuous Mode"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
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
  chatCard: {
    flex: 1,
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
  endButton: {
    backgroundColor: COLORS.danger,
  },
  primaryButtonText: {
    color: "#062235",
    fontWeight: "800",
    fontSize: 16,
  },
  disabled: {
    opacity: 0.55,
  },
});
