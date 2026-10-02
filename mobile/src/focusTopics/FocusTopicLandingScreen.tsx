import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TrainingContentHeader } from "../trainingContent/TrainingContentHeader";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { FocusTopicCard } from "./FocusTopicCard";
import { FOCUS_TOPICS_EMPTY_MESSAGE } from "./model";

interface FocusTopicLandingScreenProps {
  topics: readonly MobileFocusTopicCatalogItem[] | null;
  loading: boolean;
  error: string | null;
  theme: TrainingContentTheme;
  onBack: () => void;
  onRetry: () => void;
  onOpenTopic: (topic: MobileFocusTopicCatalogItem) => void;
}

export function FocusTopicLandingScreen(props: FocusTopicLandingScreenProps) {
  const styles = createStyles(props.theme);

  return (
    <View style={styles.fill}>
      <TrainingContentHeader title="Focus Topics" onBack={props.onBack} theme={props.theme} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Choose a topic to focus your practice and learning.</Text>
        {props.loading ? (
          <View style={styles.state} accessibilityRole="progressbar" accessibilityLabel="Loading Focus Topics">
            <ActivityIndicator color={props.theme.accent} />
            <Text style={styles.stateText}>Loading Focus Topics...</Text>
          </View>
        ) : props.error ? (
          <View style={styles.state}>
            <MaterialCommunityIcons name="alert-circle-outline" size={32} color={props.theme.danger} />
            <Text style={styles.errorText}>{props.error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry Focus Topics"
              onPress={props.onRetry}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>Try Again</Text>
            </Pressable>
          </View>
        ) : !props.topics || props.topics.length === 0 ? (
          <View style={styles.state}>
            <MaterialCommunityIcons name="target" size={38} color={props.theme.accent} />
            <Text style={styles.emptyText}>{FOCUS_TOPICS_EMPTY_MESSAGE}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {props.topics.map((topic) => (
              <FocusTopicCard
                key={topic.id}
                topic={topic}
                theme={props.theme}
                onOpen={() => props.onOpenTopic(topic)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { paddingTop: 18, paddingBottom: 32 },
    intro: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 23,
      marginBottom: 18,
    },
    list: { gap: 12 },
    state: {
      minHeight: 260,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 24,
    },
    stateText: { color: theme.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
    errorText: { color: theme.danger, fontSize: 15, lineHeight: 21, textAlign: "center" },
    emptyText: { color: theme.muted, fontSize: 16, lineHeight: 23, textAlign: "center" },
    actionButton: {
      minHeight: 44,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: theme.accent,
    },
    actionButtonText: { color: theme.accentText, fontSize: 15, fontWeight: "700" },
  });
}
