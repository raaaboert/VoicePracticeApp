import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SupportCaseRecord } from "@voicepractice/shared";

import { createSupportCaseStore } from "./supportCaseStore.js";

function createCase(overrides?: Partial<SupportCaseRecord>): SupportCaseRecord {
  return {
    id: `case_${Math.random().toString(16).slice(2)}`,
    status: "open",
    userId: "user_1",
    orgId: "org_a",
    segmentId: "sales_representative",
    scenarioId: "sales_discount_pushback",
    message: "Example support case.",
    transcriptEncrypted: "ciphertext",
    transcriptExpiresAt: "2099-04-01T12:00:00.000Z",
    transcriptFileName: "transcript.txt",
    transcriptMeta: {
      scenarioTitle: "Discount Pushback",
      segmentLabel: "Sales Representative",
      difficulty: "medium",
      personaStyle: "skeptical",
      startedAt: "2099-03-31T11:50:00.000Z",
      endedAt: "2099-03-31T12:00:00.000Z",
      model: "gpt-4o-mini",
      promptVersion: "v1",
      rubricVersion: "v1"
    },
    createdAt: "2099-03-31T12:00:00.000Z",
    updatedAt: "2099-03-31T12:00:00.000Z",
    ...overrides,
  };
}

test("file support case store saves, lists, gets, and clears expired transcripts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-support-case-store-"));
  try {
    const store = createSupportCaseStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize({ now: new Date("2099-03-31T12:00:00.000Z") });

    await store.saveCase(
      createCase({
        id: "case_active",
        createdAt: "2099-03-31T12:00:00.000Z",
        updatedAt: "2099-03-31T12:00:00.000Z",
      }),
      { now: new Date("2099-03-31T12:00:00.000Z") }
    );
    await store.saveCase(
      createCase({
        id: "case_expired",
        transcriptExpiresAt: "2026-03-01T12:00:00.000Z",
        createdAt: "2099-03-30T12:00:00.000Z",
        updatedAt: "2099-03-30T12:00:00.000Z",
      }),
      { now: new Date("2099-03-31T12:00:00.000Z") }
    );

    const rows = await store.listCases({ now: new Date("2099-03-31T12:00:00.000Z") });
    assert.deepEqual(rows.map((entry) => entry.id), ["case_active", "case_expired"]);
    assert.equal(rows[0].transcriptEncrypted, "ciphertext");
    assert.equal(rows[1].transcriptEncrypted, null);
    assert.equal(rows[1].transcriptExpiresAt, null);
    assert.equal(rows[1].transcriptFileName, null);

    const detail = await store.getCaseById("case_expired", { now: new Date("2099-03-31T12:00:00.000Z") });
    assert.ok(detail);
    assert.equal(detail.transcriptEncrypted, null);

    const deletedCount = await store.deleteCasesForUser("user_1");
    assert.equal(deletedCount, 2);
    assert.deepEqual(await store.listCases({ now: new Date("2099-03-31T12:00:00.000Z") }), []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file support case store imports legacy cases without keeping duplicate ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-support-case-store-"));
  try {
    const store = createSupportCaseStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize({ now: new Date("2099-03-31T12:00:00.000Z") });

    const migration = await store.importLegacyCases(
      [
        createCase({
          id: "case_duplicate",
          message: "Older copy",
          updatedAt: "2099-03-30T12:00:00.000Z",
        }),
        createCase({
          id: "case_duplicate",
          message: "Newer copy",
          updatedAt: "2099-03-31T12:00:00.000Z",
        }),
        createCase({
          id: "case_unique",
          userId: "user_2",
          createdAt: "2099-03-29T12:00:00.000Z",
          updatedAt: "2099-03-29T12:00:00.000Z",
        }),
      ],
      { now: new Date("2099-03-31T12:00:00.000Z") }
    );

    assert.equal(migration.importedCount, 3);
    const rows = await store.listCases({ now: new Date("2099-03-31T12:00:00.000Z") });
    assert.equal(rows.length, 2);
    assert.equal(rows.find((entry) => entry.id === "case_duplicate")?.message, "Newer copy");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
