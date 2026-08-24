import type { MobileTrainingContentSummary } from "@voicepractice/shared";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { AppColorScheme } from "../types";
import { TrainingContentCategoryScreen } from "./TrainingContentCategoryScreen";
import { TrainingContentDetailScreen } from "./TrainingContentDetailScreen";
import { getTrainingContentTheme } from "./theme";

type RelatedTrainingContentRoute =
  | { type: "list" }
  | { type: "detail"; contentId: string };

interface RelatedTrainingContentScreenProps {
  userId: string;
  authToken: string;
  colorScheme: AppColorScheme;
  initialItems: MobileTrainingContentSummary[];
  onBackToScenario: () => void;
}

export function RelatedTrainingContentScreen(
  props: RelatedTrainingContentScreenProps
) {
  const [items, setItems] = useState(props.initialItems);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<RelatedTrainingContentRoute>(() =>
    props.initialItems.length === 1
      ? { type: "detail", contentId: props.initialItems[0]!.id }
      : { type: "list" }
  );
  const theme = getTrainingContentTheme(props.colorScheme);

  const handleUnavailableItem = (message: string) => {
    setNotice(message);
    const next = route.type === "detail"
      ? items.filter((item) => item.id !== route.contentId)
      : items;
    setItems(next);
    if (next.length === 0) {
      props.onBackToScenario();
    } else {
      setRoute({ type: "list" });
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      {notice && route.type === "list" ? (
        <View style={[styles.notice, { borderColor: theme.secondary, backgroundColor: theme.surface }]}>
          <Text style={[styles.noticeText, { color: theme.text }]}>{notice}</Text>
        </View>
      ) : null}
      {route.type === "list" ? (
        <TrainingContentCategoryScreen
          category={null}
          items={items}
          title="Related Learning Resources"
          emptyMessage="No related Learning Resources are currently available."
          theme={theme}
          onBack={props.onBackToScenario}
          onOpenItem={(item) => setRoute({ type: "detail", contentId: item.id })}
        />
      ) : (
        <TrainingContentDetailScreen
          contentId={route.contentId}
          userId={props.userId}
          authToken={props.authToken}
          theme={theme}
          onBack={() => {
            if (items.length === 1) {
              props.onBackToScenario();
            } else {
              setRoute({ type: "list" });
            }
          }}
          onModuleRemoved={() => props.onBackToScenario()}
          onItemRemoved={handleUnavailableItem}
        />
      )}
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
