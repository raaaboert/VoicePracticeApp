import { Pool } from "pg";
import { UserProfile } from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";
import { assertNoEmployeeIdConflicts, normalizeEmployeeIdForUniqueness } from "../services/employeeIds.js";

export interface UserEmployeeIdClaimStore {
  initialize(): Promise<void>;
  syncFromUsers(users: readonly UserProfile[]): Promise<void>;
}

interface CreateUserEmployeeIdClaimStoreParams {
  provider: StorageProvider;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  queryPool?: UserEmployeeIdClaimQueryPool;
}

type UserEmployeeIdClaimQueryPool = Pick<Pool, "query" | "connect">;

class NullUserEmployeeIdClaimStore implements UserEmployeeIdClaimStore {
  async initialize(): Promise<void> {
    // File/test storage enforces uniqueness in application code.
  }

  async syncFromUsers(users: readonly UserProfile[]): Promise<void> {
    assertNoEmployeeIdConflicts(users);
  }
}

class PostgresUserEmployeeIdClaimStore implements UserEmployeeIdClaimStore {
  private readonly pool: UserEmployeeIdClaimQueryPool;
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    queryPool?: UserEmployeeIdClaimQueryPool
  ) {
    this.pool =
      queryPool ??
      new Pool({
        connectionString: databaseUrl,
        max: options.pgPoolMax,
        connectionTimeoutMillis: options.pgConnectTimeoutMs,
        idleTimeoutMillis: options.pgIdleTimeoutMs,
        keepAlive: true
      });
  }

  async initialize(): Promise<void> {
    await this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ensureSchemaPromise) {
      this.ensureSchemaPromise = this.pool.query(
        `
          CREATE TABLE IF NOT EXISTS user_employee_id_claims (
            user_id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            employee_id TEXT NOT NULL,
            employee_id_normalized TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS user_employee_id_claims_org_employee_id_unique_idx
            ON user_employee_id_claims (org_id, employee_id_normalized)
            WHERE employee_id_normalized IS NOT NULL;

          CREATE INDEX IF NOT EXISTS user_employee_id_claims_org_idx
            ON user_employee_id_claims (org_id);
        `
      ).then(() => undefined);
    }

    await this.ensureSchemaPromise;
  }

  async syncFromUsers(users: readonly UserProfile[]): Promise<void> {
    assertNoEmployeeIdConflicts(users);
    await this.ensureSchema();

    const rows = users
      .map((user) => {
        const normalized = normalizeEmployeeIdForUniqueness(user.employeeId);
        if (user.accountType !== "enterprise" || !user.orgId || !normalized || !user.employeeId) {
          return null;
        }
        return {
          userId: user.id,
          orgId: user.orgId,
          employeeId: user.employeeId,
          normalized
        };
      })
      .filter((row): row is { userId: string; orgId: string; employeeId: string; normalized: string } => row !== null);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE user_employee_id_claims IN SHARE ROW EXCLUSIVE MODE");
      await client.query("DELETE FROM user_employee_id_claims");
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO user_employee_id_claims
              (user_id, org_id, employee_id, employee_id_normalized, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
          `,
          [row.userId, row.orgId, row.employeeId, row.normalized]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createUserEmployeeIdClaimStore(params: CreateUserEmployeeIdClaimStoreParams): UserEmployeeIdClaimStore {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresUserEmployeeIdClaimStore(
      params.databaseUrl,
      {
        pgPoolMax: params.pgPoolMax,
        pgConnectTimeoutMs: params.pgConnectTimeoutMs,
        pgIdleTimeoutMs: params.pgIdleTimeoutMs
      },
      params.queryPool
    );
  }

  return new NullUserEmployeeIdClaimStore();
}
