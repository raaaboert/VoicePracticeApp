import assert from "node:assert/strict";
import test from "node:test";

import {
  ORG_ACCESS_REQUIRED_CODE,
  resolveMobilePaidAiOrganizationAccess,
} from "./mobileAiAccessPolicy.js";

test("paid mobile AI requires approved active enterprise organization access", () => {
  for (const input of [
    { accountType: "individual" as const, userOrgId: null, isSuperUser: false, actingOrg: null },
    {
      accountType: "individual" as const,
      userOrgId: null,
      isSuperUser: false,
      actingOrg: { id: "org_1", status: "active" as const },
    },
    {
      accountType: "enterprise" as const,
      userOrgId: "org_1",
      isSuperUser: false,
      actingOrg: { id: "org_1", status: "disabled" as const },
    },
    { accountType: "enterprise" as const, userOrgId: null, isSuperUser: false, actingOrg: null },
  ]) {
    const decision = resolveMobilePaidAiOrganizationAccess(input);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, ORG_ACCESS_REQUIRED_CODE);
  }

  assert.deepEqual(
    resolveMobilePaidAiOrganizationAccess({
      accountType: "enterprise",
      userOrgId: "org_1",
      isSuperUser: false,
      actingOrg: { id: "org_1", status: "active" },
    }),
    { allowed: true, code: null, reason: null },
  );
});

test("superusers require an explicitly selected organization without inheriting individual access", () => {
  const withoutSelection = resolveMobilePaidAiOrganizationAccess({
    accountType: "individual",
    userOrgId: null,
    isSuperUser: true,
    actingOrg: null,
  });
  assert.equal(withoutSelection.allowed, false);
  assert.equal(withoutSelection.code, ORG_ACCESS_REQUIRED_CODE);

  assert.equal(
    resolveMobilePaidAiOrganizationAccess({
      accountType: "individual",
      userOrgId: null,
      isSuperUser: true,
      actingOrg: { id: "org_1", status: "active" },
    }).allowed,
    true,
  );
});
