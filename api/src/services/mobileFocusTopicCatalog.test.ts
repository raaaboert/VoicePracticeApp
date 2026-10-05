import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrgCustomScenario,
  MobileFocusTopicScenarioSummary,
  OrgTrainingPackAttachmentRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  TrainingContentAssignment,
  TrainingContentCategory,
  TrainingContentItem,
  TrainingPack,
  TrainingPackAssignmentRecord,
  UserProfile,
} from "@voicepractice/shared";

import type { TrainingContentMobileReadRecord } from "../storage/trainingContentStore.js";
import {
  createMobileFocusTopicCatalogService,
  type MobileFocusTopicCatalogContext,
} from "./mobileFocusTopicCatalog.js";
import { LEGACY_ORG_TRAINING_CREATED_AT } from "./orgTrainingWorkspace.js";

const NOW = "2026-10-01T12:00:00.000Z";
const ORG_ID = "org_a";

function user(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "learner",
    email: "learner@example.test",
    firstName: "Learn",
    lastName: "Er",
    employeeId: null,
    managerUserId: "manager",
    emailVerifiedAt: NOW,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: ORG_ID,
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

function topic(id: string, overrides: Partial<OrgTrainingRecord> = {}): OrgTrainingRecord {
  return {
    id,
    orgId: ORG_ID,
    name: id,
    status: "active",
    description: `${id} description`,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function customScenario(id: string, orgId = ORG_ID, enabled = true): OrgCustomScenario {
  return {
    id,
    orgId,
    segmentId: "segment",
    title: id,
    description: id,
    aiRole: "Buyer",
    scoringGuidance: "",
    applicableIndustryIds: ["industry"],
    enabled,
    provenance: { sourceMode: "scratch", creationMethod: "manual" },
    createdBy: "admin",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function scenarioSummary(
  id: string,
  source: "standard" | "custom",
  trainingId: string | null = source === "custom" ? "topic" : null,
  overrides: Partial<MobileFocusTopicScenarioSummary> = {}
): MobileFocusTopicScenarioSummary {
  return {
    id,
    title: id,
    description: `${id} description`,
    source,
    segmentId: "segment",
    segmentLabel: "Role",
    industryId: "industry",
    industryLabel: "Industry",
    trainingId,
    ...overrides,
  };
}

function pack(id: string, triggers: string[], overrides: Partial<TrainingPack> = {}): TrainingPack {
  return {
    id,
    organizationId: ORG_ID,
    title: id,
    trainingTopic: "A non-authoritative label",
    learningObjectives: [],
    successBehaviors: [],
    failurePatterns: [],
    requiredBehavioralTriggers: triggers,
    scoringWeightOverrides: {},
    complianceConstraints: "",
    audienceLevel: "",
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function assignment(
  packId: string,
  scenarioIds: string[],
  overrides: Partial<TrainingPackAssignmentRecord> = {}
): TrainingPackAssignmentRecord {
  return {
    id: `assignment_${packId}`,
    trainingPackId: packId,
    orgId: ORG_ID,
    userId: "learner",
    active: true,
    assignedAt: NOW,
    assignedByUserId: "admin",
    requiredScenarioIds: scenarioIds,
    completionRule: "scored_required_scenarios_v1",
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function packAttachment(
  topicId: string,
  packId: string,
  overrides: Partial<OrgTrainingPackAttachmentRecord> = {}
): OrgTrainingPackAttachmentRecord {
  return {
    id: `pack_attachment_${topicId}_${packId}`,
    orgId: ORG_ID,
    trainingId: topicId,
    trainingPackId: packId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function scenarioAttachment(
  topicId: string,
  scenarioId: string,
  overrides: Partial<OrgTrainingScenarioAttachmentRecord> = {}
): OrgTrainingScenarioAttachmentRecord {
  return {
    id: `scenario_attachment_${topicId}_${scenarioId}`,
    orgId: ORG_ID,
    trainingId: topicId,
    scenarioId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function contentRecord(params: {
  id: string;
  topicId: string | null;
  assignmentType?: TrainingContentAssignment["assignmentType"];
  subjectUserId?: string | null;
  content?: Partial<TrainingContentItem>;
  category?: Partial<TrainingContentCategory>;
  assignment?: Partial<TrainingContentAssignment>;
}): TrainingContentMobileReadRecord {
  const category: TrainingContentCategory = {
    id: `category_${params.id}`,
    orgId: ORG_ID,
    name: "Category",
    description: "",
    displayOrder: 0,
    isDefault: false,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...params.category,
  };
  const content: TrainingContentItem = {
    id: params.id,
    orgId: ORG_ID,
    categoryId: category.id,
    title: params.id,
    description: "",
    focusTopicId: params.topicId,
    focusTopicNameSnapshot: "Not authoritative",
    contentType: "native",
    publicationState: "published",
    nativeBody: "Body",
    externalUrl: null,
    displayOrder: 0,
    contentVersion: 1,
    createdByActorId: "admin",
    updatedByActorId: "admin",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    archivedAt: null,
    ...params.content,
  };
  const grant: TrainingContentAssignment = {
    id: `grant_${params.id}`,
    orgId: ORG_ID,
    contentId: content.id,
    assignmentType: params.assignmentType ?? "organization",
    subjectUserId: params.subjectUserId ?? null,
    createdByActorId: "admin",
    createdAt: NOW,
    revokedByActorId: null,
    revokedAt: null,
    ...params.assignment,
  };
  return { content, category, currentAsset: null, assignments: [grant] };
}

const emptyScenarioConfig: MobileFocusTopicCatalogContext["scenarioConfig"] = {
  industries: [],
  roleIndustries: [],
  segments: [],
  orgCustomScenarios: [],
  orgTrainings: [],
};

function harness(overrides: Partial<MobileFocusTopicCatalogContext> & {
  packs?: TrainingPack[];
  records?: TrainingContentMobileReadRecord[];
  moduleEnabled?: boolean;
} = {}) {
  const packs = overrides.packs ?? [];
  const records = overrides.records ?? [];
  const contentReads: Array<{ orgId: string; topicIds: readonly string[] }> = [];
  const service = createMobileFocusTopicCatalogService({
    trainingPackStore: {
      async listTrainingPacksForOrg() { return packs; },
    },
    trainingContentStore: {
      async listPublishedContentForMobileFocusTopics(orgId, topicIds) {
        contentReads.push({ orgId, topicIds: [...topicIds] });
        return records;
      },
    },
    entitlementStore: {
      async getOrgModuleEntitlement(orgId) {
        return {
          orgId,
          moduleKey: "training_content" as const,
          enabled: overrides.moduleEnabled ?? true,
          updatedByActorId: null,
          updatedAt: null,
        };
      },
    },
  });
  const context: MobileFocusTopicCatalogContext = {
    actingOrgId: ORG_ID,
    organizationActive: true,
    user: user(),
    users: [user(), user({ id: "manager", orgRole: "user_admin", managerUserId: null })],
    topics: [],
    packAttachments: [],
    scenarioAttachments: [],
    packAssignments: [],
    scenarioConfig: emptyScenarioConfig,
    isTopicVisible: () => true,
    resolveScenario: () => null,
    ...overrides,
  };
  return { service, context, contentReads };
}

test("catalog uses active authoritative topic IDs, division visibility, and deterministic ordering", async () => {
  const topics = [
    topic("topic_z", { name: "alpha" }),
    topic("topic_a", { name: "Alpha" }),
    topic("topic_beta", { name: "Beta" }),
    topic("topic_draft", { status: "draft" }),
    topic("topic_archived", { status: "archived" }),
    topic("topic_other", { orgId: "org_b" }),
    topic("topic_hidden"),
    topic("topic_empty"),
  ];
  const visibleCustom = ["custom_z", "custom_a", "custom_beta"];
  const { service, context } = harness({
    topics,
    scenarioAttachments: [
      scenarioAttachment("topic_z", "custom_z"),
      scenarioAttachment("topic_a", "custom_a"),
      scenarioAttachment("topic_beta", "custom_beta"),
      scenarioAttachment("topic_hidden", "custom_hidden"),
      scenarioAttachment("topic_other", "custom_other", { orgId: "org_b" }),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [
        ...visibleCustom.map((id) => customScenario(id)),
        customScenario("custom_hidden"),
        customScenario("custom_other", "org_b"),
      ],
    },
    isTopicVisible: (entry) => entry.id !== "topic_hidden",
    resolveScenario: (id, trainingId) => visibleCustom.includes(id)
      ? scenarioSummary(id, "custom", trainingId ?? null)
      : null,
  });

  const result = await service.getCatalog(context);
  assert.deepEqual(result.topics.map((entry) => entry.id), ["topic_a", "topic_z", "topic_beta"]);
  assert.equal(result.topics.every((entry) => entry.createdAt === NOW), true);
  assert.deepEqual(result.topics.map((entry) => entry.scenarioCount), [1, 1, 1]);
  assert.equal(result.topics.some((entry) => "displayOrder" in entry || "updatedAt" in entry), false);
  assert.equal(JSON.stringify(result).includes("focusTopicNameSnapshot"), false);
  assert.equal(JSON.stringify(result).includes("trainingTopic"), false);
});

test("catalog isolates malformed legacy timestamps and keeps valid Topic creation times", async () => {
  const { service, context } = harness({
    topics: [
      topic("valid", { createdAt: "2026-02-03T04:05:06.000Z" }),
      topic("missing", { createdAt: undefined as unknown as string, updatedAt: "2025-03-04T05:06:07Z" }),
      topic("malformed", { createdAt: "not-a-date", updatedAt: "also-not-a-date" }),
    ],
    scenarioAttachments: [
      scenarioAttachment("valid", "custom_valid"),
      scenarioAttachment("missing", "custom_missing"),
      scenarioAttachment("malformed", "custom_malformed"),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [
        customScenario("custom_valid"),
        customScenario("custom_missing"),
        customScenario("custom_malformed"),
      ],
    },
    resolveScenario: (id, trainingId) => scenarioSummary(id, "custom", trainingId ?? null),
  });

  const result = await service.getCatalog(context);
  assert.equal(result.topics.length, 3);
  assert.equal(result.topics.find((entry) => entry.id === "valid")?.createdAt, "2026-02-03T04:05:06.000Z");
  assert.equal(result.topics.find((entry) => entry.id === "missing")?.createdAt, "2025-03-04T05:06:07.000Z");
  assert.equal(result.topics.find((entry) => entry.id === "malformed")?.createdAt, LEGACY_ORG_TRAINING_CREATED_AT);
});

test("catalog preserves company order across an actionable learner subset without exposing displayOrder", async () => {
  const { service, context } = harness({
    topics: [
      topic("topic_a", { name: "Alpha", displayOrder: 2 }),
      topic("topic_b", { name: "Beta", displayOrder: 0 }),
      topic("topic_c", { name: "Charlie", displayOrder: 1 }),
      topic("legacy_z", { name: "Zulu" }),
      topic("legacy_a", { name: "Able" }),
    ],
    scenarioAttachments: [
      scenarioAttachment("topic_a", "custom_a"),
      scenarioAttachment("topic_b", "custom_b"),
      scenarioAttachment("legacy_z", "custom_z"),
      scenarioAttachment("legacy_a", "custom_legacy_a"),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [
        customScenario("custom_a"),
        customScenario("custom_b"),
        customScenario("custom_z"),
        customScenario("custom_legacy_a"),
      ],
    },
    resolveScenario: (id, trainingId) => scenarioSummary(id, "custom", trainingId ?? null),
  });

  const result = await service.getCatalog(context);
  assert.deepEqual(result.topics.map((entry) => entry.id), [
    "topic_b", "topic_a", "legacy_a", "legacy_z",
  ]);
  assert.equal(result.topics.some((entry) => "displayOrder" in entry), false);
  assert.equal(result.topics.every((entry) => entry.scenarioCount === 1 && entry.resourceCount === 0), true);
  assert.equal(await service.getDetail(context, "topic_c"), null);
});

test("direct custom scenarios need no pack and stale, disabled, wrong-org, and duplicate paths stay safe", async () => {
  const resolvedCalls: Array<[string, string | null | undefined]> = [];
  const { service, context } = harness({
    topics: [topic("topic")],
    scenarioAttachments: [
      scenarioAttachment("topic", "launchable"),
      scenarioAttachment("topic", "launchable", { id: "duplicate" }),
      scenarioAttachment("topic", "disabled"),
      scenarioAttachment("topic", "stale"),
      scenarioAttachment("topic", "wrong_org", { orgId: "org_b" }),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [
        customScenario("launchable"),
        customScenario("disabled", ORG_ID, false),
        customScenario("wrong_org", "org_b"),
      ],
    },
    resolveScenario: (id, trainingId) => {
      resolvedCalls.push([id, trainingId]);
      return id === "launchable" ? scenarioSummary(id, "custom", trainingId ?? null) : null;
    },
  });

  const result = await service.getCatalog(context);
  assert.equal(result.topics[0]?.scenarioCount, 1);
  assert.equal(context.packAssignments.length, 0);
  assert.deepEqual(resolvedCalls, [["launchable", "topic"], ["launchable", "topic"], ["disabled", "topic"]]);
});

test("pack scenarios require explicit selection, active assignment intersection, and standard launchability", async () => {
  const calls: Array<[string, string | null | undefined]> = [];
  const { service, context } = harness({
    topics: [topic("topic")],
    packs: [
      pack("explicit", ["scenario:standard", "scenario:not_assigned", "scenario:custom"]),
      pack("wildcard", ["scenario:*"]),
      pack("inactive", ["scenario:inactive"], { active: false }),
      pack("other_org", ["scenario:other"], { organizationId: "org_b" }),
      pack("unattached", ["scenario:unattached"]),
    ],
    packAttachments: [
      packAttachment("topic", "explicit"),
      packAttachment("topic", "explicit", { id: "duplicate_pack_path" }),
      packAttachment("topic", "wildcard"),
      packAttachment("topic", "inactive"),
      packAttachment("topic", "other_org"),
      packAttachment("topic", "cross_org", { orgId: "org_b", trainingPackId: "explicit" }),
    ],
    packAssignments: [
      assignment("explicit", ["standard", "custom"]),
      assignment("wildcard", ["wild_standard"]),
      assignment("inactive", ["inactive"]),
      assignment("other_org", ["other"], { orgId: "org_b" }),
      assignment("unattached", ["unattached"]),
    ],
    resolveScenario: (id, trainingId) => {
      calls.push([id, trainingId]);
      if (id === "custom") return scenarioSummary(id, "custom", trainingId ?? null);
      return scenarioSummary(id, "standard");
    },
  });

  const result = await service.getCatalog(context);
  assert.equal(result.topics[0]?.scenarioCount, 1);
  assert.deepEqual(calls, [
    ["standard", null],
    ["custom", null],
    ["standard", null],
    ["custom", null],
  ]);
  assert.equal(calls.some(([id]) => id === "wild_standard"), false);
});

test("inactive or absent pack assignments and non-launchable selected standards do not create topics", async () => {
  const { service, context } = harness({
    topics: [topic("topic")],
    packs: [pack("pack", ["scenario:standard"])],
    packAttachments: [packAttachment("topic", "pack")],
    packAssignments: [assignment("pack", ["standard"], { active: false })],
    resolveScenario: (id) => scenarioSummary(id, "standard"),
  });
  assert.deepEqual(await service.getCatalog(context), { topics: [] });

  context.packAssignments = [];
  assert.deepEqual(await service.getCatalog(context), { topics: [] });

  context.packAssignments = [assignment("pack", ["standard"])];
  context.resolveScenario = () => null;
  assert.deepEqual(await service.getCatalog(context), { topics: [] });
});

test("resource eligibility supports all existing grants and exact uncapped distinct counts", async () => {
  const records = Array.from({ length: 501 }, (_, index) =>
    contentRecord({ id: `org_${index}`, topicId: "resources" })
  );
  records.push(
    contentRecord({ id: "user_grant", topicId: "resources", assignmentType: "user", subjectUserId: "learner" }),
    contentRecord({ id: "manager_grant", topicId: "resources", assignmentType: "manager", subjectUserId: "learner" }),
    contentRecord({ id: "team_grant", topicId: "resources", assignmentType: "manager_team", subjectUserId: "manager" }),
    contentRecord({ id: "revoked", topicId: "resources", assignment: { revokedAt: NOW } }),
    contentRecord({ id: "unpublished", topicId: "resources", content: { publicationState: "draft" } }),
    contentRecord({ id: "archived_content", topicId: "resources", content: { archivedAt: NOW } }),
    contentRecord({ id: "archived_category", topicId: "resources", category: { archivedAt: NOW } }),
    contentRecord({ id: "wrong_content_org", topicId: "resources", content: { orgId: "org_b" } }),
    contentRecord({ id: "wrong_category_org", topicId: "resources", category: { orgId: "org_b" } }),
    contentRecord({ id: "wrong_category_link", topicId: "resources", content: { categoryId: "other_category" } }),
    contentRecord({ id: "stale_topic", topicId: "deleted_topic" })
  );
  records.push(records[0]!);
  const { service, context, contentReads } = harness({
    topics: [topic("resources")],
    records,
    user: user({ orgRole: "user_admin" }),
    users: [
      user({ orgRole: "user_admin" }),
      user({ id: "manager", orgRole: "user_admin", managerUserId: null }),
    ],
  });

  const result = await service.getCatalog(context);
  assert.deepEqual(result, {
    topics: [{
      id: "resources",
      name: "resources",
      description: "resources description",
      createdAt: NOW,
      scenarioCount: 0,
      resourceCount: 504,
    }],
  });
  assert.deepEqual(contentReads, [{ orgId: ORG_ID, topicIds: ["resources"] }]);
});

test("disabled module, inactive membership, and stale topic IDs contribute no resources", async () => {
  const disabled = harness({
    topics: [topic("topic")],
    records: [contentRecord({ id: "resource", topicId: "topic" })],
    moduleEnabled: false,
  });
  assert.deepEqual(await disabled.service.getCatalog(disabled.context), { topics: [] });
  assert.equal(disabled.contentReads.length, 0);

  const inactive = harness({
    topics: [topic("topic")],
    records: [contentRecord({ id: "resource", topicId: "topic" })],
    user: user({ status: "disabled" }),
  });
  assert.deepEqual(await inactive.service.getCatalog(inactive.context), { topics: [] });
  assert.equal(inactive.contentReads.length, 0);
});

test("mixed, scenario-only, resource-only, and empty topics project only the narrow public DTO", async () => {
  const { service, context } = harness({
    topics: [topic("scenario"), topic("resource"), topic("mixed"), topic("empty")],
    scenarioAttachments: [
      scenarioAttachment("scenario", "custom_scenario"),
      scenarioAttachment("mixed", "custom_mixed"),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [customScenario("custom_scenario"), customScenario("custom_mixed")],
    },
    records: [
      contentRecord({ id: "resource_only", topicId: "resource" }),
      contentRecord({ id: "resource_mixed", topicId: "mixed" }),
    ],
    resolveScenario: (id, trainingId) => scenarioSummary(id, "custom", trainingId ?? null),
  });
  const result = await service.getCatalog(context);
  assert.deepEqual(result.topics.map(({ id, scenarioCount, resourceCount }) => ({ id, scenarioCount, resourceCount })), [
    { id: "mixed", scenarioCount: 1, resourceCount: 1 },
    { id: "resource", scenarioCount: 0, resourceCount: 1 },
    { id: "scenario", scenarioCount: 1, resourceCount: 0 },
  ]);
  for (const projected of result.topics) {
    assert.deepEqual(Object.keys(projected).sort(), ["createdAt", "description", "id", "name", "resourceCount", "scenarioCount"]);
  }
});

test("detail reuses catalog membership, returns safe launch metadata, and preserves resource order", async () => {
  const records = [
    contentRecord({
      id: "resource_first",
      topicId: "topic",
      content: { title: "First resource", displayOrder: 1 },
      category: { id: "category_first", name: "First category", displayOrder: 1 },
    }),
    contentRecord({
      id: "resource_second",
      topicId: "topic",
      content: { title: "Second resource", displayOrder: 2 },
      category: { id: "category_second", name: "Second category", displayOrder: 2 },
    }),
  ];
  const { service, context } = harness({
    topics: [topic("topic", { name: "Authoritative topic" })],
    scenarioAttachments: [
      scenarioAttachment("topic", "custom_z"),
      scenarioAttachment("topic", "custom_a"),
      scenarioAttachment("topic", "custom_a", { id: "duplicate_custom" }),
    ],
    scenarioConfig: {
      ...emptyScenarioConfig,
      orgCustomScenarios: [customScenario("custom_z"), customScenario("custom_a")],
    },
    records,
    resolveScenario: (id, trainingId) => scenarioSummary(
      id,
      "custom",
      trainingId ?? null,
      {
        title: id === "custom_z" ? "Zulu" : "Alpha",
        description: `${id} safe summary`,
      }
    ),
  });

  const detail = await service.getDetail(context, "topic");
  assert.ok(detail);
  assert.deepEqual(detail.topic, {
    id: "topic",
    name: "Authoritative topic",
    description: "topic description",
  });
  assert.deepEqual(detail.scenarios.map((entry) => entry.id), ["custom_a", "custom_z"]);
  assert.equal(detail.scenarios.every((entry) => entry.trainingId === "topic"), true);
  assert.deepEqual(detail.resources.map((entry) => entry.id), ["resource_first", "resource_second"]);
  assert.deepEqual(Object.keys(detail.scenarios[0]!).sort(), [
    "description",
    "id",
    "industryId",
    "industryLabel",
    "segmentId",
    "segmentLabel",
    "source",
    "title",
    "trainingId",
  ]);
  assert.deepEqual(Object.keys(detail.resources[0]!).sort(), [
    "category",
    "contentType",
    "description",
    "id",
    "relatedFocusTopic",
    "title",
  ]);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ["trainingPackId", "assignment", "aiRole", "scoringGuidance", "nativeBody"]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  const catalog = await service.getCatalog(context);
  assert.equal(catalog.topics[0]?.scenarioCount, detail.scenarios.length);
  assert.equal(catalog.topics[0]?.resourceCount, detail.resources.length);
});

test("detail keeps standard trainingId null and applies explicit assigned-pack intersection", async () => {
  const { service, context } = harness({
    topics: [topic("topic")],
    packs: [
      pack("explicit", ["scenario:z", "scenario:a", "scenario:custom", "scenario:not_required"]),
      pack("wildcard", ["scenario:*"]),
    ],
    packAttachments: [
      packAttachment("topic", "explicit"),
      packAttachment("topic", "explicit", { id: "duplicate_path" }),
      packAttachment("topic", "wildcard"),
    ],
    packAssignments: [
      assignment("explicit", ["z", "a", "custom"]),
      assignment("wildcard", ["wild"]),
    ],
    resolveScenario: (id) => id === "custom"
      ? scenarioSummary(id, "custom", "topic")
      : scenarioSummary(id, "standard", null, { title: id === "z" ? "Zulu" : "Alpha" }),
  });

  const detail = await service.getDetail(context, "topic");
  assert.ok(detail);
  assert.deepEqual(detail.scenarios.map((entry) => entry.id), ["a", "z"]);
  assert.equal(detail.scenarios.every((entry) => entry.source === "standard"), true);
  assert.equal(detail.scenarios.every((entry) => entry.trainingId === null), true);
});

test("standard topic actionability requires a Setup-reachable role and enabled-industry mapping", async () => {
  let contextRef: MobileFocusTopicCatalogContext;
  let recognizedStandardCalls = 0;
  const { service, context } = harness({
    topics: [
      topic("standard_topic", { name: "Standard topic" }),
      topic("custom_topic", { name: "Custom topic" }),
    ],
    packs: [pack("explicit", ["scenario:standard"])],
    packAttachments: [packAttachment("standard_topic", "explicit")],
    packAssignments: [assignment("explicit", ["standard"])],
    scenarioAttachments: [scenarioAttachment("custom_topic", "custom")],
    scenarioConfig: {
      industries: [{
        id: "industry",
        label: "Industry",
        enabled: true,
        aiBaseline: "",
        standardScoringGuidance: "",
      }],
      // A valid mapping elsewhere disables the legacy no-mappings fallback, while
      // the target role itself remains unavailable in mobile Setup.
      roleIndustries: [{ roleId: "other_role", industryId: "industry", active: true }],
      segments: [],
      orgCustomScenarios: [customScenario("custom")],
      orgTrainings: [],
    },
    resolveScenario: (id, trainingId) => {
      if (id === "custom") {
        return scenarioSummary(id, "custom", trainingId ?? null);
      }
      if (id !== "standard") {
        return null;
      }
      // The server can identify the standard scenario before Setup reachability
      // applies the role/industry selection constraint.
      recognizedStandardCalls += 1;
      const enabledIndustryIds = new Set(
        contextRef.scenarioConfig.industries
          .filter((industry) => industry.enabled)
          .map((industry) => industry.id)
      );
      const setupCanOfferRole = contextRef.scenarioConfig.roleIndustries.some(
        (mapping) => mapping.active
          && mapping.roleId === "target_role"
          && enabledIndustryIds.has(mapping.industryId)
      );
      return setupCanOfferRole
        ? scenarioSummary(id, "standard", null, {
            segmentId: "target_role",
            segmentLabel: "Target role",
          })
        : null;
    },
  });
  contextRef = context;

  const beforeCatalog = await service.getCatalog(context);
  assert.equal(recognizedStandardCalls > 0, true);
  assert.deepEqual(beforeCatalog.topics.map((entry) => entry.id), ["custom_topic"]);
  assert.equal(await service.getDetail(context, "standard_topic"), null);
  const customBefore = await service.getDetail(context, "custom_topic");
  assert.deepEqual(customBefore?.scenarios.map((entry) => entry.id), ["custom"]);

  context.scenarioConfig = {
    ...context.scenarioConfig,
    roleIndustries: [
      ...context.scenarioConfig.roleIndustries,
      { roleId: "target_role", industryId: "industry", active: true },
    ],
  };

  const afterCatalog = await service.getCatalog(context);
  assert.equal(
    afterCatalog.topics.find((entry) => entry.id === "standard_topic")?.scenarioCount,
    1
  );
  const standardAfter = await service.getDetail(context, "standard_topic");
  assert.deepEqual(standardAfter?.scenarios.map((entry) => entry.id), ["standard"]);
  assert.equal(standardAfter?.scenarios[0]?.trainingId, null);
  const customAfter = await service.getDetail(context, "custom_topic");
  assert.deepEqual(customAfter?.scenarios.map((entry) => entry.id), ["custom"]);
});

test("detail fails closed for missing, inactive, hidden, foreign, malformed, and empty topics", async () => {
  const { service, context } = harness({
    topics: [
      topic("empty"),
      topic("inactive", { status: "archived" }),
      topic("hidden"),
      topic("foreign", { orgId: "org_b" }),
    ],
    isTopicVisible: (entry) => entry.id !== "hidden",
  });

  for (const topicId of ["", "missing", "empty", "inactive", "hidden", "foreign"]) {
    assert.equal(await service.getDetail(context, topicId), null);
  }
});
