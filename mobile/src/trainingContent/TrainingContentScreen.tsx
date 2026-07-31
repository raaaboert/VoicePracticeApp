import type {
  MobileTrainingContentLibraryResponse,
  MobileTrainingContentSummary,
} from "@voicepractice/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { AppColorScheme } from "../types";
import { fetchMobileModules, fetchTrainingContentLibrary } from "./api";
import { TrainingContentCategoryScreen } from "./TrainingContentCategoryScreen";
import { TrainingContentDetailScreen } from "./TrainingContentDetailScreen";
import { TrainingContentLibraryScreen } from "./TrainingContentLibraryScreen";
import {
  isTrainingContentModuleRemoval,
  listCategoryItems,
  trainingContentErrorMessage,
} from "./model";
import { getTrainingContentTheme } from "./theme";

type TrainingContentRoute =
  | { type: "library" }
  | { type: "category"; categoryId: string | null }
  | {
      type: "detail";
      contentId: string;
      returnRoute: Exclude<TrainingContentRoute, { type: "detail" }>;
    };

interface TrainingContentScreenProps {
  userId: string;
  authToken: string;
  colorScheme: AppColorScheme;
  onBackToHome: (message?: string) => void;
  onModuleAvailabilityChange: (enabled: boolean) => void;
}

export function TrainingContentScreen(props: TrainingContentScreenProps) {
  const [route, setRoute] = useState<TrainingContentRoute>({ type: "library" });
  const [library, setLibrary] = useState<MobileTrainingContentLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const theme = useMemo(
    () => getTrainingContentTheme(props.colorScheme),
    [props.colorScheme]
  );

  const handleModuleRemoved = useCallback((message: string) => {
    generation.current += 1;
    setLibrary(null);
    setQuery("");
    props.onModuleAvailabilityChange(false);
    props.onBackToHome(message);
  }, [props.onBackToHome, props.onModuleAvailabilityChange]);

  const loadLibrary = useCallback(async (asRefresh = false) => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    if (asRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const modules = await fetchMobileModules(props.userId, props.authToken);
      if (!modules.modules.trainingContent.enabled) {
        handleModuleRemoved("Training Content is no longer enabled.");
        return;
      }
      const nextLibrary = await fetchTrainingContentLibrary(
        props.userId,
        props.authToken
      );
      if (generation.current !== currentGeneration) {
        return;
      }
      props.onModuleAvailabilityChange(true);
      setLibrary(nextLibrary);
      setRoute((current) => {
        if (
          current.type === "category"
          && current.categoryId
          && !nextLibrary.categories.some((category) => category.id === current.categoryId)
        ) {
          setNotice("That category is no longer available.");
          return { type: "library" };
        }
        return current;
      });
    } catch (caught) {
      if (generation.current !== currentGeneration) {
        return;
      }
      const message = trainingContentErrorMessage(
        caught,
        "Training content could not be loaded."
      );
      if (isTrainingContentModuleRemoval(caught)) {
        handleModuleRemoved(message);
        return;
      }
      setError(message);
    } finally {
      if (generation.current === currentGeneration) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    handleModuleRemoved,
    props.authToken,
    props.onModuleAvailabilityChange,
    props.userId,
  ]);

  useEffect(() => {
    void loadLibrary();
    return () => {
      generation.current += 1;
    };
  }, [loadLibrary]);

  const openItem = useCallback((
    item: MobileTrainingContentSummary,
    returnRoute: Exclude<TrainingContentRoute, { type: "detail" }>
  ) => {
    setNotice(null);
    setRoute({ type: "detail", contentId: item.id, returnRoute });
  }, []);

  const handleItemRemoved = useCallback((message: string) => {
    setNotice(message);
    setRoute((current) =>
      current.type === "detail" ? current.returnRoute : { type: "library" }
    );
    void loadLibrary(true);
  }, [loadLibrary]);

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {notice ? (
        <View style={[styles.notice, { borderColor: theme.secondary, backgroundColor: theme.surface }]}>
          <Text style={[styles.noticeText, { color: theme.text }]}>{notice}</Text>
        </View>
      ) : null}
      {route.type === "library" ? (
        <TrainingContentLibraryScreen
          library={library}
          loading={loading}
          refreshing={refreshing}
          error={error}
          query={query}
          theme={theme}
          onChangeQuery={setQuery}
          onBack={() => props.onBackToHome()}
          onRefresh={() => { void loadLibrary(true); }}
          onOpenAll={() => {
            setNotice(null);
            setRoute({ type: "category", categoryId: null });
          }}
          onOpenCategory={(categoryId) => {
            setNotice(null);
            setRoute({ type: "category", categoryId });
          }}
          onOpenItem={(item) => openItem(item, { type: "library" })}
        />
      ) : null}
      {route.type === "category" && library ? (
        <TrainingContentCategoryScreen
          category={
            route.categoryId
              ? library.categories.find((category) => category.id === route.categoryId) ?? null
              : null
          }
          items={listCategoryItems(library, route.categoryId)}
          refreshing={refreshing}
          theme={theme}
          onBack={() => setRoute({ type: "library" })}
          onRefresh={() => { void loadLibrary(true); }}
          onOpenItem={(item) => openItem(item, route)}
        />
      ) : null}
      {route.type === "detail" ? (
        <TrainingContentDetailScreen
          contentId={route.contentId}
          userId={props.userId}
          authToken={props.authToken}
          theme={theme}
          onBack={() => setRoute(route.returnRoute)}
          onModuleRemoved={handleModuleRemoved}
          onItemRemoved={handleItemRemoved}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  notice: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  noticeText: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
