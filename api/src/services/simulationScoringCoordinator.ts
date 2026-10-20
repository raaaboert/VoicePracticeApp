import { Pool } from "pg";

/** A session advisory lock, not a transaction or a durable spending claim.
 * PostgreSQL releases it if the API connection/process dies. A provider's
 * uncertain result after that failure can still require a fresh evaluation.
 */
export class SimulationScoringCoordinator {
  private readonly local = new Set<string>();
  private readonly pool: Pool | null;
  constructor(options: { databaseUrl: string | null; pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number }) {
    this.pool = options.databaseUrl ? new Pool({ connectionString: options.databaseUrl, max: options.pgPoolMax,
      connectionTimeoutMillis: options.pgConnectTimeoutMs, idleTimeoutMillis: options.pgIdleTimeoutMs,
      allowExitOnIdle: true }) : null;
    this.pool?.on("error", () => {
      // An idle connection failure must not crash the API or log driver details.
      console.warn("[simulation-score] idle coordination connection unavailable");
    });
  }

  async acquire(identity: { sessionId: string; userId: string; orgId: string | null }): Promise<{
    assertHeld(): void; release(): Promise<void>;
  } | null> {
    const key = JSON.stringify([identity.orgId, identity.userId, identity.sessionId]);
    if (!this.pool) {
      if (this.local.has(key)) return null;
      this.local.add(key);
      return { assertHeld() {}, release: async () => { this.local.delete(key); } };
    }
    const client = await this.pool.connect();
    let lost = false, released = false;
    const onError = () => { lost = true; };
    client.on("error", onError);
    const lockKey = "hashtextextended('peritio-score-v1:' || current_database() || ':' || current_schema() || ':' || $1::text, 0)";
    try {
      const result = await client.query(`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`, [key]);
      if (!result.rows[0]?.acquired) {
        client.removeListener("error", onError); client.release(); return null;
      }
      return {
        assertHeld() { if (lost || released) throw new Error("Scoring coordination is unavailable."); },
        release: async () => {
          if (released) return;
          released = true;
          try { if (!lost) await client.query(`SELECT pg_advisory_unlock(${lockKey})`, [key]); }
          catch { lost = true; }
          finally { client.removeListener("error", onError); client.release(lost); }
        },
      };
    } catch (error) {
      client.removeListener("error", onError); client.release(true); throw error;
    }
  }

  async close(): Promise<void> { await this.pool?.end(); }
}
