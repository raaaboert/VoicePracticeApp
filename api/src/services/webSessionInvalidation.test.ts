import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDatabase, EnterpriseOrg, UserProfile } from "@voicepractice/shared";
import { collectWebSessionInvalidations } from "./webSessionInvalidation.js";

function user(id: string, changes: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.test`,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    status: "active",
    accountType: "enterprise",
    orgId: "org_1",
    orgRole: "user",
    dashboardAccessEnabled: true,
    ...changes,
  } as UserProfile;
}

function state(users: UserProfile[], status: EnterpriseOrg["status"] = "active"): Pick<ApiDatabase, "users" | "orgs"> {
  return { users, orgs: [{ id: "org_1", status } as EnterpriseOrg] };
}

test("every web authorization loss and re-grant purges prior sessions", () => {
  const base = user("target");
  const sensitiveChanges: Partial<UserProfile>[] = [
    { status: "disabled" },
    { dashboardAccessEnabled: false },
    { orgRole: "org_admin" },
    { isSuperUser: true },
    { isPlatformAdmin: true },
    { orgId: "org_2" },
    { accountType: "individual" },
    { performanceAccess: "organization" },
    { managerUserId: "manager" },
  ];
  for (const change of sensitiveChanges) {
    const changed = user("target", change);
    assert.deepEqual(collectWebSessionInvalidations(state([base]), state([changed])), ["target"]);
    assert.deepEqual(collectWebSessionInvalidations(state([changed]), state([base])), ["target"]);
  }
  assert.deepEqual(collectWebSessionInvalidations(state([base]), state([])), ["target"]);
  assert.deepEqual(collectWebSessionInvalidations(state([]), state([base])), ["target"]);
});

test("organization disable and re-enable purge member sessions without disturbing another organization", () => {
  const members = [user("a"), user("b"), user("other", { orgId: "org_2" })];
  assert.deepEqual(collectWebSessionInvalidations(state(members), state(members, "disabled")), ["a", "b"]);
  assert.deepEqual(collectWebSessionInvalidations(state(members, "disabled"), state(members)), ["a", "b"]);
  assert.deepEqual(collectWebSessionInvalidations(state(members), state(members)), []);
  assert.deepEqual(collectWebSessionInvalidations(state([user("a")]), state([user("a", { firstName: "Updated" })])), []);
});
