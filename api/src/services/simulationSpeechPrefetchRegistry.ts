import crypto from "node:crypto";

export type SimulationSpeechPrefetchMissReason =
  | "not_found"
  | "expired"
  | "user_mismatch"
  | "preset_mismatch"
  | "text_mismatch";

export type SimulationSpeechPrefetchConsumeResult<T> =
  | { status: "hit"; value: T | null }
  | { status: "miss"; reason: SimulationSpeechPrefetchMissReason }
  | { status: "timeout" };

interface SimulationSpeechPrefetchEntry<T> {
  userId: string;
  preset: string;
  textHash: string;
  createdAtMs: number;
  promise: Promise<T | null>;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex");
}

export class SimulationSpeechPrefetchRegistry<T> {
  private readonly entries = new Map<string, SimulationSpeechPrefetchEntry<T>>();

  constructor(private readonly ttlMs = 60_000) {}

  register(params: {
    correlationId: string;
    userId: string;
    preset: string;
    text: string;
    promise: Promise<T | null>;
    nowMs?: number;
  }): void {
    this.sweep(params.nowMs ?? Date.now());
    const correlationId = params.correlationId.trim();
    if (!correlationId || !params.userId.trim() || !params.preset.trim() || !normalizeText(params.text)) {
      return;
    }
    this.entries.set(correlationId, {
      userId: params.userId,
      preset: params.preset,
      textHash: hashText(params.text),
      createdAtMs: params.nowMs ?? Date.now(),
      promise: params.promise,
    });
  }

  async consume(params: {
    correlationId: string;
    userId: string;
    preset: string;
    text: string;
    nowMs?: number;
    waitMs?: number;
  }): Promise<SimulationSpeechPrefetchConsumeResult<T>> {
    const nowMs = params.nowMs ?? Date.now();
    const correlationId = params.correlationId.trim();
    const entry = this.entries.get(correlationId);
    if (!entry) {
      this.sweep(nowMs);
      return { status: "miss", reason: "not_found" };
    }
    if (nowMs - entry.createdAtMs > this.ttlMs) {
      this.entries.delete(correlationId);
      return { status: "miss", reason: "expired" };
    }

    const mismatchReason =
      entry.userId !== params.userId
        ? "user_mismatch"
        : entry.preset !== params.preset
          ? "preset_mismatch"
          : entry.textHash !== hashText(params.text)
            ? "text_mismatch"
            : null;
    if (mismatchReason) {
      this.entries.delete(correlationId);
      return { status: "miss", reason: mismatchReason };
    }

    this.entries.delete(correlationId);
    const settledPrefetch = entry.promise.then(
      (value) => ({ status: "hit", value } as const),
      () => ({ status: "hit", value: null } as const),
    );
    if (params.waitMs === undefined) {
      return await settledPrefetch;
    }

    const waitMs = Math.max(0, params.waitMs);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        settledPrefetch,
        new Promise<{ status: "timeout" }>((resolve) => {
          timeoutHandle = setTimeout(() => resolve({ status: "timeout" }), waitMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private sweep(nowMs: number): void {
    for (const [correlationId, entry] of this.entries) {
      if (nowMs - entry.createdAtMs > this.ttlMs) {
        this.entries.delete(correlationId);
      }
    }
  }
}
