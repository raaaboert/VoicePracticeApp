import type { EventEmitter } from "node:events";
import type { SupportCaseStore } from "../storage/supportCaseStore.js";
import { safeErrorDiagnostics } from "./safeErrors.js";

export const SUPPORT_TRANSCRIPT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function scheduleSupportTranscriptExpiration(
  store: Pick<SupportCaseStore, "purgeExpiredTranscripts">,
  server: Pick<EventEmitter, "once" | "removeListener">,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await store.purgeExpiredTranscripts(new Date());
      } catch (error) {
        // No case identifiers, transcript material, exception text or stacks.
        // eslint-disable-next-line no-console
        console.warn("[support-transcript-expiration]", { stage: "purge_failed", ...safeErrorDiagnostics(error) });
      } finally {
        running = false;
      }
    })();
  }, SUPPORT_TRANSCRIPT_CLEANUP_INTERVAL_MS);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    server.removeListener("close", stop);
  };
  server.once("close", stop);
  return stop;
}
