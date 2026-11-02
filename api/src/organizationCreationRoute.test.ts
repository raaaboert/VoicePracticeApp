import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ApiDatabase } from "@voicepractice/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const loader = pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href;
const fixture = fileURLToPath(new URL("./organizationCreationTestServer.ts", import.meta.url));

test("organization creation is durable and retry-safe through the real authenticated route", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "peritio-org-retry-"));
  const dbPath = path.join(directory, "state.json");
  let child: ChildProcess | undefined;
  let baseUrl = "";
  let output = "";
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
    TEMP: directory, TMP: directory, TSX_DISABLE_CACHE: "1",
    NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "file", DB_PATH: dbPath,
    ADMIN_BOOTSTRAP_PASSWORD: "organization_retry_password",
    ADMIN_TOKEN_SECRET: "organization_retry_admin_secret_2026_offline",
    MOBILE_TOKEN_SECRET: "organization_retry_mobile_secret_2026_offline",
    WEB_AUTH_TOKEN_SECRET: "organization_retry_web_secret_2026_offline",
    SUPPORT_TRANSCRIPT_SECRET: "organization_retry_support_secret_2026_offline",
    AUTH_CODE_DELIVERY_PROVIDER: "log_only", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
  };
  async function start() {
    output = "";
    child = spawn(process.execPath, ["--import", loader, fixture], {
      cwd: directory, env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout!.on("data", (chunk) => { output += String(chunk); });
    child.stderr!.on("data", (chunk) => { output += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${output}`)), 15_000);
      child!.once("error", reject);
      child!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); });
      child!.once("message", (message: { kind: string; port: number }) => {
        clearTimeout(timer);
        assert.equal(message.kind, "ready");
        baseUrl = `http://127.0.0.1:${message.port}`;
        resolve();
      });
    });
  }
  async function command(kind: string) {
    const acknowledged = once(child!, "message");
    child!.send({ kind });
    const [message] = await acknowledged;
    assert.equal(message.kind, "ack");
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.send({ kind: "stop" });
    await exited;
  }
  async function call(route: string, token?: string, body?: unknown, key?: string, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(baseUrl + route, {
      method, headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key === undefined ? {} : { "Idempotency-Key": key }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const persisted = async () => JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase & {
    organizationCreationReceipts?: Record<string, { fingerprint: string; orgId: string }>;
  };
  try {
    await start();
    const login = await call("/auth/login", undefined, { password: env.ADMIN_BOOTSTRAP_PASSWORD });
    assert.equal(login.status, 200, output);
    const token = String(login.body.token);
    const input = { name: "Identical Company", contactName: "Owner", contactEmail: "owner@example.test", activeIndustries: ["people_management"] };
    const original = await persisted();
    const key = randomUUID();
    let createdId = "";
    await t.test("normal creation and repeated operation return one organization", async () => {
      const first = await call("/orgs", token, input, key);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      createdId = String(first.body.id);
      assert.equal(createdId, `org_${key}`);
      for (let i = 0; i < 3; i++) {
        const replay = await call("/orgs", token, { ...input }, key);
        assert.equal(replay.status, 201);
        assert.equal(replay.body.id, createdId);
        assert.equal(replay.body.joinCode, first.body.joinCode);
      }
      const db = await persisted();
      assert.equal(db.orgs.length, original.orgs.length + 1);
      assert.equal(db.organizationCreationReceipts?.[key].orgId, createdId);
      assert.equal("organizationCreationReceipts" in first.body, false);
      assert.deepEqual(db.users, original.users);
    });
    await t.test("different operations allow identical names and complete payloads", async () => {
      const distinct = await call("/orgs", token, input, randomUUID());
      assert.equal(distinct.status, 201);
      assert.notEqual(distinct.body.id, createdId);
      assert.equal((await persisted()).orgs.filter((org) => org.name === input.name).length, 2);
    });
    await t.test("concurrent same-operation requests serialize to one persisted result", async () => {
      const concurrentKey = randomUUID();
      const before = (await persisted()).orgs.length;
      const replies = await Promise.all(Array.from({ length: 8 }, () => call("/orgs", token, input, concurrentKey)));
      assert.ok(replies.every((reply) => reply.status === 201 && reply.body.id === `org_${concurrentKey}`));
      assert.equal((await persisted()).orgs.length, before + 1);
    });
    await t.test("response loss after commit and process restart retain the original result", async () => {
      const lostKey = randomUUID();
      const before = (await persisted()).orgs.length;
      await command("drop-response");
      await assert.rejects(call("/orgs", token, input, lostKey));
      assert.equal((await persisted()).organizationCreationReceipts?.[lostKey].orgId, `org_${lostKey}`);
      await stop();
      await start();
      const retried = await call("/orgs", token, input, lostKey);
      assert.equal(retried.status, 201, JSON.stringify(retried.body));
      assert.equal(retried.body.id, `org_${lostKey}`);
      assert.equal((await persisted()).orgs.length, before + 1);
    });
    await t.test("concurrent reuse of a key with different details produces one success and one conflict", async () => {
      const concurrentKey = randomUUID();
      const before = (await persisted()).orgs.length;
      const results = await Promise.all([
        call("/orgs", token, input, concurrentKey),
        call("/orgs", token, { ...input, contactName: "Different owner" }, concurrentKey),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal((await persisted()).orgs.length, before + 1);
    });
    await t.test("key reuse with different input conflicts without changing tenant data", async () => {
      const before = await persisted();
      const conflict = await call("/orgs", token, { ...input, name: "Different" }, key);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, "organization_creation_key_conflict");
      assert.deepEqual(await persisted(), before);
    });
    await t.test("replay after organization edits returns current data without reverting it", async () => {
      assert.equal((await call(`/orgs/${createdId}`, token, { contactName: "Updated Owner" }, undefined, "PATCH")).status, 200);
      const replay = await call("/orgs", token, input, key);
      assert.equal(replay.status, 201);
      assert.equal(replay.body.contactName, "Updated Owner");
      assert.deepEqual((await persisted()).users, original.users);
    });
    await t.test("unauthenticated and valid customer tokens cannot create or recover organizations", async () => {
      const before = await persisted();
      for (const unauthorized of [undefined, "invalid_admin_token", "retry_customer_token_0", "retry_customer_token_1"]) {
        assert.equal((await call("/orgs", unauthorized, input, key)).status, 401);
        assert.equal((await call("/orgs", unauthorized, input, randomUUID())).status, 401);
      }
      assert.deepEqual(await persisted(), before);
    });
    await t.test("missing or malformed operation IDs fail closed before any creation", async () => {
      const before = await persisted();
      for (const invalid of [undefined, "", "__proto__", "not-a-uuid"]) {
        assert.equal((await call("/orgs", token, input, invalid)).status, 400);
      }
      assert.deepEqual(await persisted(), before);
    });
    await t.test("failed persistence creates neither organization nor receipt and can be retried", async () => {
      const failedKey = randomUUID();
      const before = await persisted();
      await command("fail-save");
      assert.equal((await call("/orgs", token, input, failedKey)).status, 500);
      assert.deepEqual(await persisted(), before);
      const retry = await call("/orgs", token, input, failedKey);
      assert.equal(retry.status, 201);
      assert.equal((await persisted()).orgs.length, before.orgs.length + 1);
    });
    await t.test("explicit join-code uniqueness and unrelated endpoints retain their behavior", async () => {
      const first = await call("/orgs", token, { ...input, joinCode: "RETRY123" }, randomUUID());
      assert.equal(first.status, 201);
      assert.equal((await call("/orgs", token, { ...input, joinCode: "RETRY123" }, randomUUID())).status, 409);
      assert.equal((await call("/orgs", token)).status, 200);
      assert.equal((await call(`/orgs/${createdId}`, token, { status: "disabled" }, undefined, "PATCH")).status, 200);
      assert.equal((await call("/orgs", token, input, key)).body.status, "disabled");
    });
  } finally {
    await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("peritio-org-retry-"));
    await rm(directory, { recursive: true, force: true });
  }
});
