import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { TrainingContentHeader } from "../trainingContent/TrainingContentHeader";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { formatFocusTopicCounts, type FocusTopicNavigationSummary } from "./model";

interface FocusTopicDetailShellProps {
  topic: FocusTopicNavigationSummary;
  theme: TrainingContentTheme;
  onBack: () => void;
}

export function FocusTopicDetailShell({ topic, theme, onBack }: FocusTopicDetailShellProps) {
  const styles = createStyles(theme);
  const counts = formatFocusTopicCounts(topic);

  return (
    <View style={styles.fill}>
      <TrainingContentHeader title="Focus Topic" onBack={onBack} theme={theme} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <View style={styles.iconFrame}>
          <MaterialCommunityIcons name="target" size={28} color={theme.accent} />
        </View>
        <Text style={styles.title}>{topic.name}</Text>
        {topic.description ? <Text style={styles.description}>{topic.description}</Text> : null}
        {counts ? <Text style={styles.counts}>{counts}</Text> : null}
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Practice and Learning Resources</Text>
          <Text style={styles.noticeText}>
            Topic activities will be available here in a future update. You can continue to use scenario setup and Learning Resources from Home.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { paddingTop: 24, paddingHorizontal: 16, paddingBottom: 32 },
    iconFrame: {
      width: 50,
      height: 50,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: theme.surfaceStrong,
      marginBottom: 16,
    },
    title: { color: theme.text, fontSize: 27, lineHeight: 34, fontWeight: "800" },
    description: { color: theme.muted, fontSize: 16, lineHeight: 24, marginTop: 10 },
    counts: { color: theme.accent, fontSize: 14, lineHeight: 20, fontWeight: "700", marginTop: 14 },
    notice: {
      marginTop: 28,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    noticeTitle: { color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: "700" },
    noticeText: { color: theme.muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  });
}
