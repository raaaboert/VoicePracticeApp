import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { fetchFocusTopicCatalog } from "./api";
import { createFocusTopicCatalogController } from "./catalog";

export function useFocusTopicCatalog(params: {
  userId: string | null; authToken: string | null; orgId: string | null;
  enabled: boolean; destination: "home" | "focus_topics" | null;
}) {
  const { userId, authToken, orgId, enabled, destination } = params;
  const active = enabled && destination !== null;
  // A new identity gets a blank snapshot immediately, before effects run.
  const controller = useMemo(() => createFocusTopicCatalogController(async (signal) => {
    if (!userId || !authToken || !orgId || !enabled) return { topics: [] };
    return fetchFocusTopicCatalog(userId, authToken, { signal });
  }), [userId, authToken, orgId, enabled]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => () => controller.invalidate(), [controller]);
  useEffect(() => {
    if (!active) { controller.invalidate(); return; }
    void controller.refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void controller.refresh();
      else controller.invalidate();
    });
    return () => subscription.remove();
  }, [controller, active]);
  return { state, controller };
}
