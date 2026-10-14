/** One visible-tab timer and at most one in-flight inbox read. */
export function startNotificationPolling(params: {
  visibility: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  scheduler: Pick<Window, "setInterval" | "clearInterval">;
  intervalMs: number;
  load: (signal: AbortSignal) => Promise<void>;
}): { refresh: () => void; stop: () => void } {
  let stopped = false;
  let timer: number | undefined;
  let request: AbortController | null = null;
  let refreshPending = false;

  const refresh = () => {
    if (stopped || params.visibility.visibilityState !== "visible") return;
    if (request) { refreshPending = true; return; }
    const controller = new AbortController();
    request = controller;
    void params.load(controller.signal).catch(() => {
      // The inbox presents failures; a rejected read must not stop future polling.
    }).finally(() => {
      request = null;
      if (refreshPending) { refreshPending = false; refresh(); }
    });
  };
  const onVisibilityChange = () => {
    if (timer !== undefined) params.scheduler.clearInterval(timer);
    timer = undefined;
    if (params.visibility.visibilityState === "visible") {
      refresh();
      timer = params.scheduler.setInterval(refresh, params.intervalMs);
    }
  };

  params.visibility.addEventListener("visibilitychange", onVisibilityChange);
  onVisibilityChange();
  return {
    refresh,
    stop: () => {
      stopped = true;
      if (timer !== undefined) params.scheduler.clearInterval(timer);
      params.visibility.removeEventListener("visibilitychange", onVisibilityChange);
      request?.abort();
    },
  };
}
