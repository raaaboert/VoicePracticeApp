import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type {
  MobileRelatedPracticeScenarioSummary,
  MobileTrainingContentDetail,
} from "@voicepractice/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  fetchRelatedPracticeScenarios,
  fetchTrainingContentDetail,
} from "./api";
import {
  isTrainingContentItemRemoval,
  isTrainingContentModuleRemoval,
  trainingContentErrorMessage,
} from "./model";
import { TRAINING_CONTENT_TYPE_LABELS } from "./TrainingContentCard";
import { TrainingContentHeader } from "./TrainingContentHeader";
import type { TrainingContentTheme } from "./theme";
import { TrainingContentViewer } from "./TrainingContentViewer";
import { normalizeRelatedPracticeScenarios } from "./relatedPracticeScenarios";

interface TrainingContentDetailScreenProps {
  contentId: string;
  userId: string;
  authToken: string;
  theme: TrainingContentTheme;
  onBack: () => void;
  onModuleRemoved: (message: string) => void;
  onItemRemoved: (message: string) => void;
  onPracticeScenario: (scenario: MobileRelatedPracticeScenarioSummary) => void;
}

export function TrainingContentDetailScreen(
  props: TrainingContentDetailScreenProps
) {
  const [item, setItem] = useState<MobileTrainingContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [relatedScenarios, setRelatedScenarios] = useState<
    MobileRelatedPracticeScenarioSummary[]
  >([]);
  const generation = useRef(0);
  const relatedGeneration = useRef(0);
  const styles = createStyles(props.theme);

  const load = useCallback(async () => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    setLoading(true);
    setError(null);
    setViewerError(null);
    try {
      const result = await fetchTrainingContentDetail(
        props.userId,
        props.contentId,
        props.authToken
      );
      if (generation.current === currentGeneration) {
        setItem(result.item);
      }
    } catch (caught) {
      if (generation.current !== currentGeneration) {
        return;
      }
      const message = trainingContentErrorMessage(
        caught,
        "This Learning Resource could not be loaded."
      );
      if (isTrainingContentModuleRemoval(caught)) {
        props.onModuleRemoved(message);
        return;
      }
      if (isTrainingContentItemRemoval(caught)) {
        props.onItemRemoved(message);
        return;
      }
      setError(message);
    } finally {
      if (generation.current === currentGeneration) {
        setLoading(false);
      }
    }
  }, [
    props.authToken,
    props.contentId,
    props.onItemRemoved,
    props.onModuleRemoved,
    props.userId,
  ]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const currentGeneration = relatedGeneration.current + 1;
    relatedGeneration.current = currentGeneration;
    setRelatedScenarios([]);
    void fetchRelatedPracticeScenarios(
      props.userId,
      props.contentId,
      props.authToken
    )
      .then((result) => {
        if (relatedGeneration.current === currentGeneration) {
          setRelatedScenarios(normalizeRelatedPracticeScenarios(result.scenarios));
        }
      })
      .catch(() => {
        if (relatedGeneration.current === currentGeneration) {
          setRelatedScenarios([]);
        }
      });
    return () => {
      relatedGeneration.current += 1;
    };
  }, [props.authToken, props.contentId, props.userId]);

  return (
    <View style={styles.fill}>
      <TrainingContentHeader
        title={item?.title ?? "Learning Resource"}
        onBack={props.onBack}
        theme={props.theme}
      />
      {loading && !item ? (
        <View style={styles.state}>
          <ActivityIndicator color={props.theme.accent} />
          <Text style={styles.stateText}>Loading resource...</Text>
        </View>
      ) : error || !item ? (
        <View style={styles.state}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={30}
            color={props.theme.danger}
          />
          <Text style={styles.errorText}>
            {error ?? "This resource is not available."}
          </Text>
          <Pressable style={styles.actionButton} onPress={() => { void load(); }}>
            <Text style={styles.actionButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
        >
          <Text style={styles.typeLabel}>
            {TRAINING_CONTENT_TYPE_LABELS[item.contentType]}
          </Text>
          <Text style={styles.title}>{item.title}</Text>
          <View style={styles.metadata}>
            <Text style={styles.category}>{item.category.name}</Text>
            {item.relatedFocusTopic ? (
              <Text style={styles.topic}>{item.relatedFocusTopic}</Text>
            ) : null}
          </View>
          {item.description ? (
            <Text style={styles.description}>{item.description}</Text>
          ) : null}
          {item.asset ? (
            <Text style={styles.assetMetadata}>
              {[item.asset.filename, formatByteSize(item.asset.byteSize)]
                .filter(Boolean)
                .join(" \u00b7 ")}
            </Text>
          ) : null}
          {relatedScenarios.length > 0 ? (
            <View style={styles.relatedSection}>
              <Text style={styles.relatedHeading}>Related Practice Scenarios</Text>
              {relatedScenarios.map((scenario) => (
                <View key={scenario.id} style={styles.relatedRow}>
                  <View style={styles.relatedIdentity}>
                    <Text style={styles.relatedTitle}>{scenario.title}</Text>
                    <Text style={styles.relatedSource}>
                      {scenario.source === "custom" ? "Custom" : "Standard"}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Practice ${scenario.title}`}
                    style={styles.practiceButton}
                    onPress={() => props.onPracticeScenario(scenario)}
                  >
                    <Text style={styles.practiceButtonText}>Practice</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {viewerError ? (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{viewerError}</Text>
            </View>
          ) : null}
          <View style={styles.viewer}>
            <TrainingContentViewer
              item={item}
              userId={props.userId}
              authToken={props.authToken}
              theme={props.theme}
              onModuleRemoved={props.onModuleRemoved}
              onItemRemoved={props.onItemRemoved}
              onError={setViewerError}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function formatByteSize(byteSize: number | null): string | null {
  if (byteSize === null || !Number.isFinite(byteSize) || byteSize < 0) {
    return null;
  }
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }
  if (byteSize < 1024 * 1024) {
    return `${Math.round(byteSize / 1024)} KB`;
  }
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function createStyles(theme: TrainingContentTheme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    content: { paddingTop: 18, paddingBottom: 36 },
    state: {
      flex: 1,
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
    actionButton: {
      minHeight: 42,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      borderRadius: 6,
      backgroundColor: theme.accent,
    },
    actionButtonText: {
      color: theme.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    typeLabel: {
      color: theme.accent,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    title: {
      color: theme.text,
      fontSize: 25,
      lineHeight: 32,
      fontWeight: "700",
      marginTop: 5,
    },
    metadata: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 9,
      marginTop: 10,
    },
    category: { color: theme.muted, fontSize: 13, lineHeight: 18 },
    topic: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    description: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 24,
      marginTop: 16,
    },
    assetMetadata: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 12,
    },
    relatedSection: {
      marginTop: 18,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      backgroundColor: theme.surface,
    },
    relatedHeading: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
    },
    relatedRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    relatedIdentity: { flex: 1, gap: 2 },
    relatedTitle: { color: theme.text, fontSize: 14, lineHeight: 19, fontWeight: "600" },
    relatedSource: { color: theme.muted, fontSize: 12, lineHeight: 16 },
    practiceButton: {
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
      borderRadius: 6,
      backgroundColor: theme.accent,
    },
    practiceButtonText: { color: theme.accentText, fontSize: 14, fontWeight: "700" },
    inlineError: {
      padding: 10,
      marginTop: 12,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 6,
    },
    viewer: { marginTop: 20 },
  });
}
