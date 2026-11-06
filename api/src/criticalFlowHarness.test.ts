import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Critical Flow OTP observer cannot start outside its isolated test child", { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "voicepractice-critical-flow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../../scripts/critical-flow-test-server.mjs", import.meta.url));
  const base: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "file",
    AUTH_CODE_DELIVERY_PROVIDER: "log_only", WEB_AUTH_CODE_DELIVERY_PROVIDER: "log_only",
    MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "log_only", MOBILE_REVERIFY_ON_ONBOARD: "true",
    CRITICAL_FLOW_FIXTURE: "1", CRITICAL_FLOW_TEMP_DIR: directory, DB_PATH: path.join(directory, "db.json"),
  };
  const cases: Array<[string, NodeJS.ProcessEnv, boolean]> = [
    ["no private IPC channel", {}, false],
    ["production runtime", { NODE_ENV: "production" }, true],
    ["staging environment", { PERITIO_ENV: "staging" }, true],
    ["production environment", { PERITIO_ENV: "production" }, true],
    ["Render runtime", { RENDER: "true" }, true],
    ["Vercel runtime", { VERCEL: "1" }, true],
    ["missing explicit fixture flag", { CRITICAL_FLOW_FIXTURE: "" }, true],
    ["external database configured", { DATABASE_URL: "synthetic-forbidden-value" }, true],
    ["real delivery selected", { MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "resend" }, true],
    ["non-isolated database path", { DB_PATH: path.join(directory, "other.json") }, true],
  ];
  for (const [name, overrides, ipc] of cases) {
    await t.test(name, async () => {
      const child = spawn(process.execPath, [script, "--source"], { cwd: directory, windowsHide: true,
        env: { ...base, ...overrides }, stdio: ipc ? ["ignore", "ignore", "pipe", "ipc"] : ["ignore", "ignore", "pipe"] });
      let diagnostics = "";
      child.stderr!.on("data", chunk => { diagnostics += String(chunk); });
      const [code] = await once(child, "exit");
      assert.notEqual(code, 0);
      assert.match(diagnostics, /requires explicit offline test isolation and private IPC/);
      assert.equal(diagnostics.includes("synthetic-forbidden-value"), false, "guard errors must not echo configured values");
      assert.deepEqual(await readdir(directory), [], "rejected child must not initialize a database or outbox");
    });
  }
});
