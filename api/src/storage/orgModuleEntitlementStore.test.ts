import assert from "node:assert/strict";
import test from "node:test";

import { AuditEvent } from "@voicepractice/shared";

import { createOrgModuleEntitlementStore } from "./orgModuleEntitlementStore.js";

interface FakeRow {
  org_id: string;
  module_key: string;
  enabled: boolean;
  updated_by_actor_id: string | null;
  updated_at: Date;
}

function createStatefulQueryPool() {
  const rows = new Map<string, FakeRow>();
  const schemaQueries: string[] = [];
  const auditEvents: Array<{ values: readonly unknown[] }> = [];
  const transactionQueries: string[] = [];
  let lockTail = Promise.resolve();

  const keyFor = (orgId: unknown, moduleKey: unknown) => `${String(orgId)}:${String(moduleKey)}`;

  return {
    rows,
    schemaQueries,
    auditEvents,
    transactionQueries,
    pool: {
      async query(text: string, values?: readonly unknown[]) {
        if (text.includes("CREATE TABLE IF NOT EXISTS org_module_entitlements")) {
          schemaQueries.push(text);
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("FROM org_module_entitlements")) {
          const row = rows.get(keyFor(values?.[0], values?.[1]));
          return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        throw new Error(`Unexpected pool query: ${text}`);
      },
      async connect() {
        let releaseLock: (() => void) | null = null;
        return {
          async query(text: string, values?: readonly unknown[]) {
            const normalized = text.trim();
            transactionQueries.push(normalized);
            if (normalized === "BEGIN" || normalized === "ROLLBACK") {
              if (normalized === "ROLLBACK") {
                releaseLock?.();
                releaseLock = null;
              }
              return { rows: [], rowCount: 0 };
            }
            if (normalized === "COMMIT") {
              releaseLock?.();
              releaseLock = null;
              return { rows: [], rowCount: 0 };
            }
            if (text.includes("pg_advisory_xact_lock")) {
              return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
            }
            if (
              text.includes("CREATE TABLE IF NOT EXISTS org_module_entitlements")
              || text.includes("ALTER TABLE org_content_assets")
              || text.includes("CREATE TABLE IF NOT EXISTS org_content_categories")
            ) {
              schemaQueries.push(text);
              return { rows: [], rowCount: 0 };
            }
            if (text.includes("INSERT INTO org_module_entitlements")) {
              const waitFor = lockTail;
              lockTail = new Promise<void>((resolve) => {
                releaseLock = resolve;
              });
              await waitFor;
              const key = keyFor(values?.[0], values?.[1]);
              if (rows.has(key)) {
                return { rows: [], rowCount: 0 };
              }
              rows.set(key, {
                org_id: String(values?.[0]),
                module_key: String(values?.[1]),
                enabled: false,
                updated_by_actor_id: String(values?.[2]),
                updated_at: values?.[3] as Date,
              });
              return { rows: [], rowCount: 1 };
            }
            if (text.includes("FOR UPDATE")) {
              const row = rows.get(keyFor(values?.[0], values?.[1]));
              return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (text.includes("UPDATE org_module_entitlements")) {
              const key = keyFor(values?.[0], values?.[1]);
              const row: FakeRow = {
                org_id: String(values?.[0]),
                module_key: String(values?.[1]),
                enabled: values?.[2] === true,
                updated_by_actor_id: String(values?.[3]),
                updated_at: values?.[4] as Date,
              };
              rows.set(key, row);
              return { rows: [{ ...row }], rowCount: 1 };
            }
            if (text.includes("INSERT INTO audit_events")) {
              auditEvents.push({ values: values ?? [] });
              return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected transaction query: ${text}`);
          },
          release() {
            releaseLock?.();
            releaseLock = null;
          },
        };
      },
    },
  };
}

function buildAuditEvent(id: string, orgId: string, enabled: boolean): AuditEvent {
  return {
    id,
    actorType: "platform_admin",
    actorId: "platform_admin",
    action: "org_module_entitlement_changed",
    orgId,
    userId: null,
    message: "Changed an organization module entitlement.",
    metadata: {
      moduleKey: "training_content",
      requestedEnabled: enabled,
    },
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}

test("missing and non-postgres organization module entitlements fail closed", async () => {
  const store = createOrgModuleEntitlementStore({
    provider: "file",
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
  });

  assert.deepEqual(await store.getOrgModuleEntitlement("org_1", "training_content"), {
    orgId: "org_1",
    moduleKey: "training_content",
    enabled: false,
    updatedByActorId: null,
    updatedAt: null,
  });
  await assert.rejects(
    store.setOrgModuleEntitlement({
      orgId: "org_1",
      moduleKey: "training_content",
      enabled: true,
      updatedByActorId: "platform_admin",
    }),
    /require postgres storage/
  );
});

test("postgres module store initializes idempotently and preserves tenant-scoped explicit state", async () => {
  const fake = createStatefulQueryPool();
  fake.rows.set("org_1:other_module", {
    org_id: "org_1",
    module_key: "other_module",
    enabled: true,
    updated_by_actor_id: "platform_admin",
    updated_at: new Date("2026-07-28T10:00:00.000Z"),
  });
  const store = createOrgModuleEntitlementStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: fake.pool as any,
  });

  await store.initialize();
  await store.initialize();
  assert.equal(fake.schemaQueries.length, 4);
  assert.match(fake.schemaQueries.join("\n"), /PRIMARY KEY \(org_id, module_key\)/);
  assert.match(fake.schemaQueries.join("\n"), /org_content_assets_ready_state_check/);
  assert.match(fake.schemaQueries.join("\n"), /org_content_items_category_fkey/);
  assert.match(fake.schemaQueries.join("\n"), /processing_lease_token/);
  assert.ok(fake.transactionQueries.some((query) => query.includes("pg_advisory_xact_lock")));
  assert.equal((await store.getOrgModuleEntitlement("org_1", "training_content")).enabled, false);

  const explicitFalse = await store.setOrgModuleEntitlement({
    orgId: "org_1",
    moduleKey: "training_content",
    enabled: false,
    updatedByActorId: "platform_admin",
    updatedAt: new Date("2026-07-28T11:00:00.000Z"),
    auditEvent: buildAuditEvent("audit_false", "org_1", false),
  });
  assert.equal(explicitFalse.changed, false);
  assert.equal(fake.auditEvents.length, 0);

  const enabled = await store.setOrgModuleEntitlement({
    orgId: "org_1",
    moduleKey: "training_content",
    enabled: true,
    updatedByActorId: "platform_admin",
    updatedAt: new Date("2026-07-28T12:00:00.000Z"),
    auditEvent: buildAuditEvent("audit_enable", "org_1", true),
  });
  assert.equal(enabled.previous.enabled, false);
  assert.equal(enabled.current.enabled, true);
  assert.equal((await store.getOrgModuleEntitlement("org_1", "training_content")).enabled, true);
  assert.equal((await store.getOrgModuleEntitlement("org_2", "training_content")).enabled, false);
  assert.equal(fake.auditEvents.length, 1);
  const auditMetadata = JSON.parse(String(fake.auditEvents[0]?.values[7])) as Record<string, unknown>;
  assert.equal(auditMetadata.previousEnabled, false);
  assert.equal(auditMetadata.newEnabled, true);
  assert.ok(fake.transactionQueries.some((query) => query.includes("FOR UPDATE")));
});

test("concurrent entitlement writes serialize to a coherent final state with matching audits", async () => {
  const fake = createStatefulQueryPool();
  const store = createOrgModuleEntitlementStore({
    provider: "postgres",
    databaseUrl: "postgres://example.invalid/peritio",
    pgPoolMax: 2,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: fake.pool as any,
  });

  const [enabled, disabled] = await Promise.all([
    store.setOrgModuleEntitlement({
      orgId: "org_concurrent",
      moduleKey: "training_content",
      enabled: true,
      updatedByActorId: "actor_1",
      updatedAt: new Date("2026-07-28T12:00:00.000Z"),
      auditEvent: buildAuditEvent("audit_concurrent_enable", "org_concurrent", true),
    }),
    store.setOrgModuleEntitlement({
      orgId: "org_concurrent",
      moduleKey: "training_content",
      enabled: false,
      updatedByActorId: "actor_2",
      updatedAt: new Date("2026-07-28T12:00:01.000Z"),
      auditEvent: buildAuditEvent("audit_concurrent_disable", "org_concurrent", false),
    }),
  ]);

  assert.equal(enabled.current.enabled, true);
  assert.equal(disabled.previous.enabled, true);
  assert.equal(disabled.current.enabled, false);
  assert.equal((await store.getOrgModuleEntitlement("org_concurrent", "training_content")).enabled, false);
  assert.equal(fake.auditEvents.length, 2);
});
