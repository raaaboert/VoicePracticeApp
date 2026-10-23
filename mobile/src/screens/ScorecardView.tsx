import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DIFFICULTY_LABELS, PERSONA_LABELS } from "../data/prompts";
import { buildScorecardViewModel } from "../lib/scorecardViewModel";
import {
  getSupportModalKeyboardDismissMode,
  SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS,
} from "../lib/supportModalLayout";
import { Difficulty, PersonaStyle, SimulationScorecard, SimulationScoringStatus } from "../types";
import { useMemo, useState } from "react";

interface ScorecardViewProps {
  theme: ScorecardTheme;
  title: string;
  segmentLabel: string;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  scorecard: SimulationScorecard | null;
  scoringStatus: SimulationScoringStatus;
  error: string | null;
  transcriptAvailable: boolean;
  onDownloadTranscript: () => Promise<void>;
  onSubmitSupport: (params: { message: string; includeTranscript: boolean }) => Promise<{
    caseId: string;
    transcriptRetainedUntil: string | null;
  }>;
  onBack: () => void;
  onBackToTopic?: () => void;
}

// Supplied by the app's existing selected theme, including the surrounding background.
interface ScorecardTheme {
  panel: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  selectedCardBg: string;
  ghostButtonBg: string;
  inputBg: string;
  menuOverlayBackdrop: string;
  menuOverlayCardBg: string;
  primaryButtonText: string;
  warningBorder: string;
  warningBg: string;
  warningText: string;
}

export function ScorecardView({
  theme,
  title,
  segmentLabel,
  difficulty,
  personaStyle,
  scorecard,
  scoringStatus,
  error,
  transcriptAvailable,
  onDownloadTranscript,
  onSubmitSupport,
  onBack,
  onBackToTopic,
}: ScorecardViewProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [supportConsent, setSupportConsent] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportSuccess, setSupportSuccess] = useState<string | null>(null);

  const canSubmitSupport = useMemo(() => supportMessage.trim().length > 0 && !supportBusy, [supportBusy, supportMessage]);
  const viewModel = buildScorecardViewModel({ scoringStatus, scorecard, error });

  return (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <Text accessibilityRole="header" style={styles.topTitle}>Scorecard</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.label}>Session Review</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>
            {segmentLabel} | {DIFFICULTY_LABELS[difficulty]} | {PERSONA_LABELS[personaStyle]}
          </Text>
        </View>

        {viewModel.showLoading ? (
          <View
            style={[styles.card, styles.loadingCard]}
            accessibilityRole="progressbar"
            accessibilityLabel={viewModel.loadingTitle ?? "Generating your scorecard"}
            accessibilityState={{ busy: true }}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.loadingTitle}>{viewModel.loadingTitle}</Text>
            <Text style={styles.loadingBody}>{viewModel.loadingBody}</Text>
          </View>
        ) : null}

        {viewModel.showScoreWarning && viewModel.scoreWarning ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>{viewModel.scoreWarning}</Text>
          </View>
        ) : null}

        {viewModel.showScoreUnavailable ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>{viewModel.scoreUnavailableTitle}</Text>
            <Text style={styles.warningText}>{viewModel.scoreUnavailableBody}</Text>
          </View>
        ) : null}

        {scorecard && viewModel.showVerifiedScore ? (
          <>
            <View style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>Overall Score</Text>
              <Text style={styles.scoreValue}>{scorecard.overallScore}</Text>
              <Text style={styles.body}>out of 100</Text>
              <View style={styles.scoreBreakdown}>
                {[
                  { label: "Communication", value: scorecard.communicationScore },
                  { label: "Outcome", value: scorecard.outcomeScore },
                ].map((metric) => <View key={metric.label} style={styles.scoreMetric} accessible
                  accessibilityLabel={`${metric.label} score: ${metric.value} out of 100`}>
                  <Text style={styles.scoreMetricLabel}>{metric.label}</Text>
                  <Text style={styles.scoreMetricValue}>{metric.value}<Text style={styles.scoreScale}> / 100</Text></Text>
                </View>)}
              </View>
              <View style={styles.completionRow}>
                <View style={styles.completionItem}>
                  <Text style={styles.body}>Completion</Text>
                  <Text style={styles.completionValue}>
                    {scorecard.completionLevel === "complete" ? "Complete" : scorecard.completionLevel === "partial" ? "Partial" : "Inconclusive"}
                  </Text>
                </View>
                <View style={styles.completionItem}>
                  <Text style={styles.body}>Objective achieved</Text>
                  <Text style={styles.completionValue}>{scorecard.objectiveAchieved ? "Yes" : "No"}</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Skill Breakdown</Text>
              <Text style={styles.body}>
                See how you performed across key communication skills. Ratings are out of 10.
              </Text>

              {[
                { label: "Persuasion", value: scorecard.persuasion },
                { label: "Clarity", value: scorecard.clarity },
                { label: "Empathy", value: scorecard.empathy },
                { label: "Assertiveness", value: scorecard.assertiveness },
              ].map((metric) => (
                <View key={metric.label} style={styles.metricRow}>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <Text style={styles.metricValue}>{metric.value}/10</Text>
                </View>
              ))}
            </View>

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

          </>
        ) : null}

        {viewModel.showTranscriptActions ? (
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
            <Text style={styles.body}>{viewModel.transcriptPrivacyCopy}</Text>
            {downloadError ? <Text style={styles.warningText}>{downloadError}</Text> : null}
          </View>
        ) : null}

        {viewModel.showSupportActions ? (
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
              <Text style={styles.secondaryButtonText}>{viewModel.supportButtonLabel}</Text>
            </Pressable>
            <Text style={styles.body}>{viewModel.supportCopy}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {viewModel.showBackToScenarios ? (
          <View style={{ gap: 10 }}>
            {onBackToTopic ? <Pressable accessibilityRole="button" accessibilityLabel="Back to Topic"
              style={styles.button} onPress={onBackToTopic}>
              <Text style={styles.buttonText}>Back to Topic</Text>
            </Pressable> : null}
            <Pressable accessibilityRole="button" style={styles.button} onPress={onBack}>
              <Text style={styles.buttonText}>{onBackToTopic ? "Practice Again" : viewModel.footerCtaLabel}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Modal transparent visible={supportOpen} animationType="fade" onRequestClose={() => setSupportOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardRoot}
          behavior="padding"
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setSupportOpen(false)} />
          <SafeAreaView style={styles.modalRoot} pointerEvents="box-none">
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

            <ScrollView
              style={styles.modalBodyScroll}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps={SUPPORT_MODAL_KEYBOARD_SHOULD_PERSIST_TAPS}
              keyboardDismissMode={getSupportModalKeyboardDismissMode(Platform.OS)}
            >
            <Text style={styles.body}>
              Describe what went wrong or what you disagree with. Be as specific as you can.
            </Text>
            <TextInput
              style={styles.input}
              value={supportMessage}
              onChangeText={setSupportMessage}
              editable={!supportBusy}
              placeholder="Type your message..."
              placeholderTextColor={theme.textMuted}
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
                style={[styles.secondaryButton, styles.modalFooterButton, supportBusy ? styles.buttonDisabled : null]}
                onPress={() => setSupportOpen(false)}
                disabled={supportBusy}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.modalFooterButton, !canSubmitSupport ? styles.buttonDisabled : null]}
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
            </ScrollView>
          </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (theme: ScorecardTheme) => StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    flexShrink: 0,
  },
  topTitle: {
    color: theme.text,
    fontSize: 19,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panel,
    padding: 15,
    marginBottom: 12,
    gap: 8,
  },
  loadingCard: {
    alignItems: "center",
    borderColor: theme.border,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  loadingTitle: {
    color: theme.text,
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 25,
    textAlign: "center",
  },
  loadingBody: {
    color: theme.textMuted,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: "center",
  },
  warningCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.warningBorder,
    backgroundColor: theme.warningBg,
    padding: 14,
    marginBottom: 10,
  },
  warningText: {
    color: theme.warningText,
    fontSize: 13.5,
    lineHeight: 20,
  },
  warningTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    marginBottom: 5,
  },
  scoreCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.selectedCardBg,
    padding: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  scoreLabel: {
    color: theme.success,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  scoreValue: {
    color: theme.text,
    fontSize: 54,
    fontWeight: "800",
    lineHeight: 58,
  },
  scoreBreakdown: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  scoreMetric: {
    flexBasis: 120,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    borderRadius: 10,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    gap: 4,
  },
  scoreMetricLabel: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  scoreMetricValue: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "800",
  },
  scoreScale: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "400",
  },
  completionRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: theme.border,
    marginTop: 14,
    paddingTop: 12,
    gap: 12,
  },
  completionItem: {
    flexBasis: 120,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 4,
  },
  completionValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  label: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  body: {
    color: theme.textMuted,
    fontSize: 14.5,
    lineHeight: 21,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingVertical: 6,
  },
  metricLabel: {
    flexBasis: 120,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    color: theme.text,
    fontSize: 14,
    fontWeight: "700",
  },
  metricValue: {
    color: theme.accent,
    fontSize: 20,
    fontWeight: "700",
    flexShrink: 0,
  },
  footer: {
    flexShrink: 0,
    marginTop: 0,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.ghostButtonBg,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: "800",
    fontSize: 14.5,
    textAlign: "center",
  },
  button: {
    minHeight: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  buttonText: {
    color: theme.primaryButtonText,
    fontWeight: "800",
    fontSize: 16,
    textAlign: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  modalKeyboardRoot: {
    flex: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.menuOverlayBackdrop,
  },
  modalCard: {
    width: "100%",
    maxHeight: "100%",
    flexShrink: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.menuOverlayCardBg,
    overflow: "hidden",
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: "800",
  },
  modalCloseButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: theme.ghostButtonBg,
  },
  modalCloseButtonText: {
    color: theme.text,
    fontWeight: "800",
    fontSize: 12.5,
  },
  modalFooterRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  modalFooterButton: {
    flex: 1,
  },
  modalBodyScroll: {
    flexShrink: 1,
  },
  modalBodyContent: {
    padding: 14,
    paddingBottom: 16,
    gap: 10,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.inputBg,
    color: theme.text,
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
    borderColor: theme.border,
    backgroundColor: theme.inputBg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  checkboxMark: {
    color: theme.primaryButtonText,
    fontWeight: "900",
    fontSize: 14,
    marginTop: -1,
  },
  successText: {
    color: theme.success,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
