import { promises as fs } from "node:fs";
import { Pool } from "pg";
import { ApiDatabase } from "@voicepractice/shared";
import { StorageProvider } from "./runtimeConfig.js";

export interface DatabaseStorage {
  load(): Promise<ApiDatabase>;
  save(db: ApiDatabase): Promise<void>;
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
}

const APP_STATE_ROW_ID = "primary";

class FileDatabaseStorage implements DatabaseStorage {
  constructor(
    private readonly dbPath: string,
    private readonly ensureDatabaseShape: (candidate: unknown) => ApiDatabase,
    private readonly createDefaultDatabase: () => ApiDatabase
  ) {}

  async load(): Promise<ApiDatabase> {
    const readAndParse = async (): Promise<ApiDatabase> => {
      const raw = await fs.readFile(this.dbPath, "utf8");
      return this.ensureDatabaseShape(JSON.parse(raw));
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

  async save(db: ApiDatabase): Promise<void> {
    await fs.writeFile(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }
}

class PostgresDatabaseStorage implements DatabaseStorage {
  private readonly pool: Pool;
  private ensureTablePromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    options: { pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number },
    private readonly ensureDatabaseShape: (candidate: unknown) => ApiDatabase,
    private readonly createDefaultDatabase: () => ApiDatabase
  ) {
    this.pool = new Pool({
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

  async load(): Promise<ApiDatabase> {
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
    return this.ensureDatabaseShape(row.state_json);
  }

  async save(db: ApiDatabase): Promise<void> {
    await this.ensureTable();
    await this.writeRow(db);
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
      params.createDefaultDatabase
    );
  }

  return new FileDatabaseStorage(params.dbPath, params.ensureDatabaseShape, params.createDefaultDatabase);
}
