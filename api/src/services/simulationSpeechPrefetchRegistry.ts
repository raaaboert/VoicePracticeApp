import crypto from "node:crypto";

export type SimulationSpeechPrefetchMissReason =
  | "not_found"
  | "expired"
  | "user_mismatch"
  | "context_mismatch"
  | "preset_mismatch"
  | "text_mismatch";

export type SimulationSpeechPrefetchConsumeResult<T> =
  | { status: "hit"; value: T | null }
  | { status: "miss"; reason: SimulationSpeechPrefetchMissReason }
  | { status: "timeout" };

interface SimulationSpeechPrefetchEntry<T> {
  correlationId: string;
  userId: string;
  orgId: string | null;
  sessionId: string | null;
  preset: string;
  textHash: string;
  createdAtMs: number;
  promise: Promise<T | null>;
  settled: boolean;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex");
}

export class SimulationSpeechPrefetchRegistry<T> {
  private readonly entries = new Map<string, SimulationSpeechPrefetchEntry<T>>();

  constructor(private readonly ttlMs = 60_000, private readonly maxEntries = 64) {}

  hasCapacity(nowMs = Date.now()): boolean {
    this.sweep(nowMs);
    // Completed audio may be evicted under pressure; never evict pending work
    // merely to start another prefetch.
    if (this.entries.size >= this.maxEntries) {
      for (const [key, entry] of this.entries) {
        if (entry.settled) { this.entries.delete(key); break; }
      }
    }
    return this.entries.size < this.maxEntries;
  }

  private key(params: { correlationId: string; userId: string; orgId?: string | null; sessionId?: string | null; preset: string; text: string }): string {
    return JSON.stringify([params.correlationId.trim(), params.userId, params.orgId ?? null,
      params.sessionId ?? null, params.preset, hashText(params.text)]);
  }

  /** Atomically joins foreground work too. No database lock is held here. */
  getOrStart(params: { correlationId: string; userId: string; orgId?: string | null; sessionId?: string | null; preset: string; text: string },
    start: () => Promise<T | null>): Promise<T | null> {
    this.sweep(Date.now());
    const existing = this.entries.get(this.key(params));
    if (existing) return existing.promise;
    const promise = Promise.resolve().then(start);
    this.register({ ...params, promise });
    return promise;
  }

  register(params: {
    correlationId: string;
    userId: string;
    orgId?: string | null;
    sessionId?: string | null;
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
    const key = this.key(params);
    if (this.entries.has(key) || !this.hasCapacity(params.nowMs ?? Date.now())) return;
    const entry: SimulationSpeechPrefetchEntry<T> = {
      correlationId,
      userId: params.userId,
      orgId: params.orgId ?? null,
      sessionId: params.sessionId ?? null,
      preset: params.preset,
      textHash: hashText(params.text),
      createdAtMs: params.nowMs ?? Date.now(),
      settled: false,
      promise: params.promise.then((value) => {
        entry.settled = true;
        if (value === null && this.entries.get(key) === entry) this.entries.delete(key);
        return value;
      }, () => {
        entry.settled = true;
        if (this.entries.get(key) === entry) this.entries.delete(key);
        return null;
      }),
    };
    this.entries.set(key, entry);
  }

  async consume(params: {
    correlationId: string;
    userId: string;
    orgId?: string | null;
    sessionId?: string | null;
    preset: string;
    text: string;
    nowMs?: number;
    waitMs?: number;
  }): Promise<SimulationSpeechPrefetchConsumeResult<T>> {
    const nowMs = params.nowMs ?? Date.now();
    const correlationId = params.correlationId.trim();
    const key = this.key(params);
    const textHash = hashText(params.text);
    const entries = [...this.entries.values()];
    // Legacy speech is already authenticated, org-scoped and budget-checked
    // before this lookup. Missing session identity may reuse identical audio;
    // it never grants registered-session budget admission.
    const legacyMatch = params.sessionId == null ? entries.find((candidate) => candidate.correlationId === correlationId
      && candidate.userId === params.userId && candidate.orgId === (params.orgId ?? null)
      && candidate.preset === params.preset && candidate.textHash === textHash) : undefined;
    const entry = this.entries.get(key) ?? legacyMatch ?? entries.find((candidate) => candidate.correlationId === correlationId);
    if (!entry) {
      this.sweep(nowMs);
      return { status: "miss", reason: "not_found" };
    }
    if (nowMs - entry.createdAtMs > this.ttlMs) {
      this.sweep(nowMs);
      return { status: "miss", reason: "expired" };
    }

    const mismatchReason =
      entry.userId !== params.userId
        ? "user_mismatch"
        : entry.orgId !== (params.orgId ?? null) || (params.sessionId != null && entry.sessionId !== params.sessionId)
          ? "context_mismatch"
        : entry.preset !== params.preset
          ? "preset_mismatch"
          : entry.textHash !== textHash
            ? "text_mismatch"
            : null;
    if (mismatchReason) {
      return { status: "miss", reason: mismatchReason };
    }

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
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.createdAtMs > this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}
