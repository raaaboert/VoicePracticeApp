import { Pool, PoolClient } from "pg";

import {
  AuditEvent,
  ORG_MODULE_KEYS,
  OrgModuleEntitlementState,
  OrgModuleKey,
} from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";
import { initializeTrainingContentSchema } from "./trainingContentMigrations.js";

export interface StoredOrgModuleEntitlement extends OrgModuleEntitlementState {
  orgId: string;
}

export interface OrgModuleEntitlementChange {
  previous: StoredOrgModuleEntitlement;
  current: StoredOrgModuleEntitlement;
  changed: boolean;
}

export interface SetOrgModuleEntitlementInput {
  orgId: string;
  moduleKey: OrgModuleKey;
  enabled: boolean;
  updatedByActorId: string;
  updatedAt?: Date;
  auditEvent?: AuditEvent;
}

export interface OrgModuleEntitlementStore {
  initialize(): Promise<void>;
  getOrgModuleEntitlement(orgId: string, moduleKey: OrgModuleKey): Promise<StoredOrgModuleEntitlement>;
  setOrgModuleEntitlement(input: SetOrgModuleEntitlementInput): Promise<OrgModuleEntitlementChange>;
}

interface CreateOrgModuleEntitlementStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: OrgModuleEntitlementQueryPool;
}

interface OrgModuleEntitlementRow {
  org_id: string;
  module_key: string;
  enabled: boolean;
  updated_by_actor_id: string | null;
  updated_at: string | Date;
}

type OrgModuleEntitlementQueryPool = Pick<Pool, "query" | "connect">;

const ORG_MODULE_KEY_SET = new Set<string>(ORG_MODULE_KEYS);

class NullOrgModuleEntitlementStore implements OrgModuleEntitlementStore {
  async initialize(): Promise<void> {
    // Organization modules are relational and remain disabled for non-postgres providers.
  }

  async getOrgModuleEntitlement(orgId: string, moduleKey: OrgModuleKey): Promise<StoredOrgModuleEntitlement> {
    return buildDisabledEntitlement(normalizeRequiredId(orgId, "Organization id"), normalizeModuleKey(moduleKey));
  }

  async setOrgModuleEntitlement(_input: SetOrgModuleEntitlementInput): Promise<OrgModuleEntitlementChange> {
    throw new Error("Organization module entitlements require postgres storage.");
  }
}

class PostgresOrgModuleEntitlementStore implements OrgModuleEntitlementStore {
  private readonly pool: OrgModuleEntitlementQueryPool;
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: OrgModuleEntitlementQueryPool
  ) {
    this.pool =
      queryPool ??
      new Pool({
        connectionString: databaseUrl,
        max: options.pgPoolMax,
        connectionTimeoutMillis: options.pgConnectTimeoutMs,
        idleTimeoutMillis: options.pgIdleTimeoutMs,
        keepAlive: true,
      });
  }

  async initialize(): Promise<void> {
    if (!this.ensureSchemaPromise) {
      this.ensureSchemaPromise = this.initializeSchema();
    }

    await this.ensureSchemaPromise;
  }

  private async initializeSchema(): Promise<void> {
    await initializeTrainingContentSchema(this.pool);
  }

  async getOrgModuleEntitlement(orgId: string, moduleKey: OrgModuleKey): Promise<StoredOrgModuleEntitlement> {
    await this.initialize();
    const normalizedOrgId = normalizeRequiredId(orgId, "Organization id");
    const normalizedModuleKey = normalizeModuleKey(moduleKey);
    const result = await this.pool.query<OrgModuleEntitlementRow>(
      `
        SELECT org_id, module_key, enabled, updated_by_actor_id, updated_at
        FROM org_module_entitlements
        WHERE org_id = $1 AND module_key = $2
        LIMIT 1
      `,
      [normalizedOrgId, normalizedModuleKey]
    );

    return result.rows[0]
      ? mapEntitlementRow(result.rows[0], normalizedModuleKey)
      : buildDisabledEntitlement(normalizedOrgId, normalizedModuleKey);
  }

  async setOrgModuleEntitlement(input: SetOrgModuleEntitlementInput): Promise<OrgModuleEntitlementChange> {
    await this.initialize();
    const orgId = normalizeRequiredId(input.orgId, "Organization id");
    const moduleKey = normalizeModuleKey(input.moduleKey);
    const actorId = normalizeRequiredId(input.updatedByActorId, "Actor id");
    const updatedAt = input.updatedAt ?? new Date();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `
          INSERT INTO org_module_entitlements (
            org_id,
            module_key,
            enabled,
            updated_by_actor_id,
            updated_at
          )
          VALUES ($1, $2, FALSE, $3, $4)
          ON CONFLICT (org_id, module_key) DO NOTHING
        `,
        [orgId, moduleKey, actorId, updatedAt]
      );
      const existing = await client.query<OrgModuleEntitlementRow>(
        `
          SELECT org_id, module_key, enabled, updated_by_actor_id, updated_at
          FROM org_module_entitlements
          WHERE org_id = $1 AND module_key = $2
          FOR UPDATE
        `,
        [orgId, moduleKey]
      );
      const existingRow = existing.rows[0];
      if (!existingRow) {
        throw new Error("Organization module entitlement row could not be locked.");
      }

      const rowWasInserted = (inserted.rowCount ?? 0) > 0;
      const previous = rowWasInserted
        ? buildDisabledEntitlement(orgId, moduleKey)
        : mapEntitlementRow(existingRow, moduleKey);
      const changed = previous.enabled !== input.enabled;
      let current = mapEntitlementRow(existingRow, moduleKey);

      if (changed) {
        const updated = await client.query<OrgModuleEntitlementRow>(
          `
            UPDATE org_module_entitlements
            SET enabled = $3,
                updated_by_actor_id = $4,
                updated_at = $5
            WHERE org_id = $1 AND module_key = $2
            RETURNING org_id, module_key, enabled, updated_by_actor_id, updated_at
          `,
          [orgId, moduleKey, input.enabled, actorId, updatedAt]
        );
        if (!updated.rows[0]) {
          throw new Error("Organization module entitlement update did not return a row.");
        }
        current = mapEntitlementRow(updated.rows[0], moduleKey);

        if (input.auditEvent) {
          validateAuditEvent(input.auditEvent, orgId);
          await insertAuditEvent(client, {
            ...input.auditEvent,
            metadata: {
              ...(input.auditEvent.metadata ?? {}),
              previousEnabled: previous.enabled,
              newEnabled: current.enabled,
            },
          });
        }
      }

      await client.query("COMMIT");
      return { previous, current, changed };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeRequiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeModuleKey(value: OrgModuleKey): OrgModuleKey {
  const normalized = String(value).trim();
  if (!ORG_MODULE_KEY_SET.has(normalized)) {
    throw new Error("Organization module key is not recognized.");
  }
  return normalized as OrgModuleKey;
}

function buildDisabledEntitlement(orgId: string, moduleKey: OrgModuleKey): StoredOrgModuleEntitlement {
  return {
    orgId,
    moduleKey,
    enabled: false,
    updatedByActorId: null,
    updatedAt: null,
  };
}

function mapEntitlementRow(
  row: OrgModuleEntitlementRow,
  expectedModuleKey: OrgModuleKey
): StoredOrgModuleEntitlement {
  const moduleKey = normalizeModuleKey(row.module_key as OrgModuleKey);
  if (moduleKey !== expectedModuleKey) {
    throw new Error("Organization module entitlement key did not match the requested module.");
  }

  return {
    orgId: row.org_id,
    moduleKey,
    enabled: row.enabled === true,
    updatedByActorId: row.updated_by_actor_id,
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Organization module entitlement timestamp is invalid.");
  }
  return parsed.toISOString();
}

function validateAuditEvent(event: AuditEvent, orgId: string): void {
  if (event.orgId !== orgId) {
    throw new Error("Organization module entitlement audit event must use the same organization.");
  }
}

async function insertAuditEvent(client: Pick<PoolClient, "query">, event: AuditEvent): Promise<void> {
  await client.query(
    `
      INSERT INTO audit_events (
        id,
        actor_type,
        actor_id,
        action,
        org_id,
        user_id,
        message,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      event.id,
      event.actorType,
      event.actorId,
      event.action,
      event.orgId,
      event.userId,
      event.message,
      JSON.stringify(event.metadata),
      event.createdAt,
    ]
  );
}

export function createOrgModuleEntitlementStore(
  params: CreateOrgModuleEntitlementStoreParams
): OrgModuleEntitlementStore {
  if (params.provider !== "postgres") {
    return new NullOrgModuleEntitlementStore();
  }
  if (!params.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
  }

  return new PostgresOrgModuleEntitlementStore(
    params.databaseUrl,
    {
      pgPoolMax: params.pgPoolMax,
      pgConnectTimeoutMs: params.pgConnectTimeoutMs,
      pgIdleTimeoutMs: params.pgIdleTimeoutMs,
    },
    params.queryPool
  );
}
