import type {
  MobileFocusTopicScenarioSummary,
} from "@voicepractice/shared";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { AppColorScheme } from "../types";
import { getTrainingContentTheme } from "../trainingContent/theme";
import { TrainingContentDetailScreen } from "../trainingContent/TrainingContentDetailScreen";
import type { FocusTopicCatalogController, FocusTopicCatalogState } from "./catalog";
import { FocusTopicDetailScreen } from "./FocusTopicDetailScreen";
import { FocusTopicLandingScreen } from "./FocusTopicLandingScreen";
import type { FocusTopicLearnerSort } from "./discovery";

interface FocusTopicsScreenProps {
  catalog: { state: FocusTopicCatalogState; controller: FocusTopicCatalogController };
  userId: string;
  authToken: string;
  colorScheme: AppColorScheme;
  initialTopicId?: string | null;
  initialNotice?: string | null;
  onBackToHome: () => void;
  onPracticeScenario: (
    topicId: string,
    scenario: MobileFocusTopicScenarioSummary
  ) => void;
  onLeaveReturnedTopic: () => void;
}

export function FocusTopicsScreen(props: FocusTopicsScreenProps) {
  const { topics, loading, error } = props.catalog.state;
  const loadTopics = useCallback(() => props.catalog.controller.refresh(), [props.catalog.controller]);
  const [query, setQuery] = useState("");
  const [learnerSort, setLearnerSort] = useState<FocusTopicLearnerSort>("company");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(
    () => props.initialTopicId?.trim() || null
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [detailNotice, setDetailNotice] = useState<string | null>(props.initialNotice ?? null);
  const [refreshCatalogOnBack, setRefreshCatalogOnBack] = useState(false);
  const theme = useMemo(() => getTrainingContentTheme(props.colorScheme), [props.colorScheme]);

  const openTopic = useCallback((topicId: string) => {
    setSelectedResourceId(null);
    setDetailNotice(null);
    setRefreshCatalogOnBack(false);
    setSelectedTopicId(topicId);
  }, []);

  const returnToCatalog = useCallback(() => {
    setSelectedResourceId(null);
    setSelectedTopicId(null);
    setDetailNotice(null);
    props.onLeaveReturnedTopic();
    if (refreshCatalogOnBack) {
      setRefreshCatalogOnBack(false);
      void loadTopics();
    }
  }, [loadTopics, props.onLeaveReturnedTopic, refreshCatalogOnBack]);

  const returnFromResource = useCallback((notice?: string) => {
    setSelectedResourceId(null);
    setDetailNotice(notice ?? null);
    setDetailRefreshKey((current) => current + 1);
  }, []);

  const handleTopicResourceBack = useCallback(() => {
    returnFromResource();
  }, [returnFromResource]);

  const handleTopicResourceRemoved = useCallback((message: string) => {
    returnFromResource(message);
  }, [returnFromResource]);

  const ignoreTopicResourcePractice = useCallback(() => {}, []);

  const markDetailUnavailable = useCallback(() => {
    setRefreshCatalogOnBack(true);
  }, []);

  return (
    <View style={styles.fill}>
      <View style={[styles.surface, { backgroundColor: theme.background, borderColor: theme.border }]}>
        {selectedTopicId && selectedResourceId ? (
          <TrainingContentDetailScreen
            key={`${selectedTopicId}:${selectedResourceId}`}
            contentId={selectedResourceId}
            userId={props.userId}
            authToken={props.authToken}
            theme={theme}
            onBack={handleTopicResourceBack}
            onModuleRemoved={handleTopicResourceRemoved}
            onItemRemoved={handleTopicResourceRemoved}
            onPracticeScenario={ignoreTopicResourcePractice}
            showRelatedPracticeScenarios={false}
            contentHorizontalInset
          />
        ) : selectedTopicId ? (
          <FocusTopicDetailScreen
            key={selectedTopicId}
            topicId={selectedTopicId}
            userId={props.userId}
            authToken={props.authToken}
            theme={theme}
            refreshKey={detailRefreshKey}
            notice={detailNotice}
            onBack={returnToCatalog}
            onOpenResource={setSelectedResourceId}
            onPracticeScenario={(scenario) =>
              props.onPracticeScenario(selectedTopicId, scenario)
            }
            onUnavailable={markDetailUnavailable}
          />
        ) : (
          <FocusTopicLandingScreen
            topics={topics}
            query={query}
            learnerSort={learnerSort}
            loading={loading}
            error={error}
            theme={theme}
            onBack={props.onBackToHome}
            onRetry={() => { void loadTopics(); }}
            onChangeQuery={setQuery}
            onChangeLearnerSort={setLearnerSort}
            onOpenTopic={(topic) => openTopic(topic.id)}
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
