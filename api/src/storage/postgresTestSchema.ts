import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

/** Explicit test-only setup. Production applies 024 manually before deployment. */
export async function applyAuthenticationTestSchema(pool: Pick<Pool, "query">): Promise<void> {
  await pool.query(await readFile(new URL("../../sql/024_auth_verification.sql", import.meta.url), "utf8"));
}
