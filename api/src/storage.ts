import { promises as fs } from "node:fs";
import { Pool } from "pg";
import { ApiDatabase } from "@voicepractice/shared";
import { StorageProvider } from "./runtimeConfig.js";

export type LockedAppStateUpdate<T> =
  | { result: T; shouldSave: false }
  | { result: T; shouldSave: true; state: ApiDatabase };

export type LockedAppStateUpdateHandler<T> = (raw: unknown) => LockedAppStateUpdate<T> | Promise<LockedAppStateUpdate<T>>;

export interface DatabaseStorage {
  loadRaw(): Promise<unknown>;
  load(): Promise<ApiDatabase>;
  save(db: ApiDatabase): Promise<void>;
  updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>): Promise<T>;
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
        await fs.writeFile(this.dbPath, JSON.stringify(created, null, 2), "utf8");
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

  async save(db: ApiDatabase): Promise<void> {
    await fs.writeFile(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }

  async updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>): Promise<T> {
    const update = await handler(await this.loadRaw());
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

  private async writeRow(payload: unknown): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO app_state (id, state_json, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE
          SET state_json = EXCLUDED.state_json,
              updated_at = NOW();
      `,
      [APP_STATE_ROW_ID, JSON.stringify(payload)]
    );
  }

  async loadRaw(): Promise<unknown> {
    await this.ensureTable();

    const result = await this.pool.query<{ state_json: unknown }>(
      "SELECT state_json FROM app_state WHERE id = $1 LIMIT 1",
      [APP_STATE_ROW_ID]
    );

    if (result.rows.length === 0) {
      const created = this.createDefaultDatabase();
      await this.writeRow(created);
      return created;
    }

    const row = result.rows[0];
    return row.state_json;
  }

  async load(): Promise<ApiDatabase> {
    return this.ensureDatabaseShape(await this.loadRaw());
  }

  async save(db: ApiDatabase): Promise<void> {
    await this.ensureTable();
    await this.writeRow(db);
  }

  async updateAppStateWithLock<T>(handler: LockedAppStateUpdateHandler<T>): Promise<T> {
    await this.ensureTable();
    if (!this.pool.connect) {
      throw new Error("PostgreSQL app-state migration requires a transaction-capable query pool.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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

      const update = await handler(result.rows[0]!.state_json);
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
