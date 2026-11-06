// Disposable subprocess fixture: exercises the real API without env files or providers.
import dotenv from "dotenv";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Socket, type AddressInfo } from "node:net";
import zlib from "node:zlib";
import type { EnterpriseOrg, UserProfile } from "@voicepractice/shared";

if (!process.send || process.env.NODE_ENV !== "test" || process.env.STORAGE_PROVIDER !== "file"
  || !process.env.DB_PATH || process.env.DATABASE_URL || process.env.OPENAI_API_KEY) {
  throw new Error("Runtime security fixture requires isolated storage and IPC.");
}
dotenv.config = () => ({ parsed: {} });
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[client-ip]")) process.send!({ kind: "proxy-warning", message: args[0] });
  else Reflect.apply(warn, console, args);
};
// Capture the real decoder so the test can deterministically reproduce a late
// error after raw-body has removed its listeners. Wire timing alone is unreliable.
let lastGunzip: zlib.Gunzip | undefined;
const createGunzip = zlib.createGunzip;
Object.defineProperty(zlib, "createGunzip", { configurable: true, value: (...args: Parameters<typeof createGunzip>) => {
  lastGunzip = createGunzip(...args);
  return lastGunzip;
} });
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
  const target = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = target && typeof target === "object" ? target as { host?: string; path?: string } : {};
  const host = options.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
  if (options.path || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("External connections are forbidden in the runtime security fixture.");
  }
  return Reflect.apply(connect, this, args);
} as Socket["connect"];

const api = await import("./index.js");
const db = api.createDefaultDatabase(), now = new Date().toISOString();
const org: EnterpriseOrg = {
  id: "org_runtime_security", name: "Synthetic security fixture", status: "active",
  contactName: "Fixture Owner", contactEmail: "owner@example.test", emailDomain: null,
  joinCode: "RUNTIME", activeIndustries: ["people_management"], dailySecondsQuota: 3600,
  perUserDailySecondsCap: 600, pendingPerUserDailySecondsCap: null,
  pendingPerUserDailySecondsCapEffectiveAt: null, manualBonusSeconds: 0, contractSignedAt: now,
  monthlyMinutesAllotted: 1000, renewalTotalUsd: 0, softLimitPercentTriggers: [],
  maxSimulationMinutes: 20, createdAt: now, updatedAt: now,
};
const user: UserProfile = {
  id: "runtime_security_user", email: "user@example.test", firstName: "Synthetic", lastName: "Tester",
  employeeId: null, emailVerifiedAt: now,
  accountType: "enterprise", tier: "enterprise", status: "active", orgId: org.id, orgRole: "org_admin",
  timezone: "UTC", pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: now,
  manualBonusSeconds: 0, dailySecondsCapOverride: null, allowDailyOverageThisCycle: false,
  dailyOverageExpiresAt: null, createdAt: now, updatedAt: now,
};
db.orgs = [org]; db.users = [user];
db.mobileAuthTokens = [{ userId: user.id,
  tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update("runtime_security_token").digest("hex"),
  createdAt: now, updatedAt: now }];
await writeFile(process.env.DB_PATH, JSON.stringify(db), "utf8");

api.app.post("/__runtime_security/parsed", (request, response) => {
  if (request.readableEnded) response.json({ ok: true });
  else request.once("end", () => response.json({ ok: true }));
});
const server = api.app.listen(0, "127.0.0.1", () => {
  process.send!({ kind: "ready", port: (server.address() as AddressInfo).port });
});
process.on("message", (message: { kind?: string }) => {
  if (message.kind === "late-decoder-error") {
    if (!lastGunzip) throw new Error("No gzip decoder was exercised.");
    lastGunzip.emit("error", Object.assign(new Error("Synthetic late gzip decoding failure"), { code: "Z_DATA_ERROR" }));
    process.send!({ kind: "decoder-error-handled" });
  }
  if (message.kind === "reset-rate-limits") {
    api.clearRateLimitsForTest();
    process.send!({ kind: "rate-limits-reset" });
  }
  if (message.kind === "stop") {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  }
});
