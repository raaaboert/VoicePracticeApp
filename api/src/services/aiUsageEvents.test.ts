import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AiUsageEvent } from "@voicepractice/shared";

import { createAiUsageEventStore } from "../storage/aiUsageEventStore.js";
import { createAiUsageEventAccess, sumAiUsageEventTokens } from "./aiUsageEvents.js";

function createEvent(overrides?: Partial<AiUsageEvent>): AiUsageEvent {
  return {
    id: `ai_${Math.random().toString(16).slice(2)}`,
    kind: "turn",
    userId: "user_1",
    orgId: "org_1",
    segmentId: "segment_1",
    scenarioId: "scenario_1",
    model: "gpt-test",
    promptVersion: "v1",
    rubricVersion: null,
    inputTokens: 10,
    outputTokens: 15,
    totalTokens: 25,
    createdAt: "2026-03-31T12:00:00.000Z",
    ...overrides
  };
}

test("ai usage access appends, filters by range, and deletes per user", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-ai-usage-access-"));
  try {
    const store = createAiUsageEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize({ now: new Date("2026-04-02T00:00:00.000Z") });

    const access = createAiUsageEventAccess(store);
    await access.append(
      createEvent({
        id: "evt_keep",
        userId: "user_keep",
        createdAt: "2026-03-31T12:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_delete",
        userId: "user_delete",
        createdAt: "2026-04-01T00:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_new",
        userId: "user_keep",
        orgId: "org_2",
        segmentId: "segment_2",
        createdAt: "2026-04-02T00:00:00.000Z"
      })
    );

    const ranged = await access.list({
      userId: "user_keep",
      createdAtFrom: new Date("2026-03-31T00:00:00.000Z"),
      createdAtBefore: new Date("2026-04-02T00:00:00.000Z")
    });
    assert.deepEqual(
      ranged.map((event) => event.id),
      ["evt_keep"]
    );

    const deletedCount = await access.deleteForUser("user_delete");
    assert.equal(deletedCount, 1);
    const remaining = await access.list();
    assert.deepEqual(
      remaining.map((event) => event.id),
      ["evt_keep", "evt_new"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ai usage budget snapshot keeps existing user-timezone and global-day semantics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-ai-usage-access-"));
  try {
    const store = createAiUsageEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize({ now: new Date("2026-03-31T12:00:00.000Z") });

    const access = createAiUsageEventAccess(store);
    await access.append(
      createEvent({
        id: "evt_user_global",
        userId: "user_a",
        totalTokens: 10,
        createdAt: "2026-03-31T01:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_user_only",
        userId: "user_a",
        totalTokens: 20,
        createdAt: "2026-03-30T23:30:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_global_other_user",
        userId: "user_b",
        totalTokens: 30,
        createdAt: "2026-03-31T00:30:00.000Z"
      })
    );

    const snapshot = await access.computeBudgetSnapshot({
      userId: "user_a",
      now: new Date("2026-03-31T02:00:00.000Z"),
      userTimeZone: "America/Los_Angeles"
    });

    assert.deepEqual(snapshot, {
      userCallsToday: 2,
      userTokensToday: 30,
      globalCallsToday: 2,
      globalTokensToday: 40
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ai usage current-period totals and token sums preserve reporting semantics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-ai-usage-access-"));
  try {
    const store = createAiUsageEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize({ now: new Date("2026-03-31T18:00:00.000Z") });

    const access = createAiUsageEventAccess(store);
    await access.append(
      createEvent({
        id: "evt_day",
        userId: "user_a",
        totalTokens: 15,
        createdAt: "2026-03-31T14:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_month",
        userId: "user_a",
        totalTokens: 25,
        createdAt: "2026-03-15T14:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_previous_month",
        userId: "user_a",
        totalTokens: 40,
        createdAt: "2026-02-28T14:00:00.000Z"
      })
    );
    await access.append(
      createEvent({
        id: "evt_other_user",
        userId: "user_b",
        totalTokens: 50,
        createdAt: "2026-03-31T09:00:00.000Z"
      })
    );

    const totals = await access.computeCurrentPeriodTotals({
      userId: "user_a",
      now: new Date("2026-03-31T18:00:00.000Z"),
      timeZone: "UTC"
    });
    assert.deepEqual(totals, {
      tokensUsedToday: 15,
      tokensUsedThisMonth: 40
    });

    const filtered = await access.list({
      createdAtFrom: new Date("2026-03-01T00:00:00.000Z"),
      createdAtBefore: new Date("2026-04-01T00:00:00.000Z")
    });
    assert.equal(sumAiUsageEventTokens(filtered), 90);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
