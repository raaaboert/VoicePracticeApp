import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { ApiDatabase } from "@voicepractice/shared";
import { createDatabaseStorage } from "./storage.js";

function state(status: string): ApiDatabase {
  return { users: [{ id: "user_1", status }], orgs: [] } as unknown as ApiDatabase;
}

function harness(failAt: "audit" | "save" | "commit" | null = null) {
  let durableState = state("active");
  let durableAudit = 0;
  let stagedState: ApiDatabase | null = null;
  let stagedAudit = 0;
  let released = 0;
  const queries: string[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      const command = sql.trim().split(/\s+/)[0]!.toUpperCase();
      queries.push(command);
      if (command === "BEGIN") {
        stagedState = structuredClone(durableState);
        stagedAudit = durableAudit;
      } else if (command === "INSERT" && sql.includes("audit_events")) {
        if (failAt === "audit") throw new Error("injected audit failure");
        stagedAudit += 1;
      } else if (command === "INSERT" && sql.includes("app_state")) {
        if (failAt === "save") throw new Error("injected app_state failure");
        stagedState = JSON.parse(String(values?.[1])) as ApiDatabase;
      } else if (command === "COMMIT") {
        if (failAt === "commit") throw new Error("injected COMMIT failure");
        assert.ok(stagedState);
        durableState = stagedState;
        durableAudit = stagedAudit;
      } else if (command === "ROLLBACK") {
        stagedState = null;
        stagedAudit = 0;
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => { released += 1; },
  };
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => client,
  } as unknown as Pool;
  const storage = createDatabaseStorage({
    provider: "postgres", dbPath: "unused", databaseUrl: "postgres://unused",
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 1000,
    ensureDatabaseShape: (candidate) => candidate as ApiDatabase,
    createDefaultDatabase: () => state("active"),
    queryPool: pool,
  });
  return { storage, client, queries, getDurable: () => ({ state: durableState, audit: durableAudit, released }) };
}

for (const failure of ["audit", "save", "commit", null] as const) {
  test(`PostgreSQL app_state transaction ${failure ?? "success"} uses one client and publishes only after COMMIT`, async () => {
    const subject = harness(failure);
    let published = false;
    const mutation = subject.storage.runTransaction(async (client) => {
      assert.equal(client, subject.client);
      await client!.query("INSERT INTO audit_events (id) VALUES ('audit_1')");
      await subject.storage.save(state("disabled"), client);
    }).then(() => { published = true; });
    if (failure) {
      await assert.rejects(mutation, /injected/);
      assert.equal(subject.getDurable().state.users[0]?.status, "active");
      assert.equal(subject.getDurable().audit, 0);
      assert.equal(published, false);
      assert.deepEqual(subject.queries.slice(-1), ["ROLLBACK"]);
    } else {
      await mutation;
      assert.equal(subject.getDurable().state.users[0]?.status, "disabled");
      assert.equal(subject.getDurable().audit, 1);
      assert.equal(published, true);
      assert.deepEqual(subject.queries, ["BEGIN", "INSERT", "INSERT", "COMMIT"]);
    }
    assert.equal(subject.getDurable().released, 1);
  });
}
