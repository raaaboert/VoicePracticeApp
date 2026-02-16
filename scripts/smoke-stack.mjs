#!/usr/bin/env node

import { spawn } from "node:child_process";
import net from "node:net";
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

async function fetchWithRetry(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      return response;
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
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

  log("Smoke: API");
  const apiLogs = [];
  const api = run(NPM_CMD, ["run", "dev", "--workspace", "api"]);
  attachLogs(api, "[api] ", apiLogs);

  try {
    await waitForLogMatch(api, apiLogs, /VoicePractice API running on http:\/\/localhost:4100/i, 30000, "api");
    const health = await fetchWithRetry("http://localhost:4100/health", 10000);
    if (!health.ok) {
      throw new Error(`api /health returned ${health.status}`);
    }

    const config = await fetchWithRetry("http://localhost:4100/config", 10000);
    if (!config.ok) {
      throw new Error(`api /config returned ${config.status}`);
    }

    const configJson = await config.json();
    log(`Smoke: API ok (activeSegmentId=${configJson.activeSegmentId})`);
  } finally {
    await stopProcess(api, "api");
  }

  log("Smoke: Admin Web");
  const adminLogs = [];
  const admin = run(NPM_CMD, ["run", "dev", "--workspace", "admin-web"]);
  attachLogs(admin, "[admin] ", adminLogs);

  try {
    await waitForLogMatch(admin, adminLogs, /(Ready in|Local:\s+http:\/\/localhost:3000)/i, 45000, "admin-web");
    const login = await fetchWithRetry("http://localhost:3000/login", 10000);
    if (!login.ok) {
      throw new Error(`admin /login returned ${login.status}`);
    }

    const html = await login.text();
    if (!html.toLowerCase().includes("admin login")) {
      throw new Error("admin /login content check failed");
    }

    log("Smoke: Admin web ok");
  } finally {
    await stopProcess(admin, "admin-web");
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
    await waitForLogMatch(
      mobile,
      mobileLogs,
      new RegExp(
        `(Starting Metro Bundler|Waiting on http:\\/\\/localhost:${metroPort}|Logs for your project will appear below)`,
        "i"
      ),
      60000,
      "mobile"
    );

    const metro = await fetchWithRetry(`http://localhost:${metroPort}`, 10000);
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
