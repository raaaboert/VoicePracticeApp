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
import type {
  TrainingContentCurrentAssetRecord,
  TrainingContentManagementDetail,
} from "../storage/trainingContentStore.js";

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
    categoryId: "category_1",
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

function detail(
  overrides: Partial<TrainingContentItem> = {},
  assignments: TrainingContentAssignment[] = []
): TrainingContentManagementDetail {
  return {
    content: content(overrides),
    categoryName: "General",
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

function currentAsset(
  overrides: Partial<TrainingContentCurrentAssetRecord> = {}
): TrainingContentCurrentAssetRecord {
  return {
    id: "asset_current",
    orgId: "org_1",
    contentId: "content_1",
    assetRole: "primary",
    version: 1,
    uploadState: "ready",
    originalFilename: "training.mp4",
    declaredMimeType: "video/mp4",
    detectedMimeType: "video/mp4",
    fileExtension: "mp4",
    declaredByteSize: 1024,
    byteSize: 1024,
    uploadExpiresAt: null,
    processingAttemptCount: 0,
    processingNextAttemptAt: null,
    processingErrorCategory: null,
    rejectionReasonCategory: null,
    finalizedAt: NOW,
    supersededAt: null,
    replacementForAssetId: null,
    isCurrent: true,
    cleanupPending: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
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
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        focusTopicId: input.focusTopicId,
        focusTopicNameSnapshot: input.focusTopicNameSnapshot,
        contentType: input.contentType,
        nativeBody: input.nativeBody,
        externalUrl: input.externalUrl,
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
              "categoryId",
              "description",
              "focusTopicId",
              "focusTopicNameSnapshot",
              "nativeBody",
              "externalUrl",
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
    async deidentifyActor() {
      return 0;
    },
  };
  const defaultCategory = {
    id: "category_1",
    orgId: "org_1",
    name: "General",
    description: "",
    displayOrder: 0,
    isDefault: true,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    activeItemCount: 1,
    archivedItemCount: 0,
  };
  const categoryStore = {
    async initialize() {},
    async ensureDefaultCategory() {
      return defaultCategory;
    },
    async listCategories() {
      return { categories: [defaultCategory], orderRevision: NOW };
    },
    async getActiveCategoryForOrg(orgId: string, categoryId: string) {
      return orgId === "org_1" && categoryId === defaultCategory.id ? defaultCategory : null;
    },
    async createCategory(input: any) {
      const category = {
        ...defaultCategory,
        id: "category_2",
        name: input.name,
        description: input.description,
        isDefault: false,
        activeItemCount: 0,
      };
      return { category, categories: [defaultCategory, category], orderRevision: NOW };
    },
    async updateCategory(input: any) {
      const category = {
        ...defaultCategory,
        name: input.name ?? defaultCategory.name,
        description: input.description ?? defaultCategory.description,
      };
      return { category, categories: [category], orderRevision: NOW };
    },
    async reorderCategories() {
      return { categories: [defaultCategory], orderRevision: NOW };
    },
    async archiveCategory() {
      return {
        category: { ...defaultCategory, isDefault: false, archivedAt: NOW },
        movedItemCount: 1,
        categories: [defaultCategory],
        orderRevision: NOW,
      };
    },
    async getContentOrder() {
      return {
        groups: [{
          categoryId: defaultCategory.id,
          categoryName: defaultCategory.name,
          items: [{
            id: current.content.id,
            title: current.content.title,
            categoryId: defaultCategory.id,
            publicationState: "draft" as const,
            displayOrder: 0,
            updatedAt: NOW,
          }],
        }],
        orderRevision: NOW,
      };
    },
    async reorderContent() {
      return this.getContentOrder();
    },
  };
  const service = createTrainingContentManagementService({
    store: store as any,
    categoryStore: categoryStore as any,
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
  return {
    service,
    calls,
    store,
    categoryStore,
    setCurrent(next: ReturnType<typeof detail>) {
      current = next;
    },
  };
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

test("content categories are required, tenant-scoped, and distinct from optional Focus Topics", async () => {
  const { service, calls } = harness();
  const defaulted = await service.createContent({
    context,
    references,
    input: {
      contentType: "native",
      title: "General resource",
      nativeBody: "# General",
    },
  });
  assert.equal(defaulted.categoryId, "category_1");
  assert.equal(defaulted.categoryName, "General");
  assert.equal(defaulted.focusTopicId, null);
  assert.equal(calls.at(-1)?.input.categoryId, "category_1");

  const related = await service.createContent({
    context,
    references,
    input: {
      contentType: "native",
      categoryId: "category_1",
      title: "Related resource",
      focusTopicId: "topic_1",
      nativeBody: "# Related",
    },
  });
  assert.equal(related.categoryId, "category_1");
  assert.equal(related.focusTopicId, "topic_1");

  await assert.rejects(
    service.createContent({
      context,
      references,
      input: {
        contentType: "native",
        categoryId: "foreign_category",
        title: "Foreign category",
        nativeBody: "# No",
      },
    }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.status === 404
      && error.code === "training_content_category_not_found"
  );
});

test("category administration normalizes fields and validates complete ordered ID payloads", async () => {
  const { service } = harness();
  const listed = await service.listCategories({ context });
  assert.deepEqual(listed.categories.map((entry) => entry.name), ["General"]);

  const created = await service.createCategory({
    context,
    input: { name: "  Leadership  ", description: "  Manager resources  " },
  });
  assert.equal(created.category.name, "Leadership");
  assert.equal(created.category.description, "Manager resources");

  const updated = await service.updateCategory({
    context,
    categoryId: "category_1",
    input: { expectedUpdatedAt: NOW, name: " Core " },
  });
  assert.equal(updated.category.name, "Core");

  await assert.rejects(
    service.reorderCategories({
      context,
      input: {
        expectedOrderRevision: NOW,
        categoryIds: ["category_1", "category_1"],
      },
    }),
    /duplicate IDs/
  );
  await assert.rejects(
    service.reorderContent({
      context,
      input: {
        expectedOrderRevision: NOW,
        categories: [
          { categoryId: "category_1", contentIds: ["content_1"] },
          { categoryId: "category_1", contentIds: [] },
        ],
      },
    }),
    /duplicate category IDs/
  );
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

test("publishing ignores assignments whose user or manager is no longer active", async () => {
  const direct = harness();
  await direct.service.updateAssignments({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      availableToEveryone: false,
      userIds: ["learner"],
      managerIds: [],
      managerTeamIds: [],
    },
  });
  const referencesWithInactiveLearner = {
    ...references,
    users: references.users.map((entry) =>
      entry.id === "learner" ? { ...entry, status: "disabled" as const } : entry
    ),
  };
  await assert.rejects(
    direct.service.transitionContent({
      context,
      references: referencesWithInactiveLearner,
      contentId: "content_1",
      action: "publish",
      input: { expectedUpdatedAt: NOW },
    }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.status === 422
      && error.code === "training_content_publish_invalid"
      && Array.isArray(error.details?.reasons)
      && error.details.reasons.includes("assignment_required")
  );
  assert.equal(direct.calls.some((call) => call.method === "transition"), false);

  const manager = harness();
  await manager.service.updateAssignments({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      availableToEveryone: false,
      userIds: [],
      managerIds: ["manager"],
      managerTeamIds: ["manager"],
    },
  });
  const referencesWithDemotedManager = {
    ...references,
    users: references.users.map((entry) =>
      entry.id === "manager" ? { ...entry, orgRole: "user" as const } : entry
    ),
  };
  await assert.rejects(
    manager.service.transitionContent({
      context,
      references: referencesWithDemotedManager,
      contentId: "content_1",
      action: "publish",
      input: { expectedUpdatedAt: NOW },
    }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.code === "training_content_publish_invalid"
  );
  assert.equal(manager.calls.some((call) => call.method === "transition"), false);
});

test("published assignment updates require a currently effective target", async () => {
  const published = harness();
  published.setCurrent(detail(
    { publicationState: "published" },
    [assignment("user", "learner")]
  ));
  const referencesWithInactiveLearner = {
    ...references,
    users: references.users.map((entry) =>
      entry.id === "learner" ? { ...entry, status: "disabled" as const } : entry
    ),
  };

  await assert.rejects(
    published.service.updateAssignments({
      context,
      references: referencesWithInactiveLearner,
      contentId: "content_1",
      input: {
        expectedUpdatedAt: NOW,
        availableToEveryone: false,
        userIds: [],
        managerIds: [],
        managerTeamIds: [],
      },
    }),
    (error: unknown) =>
      error instanceof TrainingContentManagementServiceError
      && error.status === 422
      && error.code === "training_content_publish_invalid"
  );
  assert.equal(published.calls.some((call) => call.method === "assign"), false);
});

test("list filters are bounded and unusual search input remains a parameter value", async () => {
  const { service, calls } = harness();
  await service.listContent({
    context,
    references,
    filters: {
      query: "%_\\'; DROP TABLE org_content_items; --",
      categoryId: "category_1",
      contentType: "native",
      publicationState: "draft",
      page: "2",
      pageSize: "50",
      sort: "title_asc",
    },
  });
  assert.equal(calls[0]?.method, "list");
  assert.equal(calls[0]?.input.query, "%_\\'; DROP TABLE org_content_items; --");
  assert.equal(calls[0]?.input.categoryId, "category_1");
  assert.equal(calls[0]?.input.page, 2);
  assert.equal(calls[0]?.input.pageSize, 50);
});

test("management responses expose an active video replacement for list and editor persistence", async () => {
  const { service, setCurrent } = harness();
  const processing = currentAsset({
    id: "asset_processing",
    version: 2,
    uploadState: "processing",
    finalizedAt: null,
    replacementForAssetId: "asset_current",
    isCurrent: false,
  });
  setCurrent({
    ...detail({ contentType: "video" }),
    currentAsset: currentAsset(),
    hasActiveVideoProcessing: true,
    latestVideoUploadAsset: processing,
  });

  const listed = await service.listContent({ context, references });
  assert.equal(listed.items[0]?.hasActiveVideoProcessing, true);

  const loaded = await service.getContent({
    context,
    references,
    contentId: "content_1",
  });
  assert.equal(loaded.currentAsset?.id, "asset_current");
  assert.equal(loaded.latestVideoUploadAsset?.id, "asset_processing");
  assert.equal(loaded.latestVideoUploadAsset?.uploadState, "processing");
  assert.equal(loaded.latestVideoUploadAsset?.processingAttemptCount, 0);
});
