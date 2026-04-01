import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AiUsageEvent } from "@voicepractice/shared";

import { AI_USAGE_EVENT_RETENTION_DAYS, createAiUsageEventStore } from "./aiUsageEventStore.js";

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

test("file ai usage event store appends, reports correctly, and deletes per user", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-ai-usage-store-"));
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

    await store.appendEvent(
      createEvent({
        id: "evt_user_global",
        userId: "user_a",
        totalTokens: 10,
        createdAt: "2026-03-31T01:00:00.000Z"
      }),
      { now: new Date("2026-03-31T18:00:00.000Z") }
    );
    await store.appendEvent(
      createEvent({
        id: "evt_user_only",
        userId: "user_a",
        totalTokens: 20,
        createdAt: "2026-03-30T23:30:00.000Z"
      }),
      { now: new Date("2026-03-31T18:00:00.000Z") }
    );
    await store.appendEvent(
      createEvent({
        id: "evt_month",
        userId: "user_a",
        totalTokens: 25,
        createdAt: "2026-03-15T14:00:00.000Z"
      }),
      { now: new Date("2026-03-31T18:00:00.000Z") }
    );
    await store.appendEvent(
      createEvent({
        id: "evt_other_user",
        userId: "user_b",
        totalTokens: 30,
        createdAt: "2026-03-31T00:30:00.000Z"
      }),
      { now: new Date("2026-03-31T18:00:00.000Z") }
    );

    const ranged = await store.listEvents({
      userId: "user_a",
      createdAtFrom: new Date("2026-03-31T00:00:00.000Z"),
      createdAtBefore: new Date("2026-04-01T00:00:00.000Z")
    });
    assert.deepEqual(
      ranged.map((event) => event.id),
      ["evt_user_global"]
    );

    const budget = await store.computeBudgetSnapshot({
      userId: "user_a",
      now: new Date("2026-03-31T02:00:00.000Z"),
      userTimeZone: "America/Los_Angeles"
    });
    assert.deepEqual(budget, {
      userCallsToday: 2,
      userTokensToday: 30,
      globalCallsToday: 2,
      globalTokensToday: 40
    });

    const totals = await store.computeCurrentPeriodTotals({
      userId: "user_a",
      now: new Date("2026-03-31T18:00:00.000Z"),
      timeZone: "UTC"
    });
    assert.deepEqual(totals, {
      tokensUsedToday: 10,
      tokensUsedThisMonth: 55
    });

    const deletedCount = await store.deleteEventsForUser("user_b");
    assert.equal(deletedCount, 1);
    const remaining = await store.listEvents();
    assert.deepEqual(
      remaining.map((event) => event.id),
      ["evt_month", "evt_user_only", "evt_user_global"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file ai usage event store imports legacy events and prunes records beyond retention", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-ai-usage-store-"));
  try {
    const store = createAiUsageEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    const now = new Date("2036-03-31T12:00:00.000Z");
    await store.initialize({ now });

    const olderThanRetention = new Date(
      now.getTime() - (AI_USAGE_EVENT_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000
    ).toISOString();
    const withinRetention = new Date(
      now.getTime() - (AI_USAGE_EVENT_RETENTION_DAYS - 2) * 24 * 60 * 60 * 1000
    ).toISOString();

    const migration = await store.importLegacyEvents(
      [
        createEvent({
          id: "evt_pruned",
          createdAt: olderThanRetention
        }),
        createEvent({
          id: "evt_kept",
          createdAt: withinRetention
        })
      ],
      { now }
    );

    assert.equal(migration.importedCount, 1);
    assert.equal(migration.prunedCount, 1);
    const rows = await store.listEvents({}, { now });
    assert.deepEqual(
      rows.map((event) => event.id),
      ["evt_kept"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
