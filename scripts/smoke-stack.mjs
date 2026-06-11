#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const IS_WINDOWS = process.platform === "win32";
const NPM_CMD = IS_WINDOWS ? "npm.cmd" : "npm";
const TASKKILL_CMD = IS_WINDOWS ? "taskkill" : null;

function nowLabel() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${nowLabel()}] ${message}`);
}

function createRunner(cwd) {
  return function run(command, args, envOverrides = {}) {
    if (IS_WINDOWS) {
      const encoded = [command, ...args]
        .map((part) => {
          if (/[\s"]/u.test(part)) {
            return `"${part.replace(/"/g, '\\"')}"`;
          }
          return part;
        })
        .join(" ");

      return spawn("cmd.exe", ["/d", "/s", "/c", encoded], {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...envOverrides }
      });
    }

    return spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...envOverrides }
    });
  };
}

async function stopProcess(child, name) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (IS_WINDOWS && TASKKILL_CMD) {
    await new Promise((resolve) => {
      const killer = spawn(TASKKILL_CMD, ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    log(`${name}: stopped`);
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000)
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  log(`${name}: stopped`);
}

function attachLogs(child, prefix, sink) {
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(`${prefix}${text}`);
    sink.push(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(`${prefix}${text}`);
    sink.push(text);
  });
}

async function waitForLogMatch(child, logs, matcher, timeoutMs, name) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited before readiness check (exit ${child.exitCode}).`);
    }

    const joined = logs.join("");
    if (matcher.test(joined)) {
      return;
    }

    await delay(250);
  }

  throw new Error(`${name} did not reach ready state within ${Math.floor(timeoutMs / 1000)}s.`);
}

async function fetchWithRetry(url, timeoutMs, options = {}) {
  const {
    child = null,
    name = url,
    attemptTimeoutMs = 5000
  } = options;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (child?.exitCode !== null) {
      throw new Error(`${name} exited before ${url} became reachable (exit ${child.exitCode}).`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } catch (error) {
      lastError = error;
      await delay(300);
    } finally {
      clearTimeout(timer);
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${name} did not become reachable at ${url} within ${Math.floor(timeoutMs / 1000)}s.${detail}`);
}

async function isTcpPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxAttempts = 20) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isTcpPortAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No open localhost port found in range ${startPort}-${startPort + maxAttempts - 1}.`);
}

async function main() {
  const cwd = process.cwd();
  const run = createRunner(cwd);
  const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
  const apiPort = await findAvailablePort(4100);
  const adminPort = await findAvailablePort(3000);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const adminBaseUrl = `http://127.0.0.1:${adminPort}`;

  if (apiPort !== 4100) {
    log(`Smoke: default API port 4100 is occupied, using ${apiPort}.`);
  }
  if (adminPort !== 3000) {
    log(`Smoke: default Admin Web port 3000 is occupied, using ${adminPort}.`);
  }

  log("Smoke: API");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "voicepractice-smoke-stack-"));
  const apiLogs = [];
  const api = run(NPM_CMD, ["run", "dev", "--workspace", "api"], {
    PORT: String(apiPort),
    NODE_ENV: "development",
    STORAGE_PROVIDER: "file",
    DB_PATH: path.join(tempDir, "db.json"),
    CORS_ALLOWED_ORIGINS: `${adminBaseUrl},http://localhost:${adminPort}`,
    ADMIN_BOOTSTRAP_PASSWORD: "admin",
    ADMIN_TOKEN_SECRET: "local-smoke-admin-token-secret-123456",
    WEB_AUTH_TOKEN_SECRET: "local-smoke-web-auth-token-secret-123456",
    MOBILE_TOKEN_SECRET: "local-smoke-mobile-token-secret-123456",
    SUPPORT_TRANSCRIPT_SECRET: "local-smoke-support-token-secret-123456",
    ENABLE_INTERNAL_DEBUG_ENDPOINTS: "true"
  });
  attachLogs(api, "[api] ", apiLogs);

  try {
    const health = await fetchWithRetry(`${apiBaseUrl}/health`, 90000, { child: api, name: "api" });
    if (!health.ok) {
      throw new Error(`api /health returned ${health.status}`);
    }

    const config = await fetchWithRetry(`${apiBaseUrl}/config`, 10000, { child: api, name: "api" });
    if (!config.ok) {
      throw new Error(`api /config returned ${config.status}`);
    }

    const configJson = await config.json();
    log(`Smoke: API ok (activeSegmentId=${configJson.activeSegmentId})`);
  } finally {
    await stopProcess(api, "api");
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  log("Smoke: Admin Web");
  const adminLogs = [];
  const admin = run(NPM_CMD, ["run", "dev", "--workspace", "admin-web", "--", "--port", String(adminPort)], {
    API_BASE_URL: apiBaseUrl
  });
  attachLogs(admin, "[admin] ", adminLogs);

  try {
    const login = await fetchWithRetry(`${adminBaseUrl}/login`, 90000, {
      child: admin,
      name: "admin-web"
    });
    if (!login.ok) {
      throw new Error(`admin /login returned ${login.status}`);
    }

    const html = await login.text();
    const normalizedHtml = html.toLowerCase();
    const requiredMarkers = ["peritio", "web admin", "sign in"];
    const missingMarkers = requiredMarkers.filter((marker) => !normalizedHtml.includes(marker));
    if (missingMarkers.length > 0) {
      throw new Error(`admin /login content check failed (missing: ${missingMarkers.join(", ")})`);
    }

    log("Smoke: Admin web ok");
  } finally {
    await stopProcess(admin, "admin-web");
  }

  if (isGitHubActions) {
    log("Smoke: Mobile Metro skipped on GitHub Actions; verify:fast covers mobile TypeScript validation.");
    log("Smoke complete: API and Admin Web passed startup checks.");
    return;
  }

  log("Smoke: Mobile Metro");
  const metroPort = await findAvailablePort(8081);
  if (metroPort !== 8081) {
    log(`Smoke: default Metro port 8081 is occupied, using ${metroPort}.`);
  }

  const mobileLogs = [];
  const mobile = run(NPM_CMD, [
    "run",
    "start",
    "--workspace",
    "mobile",
    "--",
    "--port",
    String(metroPort)
  ], { CI: "1" });
  attachLogs(mobile, "[mobile] ", mobileLogs);

  try {
    const metro = await fetchWithRetry(`http://127.0.0.1:${metroPort}`, 90000, {
      child: mobile,
      name: "mobile"
    });
    log(`Smoke: Mobile Metro reachable (status=${metro.status})`);
  } finally {
    await stopProcess(mobile, "mobile");
  }

  log("Smoke complete: all services passed startup checks.");
}

main().catch((error) => {
  console.error(`[${nowLabel()}] Smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
