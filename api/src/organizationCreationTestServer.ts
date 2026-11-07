// Offline subprocess fixture for organizationCreationRoute.test.ts, not an app entry point.
import dotenv from "dotenv";
import { createHmac } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { Socket, type AddressInfo } from "node:net";
import type { EnterpriseOrg, UserProfile } from "@voicepractice/shared";

if (!process.send || process.env.NODE_ENV !== "test" || process.env.STORAGE_PROVIDER !== "file"
  || process.env.DATABASE_URL || process.env.OPENAI_API_KEY || !process.env.DB_PATH) {
  throw new Error("Organization creation fixture requires isolated file storage and IPC.");
}
// The production entry point calls dotenv.config at import time. Never read a local env file.
dotenv.config = () => ({ parsed: {} });
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
  const target = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = target && typeof target === "object" ? target as { host?: string; path?: string } : {};
  const host = options.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
  if (options.path || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("External connections are forbidden in this offline fixture.");
  }
  return Reflect.apply(connect, this, args);
} as Socket["connect"];
const api = await import("./index.js");
try { await access(process.env.DB_PATH); }
catch {
  const db = api.createDefaultDatabase();
  const now = new Date().toISOString();
  const org = (id: string): EnterpriseOrg => ({
    id, name: id, status: "active", contactName: "Test Owner", contactEmail: "owner@example.test",
    emailDomain: null, joinCode: id, activeIndustries: ["people_management"], dailySecondsQuota: 3600,
    perUserDailySecondsCap: 600, pendingPerUserDailySecondsCap: null, pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0, contractSignedAt: now, monthlyMinutesAllotted: 1000, renewalTotalUsd: 0,
    softLimitPercentTriggers: [], maxSimulationMinutes: 20, createdAt: now, updatedAt: now,
  });
  db.orgs = [org("org_retry_tenant_a"), org("org_retry_tenant_b")];
  db.users = db.orgs.map((entry, i): UserProfile => ({
    id: `retry_customer_${i}`, email: `customer${i}@example.test`, employeeId: null, emailVerifiedAt: now,
    accountType: "enterprise", tier: "enterprise", status: "active", orgId: entry.id, orgRole: "org_admin",
    timezone: "UTC", pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: now,
    manualBonusSeconds: 0, dailySecondsCapOverride: null, allowDailyOverageThisCycle: false, dailyOverageExpiresAt: null,
    createdAt: now, updatedAt: now,
  }));
  db.mobileAuthTokens = db.users.map((user, i) => ({
    userId: user.id,
    tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update(`retry_customer_token_${i}`).digest("hex"),
    createdAt: now, updatedAt: now,
  }));
  await writeFile(process.env.DB_PATH, JSON.stringify(db), "utf8");
}

let dropNextResponse = false;
const server = api.app.listen(0, "127.0.0.1", () => {
  process.send!({ kind: "ready", port: (server.address() as AddressInfo).port });
});
server.prependListener("request", (request, response) => {
  if (dropNextResponse && request.method === "POST" && request.url === "/orgs") {
    dropNextResponse = false;
    // Express calls end only after its commit. Simulate response loss, not rollback.
    response.end = (() => { response.destroy(); return response; }) as typeof response.end;
  }
});
process.on("message", (message: { kind: string }) => {
  if (message.kind === "drop-response") dropNextResponse = true;
  if (message.kind === "fail-save") api.setDatabaseSaveBarrierForTest(async () => {
    api.setDatabaseSaveBarrierForTest(null);
    throw new Error("Injected organization app-state save failure.");
  });
  if (message.kind === "stop") {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    return;
  }
  process.send!({ kind: "ack" });
});
