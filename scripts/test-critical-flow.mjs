#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const IS_WINDOWS = process.platform === "win32";
const TASKKILL_CMD = IS_WINDOWS ? "taskkill" : null;

function nowLabel() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${nowLabel()}] ${message}`);
}

function signalProcessTree(child, signal) {
  if (!IS_WINDOWS) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child.
    }
  }

  child.kill(signal);
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

  signalProcessTree(child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000),
  ]);
  if (child.exitCode === null) {
    signalProcessTree(child, "SIGKILL");
  }
  log(`${name}: stopped`);
}

async function fetchWithRetry(url, timeoutMs, child) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error("Critical Flow API exited before becoming healthy.");
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

async function waitForReady(baseUrl, timeoutMs, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error("Critical Flow API exited before becoming ready.");
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
  if (method === "POST" && pathName === "/orgs") {
    headers["Idempotency-Key"] = randomUUID();
  }
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

async function main() {
  if (["staging", "stage", "production", "prod"].includes(process.env.PERITIO_ENV?.toLowerCase())
    || process.env.NODE_ENV === "production"
    || ["RENDER", "RENDER_SERVICE_ID", "RENDER_GIT_COMMIT", "VERCEL", "VERCEL_ENV"].some(key => Object.hasOwn(process.env, key))) {
    throw new Error("Critical Flow is an offline test and cannot run in hosted application environments.");
  }
  const cwd = process.cwd();
  const port = await findAvailablePort(4176);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "voicepractice-critical-flow-"));
  const dbPath = path.join(tempDir, "db.json");
  const codes = new Map();
  const useBuiltApi = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";
  const inherited = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "ComSpec", "PATHEXT", "LOCALAPPDATA", "USERPROFILE", "APPDATA", "TEMP", "TMP"]) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  const apiEnv = {
    ...inherited,
    PORT: String(port),
    STORAGE_PROVIDER: "file",
    DB_PATH: dbPath,
    NODE_ENV: "test",
    PERITIO_ENV: "development",
    CRITICAL_FLOW_FIXTURE: "1",
    CRITICAL_FLOW_TEMP_DIR: tempDir,
    TSX_DISABLE_CACHE: "1",
    AUTH_CODE_DELIVERY_PROVIDER: "log_only",
    WEB_AUTH_CODE_DELIVERY_PROVIDER: "log_only",
    MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "log_only",
    MOBILE_REVERIFY_ON_ONBOARD: "true",
    TRAINING_CONTENT_STORAGE_PROVIDER: "disabled",
    ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
    ADMIN_BOOTSTRAP_PASSWORD: "admin",
    ADMIN_TOKEN_SECRET: "local-critical-flow-admin-token-secret",
    WEB_AUTH_TOKEN_SECRET: "local-critical-flow-web-auth-token-secret",
    MOBILE_TOKEN_SECRET: "local-critical-flow-mobile-token-secret",
    SUPPORT_TRANSCRIPT_SECRET: "local-critical-flow-support-secret",
  };

  log("Starting API for critical-flow test...");
  const api = spawn(process.execPath, [
    ...(!useBuiltApi ? ["--import", new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href] : []),
    fileURLToPath(new URL("./critical-flow-test-server.mjs", import.meta.url)), useBuiltApi ? "--built" : "--source",
  ], { cwd, detached: !IS_WINDOWS, windowsHide: true, env: apiEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  api.on("message", message => {
    if (message?.kind === "verification-code" && typeof message.email === "string"
      && typeof message.code === "string" && /^\d{6}$/.test(message.code)) codes.set(message.email.toLowerCase(), message.code);
  });

  api.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(`[api] ${text}`);
  });
  api.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(`[api] ${text}`);
  });

  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); api.off("message", ready); api.off("exit", exited); api.off("error", failed); };
      const ready = message => { if (message?.kind === "ready" && message.port === port) { cleanup(); resolve(); } };
      const exited = () => { cleanup(); reject(new Error("Isolated Critical Flow API exited before its readiness handshake.")); };
      const failed = () => { cleanup(); reject(new Error("Isolated Critical Flow API could not start.")); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Isolated Critical Flow API readiness timed out.")); }, 45_000);
      api.on("message", ready); api.once("exit", exited); api.once("error", failed);
    });
    await fetchWithRetry(`${baseUrl}/health`, 45_000, api);
    await waitForReady(baseUrl, 45_000, api);
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
    const onboardingFirstName = "Critical";
    const onboardingLastName = "Flow";
    log("Onboarding first mobile user...");
    const onboard = await apiRequest(baseUrl, "/mobile/onboard", {
      method: "POST",
      body: {
        email: onboardingEmail,
        firstName: onboardingFirstName,
        lastName: onboardingLastName,
        timezone: "America/New_York",
      },
      expectedStatus: [200, 201],
    });
    const userId = String(onboard?.user?.id ?? "");
    const interimMobileToken = String(onboard?.authToken ?? "");
    if (!userId || !interimMobileToken) {
      throw new Error("Onboard response missing user id or auth token.");
    }
    if (!onboard?.verificationRequired) {
      throw new Error("Expected verificationRequired=true for newly onboarded user.");
    }

    log("Receiving generated verification code through private test IPC...");
    const verificationCode = await new Promise((resolve, reject) => {
      const accept = message => {
        if (message?.kind === "verification-code" && typeof message.email === "string"
          && message.email.toLowerCase() === onboardingEmail && codes.has(onboardingEmail)) finish();
      };
      const timeout = setTimeout(() => { api.off("message", accept); reject(new Error("Test OTP delivery did not arrive.")); }, 5000);
      const finish = () => { clearTimeout(timeout); api.off("message", accept); const code = codes.get(onboardingEmail); codes.delete(onboardingEmail); resolve(code); };
      if (codes.has(onboardingEmail)) finish();
      else api.on("message", accept);
    });

    await apiRequest(baseUrl, "/mobile/onboard/verify-email", { method: "POST", mobileToken: interimMobileToken,
      body: { userId, code: String((Number(verificationCode) + 1) % 1_000_000).padStart(6, "0"),
        firstName: onboardingFirstName, lastName: onboardingLastName }, expectedStatus: 400 });

    log("Verifying email...");
    const verify = await apiRequest(baseUrl, "/mobile/onboard/verify-email", {
      method: "POST",
      mobileToken: interimMobileToken,
      body: {
        userId,
        code: verificationCode,
        firstName: onboardingFirstName,
        lastName: onboardingLastName,
      },
    });
    if (!verify?.user?.emailVerifiedAt) {
      throw new Error("Email verification did not set emailVerifiedAt.");
    }
    const mobileToken = String(verify?.authToken ?? "");
    if (!mobileToken) {
      throw new Error("Verify response missing mobile auth token.");
    }

    log("Confirming paid AI remains locked before organization approval...");
    const preApprovalEntitlements = await apiRequest(
      baseUrl,
      `/mobile/users/${encodeURIComponent(userId)}/entitlements`,
      { mobileToken },
    );
    if (preApprovalEntitlements?.canStartSimulation !== false) {
      throw new Error("Expected paid AI access to remain disabled before organization approval.");
    }
    if (preApprovalEntitlements?.lockCode !== "ORG_ACCESS_REQUIRED") {
      throw new Error(
        `Expected lockCode=ORG_ACCESS_REQUIRED, received ${preApprovalEntitlements?.lockCode ?? "null"}.`,
      );
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

    const approvedEntitlements = await apiRequest(
      baseUrl,
      `/mobile/users/${encodeURIComponent(userId)}/entitlements`,
      { mobileToken },
    );
    if (approvedEntitlements?.canStartSimulation !== true) {
      throw new Error(
        `Expected approved organization member to have paid AI access, received ${approvedEntitlements?.lockReason ?? "locked"}.`,
      );
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
    codes.clear();
    await stopProcess(api, "api");
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[${nowLabel()}] Critical-flow test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
