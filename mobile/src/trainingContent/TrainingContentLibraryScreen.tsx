import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  MobileTrainingContentLibraryResponse,
  MobileTrainingContentSummary,
} from "@voicepractice/shared";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { TRAINING_CONTENT_EMPTY_MESSAGE, searchTrainingContent } from "./model";
import { TrainingContentCard } from "./TrainingContentCard";
import { TrainingContentHeader } from "./TrainingContentHeader";
import type { TrainingContentTheme } from "./theme";

interface TrainingContentLibraryScreenProps {
  library: MobileTrainingContentLibraryResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  query: string;
  theme: TrainingContentTheme;
  onChangeQuery: (query: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onOpenAll: () => void;
  onOpenCategory: (categoryId: string) => void;
  onOpenItem: (item: MobileTrainingContentSummary) => void;
}

export function TrainingContentLibraryScreen(
  props: TrainingContentLibraryScreenProps
) {
  const styles = createStyles(props.theme);
  const results = props.library
    ? searchTrainingContent(props.library.items, props.query)
    : [];
  const searching = props.query.trim().length > 0;

  return (
    <View style={styles.fill}>
      <TrainingContentHeader
        title="Training Content"
        onBack={props.onBack}
        theme={props.theme}
      />
      <View style={styles.searchShell}>
        <MaterialCommunityIcons name="magnify" size={21} color={props.theme.muted} />
        <TextInput
          accessibilityLabel="Search training content"
          value={props.query}
          onChangeText={props.onChangeQuery}
          placeholder="Search training content"
          placeholderTextColor={props.theme.muted}
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {props.query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => props.onChangeQuery("")}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={20}
              color={props.theme.muted}
            />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} />
        }
      >
        {props.loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={props.theme.accent} />
            <Text style={styles.stateText}>Loading training content...</Text>
          </View>
        ) : props.error ? (
          <View style={styles.state}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={30}
              color={props.theme.danger}
            />
            <Text style={styles.errorText}>{props.error}</Text>
            <Pressable style={styles.actionButton} onPress={props.onRefresh}>
              <Text style={styles.actionButtonText}>Try Again</Text>
            </Pressable>
          </View>
        ) : searching ? (
          <>
            <Text style={styles.sectionTitle}>Search Results</Text>
            {results.length === 0 ? (
              <Text style={styles.emptyText}>No matching training content.</Text>
            ) : (
              <View style={styles.cardList}>
                {results.map((item) => (
                  <TrainingContentCard
                    key={item.id}
                    item={item}
                    theme={props.theme}
                    onOpen={() => props.onOpenItem(item)}
                  />
                ))}
              </View>
            )}
          </>
        ) : !props.library || props.library.items.length === 0 ? (
          <View style={styles.state}>
            <MaterialCommunityIcons
              name="bookshelf"
              size={36}
              color={props.theme.accent}
            />
            <Text style={styles.emptyText}>{TRAINING_CONTENT_EMPTY_MESSAGE}</Text>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenAll}
              style={({ pressed }) => [
                styles.allContent,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.allContentIcon}>
                <MaterialCommunityIcons
                  name="view-list-outline"
                  size={24}
                  color={props.theme.accent}
                />
              </View>
              <View style={styles.flexCopy}>
                <Text style={styles.categoryName}>All Content</Text>
                <Text style={styles.categoryCount}>
                  {props.library.items.length}{" "}
                  {props.library.items.length === 1 ? "resource" : "resources"}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={props.theme.muted}
              />
            </Pressable>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.categoryList}>
              {props.library.categories.map((category) => (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  onPress={() => props.onOpenCategory(category.id)}
                  style={({ pressed }) => [
                    styles.category,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View style={styles.flexCopy}>
                    <Text style={styles.categoryName}>{category.name}</Text>
                    {category.description ? (
                      <Text style={styles.categoryDescription} numberOfLines={3}>
                        {category.description}
                      </Text>
                    ) : null}
                    <Text style={styles.categoryCount}>
                      {category.itemCount}{" "}
                      {category.itemCount === 1 ? "resource" : "resources"}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={22}
                    color={props.theme.muted}
                  />
                </Pressable>
              ))}
            </View>
            {props.library.truncated ? (
              <Text style={styles.limitNotice}>
                Showing the first 500 available resources.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    searchShell: {
      height: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginVertical: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      backgroundColor: theme.input,
    },
    searchInput: {
      flex: 1,
      height: 44,
      color: theme.text,
      fontSize: 16,
      paddingVertical: 0,
    },
    content: { paddingBottom: 28 },
    state: {
      minHeight: 240,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 24,
    },
    stateText: { color: theme.muted, fontSize: 15, lineHeight: 21 },
    errorText: {
      color: theme.danger,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
    },
    emptyText: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 23,
      textAlign: "center",
    },
    actionButton: {
      minHeight: 42,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
      backgroundColor: theme.accent,
    },
    actionButtonText: {
      color: theme.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    allContent: {
      minHeight: 82,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      backgroundColor: theme.surface,
    },
    allContentIcon: {
      width: 42,
      height: 42,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceStrong,
    },
    flexCopy: { flex: 1, minWidth: 0 },
    sectionTitle: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "700",
      marginTop: 20,
      marginBottom: 10,
    },
    categoryList: { gap: 10 },
    category: {
      minHeight: 92,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      backgroundColor: theme.surface,
    },
    pressed: { opacity: 0.7 },
    categoryName: {
      color: theme.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "700",
    },
    categoryDescription: {
      color: theme.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 4,
    },
    categoryCount: {
      color: theme.accent,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      marginTop: 6,
    },
    cardList: { gap: 10 },
    limitNotice: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      marginTop: 16,
    },
  });
}
