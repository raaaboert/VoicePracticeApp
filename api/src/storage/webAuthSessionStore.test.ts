import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UserProfile } from "@voicepractice/shared";

import { createWebAuthService } from "../services/webAuth.js";
import { createWebAuthSessionStore } from "./webAuthSessionStore.js";

function createUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "user_1",
    email: "trusted@example.com",
    emailVerifiedAt: "2026-03-30T00:00:00.000Z",
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: true,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_a",
    orgRole: "org_admin",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-03-01T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    ...overrides,
  };
}

const service = createWebAuthService({
  tokenSecret: "0123456789abcdef0123456789abcdef",
  codeSecret: "fedcba9876543210fedcba9876543210",
});

test("file web auth session store persists, loads, and revokes sessions independently of app state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-web-auth-store-"));
  try {
    const store = createWebAuthSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize();

    const issued = service.issueSession(createUser(), 60, new Date("2099-03-30T12:00:00.000Z"), {
      accessType: "customer_dashboard_user",
      orgId: "org_a",
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.15",
    });
    await store.saveSession(issued.record);

    const active = await store.getActiveSession(issued.sessionId, issued.record.userId, new Date("2099-03-30T12:30:00.000Z"));
    assert.ok(active);
    assert.equal(active.sessionId, issued.sessionId);
    assert.equal(active.lastSeenUserAgent, "Mozilla/5.0");

    await store.revokeSession(issued.sessionId);
    const missing = await store.getActiveSession(issued.sessionId, issued.record.userId, new Date("2099-03-30T12:30:00.000Z"));
    assert.equal(missing, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file web auth session store imports legacy active sessions and drops expired ones", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-web-auth-store-"));
  try {
    const store = createWebAuthSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000,
    });
    await store.initialize();

    const active = service.issueSession(createUser({ id: "user_active" }), 60, new Date("2099-03-30T12:00:00.000Z"), {
      accessType: "customer_dashboard_user",
      orgId: "org_a",
    }).record;
    const expired = service.issueSession(createUser({ id: "user_expired", email: "expired@example.com" }), 10, new Date("2026-03-30T12:00:00.000Z"), {
      accessType: "customer_dashboard_user",
      orgId: "org_a",
    }).record;

    const migration = await store.importLegacySessions([active, expired], {
      now: new Date("2099-03-30T12:30:00.000Z"),
    });
    assert.equal(migration.importedCount, 1);
    assert.equal(migration.skippedExpiredCount, 1);

    const activeRecord = await store.getActiveSession(active.sessionId, active.userId, new Date("2099-03-30T12:30:00.000Z"));
    const expiredRecord = await store.getActiveSession(expired.sessionId, expired.userId, new Date("2099-03-30T12:30:00.000Z"));
    assert.ok(activeRecord);
    assert.equal(expiredRecord, null);

    const revokedCount = await store.revokeSessionsForUsers([active.userId, "missing_user"]);
    assert.equal(revokedCount, 1);
    assert.equal(
      await store.getActiveSession(active.sessionId, active.userId, new Date("2099-03-30T12:30:00.000Z")),
      null
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
