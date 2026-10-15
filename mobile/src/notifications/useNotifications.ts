import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { fetchMobileNotifications, markAllMobileNotificationsRead, mutateMobileNotification } from "../lib/api";
import { createNotificationInboxController } from "./model";

export function useNotifications(token: string | null, userId: string | null, orgId: string | null, enabled: boolean) {
  // A fresh controller makes identity/org switches synchronous: no previous user's
  // rows or count can flash while an effect catches up. Never poll during audio.
  const controller = useMemo(() => createNotificationInboxController({
    list: (options) => fetchMobileNotifications(token!, options),
    mutate: (id, action) => mutateMobileNotification(token!, id, action),
    markAll: () => markAllMobileNotificationsRead(token!),
  }), [token, userId, orgId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    if (!enabled || !token || !userId) return;
    if (AppState.currentState === "active") void controller.refresh();
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") void controller.refresh();
      else controller.cancel();
    });
    return () => { listener.remove(); controller.cancel(); };
  }, [controller, enabled, token, userId]);
  return { state, controller };
}
