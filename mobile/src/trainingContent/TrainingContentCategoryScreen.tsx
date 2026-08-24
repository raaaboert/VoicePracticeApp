import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  MobileTrainingContentCategory,
  MobileTrainingContentSummary,
} from "@voicepractice/shared";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TrainingContentCard } from "./TrainingContentCard";
import { TrainingContentHeader } from "./TrainingContentHeader";
import type { TrainingContentTheme } from "./theme";

interface TrainingContentCategoryScreenProps {
  category: MobileTrainingContentCategory | null;
  items: MobileTrainingContentSummary[];
  refreshing?: boolean;
  theme: TrainingContentTheme;
  title?: string;
  emptyMessage?: string;
  onBack: () => void;
  onRefresh?: () => void;
  onOpenItem: (item: MobileTrainingContentSummary) => void;
}

export function TrainingContentCategoryScreen(
  props: TrainingContentCategoryScreenProps
) {
  const title = props.title ?? props.category?.name ?? "All Content";
  const styles = createStyles(props.theme);
  return (
    <View style={styles.fill}>
      <TrainingContentHeader title={title} onBack={props.onBack} theme={props.theme} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        refreshControl={props.onRefresh ? (
          <RefreshControl refreshing={props.refreshing ?? false} onRefresh={props.onRefresh} />
        ) : undefined}
      >
        {props.category?.description ? (
          <Text style={styles.description}>{props.category.description}</Text>
        ) : null}
        {props.items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="text-box-search-outline"
              size={34}
              color={props.theme.accent}
            />
            <Text style={styles.emptyText}>
              {props.emptyMessage ?? "No Learning Resources are available in this category."}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {props.items.map((item) => (
              <TrainingContentCard
                key={item.id}
                item={item}
                theme={props.theme}
                showCategory={!props.category}
                onOpen={() => props.onOpenItem(item)}
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
    content: { paddingTop: 14, paddingBottom: 28 },
    description: {
      color: theme.muted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 14,
    },
    list: { gap: 10 },
    empty: {
      minHeight: 260,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 24,
    },
    emptyText: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 23,
      textAlign: "center",
    },
  });
}
