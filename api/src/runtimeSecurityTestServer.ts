// Disposable subprocess fixture: exercises the real API without env files or providers.
import dotenv from "dotenv";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Socket, type AddressInfo } from "node:net";
import zlib from "node:zlib";
import type { EnterpriseOrg, UserProfile } from "@voicepractice/shared";
import type { RequestHandler } from "express";

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
  accountType: "enterprise", tier: "enterprise", status: "active", orgId: org.id, orgRole: "org_admin", dashboardAccessEnabled: true,
  timezone: "UTC", pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: now,
  manualBonusSeconds: 0, dailySecondsCapOverride: null, allowDailyOverageThisCycle: false,
  dailyOverageExpiresAt: null, createdAt: now, updatedAt: now,
};
db.orgs = [org]; db.users = [user, { ...user, id: "runtime_security_second", email: "second@example.test" }];
db.mobileAuthTokens = [{ userId: user.id,
  tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update("runtime_security_token").digest("hex"),
  createdAt: now, updatedAt: now }];
for (let i = 0; i < 5; i++) {
  const orgId = `org_ai_${i}`, userId = `runtime_ai_${i}`;
  db.orgs.push({ ...org, id: orgId, joinCode: `AI${i}` });
  db.users.push({ ...user, id: userId, email: `ai-${i}@example.test`, orgId });
  db.mobileAuthTokens.push({ userId, tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!)
    .update(`runtime_ai_token_${i}`).digest("hex"), createdAt: now, updatedAt: now });
}
await writeFile(process.env.DB_PATH, JSON.stringify(db), "utf8");
const { setAuthCodeDeliveryObserverForTest } = await import("./services/authCodeDelivery.js");
setAuthCodeDeliveryObserverForTest(message => process.send!({ kind: "verification-code", ...message }));

// Deterministic, IPC-only barriers around the real middleware. Gzip decoding
// completes normally; admission can then be resumed after the socket has closed.
const routeLayers = (api.app as unknown as { _router: { stack: Array<{
  route?: { path: string; stack: Array<{ handle: RequestHandler }> };
}> } })._router.stack;
const publicLayer = routeLayers.find(layer => layer.route?.path === "/web/auth/request-code")!.route!.stack[0];
const publicGuard = publicLayer.handle;
const pausedPublic = new Map<string, () => void>();
publicLayer.handle = (request, response, next) => {
  const id = request.headers["x-runtime-public-disconnect"];
  if (typeof id === "string") {
    pausedPublic.set(id, () => {
      let forwarded = false;
      publicGuard(request, response, error => { forwarded = true; next(error); });
      process.send!({ kind: "public-resumed", id, destroyed: response.destroyed, forwarded });
    });
    process.send!({ kind: "public-paused", id });
    return;
  }
  const hold = request.headers["x-runtime-public-hold"];
  if (typeof hold === "string") {
    publicGuard(request, response, () => process.send!({ kind: "public-admitted", id: hold }));
    return;
  }
  return publicGuard(request, response, next);
};
const aiLayer = routeLayers.find(layer => layer.route?.path === "/mobile/users/:userId/ai/transcribe")!.route!.stack[0];
const aiAuthentication = aiLayer.handle;
aiLayer.handle = (request, response, next) => {
  const pending = aiAuthentication(request, response, next);
  const id = request.headers["x-runtime-ai-disconnect"];
  if (typeof id === "string") {
    // The async authentication function queues withDatabaseRead before returning.
    process.send!({ kind: "ai-queued", id });
    return Promise.resolve(pending).then(() => process.send!({ kind: "ai-resumed", id, destroyed: response.destroyed }));
  }
  return pending;
};
let releaseDatabaseBarrier: (() => void) | undefined;

api.app.post("/__runtime_security/parsed", (request, response) => {
  if (request.readableEnded) response.json({ ok: true });
  else request.once("end", () => response.json({ ok: true }));
});
const server = api.app.listen(0, "127.0.0.1", () => {
  process.send!({ kind: "ready", port: (server.address() as AddressInfo).port });
});
// IPC-only acknowledgement of actual multipart admission, after authentication.
// This lets the regression hold uploads without sleeps or test HTTP endpoints.
server.prependListener("request", (request, response) => {
  const disconnectId = request.headers["x-runtime-public-disconnect"] ?? request.headers["x-runtime-ai-disconnect"]
    ?? request.headers["x-runtime-public-hold"];
  if (typeof disconnectId === "string") response.once("close", () => process.send?.({ kind: "disconnect-closed", id: disconnectId }));
  const id = request.headers["x-runtime-hold"];
  if (typeof id !== "string" || !request.url?.endsWith("/ai/transcribe")) return;
  const pipe = request.pipe;
  request.pipe = function (this: typeof request, ...args: Parameters<typeof pipe>) {
    process.send!({ kind: "ai-upload-admitted", id });
    return Reflect.apply(pipe, this, args);
  } as typeof pipe;
  response.once("close", () => process.send?.({ kind: "ai-upload-closed", id }));
});
process.on("message", (message: { kind?: string; id?: string }) => {
  if (message.kind === "resume-public" && message.id) {
    const resume = pausedPublic.get(message.id);
    if (!resume) throw new Error("No paused synthetic public request.");
    pausedPublic.delete(message.id); resume();
  }
  if (message.kind === "hold-database") {
    const barrier = new Promise<void>(resolve => { releaseDatabaseBarrier = resolve; });
    api.setDatabaseSaveBarrierForTest(async () => { process.send!({ kind: "database-held" }); await barrier; });
    process.send!({ kind: "database-armed" });
  }
  if (message.kind === "release-database") {
    api.setDatabaseSaveBarrierForTest(null); releaseDatabaseBarrier?.(); releaseDatabaseBarrier = undefined;
  }
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
    releaseDatabaseBarrier?.();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  }
});
