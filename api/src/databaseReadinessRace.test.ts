import assert from "node:assert/strict";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";
import type { ApiDatabase } from "@voicepractice/shared";
import { createDatabaseStorage } from "./storage.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("readiness refresh cannot overwrite committed mutations", { timeout: 30_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "peritio-readiness-race-"));
  let server: Server | undefined;
  dotenv.config = () => ({ parsed: {} });
  Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "file",
    DB_PATH: path.join(directory, "auxiliary.json"), ADMIN_BOOTSTRAP_PASSWORD: "readiness_test_password",
    ADMIN_TOKEN_SECRET: "readiness_test_admin_secret_at_least_32_chars", MOBILE_TOKEN_SECRET: "readiness_test_mobile_secret_at_least_32_chars",
    WEB_AUTH_TOKEN_SECRET: "readiness_test_web_secret_at_least_32_chars", SUPPORT_TRANSCRIPT_SECRET: "readiness_test_support_secret_at_least_32_chars",
    AUTH_CODE_DELIVERY_PROVIDER: "log_only", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", TRAINING_CONTENT_STORAGE_PROVIDER: "disabled" });
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  const api = await import("./index.js");
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(e => e ? reject(e) : resolve())); }
    await fs.rm(directory, { recursive: true, force: true });
  });
  server = await new Promise<Server>(resolve => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Optional real-PostgreSQL case requires READINESS_TEST_DATABASE_URL pointing
  // to a disposable local fixture database. Ordinary CI runs the file case,
  // which also detects the missing readiness lock; no CI database is required.
  const sqlUrl = process.env.READINESS_TEST_DATABASE_URL;

  for (const provider of ["file", "postgres"] as const) {
    await t.test(provider, { skip: provider === "postgres" && !sqlUrl }, async t => {
      let pool: Pool | undefined;
      if (provider === "postgres") {
        const url = new URL(sqlUrl!);
        // Dedicated fixture DB only; never accept normal local or hosted DB URLs.
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(url.pathname, "/peritio_readiness_test");
        assert.equal(url.username, "peritio_test");
        assert.ok(url.port && !["5432", "55432"].includes(url.port));
        const root = new Pool({ connectionString: sqlUrl!, max: 1, connectionTimeoutMillis: 2000 });
        const schema = `readiness_${randomUUID().replaceAll("-", "")}`;
        await root.query(`CREATE SCHEMA ${schema}`);
        url.searchParams.set("options", `-c search_path=${schema}`);
        pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 2000, idleTimeoutMillis: 100 });
        t.after(async () => { try { await pool!.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await root.end(); } });
      }
      // Only app_state uses PostgreSQL here. Ancillary stores remain isolated file
      // fixtures, so this exercises real SQL without installing application schemas.
      const storage = createDatabaseStorage({ provider, dbPath: path.join(directory, `${provider}.json`),
        databaseUrl: provider === "postgres" ? sqlUrl! : null, queryPool: pool,
        pgPoolMax: 2, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100,
        ensureDatabaseShape: value => value as ApiDatabase, createDefaultDatabase: api.createDefaultDatabase });
      let lockDepth = 0, held = false, overlappingAcquisitions = 0;
      let admission: ReturnType<typeof gate> | undefined;
      api.setDatabaseReadinessHarnessForTest(storage, phase => {
        if (phase === "queued") admission?.resolve();
        if (phase === "acquired") { lockDepth++; if (held) overlappingAcquisitions++; }
        if (phase === "released") lockDepth--;
      });
      await api.refreshDatabaseReadinessForTest();
      assert.equal((await fetch(base + "/ready")).status, 200);
      const login = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "readiness_test_password" }) });
      assert.equal(login.status, 200);
      const token = (await login.json() as { token: string }).token;
      const create = (email: string) => fetch(base + "/users", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, accountType: "individual", tier: "free", timezone: "UTC" }) });
      const load = storage.load.bind(storage), captured = gate(), release = gate();
      let loads = 0, refreshOwnsLock = false;
      storage.load = async () => {
        const snapshot = await load();
        // First load belongs to the separately locked normalization step. The
        // second is the readiness refresh whose cache publication raced writes.
        if (++loads === 2) {
          held = true; refreshOwnsLock = lockDepth === 1;
          captured.resolve(); await release.promise; held = false;
        }
        return snapshot;
      };
      const refresh = api.refreshDatabaseReadinessForTest();
      let first: Promise<Response> | undefined;
      try {
        await captured.promise;
        admission = gate();
        first = create(`${provider}-first@example.test`);
        await admission.promise;
        // Release a refresh that owns the queue so the queued request can run.
        // On the old path it owns no lock: let the first write commit, then
        // publish the captured stale snapshot, reproducing the actual lost update.
        if (refreshOwnsLock) release.resolve();
        assert.equal((await first).status, 201);
        assert.ok((await storage.loadRaw() as ApiDatabase).users.some(u => u.email === `${provider}-first@example.test`));
        release.resolve(); await refresh;
        assert.equal((await create(`${provider}-second@example.test`)).status, 201);
        const persisted = await storage.loadRaw() as ApiDatabase;
        for (const name of ["first", "second"]) assert.ok(persisted.users.some(u => u.email === `${provider}-${name}@example.test`), `${provider}: committed ${name} user disappeared`);
        assert.equal(refreshOwnsLock, true);
        assert.equal(overlappingAcquisitions, 0);
        assert.equal((await fetch(base + "/ready")).status, 200);
      } finally {
        release.resolve(); await refresh; await first;
        held = false; admission = undefined; storage.load = load;
      }
      // A failed load must release the queue and retain existing readiness
      // threshold/recovery behavior; a subsequent write and refresh must succeed.
      let failureLoads = 0;
      storage.load = async () => { if (++failureLoads % 2 === 0) throw new Error("Synthetic readiness read failure"); return load(); };
      for (let i = 0; i < 3; i++) await api.refreshDatabaseReadinessForTest();
      assert.equal((await fetch(base + "/ready")).status, 503);
      storage.load = load;
      assert.equal((await create(`${provider}-after-failure@example.test`)).status, 201);
      await api.refreshDatabaseReadinessForTest();
      assert.equal((await fetch(base + "/ready")).status, 200);
      api.setDatabaseReadinessHarnessForTest(storage, null);
    });
  }
});
