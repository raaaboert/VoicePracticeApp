import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrgTrainingRecord,
  TrainingContentAssignment,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import { buildDashboardAdminCapabilities } from "./dashboardAuthorization.js";
import {
  createTrainingContentManagementService,
  TrainingContentManagementServiceError,
} from "./trainingContentManagementService.js";

const NOW = "2026-07-28T12:00:00.000Z";

function user(
  id: string,
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: id,
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    timezone: "UTC",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function topic(
  id: string,
  overrides: Partial<OrgTrainingRecord> = {}
): OrgTrainingRecord {
  return {
    id,
    orgId: "org_1",
    name: "Coaching",
    status: "active",
    description: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function content(overrides: Partial<TrainingContentItem> = {}): TrainingContentItem {
  return {
    id: "content_1",
    orgId: "org_1",
    title: "Coaching foundation",
    description: "Practice better coaching.",
    focusTopicId: "topic_1",
    focusTopicNameSnapshot: "Coaching",
    contentType: "native",
    publicationState: "draft",
    nativeBody: "# Foundation",
    externalUrl: null,
    displayOrder: 0,
    contentVersion: 1,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<TrainingContentItem> = {}, assignments: TrainingContentAssignment[] = []) {
  return {
    content: content(overrides),
    currentAsset: null,
    assignments,
    assignmentCounts: {
      organization: assignments.filter((entry) => entry.assignmentType === "organization").length,
      user: assignments.filter((entry) => entry.assignmentType === "user").length,
      manager: assignments.filter((entry) => entry.assignmentType === "manager").length,
      managerTeam: assignments.filter((entry) => entry.assignmentType === "manager_team").length,
    },
  };
}

function assignment(
  assignmentType: TrainingContentAssignment["assignmentType"],
  subjectUserId: string | null
): TrainingContentAssignment {
  return {
    id: `${assignmentType}_${subjectUserId ?? "org"}`,
    orgId: "org_1",
    contentId: "content_1",
    assignmentType,
    subjectUserId,
    createdByActorId: "admin",
    createdAt: NOW,
    revokedByActorId: null,
    revokedAt: null,
  };
}

function harness(enabled = true) {
  const calls: Array<{ method: string; input: any }> = [];
  let current = detail();
  const store = {
    async initialize() {},
    async listContentItemsForOrg() { return [current.content]; },
    async getContentItemForOrg() { return current.content; },
    async listContentForManagement(_orgId: string, filters: unknown) {
      calls.push({ method: "list", input: filters });
      return { items: [current], page: 1, pageSize: 25, total: 1 };
    },
    async getContentDetailForOrg(orgId: string, contentId: string) {
      return orgId === "org_1" && contentId === current.content.id ? current : null;
    },
    async createContent(input: any) {
      calls.push({ method: "create", input });
      current = detail({
        id: "created",
        title: input.title,
        description: input.description,
        focusTopicId: input.focusTopicId,
        focusTopicNameSnapshot: input.focusTopicNameSnapshot,
        contentType: input.contentType,
        nativeBody: input.nativeBody,
        externalUrl: input.externalUrl,
        displayOrder: input.displayOrder,
      });
      return current;
    },
    async updateContent(input: any) {
      calls.push({ method: "update", input });
      current = detail({
        ...current.content,
        ...Object.fromEntries(
          Object.entries(input).filter(([key, value]) =>
            value !== undefined && [
              "title",
              "description",
              "focusTopicId",
              "focusTopicNameSnapshot",
              "nativeBody",
              "externalUrl",
              "displayOrder",
            ].includes(key)
          )
        ),
      }, current.assignments);
      return current;
    },
    async replaceAssignments(input: any) {
      calls.push({ method: "assign", input });
      current = {
        ...current,
        assignments: input.assignments.map((entry: any, index: number) => ({
          ...assignment(entry.assignmentType, entry.subjectUserId),
          id: `assignment_${index}`,
        })),
      };
      current.assignmentCounts = {
        organization: current.assignments.filter((entry) => entry.assignmentType === "organization").length,
        user: current.assignments.filter((entry) => entry.assignmentType === "user").length,
        manager: current.assignments.filter((entry) => entry.assignmentType === "manager").length,
        managerTeam: current.assignments.filter((entry) => entry.assignmentType === "manager_team").length,
      };
      return current;
    },
    async transitionContent(input: any) {
      calls.push({ method: "transition", input });
      return current;
    },
  };
  const entitlement = {
    async initialize() {},
    async getOrgModuleEntitlement(orgId: string) {
      return {
        orgId,
        moduleKey: "training_content" as const,
        enabled,
        updatedByActorId: null,
        updatedAt: null,
      };
    },
    async setOrgModuleEntitlement() {
      throw new Error("not used");
    },
  };
  const service = createTrainingContentManagementService({
    store: store as any,
    entitlementStore: entitlement,
    storageConfig: {
      fileSizeLimits: {
        video: 500,
        audio: 100,
        pdf: 50,
        docx: 25,
        image: 20,
      },
    } as any,
  });
  return { service, calls, store };
}

const context = {
  orgId: "org_1",
  actorId: "admin",
  capabilities: buildDashboardAdminCapabilities("org_admin"),
};

const references = {
  users: [
    user("admin", { orgRole: "org_admin" }),
    user("learner", { employeeId: "EMP-1" }),
    user("manager", { orgRole: "user_admin" }),
    user("inactive", { status: "disabled" }),
    user("other", { orgId: "org_2" }),
  ],
  focusTopics: [
    topic("topic_1"),
    topic("archived_topic", { status: "archived" }),
    topic("other_topic", { orgId: "org_2" }),
  ],
};

test("management requires both module entitlement and server-derived capability", async () => {
  const disabled = harness(false).service;
  await assert.rejects(
    disabled.listContent({ context, references }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.code === "module_disabled"
  );

  const denied = harness().service;
  await assert.rejects(
    denied.listContent({
      context: {
        ...context,
        capabilities: buildDashboardAdminCapabilities("user_admin"),
      },
      references,
    }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.code === "dashboard_scope_denied"
  );
});

test("native creation accepts constrained Markdown and rejects raw HTML, images, and unsafe links", async () => {
  const { service, calls } = harness();
  const created = await service.createContent({
    context,
    references,
    input: {
      contentType: "native",
      title: "  Native coaching  ",
      focusTopicId: "topic_1",
      nativeBody: "# Coaching\n\nUse **clear goals** and [this guide](https://example.com/guide).",
    },
  });
  assert.equal(created.title, "Native coaching");
  assert.equal(calls[0]?.input.focusTopicNameSnapshot, "Coaching");

  for (const nativeBody of [
    "<script>alert(1)</script>",
    "![inline](https://example.com/image.png)",
    "[bad](javascript:alert(1))",
    "[data](data:text/html,hello)",
  ]) {
    await assert.rejects(
      service.createContent({
        context,
        references,
        input: { contentType: "native", title: "Unsafe", nativeBody },
      }),
      (error: unknown) =>
        error instanceof TrainingContentManagementServiceError
        && error.code === "training_content_invalid"
    );
  }
});

test("external content requires HTTPS without embedded credentials and file drafts reject source fields", async () => {
  const { service } = harness();
  const external = await service.createContent({
    context,
    references,
    input: {
      contentType: "external_url",
      title: "Reference",
      externalUrl: "https://example.com/reference?q=1",
    },
  });
  assert.equal(external.externalUrl, "https://example.com/reference?q=1");

  for (const externalUrl of [
    "http://example.com",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///tmp/file",
    "https://user:secret@example.com",
  ]) {
    await assert.rejects(
      service.createContent({
        context,
        references,
        input: { contentType: "external_url", title: "Unsafe", externalUrl },
      }),
      /must use HTTPS/
    );
  }
  await assert.rejects(
    service.createContent({
      context,
      references,
      input: { contentType: "pdf", title: "PDF", nativeBody: "# Wrong" },
    }),
    /only valid for Native/
  );
});

test("focus topics and assignment targets are same-org, active, and role validated", async () => {
  const { service } = harness();
  await assert.rejects(
    service.createContent({
      context,
      references,
      input: {
        contentType: "native",
        title: "Cross org",
        focusTopicId: "other_topic",
      },
    }),
    /no longer available/
  );
  assert.deepEqual(
    (await service.listFocusTopics({ context, references })).map((entry) => entry.id),
    ["topic_1"]
  );
  assert.deepEqual(
    (await service.listUserTargets({ context, references, query: "EMP" }))
      .map((entry) => entry.userId),
    ["learner"]
  );
  assert.deepEqual(
    (await service.listManagerTargets({ context, references, query: "" }))
      .map((entry) => entry.userId),
    ["manager"]
  );
  assert.deepEqual(
    await service.listUserTargets({ context, references, query: "E" }),
    []
  );
});

test("assignment writes preserve separate manager and team rules and reject invalid targets", async () => {
  const { service, calls } = harness();
  const updated = await service.updateAssignments({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      availableToEveryone: true,
      userIds: ["learner", "learner"],
      managerIds: ["manager"],
      managerTeamIds: ["manager"],
    },
  });
  assert.equal(updated.assignments.availableToEveryone, true);
  assert.deepEqual(
    calls[0]?.input.assignments.map((entry: any) => `${entry.assignmentType}:${entry.subjectUserId ?? ""}`),
    ["organization:", "user:learner", "manager:manager", "manager_team:manager"]
  );

  for (const invalid of [
    { userIds: ["other"], managerIds: [], managerTeamIds: [] },
    { userIds: ["inactive"], managerIds: [], managerTeamIds: [] },
    { userIds: [], managerIds: ["learner"], managerTeamIds: [] },
  ]) {
    await assert.rejects(
      service.updateAssignments({
        context,
        references,
        contentId: "content_1",
        input: {
          expectedUpdatedAt: NOW,
          availableToEveryone: false,
          ...invalid,
        },
      }),
      /selected/
    );
  }
});

test("list filters are bounded and unusual search input remains a parameter value", async () => {
  const { service, calls } = harness();
  await service.listContent({
    context,
    references,
    filters: {
      query: "%_\\'; DROP TABLE org_content_items; --",
      contentType: "native",
      publicationState: "draft",
      page: "2",
      pageSize: "50",
      sort: "title_asc",
    },
  });
  assert.equal(calls[0]?.method, "list");
  assert.equal(calls[0]?.input.query, "%_\\'; DROP TABLE org_content_items; --");
  assert.equal(calls[0]?.input.page, 2);
  assert.equal(calls[0]?.input.pageSize, 50);
});
