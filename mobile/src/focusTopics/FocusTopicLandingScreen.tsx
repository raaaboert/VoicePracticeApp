import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMemo, useState } from "react";

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

const SORT_OPTIONS: ReadonlyArray<{
  value: FocusTopicLearnerSort;
  label: string;
  compactLabel: string;
}> = [
  { value: "company", label: "Default", compactLabel: "Default" },
  { value: "az", label: "A–Z", compactLabel: "A–Z" },
  { value: "za", label: "Z–A", compactLabel: "Z–A" },
  { value: "oldest", label: "Oldest to Newest", compactLabel: "Oldest" },
  { value: "newest", label: "Newest to Oldest", compactLabel: "Newest" },
];

export function FocusTopicLandingScreen(props: FocusTopicLandingScreenProps) {
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const styles = createStyles(props.theme);
  const catalogTopics = props.topics ?? [];
  const visibleTopics = useMemo(
    () => applyFocusTopicDiscovery(catalogTopics, props.learnerSort, props.query),
    [catalogTopics, props.learnerSort, props.query],
  );
  const controls = getFocusTopicDiscoveryVisibility(catalogTopics.length, props.query);
  const activeQuery = normalizeFocusTopicQuery(props.query);
  const displayedQuery = compactFocusTopicQuery(props.query);
  const currentSort = SORT_OPTIONS.find((option) => option.value === props.learnerSort)
    ?? SORT_OPTIONS[0]!;

  const selectSort = (sort: FocusTopicLearnerSort) => {
    props.onChangeLearnerSort(sort);
    setSortMenuOpen(false);
  };

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
          <View style={[
            styles.controls,
            !controls.showSearch && controls.showSort ? styles.sortOnlyControls : null,
          ]}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sort Focus Topics. Current sort: ${currentSort.label}.`}
                accessibilityHint="Opens sort options"
                accessibilityState={{ expanded: sortMenuOpen }}
                onPress={() => setSortMenuOpen(true)}
                style={({ pressed }) => [styles.sortButton, pressed ? styles.pressed : null]}
              >
                <MaterialCommunityIcons name="sort" size={18} color={props.theme.accent} />
                <Text style={styles.sortButtonText}>{currentSort.compactLabel}</Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color={props.theme.muted} />
              </Pressable>
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
      <Modal
        transparent
        visible={sortMenuOpen}
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <View style={styles.sortModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sort options"
            style={styles.sortModalBackdrop}
            onPress={() => setSortMenuOpen(false)}
          />
          <View
            accessibilityViewIsModal
            accessibilityLabel="Sort Focus Topics"
            style={styles.sortModalCard}
          >
            <Text style={styles.sortModalTitle}>Sort Focus Topics</Text>
            {SORT_OPTIONS.map((option) => {
              const selected = props.learnerSort === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  onPress={() => selectSort(option.value)}
                  style={({ pressed }) => [
                    styles.sortMenuOption,
                    selected ? styles.sortMenuOptionSelected : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={[styles.sortMenuOptionText, selected ? styles.sortMenuOptionTextSelected : null]}>
                    {option.label}
                  </Text>
                  {selected ? (
                    <MaterialCommunityIcons name="check" size={20} color={props.theme.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
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
    controls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 18,
    },
    sortOnlyControls: { justifyContent: "flex-end" },
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
    sortButton: {
      minHeight: 44,
      width: 112,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    sortButtonText: {
      color: theme.accent,
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    sortModalRoot: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
    sortModalBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(5, 10, 18, 0.62)",
    },
    sortModalCard: {
      width: "100%",
      maxWidth: 360,
      alignSelf: "center",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceStrong,
      padding: 12,
    },
    sortModalTitle: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "800",
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    sortMenuOption: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
    },
    sortMenuOptionSelected: { backgroundColor: theme.surface },
    sortMenuOptionText: { color: theme.text, flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
    sortMenuOptionTextSelected: { color: theme.accent, fontWeight: "700" },
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
