import assert from "node:assert/strict";
import test from "node:test";

import { UserProfile } from "@voicepractice/shared";

import { DASHBOARD_TRUSTED_SESSION_MINUTES } from "./dashboardSessionPolicy.js";
import { createWebAuthService } from "./webAuth.js";

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

test("trusted web auth session stores dashboard scope and device metadata", () => {
  const user = createUser();
  const now = new Date("2099-03-30T12:00:00.000Z");

  const issued = service.issueSession(user, 14 * 24 * 60, now, {
    accessType: "customer_dashboard_user",
    orgId: "org_a",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)",
    ipAddress: "203.0.113.15",
  });

  const payload = service.verifyToken(issued.token);
  assert.ok(payload);

  const record = issued.record;
  assert.ok(record);
  assert.equal(record.accessType, "customer_dashboard_user");
  assert.equal(record.orgId, "org_a");
  assert.equal(record.createdAt, now.toISOString());
  assert.equal(record.lastSeenAt, now.toISOString());
  assert.equal(record.createdUserAgent, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)");
  assert.equal(record.lastSeenUserAgent, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)");
  assert.equal(record.createdIp, "203.0.113.15");
  assert.equal(record.lastSeenIp, "203.0.113.15");
});

test("dashboard trusted session policy is fixed at exactly 14 days", () => {
  const user = createUser();
  const issuedAt = new Date("2026-03-30T12:00:00.000Z");

  const issued = service.issueSession(user, DASHBOARD_TRUSTED_SESSION_MINUTES, issuedAt, {
    accessType: "customer_dashboard_user",
    orgId: "org_a",
  });

  assert.equal(DASHBOARD_TRUSTED_SESSION_MINUTES, 14 * 24 * 60);
  assert.equal(issued.expiresAt, "2026-04-13T12:00:00.000Z");
});

test("trusted web auth session touch updates activity metadata only when needed", () => {
  const user = createUser();
  const issuedAt = new Date("2099-03-30T12:00:00.000Z");

  const issued = service.issueSession(user, 14 * 24 * 60, issuedAt, {
    accessType: "customer_dashboard_user",
    orgId: "org_a",
    userAgent: "Mozilla/5.0",
    ipAddress: "203.0.113.15",
  });

  const payload = service.verifyToken(issued.token);
  assert.ok(payload);
  const record = issued.record;
  assert.ok(record);

  const unchanged = service.touchSession(record, new Date("2099-03-30T12:05:00.000Z"), {
    userAgent: "Mozilla/5.0",
    ipAddress: "203.0.113.15",
  });
  assert.equal(unchanged, false);
  assert.equal(record.lastSeenAt, issuedAt.toISOString());

  const touched = service.touchSession(record, new Date("2099-03-30T12:20:00.000Z"), {
    userAgent: "Mozilla/5.0",
    ipAddress: "198.51.100.20",
  });
  assert.equal(touched, true);
  assert.equal(record.lastSeenAt, "2099-03-30T12:20:00.000Z");
  assert.equal(record.lastSeenIp, "198.51.100.20");
  assert.equal(record.lastSeenUserAgent, "Mozilla/5.0");
});

test("trusted web auth session expires and can be revoked explicitly", () => {
  const user = createUser();
  const issuedAt = new Date("2099-03-30T12:00:00.000Z");
  const issued = service.issueSession(user, 60, issuedAt, {
    accessType: "customer_dashboard_user",
    orgId: "org_a",
  });

  const payload = service.verifyToken(issued.token);
  assert.ok(payload);
  assert.equal(issued.record.sessionId, payload.sid);
  assert.equal(new Date(issued.record.expiresAt).getTime() > new Date("2099-03-30T12:30:00.000Z").getTime(), true);
  assert.equal(new Date(issued.record.expiresAt).getTime() <= new Date("2099-03-30T13:01:00.000Z").getTime(), true);
});
