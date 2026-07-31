import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TrainingContentTheme } from "./theme";

interface TrainingContentHeaderProps {
  title: string;
  onBack: () => void;
  theme: TrainingContentTheme;
}

export function TrainingContentHeader({
  title,
  onBack,
  theme,
}: TrainingContentHeaderProps) {
  const styles = createStyles(theme);
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
      >
        <MaterialCommunityIcons name="arrow-left" size={24} color={theme.text} />
      </Pressable>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.trailingSpace} />
    </View>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    header: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.background,
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
    },
    pressed: { opacity: 0.65 },
    title: {
      flex: 1,
      color: theme.text,
      fontSize: 19,
      lineHeight: 24,
      fontWeight: "700",
      textAlign: "center",
    },
    trailingSpace: { width: 44, height: 44 },
  });
}
