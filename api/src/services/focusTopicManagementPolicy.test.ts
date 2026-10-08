import assert from "node:assert/strict";
import test from "node:test";

import type { ApiDatabase, EnterpriseOrg, OrgTrainingRecord, UserProfile } from "@voicepractice/shared";

import type { FocusTopicAssignment } from "./focusTopicAuthority.js";
import {
  resolveFocusTopicManagementScope,
  validateFocusTopicManagementGrant,
} from "./focusTopicManagementPolicy.js";

const org = { id: "org_a", name: "Org A", status: "active" } as EnterpriseOrg;
const topics = [
  { id: "topic_a", orgId: org.id, status: "active" },
  { id: "topic_b", orgId: org.id, status: "active" },
  { id: "topic_archived", orgId: org.id, status: "archived" },
] as OrgTrainingRecord[];

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    emailVerifiedAt: "2026-10-08T00:00:00.000Z",
    accountType: "enterprise",
    orgId: org.id,
    orgRole: "user",
    status: "active",
    isSuperUser: false,
    isPlatformAdmin: false,
    dashboardAccessEnabled: false,
    performanceAccess: "none",
    managerUserId: null,
    ...overrides,
  } as UserProfile;
}

function grant(params: Partial<FocusTopicAssignment> = {}): FocusTopicAssignment {
  return {
    id: "assignment_1",
    orgId: org.id,
    topicId: "topic_a",
    audience: "individual",
    subjectUserId: "actor",
    grantsManagement: true,
    createdBy: "admin",
    createdAt: "2026-10-08T00:00:00.000Z",
    revokedBy: null,
    revokedAt: null,
    ...params,
  };
}

function scope(params: {
  actor: UserProfile;
  users?: UserProfile[];
  assignments?: FocusTopicAssignment[];
  userAdminSwitch?: boolean;
  managerSwitch?: boolean;
}) {
  return resolveFocusTopicManagementScope({
    db: { users: params.users ?? [params.actor] } as ApiDatabase,
    actor: params.actor,
    organization: org,
    topics,
    assignments: params.assignments ?? [],
    productSettings: {
      allowUserAdminFocusTopicManagement: params.userAdminSwitch ?? false,
      allowManagerFocusTopicManagement: params.managerSwitch ?? false,
    },
  });
}

test("organization administrators manage every organization Topic", () => {
  const actor = user("actor", { orgRole: "org_admin" });
  const result = scope({ actor });
  assert.equal(result.canManageAllTopics, true);
  assert.deepEqual([...result.manageableTopicIds], ["topic_a", "topic_b", "topic_archived"]);
});

test("User Admin management requires both the switch and an explicit targeted grant", () => {
  const actor = user("actor", { orgRole: "user_admin", performanceAccess: "organization" });
  assert.equal(scope({ actor, assignments: [grant()] }).manageableTopicIds.size, 0);
  assert.equal(scope({ actor, userAdminSwitch: true }).manageableTopicIds.size, 0);
  assert.deepEqual(
    [...scope({ actor, userAdminSwitch: true, assignments: [grant()] }).manageableTopicIds],
    ["topic_a"],
  );
  assert.equal(actor.dashboardAccessEnabled, false);
  assert.equal(scope({
    actor: { ...actor, dashboardAccessEnabled: true }, userAdminSwitch: true,
  }).manageableTopicIds.size, 0);
});

test("broad learner audiences and learner-only targeted rows never grant management", () => {
  const actor = user("actor", { orgRole: "user_admin" });
  const rows = [
    grant({ id: "broad", audience: "organization", subjectUserId: null }),
    grant({ id: "learner", grantsManagement: false }),
  ];
  assert.equal(scope({ actor, userAdminSwitch: true, assignments: rows }).manageableTopicIds.size, 0);
});

test("revoked, cross-organization, inactive, and moved-user grants fail closed", () => {
  const actor = user("actor", { orgRole: "user_admin" });
  assert.equal(scope({
    actor, userAdminSwitch: true,
    assignments: [grant({ revokedAt: "2026-10-08T01:00:00.000Z", revokedBy: "admin" })],
  }).manageableTopicIds.size, 0);
  assert.equal(scope({
    actor, userAdminSwitch: true, assignments: [grant({ orgId: "org_b" })],
  }).manageableTopicIds.size, 0);
  assert.equal(scope({
    actor: { ...actor, status: "disabled" }, userAdminSwitch: true, assignments: [grant()],
  }).manageableTopicIds.size, 0);
  assert.equal(scope({
    actor: { ...actor, orgId: "org_b" }, userAdminSwitch: true, assignments: [grant()],
  }).manageableTopicIds.size, 0);
});

test("Manager management disappears with the switch, grant, or final active report", () => {
  const actor = user("actor");
  const report = user("report", { managerUserId: actor.id });
  const managerGrant = grant({ audience: "manager_only" });
  assert.equal(scope({ actor, users: [actor, report], assignments: [managerGrant] }).manageableTopicIds.size, 0);
  assert.equal(scope({ actor, users: [actor, report], managerSwitch: true }).manageableTopicIds.size, 0);
  assert.deepEqual([...scope({
    actor, users: [actor, report], assignments: [managerGrant], managerSwitch: true,
  }).manageableTopicIds], ["topic_a"]);
  assert.equal(scope({
    actor, users: [actor, { ...report, status: "disabled" }], assignments: [managerGrant], managerSwitch: true,
  }).manageableTopicIds.size, 0);
});

test("management grant validation permits only explicit User Admin and current Manager subjects", () => {
  const userAdmin = user("user_admin", { orgRole: "user_admin" });
  const manager = user("manager");
  const report = user("report", { managerUserId: manager.id });
  const db = { users: [userAdmin, manager, report] } as ApiDatabase;
  assert.equal(validateFocusTopicManagementGrant({
    db, organization: org, audience: "individual", subjectUserId: userAdmin.id,
  }).ok, true);
  assert.equal(validateFocusTopicManagementGrant({
    db, organization: org, audience: "manager_only", subjectUserId: manager.id,
  }).ok, true);
  assert.equal(validateFocusTopicManagementGrant({
    db, organization: org, audience: "manager_with_team", subjectUserId: manager.id,
  }).ok, false);
  assert.equal(validateFocusTopicManagementGrant({
    db, organization: org, audience: "organization", subjectUserId: null,
  }).ok, false);
  assert.equal(validateFocusTopicManagementGrant({
    db: { users: [manager] } as ApiDatabase,
    organization: org,
    audience: "manager_only",
    subjectUserId: manager.id,
  }).ok, false);
});
