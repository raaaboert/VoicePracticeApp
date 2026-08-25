import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppConfig,
  EnterpriseOrg,
  OrgCustomScenario,
  OrgTrainingRecord,
  TrainingContentAssignment,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import { buildDashboardAdminCapabilities } from "./dashboardAuthorization.js";
import {
  createTrainingContentManagementService,
  mapTrainingContentManagementServiceError,
  type TrainingContentReferenceData,
  TrainingContentManagementServiceError,
} from "./trainingContentManagementService.js";
import {
  createTrainingContentScenarioLinkService,
  TrainingContentScenarioLinkServiceError,
} from "./trainingContentScenarioLinks.js";
import type {
  ReplaceTrainingContentScenarioLinksInput,
  TrainingContentCurrentAssetRecord,
  TrainingContentManagementDetail,
  TrainingContentScenarioLink,
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

function harness(
  enabled = true,
  options: { scenarioReplacementError?: Error } = {}
) {
  const calls: Array<{ method: string; input: any }> = [];
  let current = detail();
  let scenarioLinks: TrainingContentScenarioLink[] = [];
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
    async listActiveScenarioLinksForContent(orgId: string, contentId: string) {
      return scenarioLinks.filter((link) => link.orgId === orgId && link.contentId === contentId);
    },
    async listActiveScenarioLinksForScenario(orgId: string, scenarioId: string) {
      return scenarioLinks.filter((link) => link.orgId === orgId && link.scenarioId === scenarioId);
    },
    async replaceActiveScenarioLinksForContent(input: ReplaceTrainingContentScenarioLinksInput) {
      calls.push({ method: "replaceLinks", input });
      if (options.scenarioReplacementError) {
        throw options.scenarioReplacementError;
      }
      scenarioLinks = input.scenarioIds.map((scenarioId, index) => ({
        id: `link_${index + 1}`,
        orgId: input.orgId,
        contentId: input.contentId,
        focusTopicId: null,
        scenarioId,
        createdByActorId: input.actor.actorId,
        createdAt: NOW,
        removedByActorId: null,
        removedAt: null,
      }));
      return scenarioLinks;
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
    scenarioLinkService: createTrainingContentScenarioLinkService(store as any),
  });
  return {
    service,
    calls,
    store,
    categoryStore,
    setCurrent(next: ReturnType<typeof detail>) {
      current = next;
    },
    setScenarioLinks(scenarioIds: string[]) {
      scenarioLinks = scenarioIds.map((scenarioId, index) => ({
        id: `existing_link_${index + 1}`,
        orgId: "org_1",
        contentId: current.content.id,
        focusTopicId: null,
        scenarioId,
        createdByActorId: "admin",
        createdAt: NOW,
        removedByActorId: null,
        removedAt: null,
      }));
    },
    getScenarioLinks() {
      return scenarioLinks;
    },
  };
}

const context = {
  orgId: "org_1",
  actorId: "admin",
  capabilities: buildDashboardAdminCapabilities("org_admin"),
};

const scenarioConfig: Pick<AppConfig, "segments" | "industries" | "roleIndustries"> = {
  industries: [
    { id: "sales", label: "Sales", enabled: true },
    { id: "medical", label: "Medical", enabled: true },
  ],
  roleIndustries: [
    { roleId: "sales_role", industryId: "sales", active: true },
    { roleId: "disabled_sales_role", industryId: "sales", active: true },
    { roleId: "medical_role", industryId: "medical", active: true },
  ],
  segments: [
    {
      id: "sales_role",
      label: "Sales",
      summary: "Sales scenarios",
      enabled: true,
      scenarios: [
        {
          id: "standard_a",
          segmentId: "sales_role",
          title: "Standard A",
          description: "Standard A",
          aiRole: "Buyer",
        },
        {
          id: "standard_b",
          segmentId: "sales_role",
          title: "Standard B",
          description: "Standard B",
          aiRole: "Buyer",
        },
        {
          id: "standard_disabled",
          segmentId: "sales_role",
          title: "Disabled standard",
          description: "Disabled",
          aiRole: "Buyer",
          enabled: false,
        },
      ],
    },
    {
      id: "disabled_sales_role",
      label: "Disabled Sales",
      summary: "Disabled Sales scenarios",
      enabled: false,
      scenarios: [{
        id: "standard_disabled_segment",
        segmentId: "disabled_sales_role",
        title: "Disabled segment standard",
        description: "Disabled segment standard",
        aiRole: "Buyer",
        enabled: true,
      }],
    },
    {
      id: "medical_role",
      label: "Medical",
      summary: "Medical scenarios",
      enabled: true,
      scenarios: [{
        id: "standard_hidden",
        segmentId: "medical_role",
        title: "Hidden standard",
        description: "Hidden",
        aiRole: "Patient",
      }],
    },
  ],
};

function customScenario(overrides: Partial<OrgCustomScenario> = {}): OrgCustomScenario {
  return {
    id: "custom_a",
    orgId: "org_1",
    segmentId: "sales_role",
    title: "Custom A",
    description: "Custom A",
    aiRole: "Buyer",
    scoringGuidance: "Score it",
    applicableIndustryIds: ["sales"],
    enabled: true,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const scenarioOrg: Pick<
  EnterpriseOrg,
  "id" | "activeIndustries" | "customScenarios"
> = {
  id: "org_1",
  activeIndustries: ["sales"],
  customScenarios: [
    customScenario(),
    customScenario({ id: "custom_disabled", title: "Disabled custom", enabled: false }),
    customScenario({ id: "custom_cross_org", title: "Cross-org custom", orgId: "org_2" }),
  ],
};

const references: TrainingContentReferenceData = {
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
  scenarioConfig,
  scenarioOrg,
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

test("scenario options expose role metadata and only active same-org custom Focus Topics", async () => {
  const { service } = harness();
  const scenarioReferences: TrainingContentReferenceData = {
    ...references,
    focusTopics: [
      topic("topic_1", { name: "Prospecting" }),
      topic("topic_2", { name: "Discovery" }),
      topic("draft_topic", { name: "Draft topic", status: "draft" }),
      topic("archived_topic", { status: "archived" }),
      topic("other_topic", { orgId: "org_2" }),
    ],
    focusTopicScenarioAttachments: [
      { id: "attachment_1", orgId: "org_1", trainingId: "topic_1", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_2", orgId: "org_1", trainingId: "topic_2", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_duplicate", orgId: "org_1", trainingId: "topic_1", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_draft", orgId: "org_1", trainingId: "draft_topic", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_archived", orgId: "org_1", trainingId: "archived_topic", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_foreign_topic", orgId: "org_1", trainingId: "other_topic", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
      { id: "attachment_foreign_org", orgId: "org_2", trainingId: "topic_1", scenarioId: "custom_a", createdAt: NOW, updatedAt: NOW },
    ],
  };
  const options = await service.listScenarioOptions({ context, references: scenarioReferences });
  assert.deepEqual(
    options,
    [
      {
        id: "custom_a",
        title: "Custom A",
        source: "custom",
        role: { id: "sales_role", label: "Sales" },
        focusTopics: [
          { id: "topic_2", label: "Discovery" },
          { id: "topic_1", label: "Prospecting" },
        ],
      },
      {
        id: "standard_a",
        title: "Standard A",
        source: "standard",
        role: { id: "sales_role", label: "Sales" },
        focusTopics: [],
      },
      {
        id: "standard_b",
        title: "Standard B",
        source: "standard",
        role: { id: "sales_role", label: "Sales" },
        focusTopics: [],
      },
    ]
  );
});

test("scenario-link validation maps to a stable non-enumerating API error", () => {
  const mapped = mapTrainingContentManagementServiceError(
    new TrainingContentScenarioLinkServiceError(
      "internal target detail",
      "invalid_scenario_link_target"
    )
  );
  assert.equal(mapped.status, 400);
  assert.equal(mapped.code, "training_content_invalid_scenario");
  assert.equal(mapped.message, "One or more selected scenarios is not available to this organization.");
  assert.deepEqual(mapped.details, { field: "relatedScenarioIds" });
});

test("create rejects instead of returning success when scenario-link persistence fails", async () => {
  const infrastructureError = new Error("scenario-link store unavailable");
  const { service, calls } = harness(true, { scenarioReplacementError: infrastructureError });

  await assert.rejects(
    service.createContent({
      context,
      references,
      input: {
        contentType: "native",
        title: "Linked resource",
        nativeBody: "# Linked",
        relatedScenarioIds: ["standard_a"],
      },
    }),
    (error: unknown) => error === infrastructureError
  );

  assert.deepEqual(calls.map((call) => call.method), ["create", "replaceLinks"]);
  assert.equal(
    mapTrainingContentManagementServiceError(infrastructureError).code,
    "training_content_operation_failed"
  );
});

test("content update rejects instead of returning success when scenario-link persistence fails", async () => {
  const infrastructureError = new Error("scenario-link store unavailable");
  const { service, calls } = harness(true, { scenarioReplacementError: infrastructureError });

  await assert.rejects(
    service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: {
        expectedUpdatedAt: NOW,
        title: "Updated title",
        relatedScenarioIds: ["standard_a"],
      },
    }),
    (error: unknown) => error === infrastructureError
  );

  assert.deepEqual(calls.map((call) => call.method), ["update", "replaceLinks"]);
});

test("create preserves omitted, empty, one, and multiple related scenario semantics", async (t) => {
  await t.test("omitted does not replace relationships and remains backward compatible", async () => {
    const { service, calls } = harness();
    const created = await service.createContent({
      context,
      references,
      input: { contentType: "native", title: "Legacy payload", nativeBody: "# Legacy" },
    });
    assert.deepEqual(created.relatedScenarios, []);
    assert.equal(calls.some((call) => call.method === "replaceLinks"), false);
  });

  for (const scenarioIds of [[], ["standard_a"], ["standard_a", "standard_b"]]) {
    await t.test(`${scenarioIds.length} selected scenario(s) replaces the exact set`, async () => {
      const { service, calls } = harness();
      const created = await service.createContent({
        context,
        references,
        input: {
          contentType: "native",
          title: "Linked resource",
          nativeBody: "# Linked",
          relatedScenarioIds: scenarioIds,
        },
      });
      const replacement = calls.find((call) => call.method === "replaceLinks");
      assert.deepEqual(replacement?.input.scenarioIds, scenarioIds);
      assert.deepEqual(created.relatedScenarios.map((scenario) => scenario.id), scenarioIds);
    });
  }
});

test("update preserves omitted, empty, one-to-many, and many-to-one relationship semantics", async (t) => {
  await t.test("omitted uses the existing metadata path without replacing links", async () => {
    const instance = harness();
    instance.setScenarioLinks(["standard_a"]);
    const updated = await instance.service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: { expectedUpdatedAt: NOW, title: "Legacy update" },
    });
    assert.equal(updated.title, "Legacy update");
    assert.deepEqual(updated.relatedScenarios.map((scenario) => scenario.id), ["standard_a"]);
    assert.equal(instance.calls.some((call) => call.method === "replaceLinks"), false);
  });

  for (const [existing, replacement] of [
    [["standard_a"], []],
    [["standard_a"], ["standard_a", "standard_b"]],
    [["standard_a", "standard_b"], ["standard_b"]],
  ] as const) {
    await t.test(`${existing.length} link(s) to ${replacement.length} link(s)`, async () => {
      const instance = harness();
      instance.setScenarioLinks([...existing]);
      const updated = await instance.service.updateContent({
        context,
        references,
        contentId: "content_1",
        input: { expectedUpdatedAt: NOW, relatedScenarioIds: [...replacement] },
      });
      assert.deepEqual(updated.relatedScenarios.map((scenario) => scenario.id), replacement);
      assert.equal(instance.calls.some((call) => call.method === "update"), false);
    });
  }
});

test("valid standard, custom, and combined scenario selections persist", async (t) => {
  for (const scenarioIds of [
    ["standard_a"],
    ["custom_a"],
    ["standard_a", "custom_a"],
  ]) {
    await t.test(scenarioIds.join(" + "), async () => {
      const { service, calls } = harness();
      await service.updateContent({
        context,
        references,
        contentId: "content_1",
        input: { expectedUpdatedAt: NOW, relatedScenarioIds: scenarioIds },
      });
      assert.deepEqual(
        calls.find((call) => call.method === "replaceLinks")?.input.scenarioIds,
        scenarioIds
      );
    });
  }
});

test("related scenario IDs are trimmed and deduplicated before replacement", async () => {
  const { service, calls } = harness();
  await service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      relatedScenarioIds: [" standard_a ", "standard_a", " custom_a "],
    },
  });
  assert.deepEqual(
    calls.find((call) => call.method === "replaceLinks")?.input.scenarioIds,
    ["standard_a", "custom_a"]
  );
});

test("invalid related scenarios reject the entire request before mutation without leaking ownership", async (t) => {
  const invalidIds = [
    " ",
    "missing_scenario",
    "standard_hidden",
    "standard_disabled",
    "standard_disabled_segment",
    "custom_disabled",
    "custom_cross_org",
  ];
  for (const scenarioId of invalidIds) {
    await t.test(scenarioId.trim() || "blank", async () => {
      const instance = harness();
      await assert.rejects(
        instance.service.updateContent({
          context,
          references,
          contentId: "content_1",
          input: {
            expectedUpdatedAt: NOW,
            title: "Must not persist",
            relatedScenarioIds: [scenarioId],
          },
        }),
        (error: unknown) => error instanceof Error
          && !error.message.includes(scenarioId.trim() || "blank")
      );
      assert.deepEqual(instance.calls, []);
    });
  }

  await t.test("mixed valid and invalid", async () => {
    const instance = harness();
    instance.setScenarioLinks(["standard_b"]);
    await assert.rejects(instance.service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: {
        expectedUpdatedAt: NOW,
        title: "Must not update",
        relatedScenarioIds: ["standard_a", "missing_scenario"],
      },
    }));
    assert.deepEqual(instance.calls, []);
    assert.deepEqual(instance.getScenarioLinks().map((link) => link.scenarioId), ["standard_b"]);
  });
});

test("links-only edits preserve assignments, Focus Topic, and content metadata", async () => {
  const instance = harness();
  const existingAssignments = [assignment("user", "learner")];
  instance.setCurrent(detail({
    title: "Original title",
    description: "Original description",
    focusTopicId: "topic_1",
    focusTopicNameSnapshot: "Coaching",
  }, existingAssignments));

  const updated = await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: { expectedUpdatedAt: NOW, relatedScenarioIds: ["standard_a"] },
  });

  assert.equal(instance.calls.some((call) => call.method === "update"), false);
  assert.equal(instance.calls.some((call) => call.method === "assign"), false);
  assert.equal(updated.title, "Original title");
  assert.equal(updated.description, "Original description");
  assert.equal(updated.categoryId, "category_1");
  assert.equal(updated.focusTopicId, "topic_1");
  assert.equal(updated.publicationState, "draft");
  assert.equal(updated.nativeBody, "# Foundation");
  assert.equal(updated.externalUrl, null);
  assert.equal(updated.assignments.availableToEveryone, false);
  assert.deepEqual(updated.assignments.users.map((target) => target.userId), ["learner"]);
});

test("published Learning Resources may update scenario links", async () => {
  const instance = harness();
  instance.setCurrent(detail({ publicationState: "published" }, [assignment("user", "learner")]));
  const updated = await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: { expectedUpdatedAt: NOW, relatedScenarioIds: ["standard_a"] },
  });
  assert.equal(updated.publicationState, "published");
  assert.deepEqual(updated.relatedScenarios.map((scenario) => scenario.id), ["standard_a"]);
});

test("adding a valid scenario preserves an already-linked unavailable scenario", async () => {
  const instance = harness();
  instance.setScenarioLinks(["standard_disabled"]);
  const updated = await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      relatedScenarioIds: ["standard_disabled", "standard_a"],
    },
  });
  assert.deepEqual(
    updated.relatedScenarios.map((scenario) => [scenario.id, scenario.available]),
    [["standard_disabled", false], ["standard_a", true]]
  );
});

test("a disabled-segment link remains displayable and retainable until removal, then cannot be re-added", async () => {
  const instance = harness();
  instance.setScenarioLinks(["standard_disabled_segment"]);

  const loaded = await instance.service.getContent({
    context,
    references,
    contentId: "content_1",
  });
  assert.deepEqual(
    loaded.relatedScenarios.map((scenario) => [scenario.id, scenario.available]),
    [["standard_disabled_segment", false]]
  );

  const retained = await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: {
      expectedUpdatedAt: NOW,
      relatedScenarioIds: ["standard_disabled_segment"],
    },
  });
  assert.deepEqual(
    retained.relatedScenarios.map((scenario) => [scenario.id, scenario.available]),
    [["standard_disabled_segment", false]]
  );

  const removed = await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: { expectedUpdatedAt: NOW, relatedScenarioIds: [] },
  });
  assert.deepEqual(removed.relatedScenarios, []);

  await assert.rejects(
    instance.service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: {
        expectedUpdatedAt: NOW,
        relatedScenarioIds: ["standard_disabled_segment"],
      },
    }),
    (error: unknown) => error instanceof TrainingContentScenarioLinkServiceError
      && error.code === "invalid_scenario_link_target"
  );
  assert.deepEqual(instance.getScenarioLinks(), []);
});

test("links-only edits still enforce optimistic concurrency", async () => {
  const instance = harness();
  await assert.rejects(
    instance.service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: {
        expectedUpdatedAt: "2026-07-28T11:59:00.000Z",
        relatedScenarioIds: ["standard_a"],
      },
    }),
    (error: unknown) => error instanceof TrainingContentManagementServiceError
      && error.code === "training_content_conflict"
  );
  assert.deepEqual(instance.calls, []);
});

test("links-only edits preserve the existing archived-content edit restriction", async () => {
  const instance = harness();
  instance.setCurrent(detail({ publicationState: "archived" }));
  await assert.rejects(
    instance.service.updateContent({
      context,
      references,
      contentId: "content_1",
      input: { expectedUpdatedAt: NOW, relatedScenarioIds: ["standard_a"] },
    }),
    (error: unknown) => error instanceof TrainingContentManagementServiceError
      && error.code === "training_content_archived"
  );
  assert.deepEqual(instance.calls, []);
});

test("detail mapping includes active links and marks stale linked targets unavailable", async () => {
  const instance = harness();
  instance.setScenarioLinks(["standard_a", "standard_disabled", "missing_scenario"]);
  const loaded = await instance.service.getContent({
    context,
    references,
    contentId: "content_1",
  });
  assert.deepEqual(loaded.relatedScenarios, [
    { id: "standard_a", title: "Standard A", available: true },
    { id: "standard_disabled", title: "Disabled standard", available: false },
    { id: "missing_scenario", title: "Unavailable scenario", available: false },
  ]);
});

test("removed scenario links are absent because detail reads active links only", async () => {
  const instance = harness();
  instance.setScenarioLinks(["standard_a", "standard_b"]);
  await instance.service.updateContent({
    context,
    references,
    contentId: "content_1",
    input: { expectedUpdatedAt: NOW, relatedScenarioIds: ["standard_b"] },
  });
  const loaded = await instance.service.getContent({ context, references, contentId: "content_1" });
  assert.deepEqual(loaded.relatedScenarios.map((scenario) => scenario.id), ["standard_b"]);
});
