import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type {
  AuditEvent,
  OrganizationProductSettings,
  OrganizationProductSwitchKey,
} from "@voicepractice/shared";
import { ORGANIZATION_PRODUCT_SWITCH_KEYS } from "@voicepractice/shared";
import type { StorageProvider } from "../runtimeConfig.js";

export interface StoredOrganizationProductSettings extends OrganizationProductSettings {
  orgId: string;
  updatedByAdminSessionId: string | null;
}

export interface OrganizationProductSwitchChange {
  previous: StoredOrganizationProductSettings;
  current: StoredOrganizationProductSettings;
  switchKey: OrganizationProductSwitchKey;
  changed: boolean;
}

export interface OrganizationProductSettingsStore {
  initialize(): Promise<void>;
  get(orgId: string): Promise<StoredOrganizationProductSettings>;
  setSwitch(input: {
    orgId: string;
    switchKey: OrganizationProductSwitchKey;
    enabled: boolean;
    adminSessionId: string;
    updatedAt?: Date;
    auditEvent: AuditEvent;
  }): Promise<OrganizationProductSwitchChange>;
}

type QueryPool = Pick<Pool, "query" | "connect">;

interface SettingsRow {
  org_id: string;
  allow_customer_scenario_creation: boolean;
  require_org_admin_scenario_approval: boolean;
  allow_user_admin_focus_topic_management: boolean;
  allow_manager_focus_topic_management: boolean;
  updated_by_admin_session_id: string | null;
  updated_at: string | Date;
}

const SWITCH_COLUMNS: Record<OrganizationProductSwitchKey, keyof SettingsRow> = {
  allowCustomerScenarioCreation: "allow_customer_scenario_creation",
  requireOrgAdminScenarioApproval: "require_org_admin_scenario_approval",
  allowUserAdminFocusTopicManagement: "allow_user_admin_focus_topic_management",
  allowManagerFocusTopicManagement: "allow_manager_focus_topic_management",
};
const SWITCH_KEY_SET = new Set<string>(ORGANIZATION_PRODUCT_SWITCH_KEYS);
const SELECT_COLUMNS = `
  org_id,
  allow_customer_scenario_creation,
  require_org_admin_scenario_approval,
  allow_user_admin_focus_topic_management,
  allow_manager_focus_topic_management,
  updated_by_admin_session_id,
  updated_at`;

class NullOrganizationProductSettingsStore implements OrganizationProductSettingsStore {
  async initialize(): Promise<void> {}
  async get(orgId: string): Promise<StoredOrganizationProductSettings> {
    return defaults(normalizeId(orgId, "Organization id"));
  }
  async setSwitch(): Promise<OrganizationProductSwitchChange> {
    throw new Error("Organization product settings require postgres storage.");
  }
}

class PostgresOrganizationProductSettingsStore implements OrganizationProductSettingsStore {
  private initialized: Promise<void> | null = null;
  constructor(private readonly pool: QueryPool) {}

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = initializeSchema(this.pool);
    }
    await this.initialized;
  }

  async get(orgId: string): Promise<StoredOrganizationProductSettings> {
    await this.initialize();
    const normalizedOrgId = normalizeId(orgId, "Organization id");
    const result = await this.pool.query<SettingsRow>(
      `SELECT ${SELECT_COLUMNS} FROM organization_product_settings WHERE org_id = $1 LIMIT 1`,
      [normalizedOrgId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : defaults(normalizedOrgId);
  }

  async setSwitch(input: {
    orgId: string;
    switchKey: OrganizationProductSwitchKey;
    enabled: boolean;
    adminSessionId: string;
    updatedAt?: Date;
    auditEvent: AuditEvent;
  }): Promise<OrganizationProductSwitchChange> {
    await this.initialize();
    const orgId = normalizeId(input.orgId, "Organization id");
    const sessionId = normalizeId(input.adminSessionId, "Admin session id");
    const switchKey = normalizeSwitchKey(input.switchKey);
    validateAudit(input.auditEvent, orgId, switchKey);
    const updatedAt = input.updatedAt ?? new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO organization_product_settings (org_id, updated_by_admin_session_id, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id) DO NOTHING`,
        [orgId, sessionId, updatedAt],
      );
      const locked = await client.query<SettingsRow>(
        `SELECT ${SELECT_COLUMNS} FROM organization_product_settings WHERE org_id = $1 FOR UPDATE`,
        [orgId],
      );
      if (!locked.rows[0]) {
        throw new Error("Organization product settings row could not be locked.");
      }
      const previous = mapRow(locked.rows[0]);
      const changed = previous[switchKey] !== input.enabled;
      let current = previous;
      if (changed) {
        const column = SWITCH_COLUMNS[switchKey];
        const updated = await client.query<SettingsRow>(
          `UPDATE organization_product_settings
           SET ${column} = $2, updated_by_admin_session_id = $3, updated_at = $4
           WHERE org_id = $1
           RETURNING ${SELECT_COLUMNS}`,
          [orgId, input.enabled, sessionId, updatedAt],
        );
        if (!updated.rows[0]) {
          throw new Error("Organization product settings update did not return a row.");
        }
        current = mapRow(updated.rows[0]);
        await insertAudit(client, {
          ...input.auditEvent,
          metadata: {
            ...(input.auditEvent.metadata ?? {}),
            switchKey,
            before: previous[switchKey],
            after: current[switchKey],
          },
        });
      }
      await client.query("COMMIT");
      return { previous, current, switchKey, changed };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaults(orgId: string): StoredOrganizationProductSettings {
  return {
    orgId,
    allowCustomerScenarioCreation: false,
    requireOrgAdminScenarioApproval: true,
    allowUserAdminFocusTopicManagement: false,
    allowManagerFocusTopicManagement: false,
    updatedByAdminSessionId: null,
    updatedAt: null,
  };
}

function mapRow(row: SettingsRow): StoredOrganizationProductSettings {
  const parsed = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Organization product settings timestamp is invalid.");
  }
  return {
    orgId: row.org_id,
    allowCustomerScenarioCreation: row.allow_customer_scenario_creation === true,
    requireOrgAdminScenarioApproval: row.require_org_admin_scenario_approval === true,
    allowUserAdminFocusTopicManagement: row.allow_user_admin_focus_topic_management === true,
    allowManagerFocusTopicManagement: row.allow_manager_focus_topic_management === true,
    updatedByAdminSessionId: row.updated_by_admin_session_id,
    updatedAt: parsed.toISOString(),
  };
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeSwitchKey(value: OrganizationProductSwitchKey): OrganizationProductSwitchKey {
  if (!SWITCH_KEY_SET.has(value)) throw new Error("Organization product switch is not recognized.");
  return value;
}

function validateAudit(event: AuditEvent, orgId: string, switchKey: OrganizationProductSwitchKey): void {
  if (event.actorType !== "platform_admin" || event.orgId !== orgId) {
    throw new Error("Product switch audit must identify the platform administrator and organization.");
  }
  if (event.metadata?.switchKey !== switchKey) {
    throw new Error("Product switch audit must identify the same switch.");
  }
}

async function insertAudit(client: Pick<PoolClient, "query">, event: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       id, actor_type, actor_id, action, org_id, user_id, message, metadata, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
    [event.id, event.actorType, event.actorId, event.action, event.orgId, event.userId,
      event.message, JSON.stringify(event.metadata), event.createdAt],
  );
}

async function readMigration(): Promise<string> {
  const candidates = [
    new URL("../../sql/014_organization_product_settings.sql", import.meta.url),
    new URL("../sql/014_organization_product_settings.sql", import.meta.url),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw new Error("Organization product settings migration is missing from the runtime artifact.", { cause: lastError });
}

async function initializeSchema(pool: Pick<Pool, "connect">): Promise<void> {
  const sql = await readMigration();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('peritio_org_product_settings_v1', 0))");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function createOrganizationProductSettingsStore(params: {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: QueryPool;
}): OrganizationProductSettingsStore {
  if (params.provider !== "postgres") return new NullOrganizationProductSettingsStore();
  if (!params.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  const pool = params.queryPool ?? new Pool({
    connectionString: params.databaseUrl,
    max: params.pgPoolMax,
    connectionTimeoutMillis: params.pgConnectTimeoutMs,
    idleTimeoutMillis: params.pgIdleTimeoutMs,
    keepAlive: true,
  });
  return new PostgresOrganizationProductSettingsStore(pool);
}
