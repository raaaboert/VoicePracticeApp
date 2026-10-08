import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  MobileFocusTopicDetailResponse,
  MobileFocusTopicScenarioSummary,
} from "@voicepractice/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TrainingContentCard } from "../trainingContent/TrainingContentCard";
import { TrainingContentHeader } from "../trainingContent/TrainingContentHeader";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { fetchFocusTopicDetail } from "./api";
import {
  createFocusTopicRequestGate,
  formatFocusTopicDetailCounts,
  isFocusTopicUnavailableError,
} from "./model";

interface FocusTopicDetailScreenProps {
  topicId: string;
  userId: string;
  authToken: string;
  theme: TrainingContentTheme;
  refreshKey: number;
  notice: string | null;
  onBack: () => void;
  onOpenResource: (contentId: string) => void;
  onPracticeScenario: (scenario: MobileFocusTopicScenarioSummary) => void;
  onUnavailable: () => void;
}

export function FocusTopicDetailScreen(props: FocusTopicDetailScreenProps) {
  const [detail, setDetail] = useState<MobileFocusTopicDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestGate = useRef(createFocusTopicRequestGate());
  const styles = createStyles(props.theme);

  const loadDetail = useCallback(async () => {
    const attempt = requestGate.current.start();
    setDetail(null);
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const response = await fetchFocusTopicDetail(
        props.userId,
        props.topicId,
        props.authToken,
        { signal: attempt.signal }
      );
      if (!requestGate.current.isCurrent(attempt)) {
        return;
      }
      setDetail(response);
    } catch (caught) {
      if (!requestGate.current.isCurrent(attempt)) {
        return;
      }
      if (isFocusTopicUnavailableError(caught)) {
        setUnavailable(true);
        props.onUnavailable();
        return;
      }
      setError("This Focus Topic could not be loaded. Please try again.");
    } finally {
      if (requestGate.current.isCurrent(attempt)) {
        setLoading(false);
      }
    }
  }, [
    props.authToken,
    props.onUnavailable,
    props.refreshKey,
    props.topicId,
    props.userId,
  ]);

  useEffect(() => {
    void loadDetail();
    return () => requestGate.current.invalidate();
  }, [loadDetail]);

  return (
    <View style={styles.fill}>
      <TrainingContentHeader title="Focus Topic" onBack={props.onBack} theme={props.theme} />
      {loading ? (
        <View
          style={styles.state}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading Focus Topic"
        >
          <ActivityIndicator color={props.theme.accent} />
          <Text style={styles.stateText}>Loading Focus Topic...</Text>
        </View>
      ) : unavailable ? (
        <View style={styles.state}>
          <MaterialCommunityIcons name="target" size={36} color={props.theme.accent} />
          <Text style={styles.unavailableTitle}>This Focus Topic is no longer available.</Text>
          <Text style={styles.stateText}>Return to Focus Topics to choose another topic.</Text>
        </View>
      ) : error || !detail ? (
        <View style={styles.state}>
          <MaterialCommunityIcons name="alert-circle-outline" size={32} color={props.theme.danger} />
          <Text style={styles.errorText}>{error ?? "This Focus Topic could not be loaded."}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry Focus Topic"
            onPress={() => { void loadDetail(); }}
            style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}
          >
            <Text style={styles.actionButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
          {props.notice ? (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.noticeText}>{props.notice}</Text>
            </View>
          ) : null}

          <View style={styles.topicPanel}>
            <View style={styles.iconFrame}>
              <MaterialCommunityIcons name="target" size={28} color={props.theme.accent} />
            </View>
            <Text style={styles.topicLabel}>Focus Topic</Text>
            <Text style={styles.title}>{detail.topic.name}</Text>
            {detail.topic.description ? (
              <Text style={styles.description}>{detail.topic.description}</Text>
            ) : null}
            <Text style={styles.counts}>{formatFocusTopicDetailCounts(detail)}</Text>
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Practice</Text>
            <Text style={styles.sectionIntro}>Conversations available for this Focus Topic.</Text>
            {detail.scenarios.length === 0 ? (
              <Text style={styles.compactEmpty}>
                No practice scenarios are available for this topic right now.
              </Text>
            ) : (
              <View style={styles.cardList}>
                {detail.scenarios.map((scenario) => (
                  <Pressable
                    key={scenario.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Set up practice for ${scenario.title}. ${scenario.segmentLabel}, ${scenario.industryLabel}. ${scenario.source === "custom" ? "Custom" : "Standard"} scenario.${scenario.description ? ` ${scenario.description}` : ""}`}
                    accessibilityHint="Opens Setup with this scenario selected"
                    onPress={() => props.onPracticeScenario(scenario)}
                    style={({ pressed }) => [
                      styles.scenarioCard,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <View style={styles.scenarioHeading}>
                      <View style={styles.scenarioCopy}>
                        <Text style={styles.scenarioTitle}>{scenario.title}</Text>
                        <Text style={styles.scenarioContext}>
                          {scenario.segmentLabel} · {scenario.industryLabel}
                        </Text>
                      </View>
                      <Text style={styles.sourceLabel}>
                        {scenario.source === "custom" ? "Custom" : "Standard"}
                      </Text>
                    </View>
                    {scenario.description ? (
                      <Text style={styles.scenarioDescription}>{scenario.description}</Text>
                    ) : null}
                    <View style={styles.scenarioAction}>
                      <Text style={styles.scenarioActionText}>Set Up Practice</Text>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={20}
                        color={props.theme.accent}
                      />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Learning Resources</Text>
            <Text style={styles.sectionIntro}>Guides and materials related to this Focus Topic.</Text>
            {detail.resources.length === 0 ? (
              <Text style={styles.compactEmpty}>
                No learning resources are available for this topic right now.
              </Text>
            ) : (
              <View style={styles.cardList}>
                {detail.resources.map((resource) => (
                  <TrainingContentCard
                    key={resource.id}
                    item={resource}
                    theme={props.theme}
                    showRelatedFocusTopic={false}
                    onOpen={() => props.onOpenResource(resource.id)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 36 },
    state: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 24,
    },
    stateText: { color: theme.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
    unavailableTitle: {
      color: theme.text,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "700",
      textAlign: "center",
    },
    errorText: { color: theme.danger, fontSize: 15, lineHeight: 22, textAlign: "center" },
    actionButton: {
      minHeight: 44,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: theme.accent,
    },
    actionButtonText: { color: theme.accentText, fontSize: 15, fontWeight: "700" },
    pressed: { opacity: 0.72 },
    notice: {
      padding: 12,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      backgroundColor: theme.surfaceStrong,
    },
    noticeText: { color: theme.text, fontSize: 14, lineHeight: 20 },
    topicPanel: {
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      backgroundColor: theme.surface,
    },
    iconFrame: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: theme.surfaceStrong,
      marginBottom: 13,
    },
    topicLabel: {
      color: theme.accent,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    title: { color: theme.text, fontSize: 26, lineHeight: 33, fontWeight: "800", marginTop: 4 },
    description: { color: theme.muted, fontSize: 16, lineHeight: 24, marginTop: 9 },
    counts: { color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 12 },
    section: { marginTop: 28 },
    sectionTitle: { color: theme.text, fontSize: 20, lineHeight: 26, fontWeight: "800" },
    sectionIntro: { color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 12 },
    cardList: { gap: 10 },
    compactEmpty: { color: theme.muted, fontSize: 14, lineHeight: 21, paddingVertical: 4 },
    scenarioCard: {
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      backgroundColor: theme.surface,
      gap: 9,
    },
    scenarioHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    scenarioCopy: { flex: 1, minWidth: 0 },
    scenarioTitle: { color: theme.text, fontSize: 17, lineHeight: 23, fontWeight: "700" },
    scenarioContext: { color: theme.accent, fontSize: 13, lineHeight: 19, fontWeight: "600", marginTop: 4 },
    sourceLabel: {
      flexShrink: 0,
      color: theme.muted,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    scenarioDescription: { color: theme.muted, fontSize: 14, lineHeight: 21 },
    scenarioAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 2,
      marginTop: 2,
    },
    scenarioActionText: { color: theme.accent, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  });
}
