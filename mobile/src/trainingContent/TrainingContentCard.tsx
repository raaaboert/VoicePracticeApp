import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  MobileTrainingContentSummary,
  TrainingContentType,
} from "@voicepractice/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TrainingContentTheme } from "./theme";

const TYPE_LABELS: Record<TrainingContentType, string> = {
  native: "Article",
  external_url: "External resource",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  docx: "Document",
  image: "Image",
};

const TYPE_ICONS: Record<
  TrainingContentType,
  React.ComponentProps<typeof MaterialCommunityIcons>["name"]
> = {
  native: "text-box-outline",
  external_url: "open-in-new",
  video: "play-box-outline",
  audio: "headphones",
  pdf: "file-pdf-box",
  docx: "file-word-outline",
  image: "image-outline",
};

interface TrainingContentCardProps {
  item: MobileTrainingContentSummary;
  onOpen: () => void;
  theme: TrainingContentTheme;
  showCategory?: boolean;
}

export function TrainingContentCard({
  item,
  onOpen,
  theme,
  showCategory = true,
}: TrainingContentCardProps) {
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.iconFrame}>
        <MaterialCommunityIcons
          name={TYPE_ICONS[item.contentType]}
          size={23}
          color={theme.accent}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.type}>{TYPE_LABELS[item.contentType]}</Text>
        <Text style={styles.title}>{item.title}</Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.metadata}>
          {showCategory ? (
            <Text style={styles.metadataText}>{item.category.name}</Text>
          ) : null}
          {item.relatedFocusTopic ? (
            <Text style={styles.topicText}>{item.relatedFocusTopic}</Text>
          ) : null}
        </View>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={theme.muted} />
    </Pressable>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    card: {
      minHeight: 112,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      padding: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
    },
    pressed: { opacity: 0.72 },
    iconFrame: {
      width: 38,
      height: 38,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceStrong,
    },
    copy: { flex: 1, minWidth: 0 },
    type: {
      color: theme.accent,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    title: {
      color: theme.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "700",
      marginTop: 2,
    },
    description: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 5,
    },
    metadata: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    metadataText: { color: theme.muted, fontSize: 12, lineHeight: 16 },
    topicText: { color: theme.secondary, fontSize: 12, lineHeight: 16 },
  });
}

export { TYPE_LABELS as TRAINING_CONTENT_TYPE_LABELS };
