import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, gzipSync } from "node:zlib";

async function startApi(t: TestContext, proxyEnv: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "peritio-runtime-security-"));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
    fileURLToPath(new URL("./runtimeSecurityTestServer.ts", import.meta.url))], {
    cwd: directory, stdio: ["ignore", "ignore", "ignore", "ipc"], env: {
      SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
      TEMP: directory, TMP: directory, TSX_DISABLE_CACHE: "1", NODE_ENV: "test", PERITIO_ENV: "development",
      STORAGE_PROVIDER: "file", DB_PATH: path.join(directory, "state.json"),
      ADMIN_BOOTSTRAP_PASSWORD: "runtime_security_password", ADMIN_TOKEN_SECRET: "runtime_security_admin_secret_offline",
      MOBILE_TOKEN_SECRET: "runtime_security_mobile_secret_offline", WEB_AUTH_TOKEN_SECRET: "runtime_security_web_secret_offline",
      SUPPORT_TRANSCRIPT_SECRET: "runtime_security_support_secret_offline", AUTH_CODE_DELIVERY_PROVIDER: "log_only",
      ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
      ...proxyEnv,
    },
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit"); child.send({ kind: "stop" });
      const force = setTimeout(() => child.kill(), 3000);
      try { await exited; } finally { clearTimeout(force); }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Offline fixture startup timed out.")), 15_000);
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Offline fixture exited ${code}.`)); });
    child.once("message", (message: { kind: string; port: number }) => {
      clearTimeout(timeout); assert.equal(message.kind, "ready"); resolve(message.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;
  return { child, base, port };
}

test("patched runtime dependencies preserve API parsing, authentication and upload limits", { timeout: 60_000 }, async t => {
  const { child, base, port } = await startApi(t);
  const proxyWarnings: string[] = [];
  child.on("message", (message: { kind?: string; message?: string }) => {
    if (message.kind === "proxy-warning") proxyWarnings.push(message.message!);
  });
  const post = (body: BodyInit, extra: Record<string, string> = {}) => fetch(`${base}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", ...extra }, body,
  });
  const login = JSON.stringify({ password: "runtime_security_password" });
  await t.test("normal JSON, malformed JSON, gzip and compressed/uncompressed limits", async () => {
    assert.equal((await post(login)).status, 200);
    assert.equal((await post("{broken")).status, 400);
    assert.equal((await post(gzipSync(login), { "Content-Encoding": "gzip" })).status, 200);
    assert.equal((await post(deflateSync(login), { "Content-Encoding": "deflate" })).status, 200);
    const oversized = JSON.stringify({ padding: "x".repeat(1024 * 1024) });
    for (const [body, headers] of [[oversized, {}], [gzipSync(oversized), { "Content-Encoding": "gzip" }]] as const) {
      const response = await post(body, headers); assert.equal(response.status, 413);
    }
    assert.equal((await fetch(`${base}/orgs`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
  await t.test("adversarial gzip trailing bytes receive a client error without crashing", async () => {
    const payload = Buffer.concat([gzipSync('{"synthetic":true}'), Buffer.alloc(1024, 0xff)]);
    await new Promise<void>((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, path: "/__runtime_security/parsed", method: "POST", agent: false,
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": payload.length } }, response => {
        response.resume(); response.once("end", () => { assert.equal(response.statusCode, 400); resolve(); });
      });
      request.once("error", reject); request.setTimeout(3000, () => request.destroy(new Error("Compressed-body fixture timed out.")));
      request.end(payload);
    });
    assert.equal(child.exitCode, null); assert.equal((await fetch(`${base}/health`)).status, 200);
  });
  const command = (kind: string, expected: string) => new Promise<void>((resolve, reject) => {
    if (!child.connected || child.exitCode !== null) { reject(new Error(`Fixture already exited before ${kind}.`)); return; }
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Fixture command timed out: ${kind}`)); }, 3000);
    const exited = () => { cleanup(); reject(new Error(`Fixture crashed during ${kind}.`)); };
    const received = (message: { kind?: string }) => { if (message.kind === expected) { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timeout); child.off("exit", exited); child.off("message", received); };
    child.on("exit", exited); child.on("message", received); child.send({ kind });
  });
  await t.test("finished gzip decoder retains protection against late errors", async () => {
    // This injects a late error into a real decoder after a successful request;
    // it checks cleanup protection, not a wire-only crash reproduction.
    // The vulnerable 1.20.6 negative control was exercised separately.
    const response = await fetch(`${base}/__runtime_security/parsed`, { method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: gzipSync('{"synthetic":true}') });
    assert.equal(response.status, 200); await response.text();
    await command("late-decoder-error", "decoder-error-handled");
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
  const uploadPath = `${base}/mobile/users/runtime_security_user/ai/transcribe`;
  const auth = { Authorization: "Bearer runtime_security_token" };
  const form = () => { const body = new FormData(); body.append("file", new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" }), "synthetic.wav"); return body; };
  await t.test("authentication precedes multipart parsing and valid uploads reach the route", async () => {
    assert.equal((await fetch(uploadPath, { method: "POST", body: form() })).status, 401);
    // No provider credential is configured: 503 proves parsing/auth passed without a provider call.
    assert.equal((await fetch(uploadPath, { method: "POST", headers: auth, body: form() })).status, 503);
  });
  await t.test("file and field limits, malformed field names and multipart bodies remain bounded", async () => {
    const cases = [() => { const b = form(); b.append("file", new Blob(["extra"]), "extra.wav"); return b; },
      () => { const b = form(); for (let i = 0; i < 5; i++) b.append(`field${i}`, "value"); return b; },
      () => { const b = new FormData(); b.append("file", new Blob([new Uint8Array(12 * 1024 * 1024 + 1)]), "oversized.wav"); return b; }];
    for (const make of cases) {
      const response = await fetch(uploadPath, { method: "POST", headers: auth, body: make() });
      assert.equal(response.status, 400); assert.equal(typeof (await response.json() as { error: string }).error, "string");
    }
    // Patched Multer may safely discard an invalid numeric field rather than reject it.
    const invalidField = form(); invalidField.append("field[999999999999999999999]", "value");
    const invalidResponse = await fetch(uploadPath, { method: "POST", headers: auth, body: invalidField });
    assert.ok([400, 503].includes(invalidResponse.status));
    const malformed = await fetch(uploadPath, { method: "POST", headers: { ...auth, "Content-Type": "multipart/form-data; boundary=unfinished" }, body: "--unfinished\r\ninvalid" });
    assert.equal(malformed.status, 400);
    await new Promise<void>(resolve => {
      const request = http.request(uploadPath, { method: "POST", headers: { ...auth, "Content-Type": "multipart/form-data; boundary=aborted" } });
      request.on("error", () => {}); request.once("close", resolve);
      request.write('--aborted\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\n');
      setTimeout(() => request.destroy(), 20);
    });
    assert.equal(child.exitCode, null); assert.equal((await fetch(`${base}/health`)).status, 200);
  });
  await t.test("fixed and rotating forged headers cannot evade the login rate limit", async () => {
    for (const rotate of [false, true]) {
      await command("reset-rate-limits", "rate-limits-reset");
      for (let i = 0; i < 60; i++) {
        const response = await post(JSON.stringify({ password: "wrong_password" }), {
          "X-Forwarded-For": `198.51.100.${rotate ? i + 1 : 1}`,
          "CF-Connecting-IP": `203.0.113.${rotate ? i + 1 : 1}`,
        });
        assert.equal(response.status, i < 12 ? 401 : 429);
        if (i >= 12) assert.ok(Number(response.headers.get("retry-after")) > 0);
      }
    }
    await command("reset-rate-limits", "rate-limits-reset");
    assert.equal((await post(login)).status, 200);
    assert.equal(proxyWarnings.length, 1, "untrusted-header warning must be throttled across requests");
    assert.equal(proxyWarnings[0], "[client-ip] Ignoring forwarded client-IP headers from an untrusted connection peer; verify ingress configuration. Shared proxy limits may cause lockouts.");
  });
});

test("explicitly trusted ingress preserves distinct login clients without trusting forged prefixes", { timeout: 60_000 }, async t => {
  for (const header of ["x-forwarded-for", "cf-connecting-ip"]) {
    await t.test(header, async t => {
      const { base } = await startApi(t, { CLIENT_IP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32", CLIENT_IP_PROXY_HEADER: header });
      for (let i = 0; i < 60; i++) {
        const response = await fetch(`${base}/auth/login`, { method: "POST", headers: {
          "Content-Type": "application/json", [header]: header === "x-forwarded-for" ? `203.0.113.${i + 1}, 198.51.100.1` : "198.51.100.1",
        }, body: JSON.stringify({ password: "wrong_password" }) });
        assert.equal(response.status, i < 12 ? 401 : 429);
      }
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: {
        "Content-Type": "application/json", [header]: "198.51.100.2",
      }, body: JSON.stringify({ password: "runtime_security_password" }) });
      assert.equal(login.status, 200);
      const token = (await login.json() as { token: string }).token;
      const orgs = await fetch(`${base}/orgs`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(orgs.status, 200);
    });
  }
  await t.test("IPv6 rotation within one /64 is limited while another /64 can log in", async t => {
    const { base } = await startApi(t, { CLIENT_IP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32", CLIENT_IP_PROXY_HEADER: "cf-connecting-ip" });
    for (let i = 0; i < 60; i++) {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: {
        "Content-Type": "application/json", "CF-Connecting-IP": `2001:db8:1:abcd::${(i + 1).toString(16)}`,
      }, body: JSON.stringify({ password: "wrong_password" }) });
      assert.equal(response.status, i < 12 ? 401 : 429);
    }
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: {
      "Content-Type": "application/json", "CF-Connecting-IP": "2001:db8:1:abce::1",
    }, body: JSON.stringify({ password: "runtime_security_password" }) });
    assert.equal(login.status, 200);
  });
});
