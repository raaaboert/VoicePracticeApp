import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { homeFocusTopicPreview, type FocusTopicCatalogState } from "./catalog";

export function HomeFocusTopicPreview(props: {
  state: FocusTopicCatalogState; theme: TrainingContentTheme;
  onOpenTopic: (topicId: string) => void; onViewAll: () => void; onRetry: () => void;
}) {
  const topics = homeFocusTopicPreview(props.state);
  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, { color: props.theme.text }]}>Your Focus Topics</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="View all Focus Topics"
        onPress={props.onViewAll} style={styles.button}>
        <Text style={{ color: props.theme.accent, fontWeight: "700" }}>View All</Text>
      </Pressable>
    </View>
    {props.state.loading ? <View accessibilityRole="progressbar" accessibilityLabel="Loading your Focus Topics" style={styles.state}>
      <ActivityIndicator color={props.theme.accent} /><Text style={{ color: props.theme.muted }}>Loading your Focus Topics...</Text>
    </View> : props.state.error ? <View accessibilityRole="alert" style={styles.state}>
      <Text style={{ color: props.theme.danger }}>{props.state.error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry Focus Topics" onPress={props.onRetry} style={styles.button}>
        <Text style={{ color: props.theme.accent }}>Retry</Text>
      </Pressable>
    </View> : topics.length === 0 ? <Text style={{ color: props.theme.muted }}>
      No Focus Topics are currently assigned. You can still browse the scenarios and learning resources available to you below.
    </Text> : topics.map((topic) => {
      const counts = `${topic.scenarioCount} ${topic.scenarioCount === 1 ? "scenario" : "scenarios"}, ${topic.resourceCount} ${topic.resourceCount === 1 ? "resource" : "resources"}`;
      return <Pressable key={topic.id} accessibilityRole="button"
        accessibilityLabel={`Open Focus Topic ${topic.name}. ${counts} available`}
        accessibilityHint="Opens this Focus Topic"
        onPress={() => props.onOpenTopic(topic.id)}
        style={({ pressed }) => [styles.topicRow, { borderColor: props.theme.border,
          backgroundColor: pressed ? props.theme.surfaceStrong : props.theme.surface }]}>
        <MaterialCommunityIcons name="target" size={22} color={props.theme.accent} accessible={false} />
        <View style={styles.copy}>
          <Text numberOfLines={2} style={[styles.topicName, { color: props.theme.text }]}>{topic.name}</Text>
          <Text style={[styles.counts, { color: props.theme.muted }]}>{counts.replace(", ", " · ")}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={props.theme.muted} accessible={false} />
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, marginBottom: 14 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 22, fontWeight: "800", flexShrink: 1 },
  button: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  topicRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 8 },
  copy: { flex: 1, minWidth: 0 },
  topicName: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  counts: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  state: { gap: 10, alignItems: "flex-start", paddingVertical: 12 },
});
