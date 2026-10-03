import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMemo } from "react";

import { TrainingContentHeader } from "../trainingContent/TrainingContentHeader";
import type { TrainingContentTheme } from "../trainingContent/theme";
import { FocusTopicCard } from "./FocusTopicCard";
import { FOCUS_TOPICS_EMPTY_MESSAGE } from "./model";
import {
  applyFocusTopicDiscovery,
  compactFocusTopicQuery,
  getFocusTopicDiscoveryVisibility,
  normalizeFocusTopicQuery,
  type FocusTopicLearnerSort,
} from "./discovery";

interface FocusTopicLandingScreenProps {
  topics: readonly MobileFocusTopicCatalogItem[] | null;
  query: string;
  learnerSort: FocusTopicLearnerSort;
  loading: boolean;
  error: string | null;
  theme: TrainingContentTheme;
  onBack: () => void;
  onRetry: () => void;
  onChangeQuery: (query: string) => void;
  onChangeLearnerSort: (sort: FocusTopicLearnerSort) => void;
  onOpenTopic: (topic: MobileFocusTopicCatalogItem) => void;
}

export function FocusTopicLandingScreen(props: FocusTopicLandingScreenProps) {
  const styles = createStyles(props.theme);
  const catalogTopics = props.topics ?? [];
  const visibleTopics = useMemo(
    () => applyFocusTopicDiscovery(catalogTopics, props.learnerSort, props.query),
    [catalogTopics, props.learnerSort, props.query],
  );
  const controls = getFocusTopicDiscoveryVisibility(catalogTopics.length, props.query);
  const activeQuery = normalizeFocusTopicQuery(props.query);
  const displayedQuery = compactFocusTopicQuery(props.query);

  return (
    <View style={styles.fill}>
      <TrainingContentHeader title="Focus Topics" onBack={props.onBack} theme={props.theme} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
      >
        <Text style={styles.intro}>Choose a topic to focus your practice and learning.</Text>
        {controls.showSearch || controls.showSort ? (
          <View style={styles.controls}>
            {controls.showSearch ? (
              <View style={styles.searchShell}>
                <MaterialCommunityIcons name="magnify" size={20} color={props.theme.muted} />
                <TextInput
                  accessibilityLabel="Search Focus Topics"
                  value={props.query}
                  onChangeText={props.onChangeQuery}
                  placeholder="Search Focus Topics"
                  placeholderTextColor={props.theme.muted}
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                {activeQuery ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear Focus Topic search"
                    hitSlop={8}
                    onPress={() => props.onChangeQuery("")}
                    style={styles.clearIcon}
                  >
                    <MaterialCommunityIcons name="close-circle" size={20} color={props.theme.muted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {controls.showSort ? (
              <View style={styles.sortGroup}>
                <Text style={styles.sortLabel}>Sort</Text>
                <View style={styles.sortOptions}>
                  {([
                    ["company", "Company Order"],
                    ["alphabetical", "A–Z"],
                  ] as const).map(([value, label]) => {
                    const selected = props.learnerSort === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityLabel={`Sort Focus Topics by ${label}`}
                        accessibilityState={{ selected }}
                        onPress={() => props.onChangeLearnerSort(value)}
                        style={({ pressed }) => [
                          styles.sortOption,
                          selected ? styles.sortOptionSelected : null,
                          pressed ? styles.pressed : null,
                        ]}
                      >
                        <Text style={[styles.sortOptionText, selected ? styles.sortOptionTextSelected : null]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
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
        ) : activeQuery && visibleTopics.length === 0 ? (
          <View style={styles.noResults}>
            <MaterialCommunityIcons name="magnify" size={30} color={props.theme.muted} />
            <Text style={styles.emptyText}>No Focus Topics match “{displayedQuery}”.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear Focus Topic search"
              onPress={() => props.onChangeQuery("")}
              style={styles.secondaryActionButton}
            >
              <Text style={styles.secondaryActionButtonText}>Clear Search</Text>
            </Pressable>
          </View>
        ) : catalogTopics.length === 0 ? (
          <View style={styles.state}>
            <MaterialCommunityIcons name="target" size={38} color={props.theme.accent} />
            <Text style={styles.emptyText}>{FOCUS_TOPICS_EMPTY_MESSAGE}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleTopics.map((topic) => (
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
    content: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 32 },
    intro: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 23,
      marginBottom: 18,
    },
    controls: { gap: 10, marginBottom: 18 },
    searchShell: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.input,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 9,
      color: theme.text,
      fontSize: 15,
    },
    clearIcon: { flexShrink: 0 },
    sortGroup: { gap: 7 },
    sortLabel: { color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: "700" },
    sortOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    sortOption: {
      minHeight: 40,
      minWidth: 112,
      flexGrow: 1,
      flexBasis: 120,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    sortOptionSelected: { borderColor: theme.accent, backgroundColor: theme.surfaceStrong },
    sortOptionText: { color: theme.muted, fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "center" },
    sortOptionTextSelected: { color: theme.accent },
    pressed: { opacity: 0.72 },
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
    noResults: {
      minHeight: 200,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 20,
    },
    actionButton: {
      minHeight: 44,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: theme.accent,
    },
    actionButtonText: { color: theme.accentText, fontSize: 15, fontWeight: "700" },
    secondaryActionButton: {
      minHeight: 42,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor: theme.accent,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    secondaryActionButtonText: { color: theme.accent, fontSize: 15, fontWeight: "700" },
  });
}
