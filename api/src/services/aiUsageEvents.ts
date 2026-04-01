import { AiUsageEvent } from "@voicepractice/shared";

import type {
  AiUsageBudgetSnapshot,
  AiUsageCurrentPeriodTotals,
  AiUsageEventQuery,
  AiUsageEventStore
} from "../storage/aiUsageEventStore.js";

export type {
  AiUsageBudgetSnapshot,
  AiUsageCurrentPeriodTotals,
  AiUsageEventQuery
} from "../storage/aiUsageEventStore.js";

function clampNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return Math.max(0, Math.floor(fallback));
}

function getUsageTokens(event: AiUsageEvent): number {
  return Math.max(0, clampNonNegativeInteger(event.totalTokens, 0));
}

export interface AiUsageEventAccess {
  append(event: AiUsageEvent): Promise<void>;
  deleteForUser(userId: string): Promise<number>;
  list(query?: AiUsageEventQuery): Promise<AiUsageEvent[]>;
  computeBudgetSnapshot(params: { userId: string; now: Date; userTimeZone: string }): Promise<AiUsageBudgetSnapshot>;
  computeCurrentPeriodTotals(params: { userId: string; now: Date; timeZone: string }): Promise<AiUsageCurrentPeriodTotals>;
}

export function createAiUsageEventAccess(store: AiUsageEventStore): AiUsageEventAccess {
  return {
    async append(event: AiUsageEvent): Promise<void> {
      await store.appendEvent(event);
    },
    async deleteForUser(userId: string): Promise<number> {
      return await store.deleteEventsForUser(userId);
    },
    async list(query: AiUsageEventQuery = {}): Promise<AiUsageEvent[]> {
      return await store.listEvents(query);
    },
    async computeBudgetSnapshot(params: {
      userId: string;
      now: Date;
      userTimeZone: string;
    }): Promise<AiUsageBudgetSnapshot> {
      return await store.computeBudgetSnapshot(params);
    },
    async computeCurrentPeriodTotals(params: {
      userId: string;
      now: Date;
      timeZone: string;
    }): Promise<AiUsageCurrentPeriodTotals> {
      return await store.computeCurrentPeriodTotals(params);
    }
  };
}

export function sumAiUsageEventTokens(events: readonly AiUsageEvent[]): number {
  return events.reduce((total, event) => total + getUsageTokens(event), 0);
}
