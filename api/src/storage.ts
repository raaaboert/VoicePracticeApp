import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ApiDatabase } from "@voicepractice/shared";
import { StorageProvider } from "./runtimeConfig.js";

export type LockedAppStateUpdate<T> =
  | { result: T; shouldSave: false }
  | { result: T; shouldSave: true; state: ApiDatabase };

export type AppStateTransactionClient = Pick<PoolClient, "query">;
/**
 * Receives the stored document and the transaction client that holds its row
 * lock (null for file storage). Any related write the handler makes must use
 * this client so it commits or rolls back with the app_state update and never
 * waits on a second connection while this row lock is held.
 */
export type LockedAppStateUpdateHandler<T> = (
  raw: unknown,
  client: AppStateTransactionClient | null
) => LockedAppStateUpdate<T> | Promise<LockedAppStateUpdate<T>>;

export interface LockedAppStateUpdateOptions {
  /**
   * Runs inside the transaction before the app_state row lock is taken. Use it
   * to take locks that other app_state writers take before the row (the
   * employee-ID claims table), so every writer acquires locks in one order.
   */
  lockBeforeRow?: (client: AppStateTransactionClient | null) => Promise<void>;
}

/**
 * Opaque row-version token for the PostgreSQL app_state document (the row's
 * `xmin`, as text). PostgreSQL assigns a new xmin on every committed UPDATE,
 * so a token read with a snapshot identifies exactly that committed version.
 * File storage has no versions and always reports null.
 */
export type AppStateVersion = string;

export interface VersionedAppState {
  db: ApiDatabase;
  version: AppStateVersion | null;
}

export interface AppStateSaveOptions {
  /**
   * Version of the stored document this write was derived from. When present,
   * PostgreSQL storage only writes if the stored row is still that version and
   * otherwise throws AppStateWriteConflictError without changing anything.
   * Omit it only for deliberate whole-document replacement (seeding, tests).
   */
  expectedVersion: AppStateVersion | null;
}

export class AppStateWriteConflictError extends Error {
  readonly code = "app_state_write_conflict";

  constructor(readonly expectedVersion: AppStateVersion | null) {
    super(
      expectedVersion === null
        ? "app_state write refused: the write has no known base version."
        : "app_state write refused: the stored document changed after this process read it."
    );
    this.name = "AppStateWriteConflictError";
  }
}

export function isAppStateWriteConflictError(error: unknown): error is AppStateWriteConflictError {
  return error instanceof AppStateWriteConflictError;
}

export interface DatabaseStorage {
  loadRaw(): Promise<unknown>;
  load(): Promise<ApiDatabase>;
  loadVersioned(): Promise<VersionedAppState>;
  save(db: ApiDatabase, client?: AppStateTransactionClient | null, options?: AppStateSaveOptions): Promise<AppStateVersion | null>;
  runTransaction<T>(handler: (client: AppStateTransactionClient | null) => Promise<T>): Promise<T>;
  updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>, options?: LockedAppStateUpdateOptions): Promise<T>;
}

interface CreateDatabaseStorageParams {
  provider: StorageProvider;
  dbPath: string;
  databaseUrl: string | null;
  pgPoolMax: number;
  pgConnectTimeoutMs: number;
  pgIdleTimeoutMs: number;
  ensureDatabaseShape: (candidate: unknown) => ApiDatabase;
  createDefaultDatabase: () => ApiDatabase;
  queryPool?: AppStateQueryPool;
}

const APP_STATE_ROW_ID = "primary";

type AppStateQueryPool = Pick<Pool, "query"> & Partial<Pick<Pool, "connect">>;

class FileDatabaseStorage implements DatabaseStorage {
  constructor(
    private readonly dbPath: string,
    private readonly ensureDatabaseShape: (candidate: unknown) => ApiDatabase,
    private readonly createDefaultDatabase: () => ApiDatabase
  ) {}

  async loadRaw(): Promise<unknown> {
    const readAndParse = async (): Promise<unknown> => {
      const raw = await fs.readFile(this.dbPath, "utf8");
      return JSON.parse(raw);
    };

    try {
      return await readAndParse();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ENOENT") {
        const created = this.createDefaultDatabase();
        await this.save(created);
        return created;
      }

      // A partial/corrupted read should not wipe data; retry once before surfacing.
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return await readAndParse();
      } catch {
        throw error;
      }
    }
  }

  async load(): Promise<ApiDatabase> {
    return this.ensureDatabaseShape(await this.loadRaw());
  }

  async loadVersioned(): Promise<VersionedAppState> {
    // Local file storage is a single-process development provider without row versions.
    return { db: await this.load(), version: null };
  }

  async save(db: ApiDatabase): Promise<AppStateVersion | null> {
    // File readers outside the API mutation queue (including auth identity reads)
    // must see a complete old or new snapshot, never a truncated in-place write.
    const temporary = `${this.dbPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(db, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      // Exclusive creation failures must not remove another writer's file.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
      throw error;
    }
    try {
      await fs.rename(temporary, this.dbPath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return null;
  }

  async runTransaction<T>(handler: (client: AppStateTransactionClient | null) => Promise<T>): Promise<T> {
    // Local file storage has no SQL transaction. The caller must finish required
    // side-writes before saving and publish its cache only after all writes pass.
    return await handler(null);
  }

  async updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>, options?: LockedAppStateUpdateOptions): Promise<T> {
    await options?.lockBeforeRow?.(null);
    const update = await handler(await this.loadRaw(), null);
    if (update.shouldSave) {
      await this.save(update.state);
    }
    return update.result;
  }
}

class PostgresDatabaseStorage implements DatabaseStorage {
  private readonly pool: AppStateQueryPool;
  private ensureTablePromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    private readonly ensureDatabaseShape: (candidate: unknown) => ApiDatabase,
    private readonly createDefaultDatabase: () => ApiDatabase,
    queryPool?: AppStateQueryPool
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

  private async ensureTable(): Promise<void> {
    if (!this.ensureTablePromise) {
      this.ensureTablePromise = this.pool
        .query(
          `
            CREATE TABLE IF NOT EXISTS app_state (
              id TEXT PRIMARY KEY,
              state_json JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
          `
        )
        .then(() => undefined);
    }

    await this.ensureTablePromise;
  }

  /** Unconditional whole-document replacement. Only for callers without a base version. */
  private async writeRow(payload: unknown, client: AppStateTransactionClient = this.pool): Promise<AppStateVersion | null> {
    const result = await client.query<{ version: string }>(
      `
        INSERT INTO app_state (id, state_json, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE
          SET state_json = EXCLUDED.state_json,
              updated_at = NOW()
        RETURNING xmin::text AS version;
      `,
      [APP_STATE_ROW_ID, JSON.stringify(payload)]
    );
    return result.rows[0]?.version ?? null;
  }

  /**
   * Compare-and-set write. Under READ COMMITTED, if another transaction holds
   * the row this UPDATE waits for it; after that transaction commits, the
   * WHERE clause is re-evaluated against the newest row version, so a token
   * from an older version matches zero rows. Nothing is written in that case.
   */
  private async writeRowIfVersion(
    payload: unknown,
    expectedVersion: AppStateVersion | null,
    client: AppStateTransactionClient
  ): Promise<AppStateVersion> {
    if (expectedVersion === null) {
      throw new AppStateWriteConflictError(null);
    }
    const result = await client.query<{ version: string }>(
      `
        UPDATE app_state
        SET state_json = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1 AND xmin = $3::xid
        RETURNING xmin::text AS version;
      `,
      [APP_STATE_ROW_ID, JSON.stringify(payload), expectedVersion]
    );
    if (result.rows.length !== 1) {
      throw new AppStateWriteConflictError(expectedVersion);
    }
    return result.rows[0]!.version;
  }

  private async loadRawVersioned(): Promise<{ raw: unknown; version: AppStateVersion }> {
    await this.ensureTable();

    const select = () => this.pool.query<{ state_json: unknown; version: string }>(
      "SELECT state_json, xmin::text AS version FROM app_state WHERE id = $1 LIMIT 1",
      [APP_STATE_ROW_ID]
    );
    let result = await select();

    if (result.rows.length === 0) {
      // Create the default document only if no other process created it first,
      // then read back whichever document actually won.
      await this.pool.query(
        `
          INSERT INTO app_state (id, state_json, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (id) DO NOTHING;
        `,
        [APP_STATE_ROW_ID, JSON.stringify(this.createDefaultDatabase())]
      );
      result = await select();
      if (result.rows.length === 0) {
        throw new Error("PostgreSQL app_state row could not be initialized.");
      }
    }

    const row = result.rows[0]!;
    return { raw: row.state_json, version: row.version };
  }

  async loadRaw(): Promise<unknown> {
    return (await this.loadRawVersioned()).raw;
  }

  async load(): Promise<ApiDatabase> {
    return this.ensureDatabaseShape(await this.loadRaw());
  }

  async loadVersioned(): Promise<VersionedAppState> {
    const { raw, version } = await this.loadRawVersioned();
    return { db: this.ensureDatabaseShape(raw), version };
  }

  async save(
    db: ApiDatabase,
    client?: AppStateTransactionClient | null,
    options?: AppStateSaveOptions
  ): Promise<AppStateVersion | null> {
    await this.ensureTable();
    if (options) {
      return await this.writeRowIfVersion(db, options.expectedVersion, client ?? this.pool);
    }
    return await this.writeRow(db, client ?? this.pool);
  }

  async runTransaction<T>(handler: (client: AppStateTransactionClient | null) => Promise<T>): Promise<T> {
    await this.ensureTable();
    if (!this.pool.connect) {
      throw new Error("PostgreSQL app-state writes require a transaction-capable query pool.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>, options?: LockedAppStateUpdateOptions): Promise<T> {
    await this.ensureTable();
    if (!this.pool.connect) {
      throw new Error("PostgreSQL app-state migration requires a transaction-capable query pool.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await options?.lockBeforeRow?.(client);
      await client.query(
        `
          INSERT INTO app_state (id, state_json, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (id) DO NOTHING;
        `,
        [APP_STATE_ROW_ID, JSON.stringify(this.createDefaultDatabase())]
      );
      const result = await client.query<{ state_json: unknown }>(
        "SELECT state_json FROM app_state WHERE id = $1 FOR UPDATE",
        [APP_STATE_ROW_ID]
      );
      if (result.rows.length === 0) {
        throw new Error("PostgreSQL app_state row was not initialized before migration.");
      }

      const update = await handler(result.rows[0]!.state_json, client);
      if (update.shouldSave) {
        await client.query(
          `
            UPDATE app_state
            SET state_json = $2::jsonb,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [APP_STATE_ROW_ID, JSON.stringify(update.state)]
        );
      }

      await client.query("COMMIT");
      return update.result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original migration failure for readiness reporting.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createDatabaseStorage(params: CreateDatabaseStorageParams): DatabaseStorage {
  if (params.provider === "postgres") {
    if (!params.databaseUrl) {
      throw new Error("DATABASE_URL is required when STORAGE_PROVIDER=postgres.");
    }

    return new PostgresDatabaseStorage(
      params.databaseUrl,
      {
        pgPoolMax: params.pgPoolMax,
        pgConnectTimeoutMs: params.pgConnectTimeoutMs,
        pgIdleTimeoutMs: params.pgIdleTimeoutMs
      },
      params.ensureDatabaseShape,
      params.createDefaultDatabase,
      params.queryPool
    );
  }

  return new FileDatabaseStorage(params.dbPath, params.ensureDatabaseShape, params.createDefaultDatabase);
}
