import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DIFFICULTY_LABELS, PERSONA_LABELS } from "../data/prompts";
import { Difficulty, PersonaStyle, SimulationScorecard } from "../types";
import { useMemo, useState } from "react";

interface ScorecardViewProps {
  title: string;
  segmentLabel: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  scorecard: SimulationScorecard | null;
  isLoading: boolean;
  error: string | null;
  transcriptAvailable: boolean;
  onDownloadTranscript: () => Promise<void>;
  onSubmitSupport: (params: { message: string; includeTranscript: boolean }) => Promise<{
    caseId: string;
    transcriptRetainedUntil: string | null;
  }>;
  onBack: () => void;
}

const COLORS = {
  panel: "rgba(17, 37, 64, 0.84)",
  border: "rgba(143, 183, 232, 0.28)",
  text: "#eaf2ff",
  textMuted: "#9eb6d5",
  accent: "#35c2ff",
  success: "#4dd6a8",
  warning: "#ffc25f",
};

export function ScorecardView({
  title,
  segmentLabel,
  difficulty,
  personaStyle,
  scorecard,
  isLoading,
  error,
  transcriptAvailable,
  onDownloadTranscript,
  onSubmitSupport,
  onBack,
}: ScorecardViewProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [supportConsent, setSupportConsent] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportSuccess, setSupportSuccess] = useState<string | null>(null);

  const canSubmitSupport = useMemo(() => supportMessage.trim().length > 0 && !supportBusy, [supportBusy, supportMessage]);

  return (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <View style={styles.spacer} />
        <Text style={styles.topTitle}>Scorecard</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.label}>Session Review</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>
            {segmentLabel} | {DIFFICULTY_LABELS[difficulty]} | {PERSONA_LABELS[personaStyle]}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.card}>
            <Text style={styles.body}>Generating your scorecard...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>{error}</Text>
          </View>
        ) : null}

        {scorecard && !isLoading ? (
          <>
            <View style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>Overall Score</Text>
              <Text style={styles.scoreValue}>{scorecard.overallScore}</Text>
              <Text style={styles.body}>out of 100</Text>
            </View>

            {[
              { label: "Persuasion", value: scorecard.persuasion },
              { label: "Clarity", value: scorecard.clarity },
              { label: "Empathy", value: scorecard.empathy },
              { label: "Assertiveness", value: scorecard.assertiveness },
            ].map((metric) => (
              <View key={metric.label} style={styles.card}>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={styles.metricValue}>{metric.value}/10</Text>
              </View>
            ))}

            <View style={styles.card}>
              <Text style={styles.label}>Strengths</Text>
              {scorecard.strengths.map((item, index) => (
                <Text key={`strength-${index}`} style={styles.body}>
                  {`\u2022 ${item}`}
                </Text>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Improvements</Text>
              {scorecard.improvements.map((item, index) => (
                <Text key={`improvement-${index}`} style={styles.body}>
                  {`\u2022 ${item}`}
                </Text>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Coach Summary</Text>
              <Text style={styles.body}>{scorecard.summary}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Transcript</Text>
              <Pressable
                style={[styles.secondaryButton, !transcriptAvailable ? styles.buttonDisabled : null]}
                disabled={!transcriptAvailable || downloadBusy}
                onPress={() => {
                  setDownloadError(null);
                  setDownloadBusy(true);
                  void (async () => {
                    try {
                      await onDownloadTranscript();
                    } catch (caught) {
                      setDownloadError(caught instanceof Error ? caught.message : "Could not download transcript.");
                    } finally {
                      setDownloadBusy(false);
                    }
                  })();
                }}
              >
                <Text style={styles.secondaryButtonText}>
                  {downloadBusy ? "Preparing..." : "Download transcript of this conversation"}
                </Text>
              </Pressable>
              <Text style={styles.body}>
                [Company Name] does not retain transcripts of your session. Only scoring and usage data are stored.
                Transcripts are not available after leaving this screen unless you choose to download them now.
              </Text>
              {downloadError ? <Text style={styles.warningText}>{downloadError}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Support</Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setSupportOpen(true);
                  setSupportError(null);
                  setSupportSuccess(null);
                  setSupportBusy(false);
                  setSupportConsent(false);
                  setSupportMessage("");
                }}
              >
                <Text style={styles.secondaryButtonText}>Concerns with this session or score?</Text>
              </Pressable>
              <Text style={styles.body}>
                If something felt off, you can send a note to support. You can optionally consent to share a transcript
                so we can investigate.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Run Another Simulation</Text>
        </Pressable>
      </View>

      <Modal transparent visible={supportOpen} animationType="fade" onRequestClose={() => setSupportOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSupportOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Feedback / Support</Text>
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setSupportOpen(false)}
                disabled={supportBusy}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.body}>
              Describe what went wrong or what you disagree with. Be as specific as you can.
            </Text>
            <TextInput
              style={styles.input}
              value={supportMessage}
              onChangeText={setSupportMessage}
              editable={!supportBusy}
              placeholder="Type your message..."
              placeholderTextColor={COLORS.textMuted}
              multiline
            />

            <Text style={styles.body}>
              To investigate this issue, we will generate a transcript of this session and retain it for up to 10 days
              for support review.
            </Text>

            <Pressable
              style={styles.consentRow}
              onPress={() => setSupportConsent((prev) => !prev)}
              disabled={supportBusy}
            >
              <View style={[styles.checkbox, supportConsent ? styles.checkboxChecked : null]}>
                {supportConsent ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </View>
              <Text style={styles.body}>
                I consent to share this session transcript for support review (retained up to 10 days).
              </Text>
            </Pressable>

            {supportError ? <Text style={styles.warningText}>{supportError}</Text> : null}
            {supportSuccess ? <Text style={styles.successText}>{supportSuccess}</Text> : null}

            <View style={styles.modalFooterRow}>
              <Pressable
                style={[styles.secondaryButton, supportBusy ? styles.buttonDisabled : null]}
                onPress={() => setSupportOpen(false)}
                disabled={supportBusy}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.button, !canSubmitSupport ? styles.buttonDisabled : null]}
                disabled={!canSubmitSupport}
                onPress={() => {
                  setSupportError(null);
                  setSupportSuccess(null);
                  setSupportBusy(true);
                  void (async () => {
                    try {
                      const result = await onSubmitSupport({
                        message: supportMessage,
                        includeTranscript: supportConsent,
                      });
                      const retained = result.transcriptRetainedUntil
                        ? ` Transcript retained until ${new Date(result.transcriptRetainedUntil).toLocaleString()}.`
                        : "";
                      setSupportSuccess(`Submitted. Case ID: ${result.caseId}.${retained}`);
                    } catch (caught) {
                      setSupportError(caught instanceof Error ? caught.message : "Could not submit feedback.");
                    } finally {
                      setSupportBusy(false);
                    }
                  })();
                }}
              >
                <Text style={styles.buttonText}>{supportBusy ? "Submitting..." : "Submit"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  topTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    padding: 15,
    marginBottom: 12,
    gap: 8,
  },
  warningCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 194, 95, 0.5)",
    backgroundColor: "rgba(69, 49, 14, 0.48)",
    padding: 14,
    marginBottom: 10,
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 13.5,
    lineHeight: 20,
  },
  scoreCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(77, 214, 168, 0.45)",
    backgroundColor: "rgba(14, 49, 44, 0.75)",
    paddingVertical: 22,
    alignItems: "center",
    marginBottom: 12,
  },
  scoreLabel: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  scoreValue: {
    color: COLORS.text,
    fontSize: 54,
    fontWeight: "800",
    lineHeight: 58,
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  label: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  body: {
    color: COLORS.textMuted,
    fontSize: 14.5,
    lineHeight: 21,
  },
  metricLabel: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
  },
  metricValue: {
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: "700",
  },
  footer: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(143, 183, 232, 0.2)",
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(18, 42, 72, 0.66)",
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 14.5,
    textAlign: "center",
  },
  button: {
    minHeight: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accent,
  },
  buttonText: {
    color: "#062235",
    fontWeight: "800",
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 10, 18, 0.76)",
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(10, 30, 55, 0.97)",
    padding: 14,
    gap: 10,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "800",
  },
  modalCloseButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(18, 42, 72, 0.66)",
  },
  modalCloseButtonText: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 12.5,
  },
  modalFooterRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(8, 26, 44, 0.8)",
    color: COLORS.text,
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(8, 26, 44, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  checkboxMark: {
    color: "#062235",
    fontWeight: "900",
    fontSize: 14,
    marginTop: -1,
  },
  successText: {
    color: COLORS.success,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
