import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "@voicepractice/shared";
import { createOrganizationProductSettingsStore } from "./organizationProductSettingsStore.js";

interface Row {
  org_id: string;
  allow_customer_scenario_creation: boolean;
  require_org_admin_scenario_approval: boolean;
  allow_user_admin_focus_topic_management: boolean;
  allow_manager_focus_topic_management: boolean;
  updated_by_admin_session_id: string | null;
  updated_at: Date;
}

function fakePool(options?: { failAudit?: boolean }) {
  const rows = new Map<string, Row>();
  const queries: string[] = [];
  const audits: unknown[][] = [];
  const pool = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push(text);
      if (text.includes("FROM organization_product_settings")) {
        const row = rows.get(String(values?.[0]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unexpected pool query: ${text}`);
    },
    async connect() {
      let snapshot = new Map<string, Row>();
      return {
        async query(text: string, values?: readonly unknown[]) {
          queries.push(text);
          const normalized = text.trim();
          if (normalized === "BEGIN") {
            snapshot = new Map([...rows].map(([key, value]) => [key, { ...value }]));
            return { rows: [], rowCount: 0 };
          }
          if (normalized === "COMMIT") return { rows: [], rowCount: 0 };
          if (normalized === "ROLLBACK") {
            rows.clear();
            for (const [key, value] of snapshot) rows.set(key, value);
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("pg_advisory_xact_lock") || text.includes("CREATE TABLE IF NOT EXISTS")) {
            return { rows: [], rowCount: 0 };
          }
          if (text.includes("INSERT INTO organization_product_settings")) {
            const orgId = String(values?.[0]);
            if (rows.has(orgId)) return { rows: [], rowCount: 0 };
            rows.set(orgId, {
              org_id: orgId,
              allow_customer_scenario_creation: false,
              require_org_admin_scenario_approval: true,
              allow_user_admin_focus_topic_management: false,
              allow_manager_focus_topic_management: false,
              updated_by_admin_session_id: String(values?.[1]),
              updated_at: values?.[2] as Date,
            });
            return { rows: [], rowCount: 1 };
          }
          if (text.includes("FOR UPDATE")) {
            const row = rows.get(String(values?.[0]));
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
          }
          if (text.includes("UPDATE organization_product_settings")) {
            const orgId = String(values?.[0]);
            const row = rows.get(orgId)!;
            if (text.includes("allow_customer_scenario_creation =")) row.allow_customer_scenario_creation = values?.[1] === true;
            if (text.includes("require_org_admin_scenario_approval =")) row.require_org_admin_scenario_approval = values?.[1] === true;
            if (text.includes("allow_user_admin_focus_topic_management =")) row.allow_user_admin_focus_topic_management = values?.[1] === true;
            if (text.includes("allow_manager_focus_topic_management =")) row.allow_manager_focus_topic_management = values?.[1] === true;
            row.updated_by_admin_session_id = String(values?.[2]);
            row.updated_at = values?.[3] as Date;
            return { rows: [{ ...row }], rowCount: 1 };
          }
          if (text.includes("INSERT INTO audit_events")) {
            if (options?.failAudit) throw new Error("audit unavailable");
            audits.push([...(values ?? [])]);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected client query: ${text}`);
        },
        release() {},
      };
    },
  };
  return { pool, rows, queries, audits };
}

function audit(orgId: string, switchKey: string): AuditEvent {
  return {
    id: `audit_${switchKey}`,
    actorType: "platform_admin",
    actorId: "platform_admin",
    action: "organization_product_switch.changed",
    orgId,
    userId: null,
    message: "Changed switch.",
    metadata: { switchKey, adminSessionId: "adm_1" },
    createdAt: "2026-10-06T12:00:00.000Z",
  };
}

test("missing product settings resolve to conservative defaults", async () => {
  const fileStore = createOrganizationProductSettingsStore({
    provider: "file", databaseUrl: null, pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1,
  });
  assert.deepEqual(await fileStore.get("org_1"), {
    orgId: "org_1",
    allowCustomerScenarioCreation: false,
    requireOrgAdminScenarioApproval: true,
    allowUserAdminFocusTopicManagement: false,
    allowManagerFocusTopicManagement: false,
    updatedByAdminSessionId: null,
    updatedAt: null,
  });
});

test("postgres product switch update and governance audit commit together", async () => {
  const fake = fakePool();
  const store = createOrganizationProductSettingsStore({
    provider: "postgres", databaseUrl: "postgres://example.invalid/peritio", pgPoolMax: 1,
    pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1, queryPool: fake.pool as never,
  });
  const change = await store.setSwitch({
    orgId: "org_1", switchKey: "allowCustomerScenarioCreation", enabled: true,
    adminSessionId: "adm_1", updatedAt: new Date("2026-10-06T12:00:00.000Z"),
    auditEvent: audit("org_1", "allowCustomerScenarioCreation"),
  });
  assert.equal(change.previous.allowCustomerScenarioCreation, false);
  assert.equal(change.current.allowCustomerScenarioCreation, true);
  assert.equal(fake.audits.length, 1);
  const metadata = JSON.parse(String(fake.audits[0]?.[7])) as Record<string, unknown>;
  assert.equal(metadata.before, false);
  assert.equal(metadata.after, true);
  assert.ok(fake.queries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS organization_product_settings")));
  const migration = fake.queries.find((query) => query.includes("CREATE TABLE IF NOT EXISTS organization_product_settings")) ?? "";
  assert.match(migration, /allow_customer_scenario_creation BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /require_org_admin_scenario_approval BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /allow_user_admin_focus_topic_management BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /allow_manager_focus_topic_management BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.ok(fake.queries.lastIndexOf("COMMIT") > fake.queries.findIndex((query) => query.includes("INSERT INTO audit_events")));

  const repeated = await store.setSwitch({
    orgId: "org_1", switchKey: "allowCustomerScenarioCreation", enabled: true,
    adminSessionId: "adm_1", updatedAt: new Date("2026-10-06T12:01:00.000Z"),
    auditEvent: { ...audit("org_1", "allowCustomerScenarioCreation"), id: "audit_repeat" },
  });
  assert.equal(repeated.changed, false);
  assert.equal(fake.audits.length, 1);
});

test("postgres store maps every organization product switch to its dedicated SQL column", async () => {
  const fake = fakePool();
  const store = createOrganizationProductSettingsStore({
    provider: "postgres", databaseUrl: "postgres://example.invalid/peritio", pgPoolMax: 1,
    pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1, queryPool: fake.pool as never,
  });
  const changes = [
    ["allowCustomerScenarioCreation", true],
    ["requireOrgAdminScenarioApproval", false],
    ["allowUserAdminFocusTopicManagement", true],
    ["allowManagerFocusTopicManagement", true],
  ] as const;
  for (const [switchKey, enabled] of changes) {
    const result = await store.setSwitch({
      orgId: "org_all", switchKey, enabled, adminSessionId: "adm_1",
      auditEvent: audit("org_all", switchKey),
    });
    assert.equal(result.current[switchKey], enabled, switchKey);
  }
  assert.equal(fake.audits.length, 4);
});

test("failed governance insert rolls product switch state back", async () => {
  const fake = fakePool({ failAudit: true });
  const store = createOrganizationProductSettingsStore({
    provider: "postgres", databaseUrl: "postgres://example.invalid/peritio", pgPoolMax: 1,
    pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1, queryPool: fake.pool as never,
  });
  await assert.rejects(store.setSwitch({
    orgId: "org_1", switchKey: "allowManagerFocusTopicManagement", enabled: true,
    adminSessionId: "adm_1", auditEvent: audit("org_1", "allowManagerFocusTopicManagement"),
  }), /audit unavailable/);
  assert.equal((await store.get("org_1")).allowManagerFocusTopicManagement, false);
  assert.ok(fake.queries.includes("ROLLBACK"));
});
