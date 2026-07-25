import assert from "node:assert/strict";
import test from "node:test";

import { UserProfile } from "@voicepractice/shared";

import {
  EMPLOYEE_ID_MAX_LENGTH,
  findEmployeeIdConflict,
  normalizeEmployeeIdInput,
} from "./employeeIds.js";

function createUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    employeeId: overrides.employeeId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-07-25T00:00:00.000Z",
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "UTC",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-07-25T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-25T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-25T00:00:00.000Z",
  };
}

test("Employee ID normalization trims, clears blank strings, and enforces max length", () => {
  assert.deepEqual(normalizeEmployeeIdInput("  EMP-123  "), { ok: true, value: "EMP-123" });
  assert.deepEqual(normalizeEmployeeIdInput("   "), { ok: true, value: null });
  assert.deepEqual(normalizeEmployeeIdInput(null), { ok: true, value: null });

  const tooLong = normalizeEmployeeIdInput("X".repeat(EMPLOYEE_ID_MAX_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) {
    assert.equal(tooLong.code, "employee_id_invalid");
  }
});

test("Employee ID conflicts are organization-scoped and case-insensitive", () => {
  const users = [
    createUser({ id: "user_a", employeeId: "EMP-1", orgId: "org_1" }),
    createUser({ id: "user_b", employeeId: "EMP-1", orgId: "org_2" }),
  ];

  assert.equal(findEmployeeIdConflict({ users, orgId: "org_1", employeeId: "emp-1", exceptUserId: "user_a" }), null);
  assert.deepEqual(findEmployeeIdConflict({ users, orgId: "org_1", employeeId: " emp-1 " }), {
    code: "employee_id_conflict",
    orgId: "org_1",
  });
  assert.equal(findEmployeeIdConflict({ users, orgId: "org_3", employeeId: "EMP-1" }), null);
});
