import { Pool, type PoolClient } from "pg";
import { UserProfile } from "@voicepractice/shared";

import { StorageProvider } from "../runtimeConfig.js";
import { assertNoEmployeeIdConflicts, normalizeEmployeeIdForUniqueness } from "../services/employeeIds.js";

type ClaimTransactionClient = Pick<PoolClient, "query">;

export interface UserEmployeeIdClaimStore {
  initialize(): Promise<void>;
  /** Replaces every claim from `users`. Pass the app_state transaction client. */
  syncFromUsers(users: readonly UserProfile[], client?: ClaimTransactionClient | null): Promise<void>;
  /**
   * Takes the claims table lock on the caller's transaction. Lock order for any
   * transaction that writes both: claims table first, then the app_state row.
   */
  lockForAppStateWrite(client: ClaimTransactionClient | null): Promise<void>;
  /**
   * Makes claims match `users` (the authoritative, row-locked app_state users),
   * writing only when they differ. Returns whether claims were rewritten.
   */
  reconcileFromUsers(users: readonly UserProfile[], client: ClaimTransactionClient | null): Promise<boolean>;
}

const LOCK_CLAIMS_SQL = "LOCK TABLE user_employee_id_claims IN SHARE ROW EXCLUSIVE MODE";

interface ClaimRow { userId: string; orgId: string; employeeId: string; normalized: string }

function buildClaimRows(users: readonly UserProfile[]): ClaimRow[] {
  return users
    .map((user) => {
      const normalized = normalizeEmployeeIdForUniqueness(user.employeeId);
      if (user.accountType !== "enterprise" || !user.orgId || !normalized || !user.employeeId) {
        return null;
      }
      return { userId: user.id, orgId: user.orgId, employeeId: user.employeeId, normalized };
    })
    .filter((row): row is ClaimRow => row !== null);
}

function claimRowKey(row: ClaimRow): string {
  return JSON.stringify([row.userId, row.orgId, row.employeeId, row.normalized]);
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

  async lockForAppStateWrite(): Promise<void> {
    // No claims table outside PostgreSQL.
  }

  async reconcileFromUsers(users: readonly UserProfile[]): Promise<boolean> {
    assertNoEmployeeIdConflicts(users);
    return false;
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

  async syncFromUsers(users: readonly UserProfile[], transactionClient?: ClaimTransactionClient | null): Promise<void> {
    assertNoEmployeeIdConflicts(users);
    await this.ensureSchema();
    const rows = buildClaimRows(users);
    await this.inTransaction(transactionClient, async (client) => {
      await client.query(LOCK_CLAIMS_SQL);
      await this.replaceRows(client, rows);
    });
  }

  async lockForAppStateWrite(client: ClaimTransactionClient | null): Promise<void> {
    if (!client) {
      throw new Error("Employee ID claim locking requires the caller's app_state transaction client.");
    }
    await this.ensureSchema();
    await client.query(LOCK_CLAIMS_SQL);
  }

  async reconcileFromUsers(users: readonly UserProfile[], transactionClient: ClaimTransactionClient | null): Promise<boolean> {
    assertNoEmployeeIdConflicts(users);
    await this.ensureSchema();
    const desired = buildClaimRows(users);
    return await this.inTransaction(transactionClient, async (client) => {
      await client.query(LOCK_CLAIMS_SQL);
      const current = await client.query<{ user_id: string; org_id: string; employee_id: string; employee_id_normalized: string }>(
        "SELECT user_id, org_id, employee_id, employee_id_normalized FROM user_employee_id_claims"
      );
      const currentKeys = current.rows
        .map((row) => claimRowKey({ userId: row.user_id, orgId: row.org_id, employeeId: row.employee_id, normalized: row.employee_id_normalized }))
        .sort();
      const desiredKeys = desired.map(claimRowKey).sort();
      if (currentKeys.length === desiredKeys.length && currentKeys.every((key, index) => key === desiredKeys[index])) {
        return false;
      }
      await this.replaceRows(client, desired);
      return true;
    });
  }

  private async replaceRows(client: ClaimTransactionClient, rows: readonly ClaimRow[]): Promise<void> {
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
  }

  private async inTransaction<T>(
    transactionClient: ClaimTransactionClient | null | undefined,
    work: (client: ClaimTransactionClient) => Promise<T>
  ): Promise<T> {
    if (transactionClient) {
      return await work(transactionClient);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
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
