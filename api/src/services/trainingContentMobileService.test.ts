import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppConfig,
  TrainingContentAssignment,
  TrainingContentCategory,
  TrainingContentItem,
  UserProfile,
} from "@voicepractice/shared";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type {
  OrgModuleEntitlementStore,
  StoredOrgModuleEntitlement,
} from "../storage/orgModuleEntitlementStore.js";
import type {
  TrainingContentObjectStorage,
  TrainingContentPresignedRequest,
} from "../storage/trainingContentObjectStorage.js";
import type {
  TrainingContentScenarioLink,
  TrainingContentMobileReadRecord,
  TrainingContentMobileReadResult,
  TrainingContentStore,
} from "../storage/trainingContentStore.js";
import { TrainingContentStorageReadinessService } from "./trainingContentStorageReadiness.js";
import {
  createTrainingContentMobileService,
  mapTrainingContentMobileServiceError,
  MobileTrainingContentRequestContext,
  TrainingContentMobileServiceError,
} from "./trainingContentMobileService.js";
import { createTrainingContentScenarioLinkService } from "./trainingContentScenarioLinks.js";

const NOW = "2026-07-28T15:00:00.000Z";
const ORG_ID = "org_a";

const scenarioConfig: Pick<
  AppConfig,
  "industries" | "roleIndustries" | "segments" | "orgCustomScenarios" | "orgTrainings"
> = {
  industries: [{ id: "sales", label: "Sales", enabled: true }],
  roleIndustries: [{ roleId: "sales", industryId: "sales", active: true }],
  segments: [{
    id: "sales",
    label: "Sales",
    summary: "Sales",
    enabled: true,
    scenarios: [{
      id: "standard_visible",
      segmentId: "sales",
      title: "Standard visible",
      description: "Visible scenario",
      aiRole: "Buyer",
    }],
  }],
  orgCustomScenarios: [{
    id: "custom_visible",
    orgId: ORG_ID,
    segmentId: "sales",
    title: "Custom visible",
    description: "Visible custom scenario",
    aiRole: "Buyer",
    scoringGuidance: "Score it",
    applicableIndustryIds: ["sales"],
    enabled: true,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  }],
  orgTrainings: [{
    id: "training_visible",
    orgId: ORG_ID,
    name: "Sales readiness",
    status: "active",
    description: "Sales readiness",
    createdAt: NOW,
    updatedAt: NOW,
    attachedTrainingPackIds: [],
    attachedCustomScenarioIds: ["custom_visible"],
    attachedTrainingPackCount: 0,
    attachedCustomScenarioCount: 1,
  }],
};

function buildUser(
  id: string,
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: "Test",
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: ORG_ID,
    orgRole: "user",
    divisionId: null,
    timezone: "America/Denver",
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

function buildCategory(
  id: string,
  displayOrder: number,
  overrides: Partial<TrainingContentCategory> = {}
): TrainingContentCategory {
  return {
    id,
    orgId: ORG_ID,
    name: id === "category_a" ? "Onboarding" : "Product",
    description: `${id} description`,
    displayOrder,
    isDefault: id === "category_a",
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function buildContent(
  id: string,
  categoryId: string,
  displayOrder: number,
  overrides: Partial<TrainingContentItem> = {}
): TrainingContentItem {
  return {
    id,
    orgId: ORG_ID,
    categoryId,
    title: id,
    description: `${id} description`,
    focusTopicId: "topic_1",
    focusTopicNameSnapshot: "Customer Care",
    contentType: "native",
    publicationState: "published",
    nativeBody: "# Guide",
    externalUrl: null,
    displayOrder,
    contentVersion: 1,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function assignment(
  contentId: string,
  assignmentType: TrainingContentAssignment["assignmentType"],
  subjectUserId: string | null = null
): TrainingContentAssignment {
  return {
    id: `${contentId}_${assignmentType}_${subjectUserId ?? "all"}`,
    orgId: ORG_ID,
    contentId,
    assignmentType,
    subjectUserId,
    createdByActorId: "admin",
    createdAt: NOW,
    revokedByActorId: null,
    revokedAt: null,
  };
}

function record(params: {
  content: TrainingContentItem;
  category: TrainingContentCategory;
  assignments: TrainingContentAssignment[];
  asset?: TrainingContentMobileReadRecord["currentAsset"];
}): TrainingContentMobileReadRecord {
  return {
    content: params.content,
    category: params.category,
    assignments: params.assignments,
    currentAsset: params.asset ?? null,
  };
}

function scenarioLink(
  contentId: string,
  scenarioId = "standard_visible",
  overrides: Partial<TrainingContentScenarioLink> = {}
): TrainingContentScenarioLink {
  return {
    id: `link_${contentId}_${scenarioId}`,
    orgId: ORG_ID,
    contentId,
    focusTopicId: null,
    scenarioId,
    createdByActorId: "admin",
    createdAt: NOW,
    removedByActorId: null,
    removedAt: null,
    ...overrides,
  };
}

class FakeStore implements TrainingContentStore {
  records: TrainingContentMobileReadRecord[] = [];
  scenarioLinks: TrainingContentScenarioLink[] = [];
  scenarioLinkReads: Array<[string, string]> = [];
  contentLinkReads: Array<[string, string]> = [];
  maximumItems: number | null = null;
  truncated = false;

  async initialize(): Promise<void> {}
  async listContentItemsForOrg() { return this.records.map((entry) => entry.content); }
  async getContentItemForOrg(_orgId: string, contentId: string) {
    return this.records.find((entry) => entry.content.id === contentId)?.content ?? null;
  }
  async listActiveScenarioLinksForContent(orgId: string, contentId: string) {
    this.contentLinkReads.push([orgId, contentId]);
    return this.scenarioLinks.filter(
      (entry) => entry.orgId === orgId
        && entry.contentId === contentId
        && entry.removedAt === null
    );
  }
  async listActiveScenarioLinksForScenario(orgId: string, scenarioId: string) {
    this.scenarioLinkReads.push([orgId, scenarioId]);
    return this.scenarioLinks.filter(
      (entry) => entry.orgId === orgId
        && entry.scenarioId === scenarioId
        && entry.removedAt === null
    );
  }
  async replaceActiveScenarioLinksForContent() { return []; }
  async listPublishedContentForMobile(
    orgId: string,
    maximumItems?: number
  ): Promise<TrainingContentMobileReadResult> {
    this.maximumItems = maximumItems ?? null;
    return {
      items: this.records.filter((entry) => entry.content.orgId === orgId),
      truncated: this.truncated,
    };
  }
  async getPublishedContentForMobile(orgId: string, contentId: string) {
    return this.records.find(
      (entry) => entry.content.orgId === orgId && entry.content.id === contentId
    ) ?? null;
  }
  async listContentForManagement(): Promise<never> { throw new Error("not used"); }
  async getContentDetailForOrg(): Promise<never> { throw new Error("not used"); }
  async createContent(): Promise<never> { throw new Error("not used"); }
  async updateContent(): Promise<never> { throw new Error("not used"); }
  async replaceAssignments(): Promise<never> { throw new Error("not used"); }
  async transitionContent(): Promise<never> { throw new Error("not used"); }
  async deleteUserAssignmentsAndDeidentifyRecords() {
    return { deletedAssignments: 0, deidentifiedUsageSessions: 0, deidentifiedActorReferences: 0 };
  }
}

class FakeEntitlementStore implements OrgModuleEntitlementStore {
  enabled = true;
  requestedOrgIds: string[] = [];

  async initialize(): Promise<void> {}
  async getOrgModuleEntitlement(
    orgId: string
  ): Promise<StoredOrgModuleEntitlement> {
    this.requestedOrgIds.push(orgId);
    return {
      orgId,
      moduleKey: "training_content",
      enabled: this.enabled,
      updatedByActorId: null,
      updatedAt: null,
    };
  }
  async setOrgModuleEntitlement(): Promise<never> {
    throw new Error("not used");
  }
  async deidentifyActor(): Promise<number> {
    return 0;
  }
}

class FakeObjectStorage implements TrainingContentObjectStorage {
  readonly provider = "r2" as const;
  available = true;
  accessKeys: string[] = [];
  accessTtls: number[] = [];

  async verifyReadiness(): Promise<void> {
    if (!this.available) {
      throw new Error("storage unavailable with internal details");
    }
  }
  async createPresignedAccess(params: {
    key: string;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<TrainingContentPresignedRequest> {
    if (!this.available) {
      throw new Error("credential-shaped storage failure");
    }
    this.accessKeys.push(params.key);
    this.accessTtls.push(params.expiresInSeconds);
    return {
      url: "https://signed.example.test/private?signature=secret",
      expiresAt: new Date(
        (params.now ?? new Date()).getTime() + params.expiresInSeconds * 1000
      ).toISOString(),
      requiredHeaders: {},
    };
  }
  async createPresignedUpload(): Promise<never> { throw new Error("not used"); }
  async headObject(): Promise<never> { throw new Error("not used"); }
  async readObjectRange(): Promise<never> { throw new Error("not used"); }
  async readObjectBytes(): Promise<never> { throw new Error("not used"); }
  async downloadObjectToFile(): Promise<never> { throw new Error("not used"); }
  async uploadFileImmutable(): Promise<never> { throw new Error("not used"); }
  async copyObject(): Promise<never> { throw new Error("not used"); }
  async deleteObject(): Promise<never> { throw new Error("not used"); }
  async listObjects(): Promise<never> { throw new Error("not used"); }
}

const storageConfig: TrainingContentStorageConfig = {
  provider: "r2",
  r2: {
    environment: "staging",
    accountId: "account",
    bucket: "bucket",
    accessKeyId: "key",
    secretAccessKey: "secret",
    endpoint: "https://account.r2.cloudflarestorage.com",
  },
  uploadUrlTtlSeconds: 600,
  downloadUrlTtlSeconds: 300,
  mediaAccessUrlTtlSeconds: 3600,
  maxPendingUploadBytesPerOrganization: 1024,
  fileSizeLimits: {
    video: 1024,
    audio: 1024,
    pdf: 1024,
    docx: 1024,
    image: 1024,
  },
  finalizationLeaseSeconds: 300,
  orphanGracePeriodSeconds: 3600,
  supersededRetentionDays: 30,
  backup: {
    enabled: false,
    r2: null,
  },
};

function setup(users = [buildUser("learner")]) {
  const store = new FakeStore();
  const entitlementStore = new FakeEntitlementStore();
  const objectStorage = new FakeObjectStorage();
  const readiness = new TrainingContentStorageReadinessService(
    storageConfig,
    objectStorage
  );
  const service = createTrainingContentMobileService({
    store,
    scenarioLinkService: createTrainingContentScenarioLinkService(store),
    entitlementStore,
    objectStorage,
    readiness,
    storageConfig,
  });
  const context: MobileTrainingContentRequestContext = {
    user: users[0],
    users,
    organizationActive: true,
    scenarioConfig,
  };
  return { service, store, entitlementStore, objectStorage, readiness, context };
}

test("module availability uses the relational entitlement and requires an active complete member", async () => {
  const fixture = setup();
  assert.deepEqual(await fixture.service.getModules(fixture.context), {
    modules: { trainingContent: { enabled: true } },
  });
  assert.deepEqual(fixture.entitlementStore.requestedOrgIds, [ORG_ID]);

  fixture.entitlementStore.enabled = false;
  assert.equal(
    (await fixture.service.getModules(fixture.context)).modules.trainingContent.enabled,
    false
  );

  for (const user of [
    buildUser("free", { accountType: "individual", tier: "free", orgId: null }),
    buildUser("no_org", { orgId: null }),
    buildUser("disabled", { status: "disabled" }),
    buildUser("unverified", { emailVerifiedAt: null }),
    buildUser("incomplete", { firstName: null }),
  ]) {
    await assert.rejects(
      fixture.service.getModules({ ...fixture.context, user, users: [user] }),
      (error: unknown) =>
        error instanceof TrainingContentMobileServiceError
        && error.code === "training_content_access_denied"
    );
  }
  await assert.rejects(
    fixture.service.getModules({ ...fixture.context, organizationActive: false }),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_access_denied"
  );
});

test("library returns only eligible content with safe category and item ordering", async () => {
  const fixture = setup();
  const categoryA = buildCategory("category_a", 0);
  const categoryB = buildCategory("category_b", 1);
  const categoryEmpty = buildCategory("category_empty", 2);
  const first = buildContent("first", categoryA.id, 0);
  const second = buildContent("second", categoryA.id, 1);
  const third = buildContent("third", categoryB.id, 0);
  const unauthorized = buildContent("private", categoryEmpty.id, 0);
  fixture.store.records = [
    record({ content: first, category: categoryA, assignments: [assignment(first.id, "organization")] }),
    record({ content: second, category: categoryA, assignments: [assignment(second.id, "user", "learner")] }),
    record({ content: third, category: categoryB, assignments: [assignment(third.id, "organization")] }),
    record({ content: unauthorized, category: categoryEmpty, assignments: [assignment(unauthorized.id, "user", "other")] }),
  ];
  fixture.store.truncated = true;

  const library = await fixture.service.getLibrary(fixture.context);
  assert.equal(fixture.store.maximumItems, 500);
  assert.equal(library.truncated, true);
  assert.deepEqual(library.categories.map((entry) => [entry.name, entry.itemCount]), [
    ["Onboarding", 2],
    ["Product", 1],
  ]);
  assert.deepEqual(library.items.map((entry) => entry.id), ["first", "second", "third"]);
  assert.equal(library.items[0]?.relatedFocusTopic, "Customer Care");
  assert.equal("orgId" in (library.items[0] as object), false);
  assert.equal("assignments" in (library.items[0] as object), false);
  assert.equal("displayOrder" in (library.items[0] as object), false);
  assert.deepEqual(
    await fixture.service.getCategories(fixture.context),
    { categories: library.categories }
  );
});

test("related scenario resources return zero, one, or many eligible summaries", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const first = buildContent("first", category.id, 0);
  const second = buildContent("second", category.id, 1);
  fixture.store.records = [
    record({ content: first, category, assignments: [assignment(first.id, "organization")] }),
    record({ content: second, category, assignments: [assignment(second.id, "user", "learner")] }),
  ];

  assert.deepEqual(
    await fixture.service.getRelatedForScenario(fixture.context, "standard_visible"),
    { categories: [], items: [], truncated: false }
  );

  fixture.store.scenarioLinks = [scenarioLink(first.id)];
  assert.deepEqual(
    (await fixture.service.getRelatedForScenario(
      fixture.context,
      "standard_visible"
    )).items.map((item) => item.id),
    ["first"]
  );

  fixture.store.scenarioLinks.push(scenarioLink(second.id));
  const many = await fixture.service.getRelatedForScenario(
    fixture.context,
    "standard_visible"
  );
  assert.deepEqual(many.items.map((item) => item.id), ["first", "second"]);
  assert.deepEqual(many.categories.map((entry) => [entry.id, entry.itemCount]), [
    ["category_a", 2],
  ]);
  assert.equal(many.truncated, false);
});

test("missing linked content is excluded without hiding other eligible resources", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const eligible = buildContent("eligible", category.id, 0);
  fixture.store.records = [
    record({ content: eligible, category, assignments: [assignment(eligible.id, "organization")] }),
  ];
  fixture.store.scenarioLinks = [
    scenarioLink("missing_content"),
    scenarioLink(eligible.id),
  ];

  assert.deepEqual(
    (await fixture.service.getRelatedForScenario(
      fixture.context,
      "standard_visible"
    )).items.map((item) => item.id),
    ["eligible"]
  );
});

test("related scenario discovery filters unpublished, unassigned, and cross-org candidates", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const eligible = buildContent("eligible", category.id, 0);
  const unpublished = buildContent("unpublished", category.id, 1, {
    publicationState: "draft",
    publishedAt: null,
  });
  const unassigned = buildContent("unassigned", category.id, 2);
  const crossOrgCategory = buildCategory("cross_org_category", 0, { orgId: "org_b" });
  const crossOrg = buildContent("cross_org", crossOrgCategory.id, 0, { orgId: "org_b" });
  fixture.store.records = [
    record({ content: eligible, category, assignments: [assignment(eligible.id, "organization")] }),
    record({ content: unpublished, category, assignments: [assignment(unpublished.id, "organization")] }),
    record({ content: unassigned, category, assignments: [] }),
    record({
      content: crossOrg,
      category: crossOrgCategory,
      assignments: [{ ...assignment(crossOrg.id, "organization"), orgId: "org_b" }],
    }),
  ];
  fixture.store.scenarioLinks = fixture.store.records.map((entry) =>
    scenarioLink(entry.content.id)
  );

  assert.deepEqual(
    (await fixture.service.getRelatedForScenario(
      fixture.context,
      "standard_visible"
    )).items.map((item) => item.id),
    ["eligible"]
  );
});

test("related scenario discovery fails closed for inactive membership or a disabled module", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const content = buildContent("eligible", category.id, 0);
  fixture.store.records = [
    record({ content, category, assignments: [assignment(content.id, "organization")] }),
  ];
  fixture.store.scenarioLinks = [scenarioLink(content.id)];

  await assert.rejects(
    fixture.service.getRelatedForScenario(
      { ...fixture.context, user: { ...fixture.context.user, status: "disabled" } },
      "standard_visible"
    ),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_access_denied"
  );

  fixture.entitlementStore.enabled = false;
  await assert.rejects(
    fixture.service.getRelatedForScenario(fixture.context, "standard_visible"),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
      && error.code === "module_disabled"
  );
});

test("removed historical scenario links are not returned", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const active = buildContent("active", category.id, 0);
  const removed = buildContent("removed", category.id, 1);
  fixture.store.records = [active, removed].map((content) =>
    record({ content, category, assignments: [assignment(content.id, "organization")] })
  );
  fixture.store.scenarioLinks = [
    scenarioLink(active.id),
    scenarioLink(removed.id, "standard_visible", {
      removedAt: NOW,
      removedByActorId: "admin",
    }),
  ];

  assert.deepEqual(
    (await fixture.service.getRelatedForScenario(
      fixture.context,
      "standard_visible"
    )).items.map((item) => item.id),
    ["active"]
  );
});

test("custom scenarios require their visible Focus Topic and invalid scenarios cannot enumerate", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const content = buildContent("custom_resource", category.id, 0);
  fixture.store.records = [
    record({ content, category, assignments: [assignment(content.id, "organization")] }),
  ];
  fixture.store.scenarioLinks = [scenarioLink(content.id, "custom_visible")];

  assert.deepEqual(
    (await fixture.service.getRelatedForScenario(
      fixture.context,
      "custom_visible",
      "training_visible"
    )).items.map((item) => item.id),
    ["custom_resource"]
  );

  const crossOrgScenario = {
    ...scenarioConfig.orgCustomScenarios![0]!,
    id: "custom_other_org",
    orgId: "org_b",
  };
  const crossOrgTraining = {
    ...scenarioConfig.orgTrainings![0]!,
    id: "training_other_org",
    attachedCustomScenarioIds: [crossOrgScenario.id],
  };
  await assert.rejects(
    fixture.service.getRelatedForScenario(
      {
        ...fixture.context,
        scenarioConfig: {
          ...scenarioConfig,
          orgCustomScenarios: [crossOrgScenario],
          orgTrainings: [crossOrgTraining],
        },
      },
      crossOrgScenario.id,
      crossOrgTraining.id
    ),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
      && error.code === "scenario_not_found"
  );

  for (const [scenarioId, trainingId] of [
    ["custom_visible", "other_training"],
    ["missing", null],
  ] as const) {
    await assert.rejects(
      fixture.service.getRelatedForScenario(fixture.context, scenarioId, trainingId),
      (error: unknown) => error instanceof TrainingContentMobileServiceError
        && error.code === "scenario_not_found"
    );
  }
});

test("a visible but mismatched custom-scenario training context fails before link enumeration", async () => {
  const fixture = setup();
  const unrelatedScenario = {
    ...scenarioConfig.orgCustomScenarios![0]!,
    id: "custom_unrelated",
    title: "Unrelated custom scenario",
  };
  const unrelatedTraining = {
    ...scenarioConfig.orgTrainings![0]!,
    id: "training_unrelated",
    name: "Unrelated Focus Topic",
    attachedCustomScenarioIds: [unrelatedScenario.id],
  };
  const context: MobileTrainingContentRequestContext = {
    ...fixture.context,
    scenarioConfig: {
      ...scenarioConfig,
      orgCustomScenarios: [
        ...scenarioConfig.orgCustomScenarios!,
        unrelatedScenario,
      ],
      orgTrainings: [
        ...scenarioConfig.orgTrainings!,
        unrelatedTraining,
      ],
    },
  };

  await assert.rejects(
    fixture.service.getRelatedForScenario(
      context,
      "custom_visible",
      unrelatedTraining.id
    ),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
      && error.code === "scenario_not_found"
  );
  assert.deepEqual(fixture.store.scenarioLinkReads, []);
});

test("a scenario relationship does not change ordinary Learning Resource eligibility", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const eligible = buildContent("eligible", category.id, 0);
  const unassigned = buildContent("unassigned", category.id, 1);
  fixture.store.records = [
    record({ content: eligible, category, assignments: [assignment(eligible.id, "organization")] }),
    record({ content: unassigned, category, assignments: [] }),
  ];
  fixture.store.scenarioLinks = [scenarioLink(eligible.id), scenarioLink(unassigned.id)];

  const libraryIds = (await fixture.service.getLibrary(fixture.context)).items
    .map((item) => item.id);
  const relatedIds = (await fixture.service.getRelatedForScenario(
    fixture.context,
    "standard_visible"
  )).items.map((item) => item.id);
  assert.deepEqual(libraryIds, ["eligible"]);
  assert.deepEqual(relatedIds, libraryIds);
});

test("reverse links return only user-scoped standard and custom launch summaries", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const content = buildContent("resource", category.id, 0);
  fixture.store.records = [
    record({ content, category, assignments: [assignment(content.id, "organization")] }),
  ];
  const disabledStandard = {
    id: "standard_disabled",
    segmentId: "sales",
    title: "Disabled standard",
    description: "Disabled",
    aiRole: "Buyer",
    enabled: false,
  };
  const otherOrgCustom = {
    ...scenarioConfig.orgCustomScenarios![0]!,
    id: "custom_other_org",
    orgId: "org_b",
    title: "Other org custom",
  };
  const hiddenCustom = {
    ...scenarioConfig.orgCustomScenarios![0]!,
    id: "custom_hidden",
    title: "Hidden custom",
    enabled: true,
  };
  const deterministicTraining = {
    ...scenarioConfig.orgTrainings![0]!,
    id: "training_alpha",
    name: "Alpha Focus Topic",
  };
  const context: MobileTrainingContentRequestContext = {
    ...fixture.context,
    scenarioConfig: {
      ...scenarioConfig,
      segments: [{
        ...scenarioConfig.segments[0]!,
        scenarios: [...scenarioConfig.segments[0]!.scenarios, disabledStandard],
      }],
      orgCustomScenarios: [
        ...scenarioConfig.orgCustomScenarios!,
        otherOrgCustom,
        hiddenCustom,
      ],
      orgTrainings: [
        ...scenarioConfig.orgTrainings!,
        deterministicTraining,
        {
          ...scenarioConfig.orgTrainings![0]!,
          id: "training_other_org",
          orgId: "org_b",
          attachedCustomScenarioIds: [otherOrgCustom.id],
        },
      ],
    },
  };
  fixture.store.scenarioLinks = [
    scenarioLink(content.id, "standard_visible"),
    scenarioLink(content.id, "standard_disabled"),
    scenarioLink(content.id, "standard_outside_scope"),
    scenarioLink(content.id, "custom_visible"),
    scenarioLink(content.id, otherOrgCustom.id),
    scenarioLink(content.id, hiddenCustom.id),
    scenarioLink(content.id, "missing_scenario"),
    scenarioLink(content.id, "standard_visible", { id: "duplicate_active_for_test" }),
    scenarioLink(content.id, "removed_scenario", {
      removedAt: NOW,
      removedByActorId: "admin",
    }),
  ];

  const result = await fixture.service.getRelatedScenariosForContent(context, content.id);
  assert.deepEqual(result, {
    scenarios: [{
      id: "standard_visible",
      title: "Standard visible",
      source: "standard",
      segmentId: "sales",
      industryId: "sales",
      trainingId: null,
    }, {
      id: "custom_visible",
      title: "Custom visible",
      source: "custom",
      segmentId: "sales",
      industryId: "sales",
      trainingId: "training_alpha",
    }],
  });
  assert.deepEqual(fixture.store.contentLinkReads, [[ORG_ID, content.id]]);
});

test("reverse-link enumeration requires independently eligible Learning Resource access", async () => {
  const cases: Array<{
    name: string;
    configure: (fixture: ReturnType<typeof setup>) => MobileTrainingContentRequestContext;
  }> = [
    {
      name: "unassigned",
      configure: (fixture) => fixture.context,
    },
    {
      name: "unpublished",
      configure: (fixture) => {
        fixture.store.records[0]!.content.publicationState = "draft";
        fixture.store.records[0]!.content.publishedAt = null;
        return fixture.context;
      },
    },
    {
      name: "archived category",
      configure: (fixture) => {
        fixture.store.records[0]!.category.archivedAt = NOW;
        return fixture.context;
      },
    },
    {
      name: "archived content",
      configure: (fixture) => {
        fixture.store.records[0]!.content.archivedAt = NOW;
        return fixture.context;
      },
    },
    {
      name: "module disabled",
      configure: (fixture) => {
        fixture.entitlementStore.enabled = false;
        return fixture.context;
      },
    },
    {
      name: "inactive membership",
      configure: (fixture) => ({
        ...fixture.context,
        user: { ...fixture.context.user, status: "disabled" },
      }),
    },
    {
      name: "incomplete membership",
      configure: (fixture) => ({
        ...fixture.context,
        user: { ...fixture.context.user, firstName: null },
      }),
    },
    {
      name: "inactive organization",
      configure: (fixture) => ({ ...fixture.context, organizationActive: false }),
    },
  ];

  for (const entry of cases) {
    const fixture = setup();
    const category = buildCategory("category_a", 0);
    const content = buildContent("protected_resource", category.id, 0);
    fixture.store.records = [record({
      content,
      category,
      assignments: entry.name === "unassigned"
        ? []
        : [assignment(content.id, "organization")],
    })];
    fixture.store.scenarioLinks = [scenarioLink(content.id)];
    await assert.rejects(
      fixture.service.getRelatedScenariosForContent(entry.configure(fixture), content.id),
      (error: unknown) => error instanceof TrainingContentMobileServiceError,
      entry.name
    );
    assert.deepEqual(fixture.store.contentLinkReads, [], entry.name);
  }

  const crossOrg = setup();
  const otherCategory = buildCategory("other_category", 0, { orgId: "org_b" });
  const otherContent = buildContent("guessed_other_org", otherCategory.id, 0, { orgId: "org_b" });
  crossOrg.store.records = [record({
    content: otherContent,
    category: otherCategory,
    assignments: [{ ...assignment(otherContent.id, "organization"), orgId: "org_b" }],
  })];
  crossOrg.store.scenarioLinks = [scenarioLink(otherContent.id, "standard_visible", { orgId: "org_b" })];
  await assert.rejects(
    crossOrg.service.getRelatedScenariosForContent(crossOrg.context, otherContent.id),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
  );
  assert.deepEqual(crossOrg.store.contentLinkReads, []);
});

test("a reverse relationship cannot make an unavailable scenario visible", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const content = buildContent("resource", category.id, 0);
  fixture.store.records = [record({
    content,
    category,
    assignments: [assignment(content.id, "organization")],
  })];
  fixture.store.scenarioLinks = [scenarioLink(content.id, "not_in_user_config")];

  assert.deepEqual(
    await fixture.service.getRelatedScenariosForContent(fixture.context, content.id),
    { scenarios: [] }
  );
  await assert.rejects(
    fixture.service.getRelatedForScenario(fixture.context, "not_in_user_config"),
    (error: unknown) => error instanceof TrainingContentMobileServiceError
      && error.code === "scenario_not_found"
  );
});

test("manager and manager-team eligibility is dynamic and overlapping grants use OR semantics", async () => {
  const learner = buildUser("learner", { managerUserId: "manager" });
  const manager = buildUser("manager", { orgRole: "user_admin" });
  const otherManager = buildUser("other_manager", { orgRole: "user_admin" });
  const fixture = setup([learner, manager, otherManager]);
  const category = buildCategory("category_a", 0);
  const teamContent = buildContent("team", category.id, 0);
  const personalContent = buildContent("personal", category.id, 1);
  fixture.store.records = [
    record({
      content: teamContent,
      category,
      assignments: [assignment(teamContent.id, "manager_team", manager.id)],
    }),
    record({
      content: personalContent,
      category,
      assignments: [assignment(personalContent.id, "manager", learner.id)],
    }),
  ];

  assert.deepEqual(
    (await fixture.service.getLibrary(fixture.context)).items.map((entry) => entry.id),
    ["team"]
  );

  const managerContext = { ...fixture.context, user: manager };
  fixture.store.records[1] = record({
    content: personalContent,
    category,
    assignments: [
      assignment(personalContent.id, "manager", manager.id),
      assignment(personalContent.id, "organization"),
    ],
  });
  assert.deepEqual(
    (await fixture.service.getLibrary(managerContext)).items.map((entry) => entry.id),
    ["personal"]
  );

  manager.status = "disabled";
  assert.deepEqual(
    (await fixture.service.getLibrary(fixture.context)).items.map((entry) => entry.id),
    ["personal"]
  );
  manager.status = "active";
  manager.orgRole = "user";
  assert.deepEqual(
    (await fixture.service.getLibrary(fixture.context)).items.map((entry) => entry.id),
    ["personal"]
  );
  manager.orgRole = "user_admin";
  learner.managerUserId = otherManager.id;
  assert.deepEqual(
    (await fixture.service.getLibrary(fixture.context)).items.map((entry) => entry.id),
    ["personal"]
  );
  learner.managerUserId = manager.id;
  fixture.store.records[0].assignments.push(assignment(teamContent.id, "user", learner.id));
  manager.status = "disabled";
  assert.deepEqual(
    (await fixture.service.getLibrary(fixture.context)).items.map((entry) => entry.id),
    ["team", "personal"]
  );
});

test("detail revalidates publication, tenant, category, assignment, and module eligibility", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const content = buildContent("guide", category.id, 0);
  fixture.store.records = [
    record({ content, category, assignments: [assignment(content.id, "organization")] }),
  ];

  const detail = await fixture.service.getDetail(fixture.context, content.id);
  assert.equal(detail.item.id, content.id);
  assert.equal(detail.item.nativeBody, "# Guide");
  assert.equal(detail.item.externalUrl, null);
  assert.equal("orgId" in (detail.item as object), false);

  fixture.store.records[0].content.publicationState = "draft";
  await assert.rejects(
    fixture.service.getDetail(fixture.context, content.id),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.status === 404
      && error.code === "training_content_not_found"
  );
  fixture.store.records[0].content.publicationState = "published";
  fixture.store.records[0].content.archivedAt = NOW;
  await assert.rejects(
    fixture.service.getDetail(fixture.context, content.id),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_not_found"
  );
  fixture.store.records[0].content.archivedAt = null;
  fixture.store.records[0].category.archivedAt = NOW;
  await assert.rejects(
    fixture.service.getDetail(fixture.context, content.id),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_not_found"
  );
  fixture.store.records[0].category.archivedAt = null;
  fixture.store.records[0].content.categoryId = "cross_org_category";
  await assert.rejects(
    fixture.service.getDetail(fixture.context, content.id),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_not_found"
  );
  fixture.store.records[0].content.categoryId = category.id;
  fixture.store.records[0].assignments = [];
  await assert.rejects(
    fixture.service.getDetail(fixture.context, content.id),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "training_content_not_found"
  );

  fixture.entitlementStore.enabled = false;
  await assert.rejects(
    fixture.service.getDetail(fixture.context, "guessed-cross-org-id"),
    (error: unknown) =>
      error instanceof TrainingContentMobileServiceError
      && error.code === "module_disabled"
  );
  const mapped = mapTrainingContentMobileServiceError(
    new TrainingContentMobileServiceError("disabled", 403, "module_disabled")
  );
  assert.deepEqual(mapped.body, {
    error: "disabled",
    code: "module_disabled",
    moduleKey: "training_content",
  });
});

test("asset access signs only the current ready authorized asset with capped TTLs", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const video = buildContent("video", category.id, 0, {
    contentType: "video",
    nativeBody: null,
  });
  const asset: NonNullable<TrainingContentMobileReadRecord["currentAsset"]> = {
    id: "asset_current",
    orgId: ORG_ID,
    contentId: video.id,
    uploadState: "ready",
    originalFilename: "training.mp4",
    detectedMimeType: "video/mp4",
    fileExtension: "mp4",
    byteSize: 100,
    isCurrent: true,
    finalObjectKey: "orgs/org_a/content/video/assets/asset_current/v1/training.mp4",
    objectDeletedAt: null,
  };
  fixture.store.records = [
    record({
      content: video,
      category,
      assignments: [assignment(video.id, "organization")],
      asset,
    }),
  ];
  await fixture.readiness.refresh(new Date(NOW));

  const access = await fixture.service.createAssetAccess(
    fixture.context,
    video.id,
    new Date(NOW)
  );
  assert.equal(access.access.url.includes("signature=secret"), true);
  assert.deepEqual(fixture.objectStorage.accessKeys, [asset.finalObjectKey]);
  assert.deepEqual(fixture.objectStorage.accessTtls, [3600]);
  assert.equal(JSON.stringify(access).includes(asset.finalObjectKey!), false);

  for (const mutation of [
    () => { asset.uploadState = "pending"; },
    () => { asset.uploadState = "ready"; asset.isCurrent = false; },
    () => { asset.isCurrent = true; asset.finalObjectKey = null; },
    () => { asset.finalObjectKey = "private/key"; asset.objectDeletedAt = NOW; },
    () => {
      asset.objectDeletedAt = null;
      asset.orgId = "org_b";
    },
  ]) {
    mutation();
    await assert.rejects(
      fixture.service.createAssetAccess(fixture.context, video.id),
      (error: unknown) =>
        error instanceof TrainingContentMobileServiceError
        && error.code === "training_content_asset_not_available"
    );
  }
});

test("storage failures return a safe structured error without leaking provider details", async () => {
  const fixture = setup();
  const category = buildCategory("category_a", 0);
  const pdf = buildContent("pdf", category.id, 0, {
    contentType: "pdf",
    nativeBody: null,
  });
  fixture.store.records = [
    record({
      content: pdf,
      category,
      assignments: [assignment(pdf.id, "organization")],
      asset: {
        id: "asset_pdf",
        orgId: ORG_ID,
        contentId: pdf.id,
        uploadState: "ready",
        originalFilename: "guide.pdf",
        detectedMimeType: "application/pdf",
        fileExtension: "pdf",
        byteSize: 100,
        isCurrent: true,
        finalObjectKey: "private/pdf",
        objectDeletedAt: null,
      },
    }),
  ];
  fixture.objectStorage.available = false;

  await assert.rejects(
    fixture.service.createAssetAccess(fixture.context, pdf.id),
    (error: unknown) => {
      const mapped = mapTrainingContentMobileServiceError(error);
      assert.equal(mapped.status, 503);
      assert.deepEqual(mapped.body, {
        error: "Training Content storage is temporarily unavailable.",
        code: "training_content_storage_unavailable",
      });
      assert.equal(JSON.stringify(mapped).includes("credential"), false);
      return true;
    }
  );
});
