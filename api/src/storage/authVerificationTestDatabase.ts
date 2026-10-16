import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

export async function createLocalAuthDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/(test|integration)/i.test(parsed.pathname)) throw new Error("Authentication integration requires disposable LOCAL PostgreSQL.");
  const schema = `auth_test_${crypto.randomBytes(8).toString("hex")}`;
  const root = new Pool({ connectionString: databaseUrl, max: 1 });
  await root.query(`CREATE SCHEMA ${schema}`);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: parsed.toString(), max: 4 });
  const migrate = async () => pool.query(await readFile(new URL("../../sql/024_auth_verification.sql", import.meta.url), "utf8"));
  return { pool, url: parsed.toString(), migrate, close: async () => { await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); } };
}
