import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { AppColorScheme } from "../types";
import { getTrainingContentTheme } from "../trainingContent/theme";
import { fetchFocusTopicCatalog } from "./api";
import { FocusTopicDetailShell } from "./FocusTopicDetailShell";
import { FocusTopicLandingScreen } from "./FocusTopicLandingScreen";
import {
  buildFocusTopicNavigationSummary,
  createFocusTopicRequestGate,
  type FocusTopicNavigationSummary,
} from "./model";

interface FocusTopicsScreenProps {
  userId: string;
  authToken: string;
  colorScheme: AppColorScheme;
  onBackToHome: () => void;
}

export function FocusTopicsScreen(props: FocusTopicsScreenProps) {
  const [topics, setTopics] = useState<MobileFocusTopicCatalogItem[] | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<FocusTopicNavigationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGate = useRef(createFocusTopicRequestGate());
  const theme = useMemo(() => getTrainingContentTheme(props.colorScheme), [props.colorScheme]);

  const loadTopics = useCallback(async () => {
    const attempt = requestGate.current.start();
    setTopics(null);
    setSelectedTopic(null);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchFocusTopicCatalog(props.userId, props.authToken, {
        signal: attempt.signal,
      });
      if (!requestGate.current.isCurrent(attempt)) {
        return;
      }
      setTopics(response.topics);
    } catch (caught) {
      if (!requestGate.current.isCurrent(attempt)) {
        return;
      }
      setError(
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : "Focus Topics could not be loaded."
      );
    } finally {
      if (requestGate.current.isCurrent(attempt)) {
        setLoading(false);
      }
    }
  }, [props.authToken, props.userId]);

  useEffect(() => {
    void loadTopics();
    return () => requestGate.current.invalidate();
  }, [loadTopics]);

  return (
    <View style={styles.fill}>
      <View style={[styles.surface, { backgroundColor: theme.background, borderColor: theme.border }]}>
        {selectedTopic ? (
          <FocusTopicDetailShell
            topic={selectedTopic}
            theme={theme}
            onBack={() => setSelectedTopic(null)}
          />
        ) : (
          <FocusTopicLandingScreen
            topics={topics}
            loading={loading}
            error={error}
            theme={theme}
            onBack={props.onBackToHome}
            onRetry={() => { void loadTopics(); }}
            onOpenTopic={(topic) => setSelectedTopic(buildFocusTopicNavigationSummary(topic))}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  surface: {
    flex: 1,
    marginHorizontal: 2,
    marginVertical: 4,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
});
