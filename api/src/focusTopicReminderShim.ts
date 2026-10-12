/**
 * Compatibility shim for the former one-shot Topic deadline worker.
 *
 * Keep this side-effect-free and dependency-free until external scheduler
 * cleanup is confirmed.  It deliberately does not load runtime config,
 * database stores, or the API entrypoint.
 */
export function runRetiredFocusTopicReminderShim(log: (message: string) => void = console.log): {
  considered: number;
  inserted: number;
} {
  log("[focus-topic-reminders] retired; no action taken");
  return { considered: 0, inserted: 0 };
}
