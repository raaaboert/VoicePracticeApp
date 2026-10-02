import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatFocusTopicCounts } from "./model";
import type { TrainingContentTheme } from "../trainingContent/theme";

interface FocusTopicCardProps {
  topic: MobileFocusTopicCatalogItem;
  theme: TrainingContentTheme;
  onOpen: () => void;
}

export function FocusTopicCard({ topic, theme, onOpen }: FocusTopicCardProps) {
  const styles = createStyles(theme);
  const counts = formatFocusTopicCounts(topic);
  const countLabel = counts ? `. ${counts.replace(" · ", ", ")}` : "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open Focus Topic ${topic.name}${countLabel}`}
      accessibilityHint="Opens this Focus Topic"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.iconFrame}>
        <MaterialCommunityIcons name="target" size={24} color={theme.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{topic.name}</Text>
        {topic.description ? (
          <Text style={styles.description}>{topic.description}</Text>
        ) : null}
        {counts ? <Text style={styles.counts}>{counts}</Text> : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={24} color={theme.muted} />
    </Pressable>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    card: {
      minHeight: 116,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    pressed: { opacity: 0.72 },
    iconFrame: {
      width: 42,
      height: 42,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: theme.surfaceStrong,
    },
    copy: { flex: 1, minWidth: 0 },
    name: {
      color: theme.text,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "800",
    },
    description: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 5,
    },
    counts: {
      color: theme.accent,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      marginTop: 9,
    },
  });
}
