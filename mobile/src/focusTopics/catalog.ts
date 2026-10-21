import type { MobileFocusTopicCatalogItem, MobileFocusTopicCatalogResponse } from "@voicepractice/shared";
import { createFocusTopicRequestGate } from "./model";

export interface FocusTopicCatalogState {
  topics: MobileFocusTopicCatalogItem[] | null;
  loading: boolean;
  error: string | null;
}

export const FOCUS_TOPIC_HOME_LIMIT = 2;

/** One identity-scoped, in-memory catalog shared by Home and the existing catalog screen. */
export function createFocusTopicCatalogController(
  fetchCatalog: (signal: AbortSignal) => Promise<MobileFocusTopicCatalogResponse>,
) {
  let state: FocusTopicCatalogState = { topics: null, loading: true, error: null };
  let pending: Promise<void> | null = null;
  const gate = createFocusTopicRequestGate();
  const listeners = new Set<() => void>();
  const publish = (next: FocusTopicCatalogState) => { state = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh(): Promise<void> {
      if (pending) return pending;
      const attempt = gate.start();
      publish({ topics: null, loading: true, error: null });
      const work = (async () => {
        try {
          const result = await fetchCatalog(attempt.signal);
          if (gate.isCurrent(attempt)) publish({ topics: result.topics, loading: false, error: null });
        } catch {
          if (gate.isCurrent(attempt)) publish({ topics: null, loading: false,
            error: "Focus Topics could not be loaded. Please try again." });
        }
      })();
      pending = work;
      void work.finally(() => { if (pending === work) pending = null; });
      return work;
    },
    invalidate() {
      gate.invalidate();
      pending = null;
      publish({ topics: null, loading: true, error: null });
    },
  };
}

export type FocusTopicCatalogController = ReturnType<typeof createFocusTopicCatalogController>;

export function homeFocusTopicPreview(state: FocusTopicCatalogState): MobileFocusTopicCatalogItem[] {
  // Preserve authorized company ordering until the API supplies learner-specific
  // assignment/practice timestamps. Topic createdAt is not learner activity.
  return state.loading || state.error ? [] : (state.topics ?? []).slice(0, FOCUS_TOPIC_HOME_LIMIT);
}
