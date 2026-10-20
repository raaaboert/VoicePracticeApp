import { Pool } from "pg";
import { performance } from "node:perf_hooks";

export type ScoringCoordination =
  | { status: "acquired"; release(): Promise<void> }
  | { status: "busy" }
  | { status: "unavailable" };

/** A session advisory lock, not a transaction or a durable spending claim.
 * PostgreSQL releases it if the API connection/process dies. A provider's
 * uncertain result after that failure can still require a fresh evaluation.
 */
export class SimulationScoringCoordinator {
  private readonly local = new Set<string>();
  private readonly pool: Pool | null;
  private readonly acquisitionWindowMs: number;
  constructor(options: { databaseUrl: string | null; pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number }) {
    // Duplicate suppression is optional: never queue behind evaluations for
    // the ordinary eight-second database connection timeout.
    this.acquisitionWindowMs = Math.max(1, Math.min(250, options.pgConnectTimeoutMs));
    this.pool = options.databaseUrl ? new Pool({ connectionString: options.databaseUrl, max: options.pgPoolMax,
      connectionTimeoutMillis: this.acquisitionWindowMs, query_timeout: this.acquisitionWindowMs,
      idleTimeoutMillis: options.pgIdleTimeoutMs,
      allowExitOnIdle: true }) : null;
    this.pool?.on("error", () => {
      // An idle connection failure must not crash the API or log driver details.
      console.warn("[simulation-score] idle coordination connection unavailable");
    });
  }

  async acquire(identity: { sessionId: string; userId: string; orgId: string | null }): Promise<ScoringCoordination> {
    const key = JSON.stringify([identity.orgId, identity.userId, identity.sessionId]);
    if (this.local.has(key)) return { status: "busy" };
    this.local.add(key);
    if (!this.pool) {
      return { status: "acquired", release: async () => { this.local.delete(key); } };
    }
    const deadline = performance.now() + this.acquisitionWindowMs;
    let client;
    try { client = await this.pool.connect(); }
    catch { this.local.delete(key); return { status: "unavailable" }; }
    let lost = false, released = false;
    const onError = () => { lost = true; };
    client.on("error", onError);
    const lockKey = "hashtextextended('peritio-score-v1:' || current_database() || ':' || current_schema() || ':' || $1::text, 0)";
    try {
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs <= 0) {
        client.removeListener("error", onError); client.release(); this.local.delete(key);
        return { status: "unavailable" };
      }
      const query = { text: `SELECT pg_try_advisory_lock(${lockKey}) AS acquired`, values: [key], query_timeout: remainingMs };
      const result = await client.query<{ acquired: boolean }>(query);
      if (!result.rows[0]?.acquired) {
        client.removeListener("error", onError); client.release(); this.local.delete(key); return { status: "busy" };
      }
      return {
        status: "acquired",
        release: async () => {
          if (released) return;
          released = true;
          try { if (!lost) await client.query(`SELECT pg_advisory_unlock(${lockKey})`, [key]); }
          catch { lost = true; }
          finally { client.removeListener("error", onError); client.release(lost); this.local.delete(key); }
        },
      };
    } catch {
      client.removeListener("error", onError); client.release(true); this.local.delete(key);
      return { status: "unavailable" };
    }
  }

  async close(): Promise<void> { await this.pool?.end(); }
}
