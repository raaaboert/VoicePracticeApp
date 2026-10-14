import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    assert.equal(rows[1].transcriptMeta, null);

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

test("file expiration persists at the boundary without reads, preserves case metadata, and is repeatable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-support-expiration-"));
  try {
    const params = { provider: "file" as const, dbPath: path.join(tempDir, "db.json"), databaseUrl: null,
      pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 1000 };
    const store = createSupportCaseStore(params);
    const before = new Date("2099-04-01T11:59:59.000Z");
    const boundary = new Date("2099-04-01T12:00:00.000Z");
    const expired = createCase({ id: "expired" });
    const live = createCase({ id: "live", transcriptExpiresAt: "2099-04-01T12:00:00.001Z" });
    const metadataOnly = createCase({ id: "metadata_only", transcriptEncrypted: null });
    for (const record of [expired, live, metadataOnly]) await store.saveCase(record, { now: before });
    const file = path.join(tempDir, "db.support-cases.json");
    await store.purgeExpiredTranscripts(boundary);
    const raw = await readFile(file, "utf8");
    const cases = (JSON.parse(raw) as { cases: SupportCaseRecord[] }).cases;
    for (const record of [expired, metadataOnly]) {
      assert.deepEqual(cases.find((entry) => entry.id === record.id), {
        ...record, transcriptEncrypted: null, transcriptExpiresAt: null, transcriptFileName: null, transcriptMeta: null,
      });
    }
    assert.deepEqual(cases.find((entry) => entry.id === live.id), live);
    await store.purgeExpiredTranscripts(boundary);
    assert.equal(await readFile(file, "utf8"), raw);
    // Startup and on-access cleanup still physically persist expiration.
    await createSupportCaseStore(params).initialize({ now: new Date(boundary.getTime() + 1) });
    const startupCases = (JSON.parse(await readFile(file, "utf8")) as { cases: SupportCaseRecord[] }).cases;
    assert.equal(startupCases.find((entry) => entry.id === live.id)?.transcriptMeta, null);
    await store.saveCase(expired, { now: before });
    assert.equal((await store.getCaseById(expired.id, { now: boundary }))?.transcriptEncrypted, null);
    assert.equal((JSON.parse(await readFile(file, "utf8")) as { cases: SupportCaseRecord[] }).cases
      .find((entry) => entry.id === expired.id)?.transcriptEncrypted, null);
  } finally { await rm(tempDir, { recursive: true, force: true }); }
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
