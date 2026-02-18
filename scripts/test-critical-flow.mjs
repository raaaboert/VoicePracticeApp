#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function stopProcess(child, name) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (IS_WINDOWS && TASKKILL_CMD) {
    await new Promise((resolve) => {
      const killer = spawn(TASKKILL_CMD, ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
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
    delay(5000),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  log(`${name}: stopped`);
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

  throw new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}.`);
}

async function waitForReady(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // Continue polling until timeout.
    }

    await delay(500);
  }

  throw new Error(`API did not become ready within ${Math.floor(timeoutMs / 1000)}s.`);
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function apiRequest(baseUrl, pathName, options = {}) {
  const {
    method = "GET",
    adminToken = "",
    mobileToken = "",
    body = undefined,
    expectedStatus = 200,
  } = options;

  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const headers = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  } else if (mobileToken) {
    headers.Authorization = `Bearer ${mobileToken}`;
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? parseJsonSafe(text) : null;
  if (!expected.includes(response.status)) {
    const errorMessage = payload?.error ?? (text || "Unknown error");
    throw new Error(
      `${method} ${pathName} failed (${response.status}): ${errorMessage}`
    );
  }

  return payload;
}

function extractLatestVerificationCode(logs, email) {
  const joined = logs.join("");
  const regex = new RegExp(`\\[email-verification\\]\\s+${escapeRegExp(email)}\\s+code=(\\d{6})`, "gi");
  let match = regex.exec(joined);
  let latest = null;
  while (match) {
    latest = match[1];
    match = regex.exec(joined);
  }
  return latest;
}

async function waitForVerificationCode(logs, email, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const code = extractLatestVerificationCode(logs, email);
    if (code) {
      return code;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for email verification code for ${email}.`);
}

async function main() {
  const cwd = process.cwd();
  const port = await findAvailablePort(4176);
  const baseUrl = `http://localhost:${port}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "voicepractice-critical-flow-"));
  const dbPath = path.join(tempDir, "db.json");
  const logs = [];
  const apiEnv = {
    ...process.env,
    PORT: String(port),
    STORAGE_PROVIDER: "file",
    DB_PATH: dbPath,
    NODE_ENV: "development",
    ADMIN_BOOTSTRAP_PASSWORD: "admin",
    ADMIN_TOKEN_SECRET: "local-critical-flow-admin-token-secret",
    MOBILE_TOKEN_SECRET: "local-critical-flow-mobile-token-secret",
    SUPPORT_TRANSCRIPT_SECRET: "local-critical-flow-support-secret",
  };

  log("Starting API for critical-flow test...");
  const api = IS_WINDOWS
    ? spawn("cmd.exe", ["/d", "/s", "/c", `${NPM_CMD} run dev --workspace api`], {
        cwd,
        shell: false,
        env: apiEnv,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(NPM_CMD, ["run", "dev", "--workspace", "api"], {
        cwd,
        shell: false,
        env: apiEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

  api.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(`[api] ${text}`);
    logs.push(text);
  });
  api.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(`[api] ${text}`);
    logs.push(text);
  });

  try {
    await fetchWithRetry(`${baseUrl}/health`, 45_000);
    await waitForReady(baseUrl, 45_000);
    log("API is healthy and ready.");

    log("Logging in as platform admin...");
    const loginPayload = await apiRequest(baseUrl, "/auth/login", {
      method: "POST",
      body: { password: "admin" },
    });
    const adminToken = String(loginPayload?.token ?? "");
    if (!adminToken) {
      throw new Error("Admin login did not return a token.");
    }

    log("Creating enterprise org...");
    const org = await apiRequest(baseUrl, "/orgs", {
      method: "POST",
      adminToken,
      body: {
        name: "Critical Flow Org",
        contactName: "Critical Flow Owner",
        contactEmail: "owner@criticalflow.example",
        emailDomain: "criticalflow.example",
        activeIndustries: ["people_management"],
      },
      expectedStatus: 201,
    });
    const orgId = String(org?.id ?? "");
    const joinCode = String(org?.joinCode ?? "");
    if (!orgId || !joinCode) {
      throw new Error("Created org response missing id or joinCode.");
    }

    const onboardingEmail = "first.admin@criticalflow.example";
    log("Onboarding first mobile user...");
    const onboard = await apiRequest(baseUrl, "/mobile/onboard", {
      method: "POST",
      body: {
        email: onboardingEmail,
        timezone: "America/New_York",
      },
      expectedStatus: [200, 201],
    });
    const userId = String(onboard?.user?.id ?? "");
    const mobileToken = String(onboard?.authToken ?? "");
    if (!userId || !mobileToken) {
      throw new Error("Onboard response missing user id or auth token.");
    }
    if (!onboard?.verificationRequired) {
      throw new Error("Expected verificationRequired=true for newly onboarded user.");
    }

    log("Waiting for verification code in API logs...");
    const verificationCode = await waitForVerificationCode(logs, onboardingEmail, 20_000);

    log("Verifying email...");
    const verify = await apiRequest(baseUrl, "/mobile/onboard/verify-email", {
      method: "POST",
      mobileToken,
      body: {
        userId,
        code: verificationCode,
      },
    });
    if (!verify?.user?.emailVerifiedAt) {
      throw new Error("Email verification did not set emailVerifiedAt.");
    }

    log("Submitting org join request...");
    const joinRequest = await apiRequest(baseUrl, `/mobile/users/${encodeURIComponent(userId)}/org-access-requests`, {
      method: "POST",
      mobileToken,
      body: { joinCode },
      expectedStatus: [200, 201],
    });
    const requestId = String(joinRequest?.request?.id ?? "");
    if (!requestId) {
      throw new Error("Join request response missing request id.");
    }

    log("Approving org join request as org admin bootstrap...");
    await apiRequest(baseUrl, `/org-join-requests/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      adminToken,
      body: {
        action: "approve",
        assignOrgAdmin: true,
      },
    });

    log("Validating user enterprise membership...");
    const enterpriseUser = await apiRequest(baseUrl, `/users/${encodeURIComponent(userId)}`, {
      adminToken,
    });
    if (enterpriseUser?.accountType !== "enterprise") {
      throw new Error(`Expected accountType=enterprise, received ${enterpriseUser?.accountType ?? "unknown"}.`);
    }
    if (enterpriseUser?.orgId !== orgId) {
      throw new Error(`Expected orgId=${orgId}, received ${enterpriseUser?.orgId ?? "null"}.`);
    }
    if (enterpriseUser?.orgRole !== "org_admin") {
      throw new Error(`Expected orgRole=org_admin, received ${enterpriseUser?.orgRole ?? "unknown"}.`);
    }

    log("Checking audit trail contains key events...");
    const audit = await apiRequest(baseUrl, "/audit/events?limit=300", {
      adminToken,
    });
    const actions = new Set((audit?.rows ?? []).map((row) => row.action));
    for (const requiredAction of [
      "org.created",
      "mobile.user_created",
      "mobile.email_verified",
      "org_join.request_created",
      "org_join.approved_by_platform_admin",
    ]) {
      if (!actions.has(requiredAction)) {
        throw new Error(`Missing expected audit action "${requiredAction}".`);
      }
    }

    log("Deleting enterprise user...");
    await apiRequest(baseUrl, `/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      adminToken,
    });
    await apiRequest(baseUrl, `/users/${encodeURIComponent(userId)}`, {
      adminToken,
      expectedStatus: 404,
    });

    log("Critical-flow test passed.");
  } finally {
    await stopProcess(api, "api");
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
}

main().catch((error) => {
  console.error(`[${nowLabel()}] Critical-flow test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
