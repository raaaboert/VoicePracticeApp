import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
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

function fixtureMessage(child: ChildProcess, kind: string, id?: string) {
  return new Promise<{ destroyed?: boolean; forwarded?: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", received); reject(new Error(`Missing synthetic ${kind} acknowledgement.`)); }, 5000);
    const received = (message: { kind: string; id?: string; destroyed?: boolean; forwarded?: boolean }) => {
      if (message.kind === kind && (id === undefined || message.id === id)) {
        clearTimeout(timer); child.off("message", received); resolve(message);
      }
    };
    child.on("message", received);
  });
}

test("patched runtime dependencies preserve API parsing, authentication and upload limits", { timeout: 60_000 }, async t => {
  const { child, base, port } = await startApi(t);
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
  });
});

test("trusted ingress cannot reset the single platform-admin credential budget", { timeout: 60_000 }, async t => {
  for (const header of ["x-forwarded-for", "cf-connecting-ip"]) {
    await t.test(header, async t => {
      const { base } = await startApi(t, { CLIENT_IP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32", CLIENT_IP_PROXY_HEADER: header });
      const session = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "runtime_security_password" }) });
      assert.equal(session.status, 200);
      const adminToken = (await session.json() as { token: string }).token;
      for (let i = 0; i < 60; i++) {
        const response = await fetch(`${base}/auth/login`, { method: "POST", headers: {
          "Content-Type": "application/json", [header]: header === "x-forwarded-for" ? `203.0.113.${i + 1}, 198.51.100.1` : "198.51.100.1",
        }, body: JSON.stringify({ password: "wrong_password" }) });
        assert.equal(response.status, i < 11 ? 401 : 429);
      }
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: {
        "Content-Type": "application/json", [header]: "198.51.100.2",
      }, body: JSON.stringify({ password: "runtime_security_password" }) });
      assert.equal(login.status, 429);
      assert.equal((await fetch(`${base}/orgs`, { headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
    });
  }
  await t.test("IPv6 rotation across /64s cannot reset a credential budget", async t => {
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
    assert.equal(login.status, 429);
  });
});

test("shared proxy customers have isolated OTP, upload and authenticated AI allowances", { timeout: 60_000 }, async t => {
  const { base, child } = await startApi(t);
  const codes = new Map<string, string>();
  const warnings: string[] = [];
  child.on("message", (message: { kind?: string; email: string; code: string; message: string }) => {
    if (message.kind === "verification-code") codes.set(message.email, message.code);
    if (message.kind === "proxy-warning") warnings.push(message.message);
  });
  const post = (route: string, body: unknown, token?: string, forged = "198.51.100.1") => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": forged,
      "CF-Connecting-IP": forged, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  for (const email of ["user@example.test", "second@example.test"]) {
    assert.equal((await post("/web/auth/request-code", { email })).status, 200);
    assert.ok(codes.get(email));
  }
  for (let i = 0; i < 60; i++) {
    const wrong = codes.get("user@example.test") === "999999" ? "888888" : "999999";
    assert.equal((await post("/web/auth/verify-code", { email: "user@example.test", code: wrong }, undefined, `203.0.113.${i + 1}`)).status, 400);
  }
  assert.equal((await post("/web/auth/verify-code", { email: "user@example.test", code: codes.get("user@example.test") })).status, 400,
    "the attacked account's challenge must remain invalidated");
  const second = await post("/web/auth/verify-code", { email: "second@example.test", code: codes.get("second@example.test") });
  assert.equal(second.status, 200);
  const token = (await second.json() as { token: string }).token;
  assert.equal((await fetch(base + "/web/auth/session", { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.equal(warnings.length, 1, "audit metadata warning stays throttled and contains no request data");
  assert.equal(warnings[0], "[client-ip] Ignoring forwarded client-IP headers from an untrusted connection peer; verify ingress configuration for accurate audit metadata.");
  // Invalid credentials and claimed user IDs cannot spend a verified user's upload quota.
  const upload = "/dashboard/admin/training-content/nonexistent/assets/uploads";
  for (let i = 0; i < 125; i++) assert.equal((await post(upload, { userId: "runtime_security_second" }, "invalid")).status, 401);
  assert.notEqual((await post(upload, {}, token)).status, 429);
  // An exhausted anonymous pool must not reject a valid AI user behind the same peer.
  const ai = "/mobile/users/runtime_security_user/ai/transcribe";
  for (let i = 0; i < 121; i++) assert.equal((await post(ai, {}, undefined, `203.0.113.${i + 1}`)).status, i < 120 ? 401 : 429);
  const body = new FormData(); body.append("file", new Blob(["synthetic"], { type: "audio/wav" }), "synthetic.wav");
  assert.equal((await fetch(base + ai, { method: "POST", headers: { Authorization: "Bearer runtime_security_token" }, body })).status, 503);
});

test("upload quotas use verified users despite a shared proxy, claimed IDs and rotating headers", { timeout: 60_000 }, async t => {
  const { base, child } = await startApi(t);
  const codes = new Map<string, string>();
  child.on("message", (m: { kind?: string; email: string; code: string }) => { if (m.kind === "verification-code") codes.set(m.email, m.code); });
  const tokens: string[] = [];
  for (const email of ["user@example.test", "second@example.test"]) {
    const request = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await request("/web/auth/request-code", { email })).status, 200);
    const login = await request("/web/auth/verify-code", { email, code: codes.get(email) }); assert.equal(login.status, 200);
    tokens.push((await login.json() as { token: string }).token);
  }
  const upload = (token: string, i: number) => fetch(base + "/dashboard/admin/training-content/nonexistent/assets/uploads", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "CF-Connecting-IP": `203.0.113.${i + 1}` },
    body: JSON.stringify({ userId: `claimed-${i}` }),
  });
  for (let i = 0; i < 121; i++) {
    const response = await upload(tokens[0], i);
    assert.equal(response.status, i < 120 ? 403 : 429);
  }
  assert.equal((await upload(tokens[1], 122)).status, 403);
});

test("sixteen active AI uploads across organizations and an anonymous flood do not gate another customer", { timeout: 30_000 }, async t => {
  const { base, child } = await startApi(t);
  const held: http.ClientRequest[] = [];
  t.after(() => held.forEach(request => request.destroy()));
  const waitMessage = (kind: string, id: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", onMessage); reject(new Error(`Missing synthetic ${kind} acknowledgement.`)); }, 5000);
    const onMessage = (m: { kind: string; id: string }) => {
      if (m.kind === kind && m.id === id) { clearTimeout(timer); child.off("message", onMessage); resolve(); }
    };
    child.on("message", onMessage);
  });
  for (let user = 0; user < 4; user++) for (let slot = 0; slot < 4; slot++) {
    const id = `${user}-${slot}`, admitted = waitMessage("ai-upload-admitted", id);
    const request = http.request(`${base}/mobile/users/runtime_ai_${user}/ai/transcribe`, {
      method: "POST", headers: { Authorization: `Bearer runtime_ai_token_${user}`, "X-Runtime-Hold": id,
        "Content-Type": "multipart/form-data; boundary=hold" },
    });
    request.on("error", () => {}); request.on("response", response => response.resume());
    request.setTimeout(10_000, () => request.destroy()); held.push(request);
    request.write('--hold\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\nsynthetic');
    await admitted;
  }
  const transcribe = (user: number, token?: string) => fetch(`${base}/mobile/users/runtime_ai_${user}/ai/transcribe`, {
    method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: new FormData(),
  });
  assert.equal((await transcribe(0, "runtime_ai_token_0")).status, 429, "per-user concurrency remains bounded");
  for (let i = 0; i < 125; i++) assert.equal((await transcribe(4)).status, i < 120 ? 401 : 429);
  assert.equal((await transcribe(4, "runtime_ai_token_4")).status, 503,
    "a fifth organization's valid request reaches the disabled provider rather than a global concurrency gate");
  const closed = new Promise<void>((resolve, reject) => {
    const pending = new Set(held.map((_, i) => `${Math.floor(i / 4)}-${i % 4}`));
    const timer = setTimeout(() => { child.off("message", onClose); reject(new Error("Synthetic uploads did not close.")); }, 5000);
    const onClose = (m: { kind: string; id: string }) => {
      if (m.kind === "ai-upload-closed") pending.delete(m.id);
      if (!pending.size) { clearTimeout(timer); child.off("message", onClose); resolve(); }
    };
    child.on("message", onClose);
  });
  held.forEach(request => request.destroy()); await closed;
  assert.equal((await transcribe(0, "runtime_ai_token_0")).status, 503, "aborted uploads release the user's slots");
});

test("anonymous auto-error reports stop at 30 per hour without consuming authenticated support capacity", { timeout: 30_000 }, async t => {
  const { base } = await startApi(t);
  for (let i = 0; i < 31; i++) {
    const response = await fetch(base + "/mobile/public/support/errors", { method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.113.${i + 1}` },
      body: JSON.stringify({ message: "[AUTO-ERROR] Synthetic anonymous quota test" }) });
    assert.equal(response.status, i < 30 ? 201 : 429);
    if (i === 30) assert.ok(Number(response.headers.get("retry-after")) > 3500);
  }
  const response = await fetch(base + "/mobile/users/runtime_security_user/support/cases", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer runtime_security_token" },
    body: JSON.stringify({ message: "Synthetic authenticated support remains available", includeTranscript: false }) });
  assert.equal(response.status, 201);
});

test("early disconnect before public admission releases every slot after gzip parsing", { timeout: 30_000 }, async t => {
  const { base, child } = await startApi(t);
  const resumed: Array<{ destroyed?: boolean; forwarded?: boolean }> = [];
  for (let i = 0; i < 16; i++) {
    const id = `public-disconnect-${i}`, paused = fixtureMessage(child, "public-paused", id);
    const request = http.request(base + "/web/auth/request-code", { method: "POST", headers: {
      "Content-Type": "application/json", "Content-Encoding": "gzip", "X-Runtime-Public-Disconnect": id,
    } });
    request.on("error", () => {}); request.end(gzipSync(JSON.stringify({ email: "unknown@example.test" })));
    await paused;
    const closed = fixtureMessage(child, "disconnect-closed", id); request.destroy(); await closed;
    const completed = fixtureMessage(child, "public-resumed", id); child.send({ kind: "resume-public", id });
    resumed.push(await completed);
  }
  const post = (route: string, body: unknown) => fetch(base + route, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/auth/login", { password: "runtime_security_password" })).status, 200);
  assert.equal((await post("/web/auth/request-code", { email: "user@example.test" })).status, 200);
  assert.ok(resumed.every(result => result.destroyed && !result.forwarded), "closed responses must release without calling next");
  // Prove all sixteen slots are available, and double-release did not increase capacity.
  const held: http.ClientRequest[] = [];
  t.after(() => held.forEach(request => request.destroy()));
  for (let i = 0; i < 16; i++) {
    const id = `public-held-${i}`, admitted = fixtureMessage(child, "public-admitted", id);
    const request = http.request(base + "/web/auth/request-code", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Runtime-Public-Hold": id,
    } });
    request.on("error", () => {}); held.push(request); request.end(JSON.stringify({ email: "unknown@example.test" }));
    await admitted;
  }
  assert.equal((await post("/web/auth/request-code", { email: "unknown@example.test" })).status, 429);
  for (let i = 0; i < held.length; i++) {
    const closed = fixtureMessage(child, "disconnect-closed", `public-held-${i}`); held[i].destroy(); await closed;
  }
  assert.equal((await post("/auth/login", { password: "runtime_security_password" })).status, 200);
});

test("early disconnect while AI authentication awaits the database lock releases every user slot", { timeout: 30_000 }, async t => {
  const { base, child } = await startApi(t);
  const armed = fixtureMessage(child, "database-armed"); child.send({ kind: "hold-database" }); await armed;
  const databaseHeld = fixtureMessage(child, "database-held");
  const holder = fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "runtime_security_password" }) });
  await databaseHeld;
  const resumed: Array<ReturnType<typeof fixtureMessage>> = [];
  for (let i = 0; i < 4; i++) {
    const id = `ai-disconnect-${i}`, queued = fixtureMessage(child, "ai-queued", id);
    const request = http.request(base + "/mobile/users/runtime_ai_0/ai/transcribe", { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: "Bearer runtime_ai_token_0", "X-Runtime-Ai-Disconnect": id,
    } });
    request.on("error", () => {}); request.end("{}"); await queued;
    const closed = fixtureMessage(child, "disconnect-closed", id); request.destroy(); await closed;
    resumed.push(fixtureMessage(child, "ai-resumed", id));
  }
  child.send({ kind: "release-database" }); assert.equal((await holder).status, 200);
  assert.ok((await Promise.all(resumed)).every(result => result.destroyed));
  const transcribe = (user: number) => fetch(`${base}/mobile/users/runtime_ai_${user}/ai/transcribe`, { method: "POST",
    headers: { Authorization: `Bearer runtime_ai_token_${user}` }, body: new FormData() });
  assert.equal((await transcribe(0)).status, 503, "the abandoned user's request reaches the disabled provider");
  assert.equal((await transcribe(1)).status, 503, "another organization remains unaffected");
  const held: http.ClientRequest[] = [];
  t.after(() => held.forEach(request => request.destroy()));
  for (let i = 0; i < 4; i++) {
    const id = `ai-after-disconnect-${i}`, admitted = fixtureMessage(child, "ai-upload-admitted", id);
    const request = http.request(base + "/mobile/users/runtime_ai_0/ai/transcribe", { method: "POST", headers: {
      Authorization: "Bearer runtime_ai_token_0", "Content-Type": "multipart/form-data; boundary=hold", "X-Runtime-Hold": id,
    } });
    request.on("error", () => {}); held.push(request);
    request.write('--hold\r\nContent-Disposition: form-data; name="file"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\nsynthetic');
    await admitted;
  }
  assert.equal((await transcribe(0)).status, 429, "capacity remains exactly four per verified user");
  assert.equal((await transcribe(1)).status, 503);
  for (let i = 0; i < held.length; i++) {
    const closed = fixtureMessage(child, "ai-upload-closed", `ai-after-disconnect-${i}`); held[i].destroy(); await closed;
  }
  assert.equal((await transcribe(0)).status, 503);
});
