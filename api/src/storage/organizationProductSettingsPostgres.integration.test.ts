import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { AuditEvent, OrganizationProductSwitchKey } from "@voicepractice/shared";
import { Pool } from "pg";
import { createOrganizationProductSettingsStore } from "./organizationProductSettingsStore.js";

const databaseUrl = process.env.ORGANIZATION_PRODUCT_SETTINGS_INTEGRATION_DATABASE_URL?.trim() || "";
const allowNonLocal = process.env.ORGANIZATION_PRODUCT_SETTINGS_ALLOW_NON_LOCAL_INTEGRATION_TESTS === "true";

function assertSafeIntegrationDatabase(url: string): void {
  const normalized = url.toLowerCase();
  if (normalized.includes("peritio-db-prod") || normalized.includes("peritio_db_prod")) {
    throw new Error("Organization product-settings integration tests refuse production databases.");
  }
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (!/(test|integration|throwaway)/.test(databaseName)) {
    throw new Error("Organization product-settings integration tests require an explicitly named test database.");
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  if (!isLocal && !allowNonLocal) {
    throw new Error(
      "Use a local throwaway PostgreSQL database or explicitly set ORGANIZATION_PRODUCT_SETTINGS_ALLOW_NON_LOCAL_INTEGRATION_TESTS=true.",
    );
  }
}

function scopedDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

function audit(id: string, switchKey: OrganizationProductSwitchKey): AuditEvent {
  return {
    id,
    actorType: "platform_admin",
    actorId: "platform_admin",
    action: "organization_product_switch.changed",
    orgId: "org_integration",
    userId: null,
    message: "Changed an organization product switch.",
    metadata: { switchKey, adminSessionId: "admin_session_integration" },
    createdAt: "2026-10-06T12:00:00.000Z",
  };
}

test(
  "real PostgreSQL applies product-settings migration and commits state with governance atomically",
  { skip: !databaseUrl },
  async () => {
    assertSafeIntegrationDatabase(databaseUrl);
    const setupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const schema = `org_product_settings_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schema}"`;
    let scopedPool: Pool | null = null;
    try {
      await setupPool.query(`CREATE SCHEMA ${quotedSchema}`);
      const scopedUrl = scopedDatabaseUrl(databaseUrl, schema);
      scopedPool = new Pool({
        connectionString: scopedUrl,
        max: 2,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 10_000,
      });
      await scopedPool.query(`
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          actor_type TEXT NOT NULL,
          actor_id TEXT NULL,
          action TEXT NOT NULL,
          org_id TEXT NULL,
          user_id TEXT NULL,
          message TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
      const store = createOrganizationProductSettingsStore({
        provider: "postgres",
        databaseUrl: scopedUrl,
        pgPoolMax: 2,
        pgConnectTimeoutMs: 15_000,
        pgIdleTimeoutMs: 10_000,
        queryPool: scopedPool,
      });
      await store.initialize();

      const defaults = await store.get("org_integration");
      assert.equal(defaults.allowCustomerScenarioCreation, false);
      assert.equal(defaults.requireOrgAdminScenarioApproval, true);
      assert.equal(defaults.allowUserAdminFocusTopicManagement, false);
      assert.equal(defaults.allowManagerFocusTopicManagement, false);

      const success = await store.setSwitch({
        orgId: "org_integration",
        switchKey: "allowCustomerScenarioCreation",
        enabled: true,
        adminSessionId: "admin_session_integration",
        auditEvent: audit("audit_product_settings_success", "allowCustomerScenarioCreation"),
      });
      assert.equal(success.changed, true);
      const persisted = await scopedPool.query<{
        allow_customer_scenario_creation: boolean;
        updated_by_admin_session_id: string | null;
      }>(
        "SELECT allow_customer_scenario_creation, updated_by_admin_session_id FROM organization_product_settings WHERE org_id = $1",
        ["org_integration"],
      );
      assert.equal(persisted.rows[0]?.allow_customer_scenario_creation, true);
      assert.equal(persisted.rows[0]?.updated_by_admin_session_id, "admin_session_integration");
      const committedAudit = await scopedPool.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_events WHERE id = $1",
        ["audit_product_settings_success"],
      );
      assert.deepEqual(committedAudit.rows[0]?.metadata, {
        switchKey: "allowCustomerScenarioCreation",
        adminSessionId: "admin_session_integration",
        before: false,
        after: true,
      });

      const repeated = await store.setSwitch({
        orgId: "org_integration",
        switchKey: "allowCustomerScenarioCreation",
        enabled: true,
        adminSessionId: "admin_session_integration",
        auditEvent: audit("audit_product_settings_repeat", "allowCustomerScenarioCreation"),
      });
      assert.equal(repeated.changed, false);
      assert.equal((await scopedPool.query("SELECT 1 FROM audit_events")).rowCount, 1);

      await assert.rejects(store.setSwitch({
        orgId: "org_integration",
        switchKey: "allowManagerFocusTopicManagement",
        enabled: true,
        adminSessionId: "admin_session_integration",
        auditEvent: audit("audit_product_settings_success", "allowManagerFocusTopicManagement"),
      }));
      const afterRollback = await store.get("org_integration");
      assert.equal(afterRollback.allowManagerFocusTopicManagement, false);
      assert.equal((await scopedPool.query("SELECT 1 FROM audit_events")).rowCount, 1);
    } finally {
      if (scopedPool) await scopedPool.end();
      await setupPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      await setupPool.end();
    }
  },
);
