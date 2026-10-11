import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryUserNotificationStoreForTest } from "../storage/userNotificationStore.js";
import { buildFocusTopicReminderInputs, runFocusTopicReminderSweep } from "./focusTopicReminderWorker.js";

const topic = { id: "topic", orgId: "org", name: "Due topic", description: "", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } as any;
const user = { id: "learner", accountType: "enterprise", orgId: "org", orgRole: "user", status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z", timezone: "America/Denver" } as any;
function assignment(overrides: Record<string, unknown> = {}): any { return { id: "assignment", orgId: "org", topicId: "topic", audience: "individual", subjectUserId: "learner", grantsManagement: false, dueDate: "2026-06-10", createdBy: "admin", createdAt: "2026-01-01T00:00:00.000Z", revokedBy: null, revokedAt: null, ...overrides }; }
function input(overrides: Record<string, unknown> = {}): any { return { db: { orgs: [{ id: "org", status: "active" }], orgTrainings: [topic], users: [user] } as any, authority: { assignments: [assignment()], scenarioAttachments: [], contentAttachments: [] }, ...overrides }; }

test("Focus Topic reminders schedule 7-day, 1-day, and overdue milestones at learner-local 8 AM", () => {
  assert.equal(buildFocusTopicReminderInputs({ ...input(), now: new Date("2026-06-03T14:00:00.000Z") }).map((row) => row.kind)[0], "topic_due_7d");
  assert.deepEqual(buildFocusTopicReminderInputs({ ...input(), now: new Date("2026-06-09T14:00:00.000Z") }).map((row) => row.kind), ["topic_due_1d"]);
  assert.deepEqual(buildFocusTopicReminderInputs({ ...input(), now: new Date("2026-06-11T14:00:00.000Z") }).map((row) => row.kind), ["topic_overdue"]);
  assert.deepEqual(buildFocusTopicReminderInputs({ ...input(), now: new Date("2026-06-03T13:59:00.000Z") }), []);
});

test("Focus Topic reminder sweep is durable, deduplicated, and evaluates current access", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  const now = new Date("2026-06-03T14:00:00.000Z");
  assert.deepEqual(await runFocusTopicReminderSweep({ ...input(), store, now }), { considered: 1, inserted: 1 });
  assert.deepEqual(await runFocusTopicReminderSweep({ ...input(), store, now }), { considered: 1, inserted: 0 });
  const removed = input({ authority: { assignments: [assignment({ revokedAt: now.toISOString() })], scenarioAttachments: [], contentAttachments: [] } });
  assert.deepEqual(await runFocusTopicReminderSweep({ ...removed, store, now }), { considered: 0, inserted: 0 });
  const archived = input({ db: { orgs: [{ id: "org", status: "active" }], orgTrainings: [{ ...topic, status: "archived" }], users: [user] }, authority: { assignments: [assignment({ id: "archived" })], scenarioAttachments: [], contentAttachments: [] } });
  assert.deepEqual(await runFocusTopicReminderSweep({ ...archived, store, now }), { considered: 0, inserted: 0 });
  const lostAccess = input({ db: { orgs: [{ id: "org", status: "active" }], orgTrainings: [topic], users: [{ ...user, status: "disabled" }] }, authority: { assignments: [assignment({ id: "lost-access" })], scenarioAttachments: [], contentAttachments: [] } });
  assert.deepEqual(await runFocusTopicReminderSweep({ ...lostAccess, store, now }), { considered: 0, inserted: 0 });
  const inactiveOrg = input({ db: { orgs: [{ id: "org", status: "disabled" }], orgTrainings: [topic], users: [user] }, authority: { assignments: [assignment({ id: "inactive-org" })], scenarioAttachments: [], contentAttachments: [] } });
  assert.deepEqual(await runFocusTopicReminderSweep({ ...inactiveOrg, store, now }), { considered: 0, inserted: 0 });
});

test("Focus Topic reminder dynamic audiences resolve current members at send time", () => {
  const manager = { ...user, id: "manager", orgRole: "user", timezone: "UTC" };
  const report = { ...user, id: "report", managerUserId: "manager", timezone: "UTC" };
  const result = buildFocusTopicReminderInputs({ db: { orgs: [{ id: "org", status: "active" }], orgTrainings: [topic], users: [manager, report] } as any, authority: { assignments: [assignment({ audience: "manager_with_team", subjectUserId: "manager" })], scenarioAttachments: [], contentAttachments: [] }, now: new Date("2026-06-03T08:00:00.000Z") });
  assert.deepEqual(result.map((row) => row.recipientUserId).sort(), ["manager", "report"]);
});

test("Focus Topic reminders stay scoped to the dated assignment audience", () => {
  const alice = { ...user, id: "alice", timezone: "UTC" };
  const bob = { ...user, id: "bob", timezone: "UTC" };
  const db = { orgs: [{ id: "org", status: "active" }], orgTrainings: [topic], users: [alice, bob] } as any;
  const now = new Date("2026-06-03T08:01:00.000Z");
  const individualDue = assignment({ id: "alice-due", subjectUserId: "alice" });
  const orgUndated = assignment({ id: "org-access", audience: "organization", subjectUserId: null, dueDate: null });
  assert.deepEqual(
    buildFocusTopicReminderInputs({ db, authority: { assignments: [individualDue, orgUndated], scenarioAttachments: [], contentAttachments: [] }, now }).map((row) => row.recipientUserId),
    ["alice"],
  );

  const bobDue = assignment({ id: "bob-due", subjectUserId: "bob", dueDate: "2026-06-10" });
  assert.deepEqual(
    buildFocusTopicReminderInputs({ db, authority: { assignments: [individualDue, bobDue], scenarioAttachments: [], contentAttachments: [] }, now }).map((row) => row.recipientUserId).sort(),
    ["alice", "bob"],
  );
});

test("Focus Topic reminders catch up after 8 AM and remain deduplicated", async () => {
  const store = createMemoryUserNotificationStoreForTest();
  const late = new Date("2026-06-04T08:01:00.000Z");
  const params = { ...input(), store, now: late };
  assert.deepEqual(await runFocusTopicReminderSweep(params), { considered: 1, inserted: 1 });
  assert.deepEqual(await runFocusTopicReminderSweep(params), { considered: 1, inserted: 0 });
  const revoked = { ...params, authority: { assignments: [assignment({ revokedAt: late.toISOString() })], scenarioAttachments: [], contentAttachments: [] } };
  assert.deepEqual(await runFocusTopicReminderSweep(revoked), { considered: 0, inserted: 0 });
});
