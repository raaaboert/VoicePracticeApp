import type { MobileNotificationRow, MobileNotificationsResponse } from "@voicepractice/shared";
import { MobileApiError } from "../lib/apiError";

export interface NotificationInboxState {
  rows: MobileNotificationRow[]; unreadCount: number; nextOffset: number | null;
  loading: boolean; acting: boolean; error: string | null; unsupported: boolean; history: boolean;
}
export function createNotificationInboxController(api: {
  list: (options: { offset: number; history: boolean; signal: AbortSignal }) => Promise<MobileNotificationsResponse>;
  mutate: (id: string, action: "open" | "dismiss") => Promise<{ notification: MobileNotificationRow }>;
  markAll: () => Promise<unknown>;
}) {
  let state: NotificationInboxState = { rows: [], unreadCount: 0, nextOffset: null, loading: false, acting: false, error: null, unsupported: false, history: false };
  const listeners = new Set<() => void>();
  let generation = 0;
  let epoch = 0;
  let active: AbortController | null = null;
  let mutation = false;
  const update = (patch: Partial<NotificationInboxState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  const cancel = () => { epoch++; generation++; active?.abort(); active = null; update({ loading: false }); };
  const load = async (more = false) => {
    if (state.loading || (more && state.nextOffset === null)) return;
    const current = ++generation;
    const controller = new AbortController(); active = controller;
    update({ loading: true, error: null });
    try {
      const page = await api.list({ offset: more ? state.nextOffset! : 0, history: state.history, signal: controller.signal });
      if (generation !== current) return;
      const rows = new Map((more ? state.rows : []).map((row) => [row.id, row]));
      page.notifications.forEach((row) => rows.set(row.id, row));
      update({ rows: [...rows.values()], unreadCount: page.unreadCount, nextOffset: page.nextOffset, unsupported: false });
    } catch (error) {
      if (generation !== current) return;
      const unsupported = error instanceof MobileApiError && [404, 405, 501].includes(error.status);
      update({ rows: [], unreadCount: 0, nextOffset: null, unsupported,
        error: unsupported ? null : "Notifications could not be loaded. Please try again." });
    } finally {
      if (generation === current) { active = null; update({ loading: false }); }
    }
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    cancel,
    refresh: () => load(),
    more: () => load(true),
    async history(value: boolean) { cancel(); update({ history: value, rows: [], nextOffset: null }); await load(); },
    async act(id: string | null, action: "open" | "dismiss" | "mark-all") {
      if (mutation) return null;
      mutation = true;
      update({ acting: true, error: null });
      const current = generation;
      const currentEpoch = epoch;
      try {
        const result = action === "mark-all" ? (await api.markAll(), null) : await api.mutate(id!, action);
        if (current !== generation) return null;
        active?.abort(); active = null;
        update({ loading: false });
        await load();
        return epoch === currentEpoch ? result?.notification.destination ?? null : null;
      } catch {
        if (current === generation) {
          update({ error: "This notification is no longer available, or the action could not be completed. Refresh and try again." });
        }
        return null;
      } finally { mutation = false; update({ acting: false }); }
    },
  };
}

export function notificationTimeLabel(value: string, now = Date.now()): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Date unavailable";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return new Date(parsed).toLocaleDateString();
}
