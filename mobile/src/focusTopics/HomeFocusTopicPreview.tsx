import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { FocusTopicCard } from "./FocusTopicCard";
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
    </Text> : topics.map((topic) => <FocusTopicCard key={topic.id} topic={topic} theme={props.theme}
      onOpen={() => props.onOpenTopic(topic.id)} />)}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 22, fontWeight: "800", flexShrink: 1 },
  button: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  state: { gap: 10, alignItems: "flex-start", paddingVertical: 12 },
});
