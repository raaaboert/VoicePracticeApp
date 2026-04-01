import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AuditEvent } from "@voicepractice/shared";

import { createAuditEventStore } from "./auditEventStore.js";

function createEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    id: `audit_${Math.random().toString(16).slice(2)}`,
    actorType: "platform_admin",
    actorId: "platform_admin",
    action: "user.updated",
    orgId: "org_a",
    userId: "user_1",
    message: "Updated user.",
    metadata: { ok: true },
    createdAt: "2026-03-31T12:00:00.000Z",
    ...overrides,
  };
}

test("file audit event store appends, filters, and preserves web_user events", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-audit-store-"));
  try {
    const store = createAuditEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize();

    await store.appendEvents([
      createEvent({
        id: "audit_platform",
        actorType: "platform_admin",
        actorId: "platform_admin",
        createdAt: "2026-03-29T12:00:00.000Z",
      }),
      createEvent({
        id: "audit_web",
        actorType: "web_user",
        actorId: "user_web",
        action: "web_auth.session_created",
        orgId: "org_b",
        userId: "user_web",
        createdAt: "2026-03-30T12:00:00.000Z",
      }),
      createEvent({
        id: "audit_mobile",
        actorType: "mobile_user",
        actorId: "user_mobile",
        action: "simulation.completed",
        orgId: "org_b",
        userId: "user_mobile",
        createdAt: "2026-03-31T12:00:00.000Z",
      }),
    ], { maxRecords: 20_000 });

    const webRows = await store.listEvents({
      actorType: "web_user",
      from: new Date("2026-03-01T00:00:00.000Z"),
      to: new Date("2026-04-01T00:00:00.000Z"),
      limit: 10,
    });
    assert.equal(webRows.length, 1);
    assert.equal(webRows[0].id, "audit_web");

    const orgRows = await store.listEvents({
      orgId: "org_b",
      limit: 10,
    });
    assert.deepEqual(
      orgRows.map((entry) => entry.id),
      ["audit_mobile", "audit_web"]
    );

    const actionRows = await store.listEvents({
      action: "simulation.completed",
      limit: 10,
    });
    assert.equal(actionRows.length, 1);
    assert.equal(actionRows[0].actorType, "mobile_user");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file audit event store imports legacy events and trims oldest records beyond max", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-audit-store-"));
  try {
    const store = createAuditEventStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize();

    const migration = await store.importLegacyEvents([
      createEvent({ id: "audit_old", createdAt: "2026-03-29T12:00:00.000Z" }),
      createEvent({ id: "audit_mid", createdAt: "2026-03-30T12:00:00.000Z" }),
      createEvent({ id: "audit_new", createdAt: "2026-03-31T12:00:00.000Z" }),
    ], { maxRecords: 2 });

    assert.equal(migration.importedCount, 3);
    assert.equal(migration.trimmedCount, 1);

    const rows = await store.listEvents({ limit: 10 });
    assert.deepEqual(
      rows.map((entry) => entry.id),
      ["audit_new", "audit_mid"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
