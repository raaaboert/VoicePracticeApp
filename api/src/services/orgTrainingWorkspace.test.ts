import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, OrgTrainingRecord } from "@voicepractice/shared";

import {
  buildOrgTrainingSummaries,
  buildOrgTrainingSummariesInCompanyOrder,
  compareOrgTrainingCompanyOrder,
  ensureOrgTrainingCollections,
  getOrgTrainingOrderRevision,
  LEGACY_ORG_TRAINING_CREATED_AT,
  LEGACY_TEST_TRAINING_DESCRIPTION,
  LEGACY_TEST_TRAINING_NAME,
  listActiveOrgTrainingsInCompanyOrder,
  listOrgTrainingRecords,
  materializeActiveOrgTrainingOrderWithAppendedTopic,
  normalizeOrgTrainingDisplayOrder,
  normalizeOrgTrainingPackAttachments,
  normalizeOrgTrainingRecords,
  normalizeOrgTrainingScenarioAttachments,
  replaceOrgTrainingPackAttachments,
  replaceOrgTrainingScenarioAttachments,
  reorderActiveOrgTrainings,
  resolveOrgTrainingCreatedAt,
  seedLegacyOrgTraining,
} from "./orgTrainingWorkspace.js";

const ORDER_NOW = "2026-10-02T12:00:00.000Z";

function orderedTraining(
  id: string,
  name: string,
  overrides: Partial<OrgTrainingRecord> = {},
): OrgTrainingRecord {
  return {
    id,
    orgId: "org_123",
    name,
    status: "active" as const,
    description: "",
    createdAt: ORDER_NOW,
    updatedAt: ORDER_NOW,
    ...overrides,
  };
}

test("display order normalization accepts only nonnegative safe integers", () => {
  assert.equal(normalizeOrgTrainingDisplayOrder(undefined), undefined);
  assert.equal(normalizeOrgTrainingDisplayOrder(0), 0);
  assert.equal(normalizeOrgTrainingDisplayOrder(17), 17);
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.equal(normalizeOrgTrainingDisplayOrder(invalid), undefined);
  }

  const normalized = normalizeOrgTrainingRecords([
    orderedTraining("zero", "Zero", { displayOrder: 0 }),
    orderedTraining("positive", "Positive", { displayOrder: 4 }),
    orderedTraining("negative", "Negative", { displayOrder: -1 }),
    orderedTraining("fraction", "Fraction", { displayOrder: 1.5 }),
    orderedTraining("unsafe", "Unsafe", { displayOrder: Number.MAX_SAFE_INTEGER + 1 }),
    orderedTraining("string", "String", { displayOrder: "1" as unknown as number }),
    orderedTraining("missing", "Missing"),
  ], new Set(["org_123"]), ORDER_NOW);
  assert.deepEqual(
    normalized.map((training) => [training.id, training.displayOrder]),
    [
      ["zero", 0], ["positive", 4], ["negative", undefined],
      ["fraction", undefined], ["unsafe", undefined], ["string", undefined], ["missing", undefined],
    ],
  );
});

test("Focus Topic creation timestamps use persisted canonical values and deterministic legacy fallbacks", () => {
  const validOrgIds = new Set(["org_123"]);
  const entries = [
    orderedTraining("canonical", "Canonical", {
      createdAt: "2026-02-03T04:05:06.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
    orderedTraining("parseable", "Parseable", {
      createdAt: "2026-02-03T04:05:06Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
    { ...orderedTraining("missing", "Missing"), createdAt: undefined, updatedAt: "2025-03-04T05:06:07Z" },
    { ...orderedTraining("malformed", "Malformed"), createdAt: "not-a-date", updatedAt: "2024-04-05T06:07:08Z" },
    { ...orderedTraining("unknown", "Unknown"), createdAt: "bad", updatedAt: "also-bad" },
  ];

  const first = normalizeOrgTrainingRecords(entries, validOrgIds, "2026-01-01T00:00:00.000Z");
  const second = normalizeOrgTrainingRecords(entries, validOrgIds, "2036-12-31T23:59:59.999Z");
  assert.deepEqual(
    first.map((entry) => [entry.id, entry.createdAt, entry.updatedAt]),
    [
      ["canonical", "2026-02-03T04:05:06.000Z", "2026-09-01T00:00:00.000Z"],
      ["parseable", "2026-02-03T04:05:06.000Z", "2026-09-01T00:00:00.000Z"],
      ["missing", "2025-03-04T05:06:07.000Z", "2025-03-04T05:06:07.000Z"],
      ["malformed", "2024-04-05T06:07:08.000Z", "2024-04-05T06:07:08.000Z"],
      ["unknown", LEGACY_ORG_TRAINING_CREATED_AT, LEGACY_ORG_TRAINING_CREATED_AT],
    ],
  );
  assert.deepEqual(second, first);
  assert.equal(resolveOrgTrainingCreatedAt("invalid", "invalid"), LEGACY_ORG_TRAINING_CREATED_AT);
});

test("company comparator orders explicit topics first with deterministic legacy and duplicate fallbacks", () => {
  const topics = [
    orderedTraining("legacy_z", "Zulu"),
    orderedTraining("ordered_b", "Beta", { displayOrder: 2 }),
    orderedTraining("duplicate_z", "Zulu", { displayOrder: 1 }),
    orderedTraining("legacy_a2", "alpha"),
    orderedTraining("duplicate_a2", "alpha", { displayOrder: 1 }),
    orderedTraining("duplicate_a1", "Alpha", { displayOrder: 1 }),
    orderedTraining("ordered_a", "First", { displayOrder: 0 }),
    orderedTraining("legacy_a1", "Alpha"),
  ];
  assert.deepEqual(topics.sort(compareOrgTrainingCompanyOrder).map((topic) => topic.id), [
    "ordered_a", "duplicate_a1", "duplicate_a2", "duplicate_z", "ordered_b",
    "legacy_a1", "legacy_a2", "legacy_z",
  ]);
});

test("company-order summaries are explicit while the shared list retains its prior dashboard ordering", () => {
  const db = {
    orgTrainings: [
      orderedTraining("topic_a", "Topic A", { displayOrder: 1, updatedAt: "2026-10-02T11:00:00.000Z" }),
      orderedTraining("topic_b", "Topic B", { displayOrder: 2, updatedAt: "2026-10-02T13:00:00.000Z" }),
      orderedTraining("topic_c", "Topic C", { displayOrder: 0, updatedAt: "2026-10-02T12:00:00.000Z" }),
    ],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
  };
  assert.deepEqual(listOrgTrainingRecords(db, "org_123").map((topic) => topic.id), [
    "topic_b", "topic_c", "topic_a",
  ]);
  assert.deepEqual(buildOrgTrainingSummariesInCompanyOrder({ db, orgId: "org_123" }).map((topic) => topic.id), [
    "topic_c", "topic_a", "topic_b",
  ]);
  assert.deepEqual(buildOrgTrainingSummaries({ db, orgId: "org_123" }).map((topic) => topic.id), [
    "topic_b", "topic_c", "topic_a",
  ]);
});

test("active append materializes mixed legacy order and places creation or restoration last", () => {
  const db = {
    orgTrainings: [
      orderedTraining("explicit", "Zulu", { displayOrder: 2 }),
      orderedTraining("legacy_a", "Alpha"),
      orderedTraining("legacy_b", "Beta"),
      orderedTraining("restored", "Restored", { displayOrder: 0 }),
      orderedTraining("draft", "Draft", { status: "draft" }),
      orderedTraining("foreign", "Foreign", { orgId: "org_other", displayOrder: 0 }),
    ],
  };
  const createdAtById = new Map(db.orgTrainings.map((topic) => [topic.id, topic.createdAt]));
  materializeActiveOrgTrainingOrderWithAppendedTopic({
    db,
    orgId: "org_123",
    trainingId: "restored",
    updatedAt: "2026-10-02T13:00:00.000Z",
  });
  assert.deepEqual(
    listActiveOrgTrainingsInCompanyOrder(db, "org_123").map((topic) => [topic.id, topic.displayOrder]),
    [["explicit", 0], ["legacy_a", 1], ["legacy_b", 2], ["restored", 3]],
  );
  assert.equal(db.orgTrainings.find((topic) => topic.id === "draft")?.displayOrder, undefined);
  assert.equal(db.orgTrainings.find((topic) => topic.id === "foreign")?.displayOrder, 0);
  assert.equal(db.orgTrainings.every((topic) => topic.createdAt === createdAtById.get(topic.id)), true);
});

test("atomic reorder validates revision and the complete active same-org set before mutation", () => {
  const db = {
    orgTrainings: [
      orderedTraining("a", "A", { displayOrder: 0 }),
      orderedTraining("b", "B", { displayOrder: 1 }),
      orderedTraining("draft", "Draft", { status: "draft" }),
      orderedTraining("archived", "Archived", { status: "archived" }),
      orderedTraining("foreign", "Foreign", { orgId: "org_other", displayOrder: 0 }),
    ],
  };
  const revision = getOrgTrainingOrderRevision(db, "org_123");
  const before = structuredClone(db.orgTrainings);
  for (const trainingIds of [
    ["a", "a"], ["a"], ["a", "draft"], ["a", "archived"], ["a", "foreign"], ["a", "deleted"], ["a", " b "], ["a", ""],
  ]) {
    assert.throws(() => reorderActiveOrgTrainings({
      db,
      orgId: "org_123",
      trainingIds,
      expectedOrderRevision: revision,
      updatedAt: "2026-10-02T14:00:00.000Z",
    }));
    assert.deepEqual(db.orgTrainings, before);
  }
  assert.throws(() => reorderActiveOrgTrainings({
    db,
    orgId: "org_123",
    trainingIds: ["b", "a"],
    expectedOrderRevision: "stale",
    updatedAt: "2026-10-02T14:00:00.000Z",
  }), /changed in another session/);
  assert.throws(() => reorderActiveOrgTrainings({
    db,
    orgId: "org_123",
    trainingIds: ["b", "a"],
    expectedOrderRevision: ` ${revision}`,
    updatedAt: "2026-10-02T14:00:00.000Z",
  }), /changed in another session/);
  assert.deepEqual(db.orgTrainings, before);

  const nextRevision = reorderActiveOrgTrainings({
    db,
    orgId: "org_123",
    trainingIds: ["b", "a"],
    expectedOrderRevision: revision,
    updatedAt: "2026-10-02T14:00:00.000Z",
  });
  assert.deepEqual(
    listActiveOrgTrainingsInCompanyOrder(db, "org_123").map((topic) => [topic.id, topic.displayOrder]),
    [["b", 0], ["a", 1]],
  );
  assert.notEqual(nextRevision, revision);
  assert.equal(db.orgTrainings.find((topic) => topic.id === "draft")?.displayOrder, undefined);
  assert.equal(db.orgTrainings.find((topic) => topic.id === "foreign")?.displayOrder, 0);
  assert.deepEqual(
    db.orgTrainings.map((topic) => topic.createdAt),
    before.map((topic) => topic.createdAt),
  );
});

test("active membership changes are stale conflicts before submitted-list validation", () => {
  const original = [
    orderedTraining("a", "A", { displayOrder: 0 }),
    orderedTraining("b", "B", { displayOrder: 1 }),
    orderedTraining("c", "C", { status: "draft" }),
    orderedTraining("d", "D", { status: "archived", displayOrder: 0 }),
  ];
  const revision = getOrgTrainingOrderRevision({ orgTrainings: original }, "org_123");
  const membershipChanges: Array<(rows: OrgTrainingRecord[]) => void> = [
    (rows) => rows.push(orderedTraining("e", "E", { displayOrder: 2 })),
    (rows) => { rows.find((row) => row.id === "c")!.status = "active"; },
    (rows) => { rows[1]!.status = "archived"; },
    (rows) => { rows.find((row) => row.id === "d")!.status = "active"; },
    (rows) => { rows.splice(1, 1); },
  ];

  for (const changeMembership of membershipChanges) {
    const db = { orgTrainings: structuredClone(original) };
    changeMembership(db.orgTrainings);
    const stateAfterConcurrentChange = structuredClone(db.orgTrainings);
    assert.throws(() => reorderActiveOrgTrainings({
      db,
      orgId: "org_123",
      trainingIds: ["a"],
      expectedOrderRevision: revision,
      updatedAt: "2026-10-02T15:00:00.000Z",
    }), (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "org_training_order_conflict");
    assert.deepEqual(db.orgTrainings, stateAfterConcurrentChange);
  }
});

test("seedLegacyOrgTraining creates active Test Training with attached packs and scenarios", () => {
  const db = {
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
  };
  const now = "2026-03-20T00:00:00.000Z";

  const created = seedLegacyOrgTraining({
    db,
    orgId: "org_123",
    trainingPackIds: ["pack_a", "pack_b"],
    scenarioIds: ["scenario_a", "scenario_b"],
    now,
    createTrainingId: () => "training_test",
    createPackAttachmentId: () => `tpack_${db.orgTrainingPackAttachments.length + 1}`,
    createScenarioAttachmentId: () => `tscenario_${db.orgTrainingScenarioAttachments.length + 1}`,
  });

  assert.ok(created);
  assert.equal(created?.id, "training_test");
  assert.equal(created?.name, LEGACY_TEST_TRAINING_NAME);
  assert.equal(created?.status, "active");
  assert.equal(created?.description, LEGACY_TEST_TRAINING_DESCRIPTION);
  assert.equal(db.orgTrainingPackAttachments.length, 2);
  assert.equal(db.orgTrainingScenarioAttachments.length, 2);

  const [summary] = buildOrgTrainingSummaries({
    db,
    orgId: "org_123",
    validTrainingPackIds: ["pack_a", "pack_b"],
    validScenarioIds: ["scenario_a", "scenario_b"],
  });
  assert.ok(summary);
  assert.deepEqual(summary.attachedTrainingPackIds, ["pack_a", "pack_b"]);
  assert.deepEqual(summary.attachedCustomScenarioIds, ["scenario_a", "scenario_b"]);
});

test("seedLegacyOrgTraining is a no-op once org already has trainings", () => {
  const db = {
    orgTrainings: [
      {
        id: "training_existing",
        orgId: "org_123",
        name: "Existing",
        status: "draft" as const,
        description: "",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
  };

  const created = seedLegacyOrgTraining({
    db,
    orgId: "org_123",
    trainingPackIds: ["pack_a"],
    scenarioIds: ["scenario_a"],
    now: "2026-03-20T00:00:00.000Z",
    createTrainingId: () => "training_test",
    createPackAttachmentId: () => "pack_attachment",
    createScenarioAttachmentId: () => "scenario_attachment",
  });

  assert.equal(created, null);
  assert.equal(db.orgTrainings.length, 1);
  assert.equal(db.orgTrainingPackAttachments.length, 0);
  assert.equal(db.orgTrainingScenarioAttachments.length, 0);
});

test("normalizers drop invalid org training records and dangling attachments", () => {
  const now = "2026-03-20T00:00:00.000Z";
  const validOrgIds = new Set(["org_123"]);
  const trainings = normalizeOrgTrainingRecords(
    [
      {
        id: "training_valid",
        orgId: "org_123",
        name: "Valid",
        status: "active",
        description: "kept",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "training_invalid_org",
        orgId: "org_missing",
        name: "Drop",
      },
    ],
    validOrgIds,
    now,
  );
  const validTrainingIds = new Set(trainings.map((entry) => entry.id));

  const packAttachments = normalizeOrgTrainingPackAttachments(
    [
      {
        id: "pack_valid",
        orgId: "org_123",
        trainingId: "training_valid",
        trainingPackId: "pack_a",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "pack_invalid_training",
        orgId: "org_123",
        trainingId: "training_missing",
        trainingPackId: "pack_b",
      },
    ],
    validOrgIds,
    validTrainingIds,
    now,
  );
  const scenarioAttachments = normalizeOrgTrainingScenarioAttachments(
    [
      {
        id: "scenario_valid",
        orgId: "org_123",
        trainingId: "training_valid",
        scenarioId: "scenario_a",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "scenario_invalid_training",
        orgId: "org_123",
        trainingId: "training_missing",
        scenarioId: "scenario_b",
      },
    ],
    validOrgIds,
    validTrainingIds,
    now,
  );

  assert.equal(trainings.length, 1);
  assert.equal(packAttachments.length, 1);
  assert.equal(scenarioAttachments.length, 1);
});

test("ensureOrgTrainingCollections initializes missing arrays", () => {
  const db = {} as Partial<
    Pick<ApiDatabase, "orgTrainings" | "orgTrainingPackAttachments" | "orgTrainingScenarioAttachments">
  >;

  ensureOrgTrainingCollections(db);

  assert.deepEqual(db.orgTrainings, []);
  assert.deepEqual(db.orgTrainingPackAttachments, []);
  assert.deepEqual(db.orgTrainingScenarioAttachments, []);
});

test("replaceOrgTrainingPackAttachments enforces one-training-only ownership inside an org", () => {
  const db = {
    orgTrainings: [],
    orgTrainingPackAttachments: [
      {
        id: "pack_attachment_1",
        orgId: "org_123",
        trainingId: "training_a",
        trainingPackId: "pack_a",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    orgTrainingScenarioAttachments: [],
  };

  replaceOrgTrainingPackAttachments({
    db,
    orgId: "org_123",
    trainingId: "training_b",
    trainingPackIds: ["pack_a", "pack_b"],
    now: "2026-03-20T00:00:00.000Z",
    createAttachmentId: () => `pack_attachment_${db.orgTrainingPackAttachments.length + 1}`,
  });

  assert.deepEqual(
    db.orgTrainingPackAttachments.map((entry) => ({
      trainingId: entry.trainingId,
      trainingPackId: entry.trainingPackId,
    })),
    [
      { trainingId: "training_b", trainingPackId: "pack_a" },
      { trainingId: "training_b", trainingPackId: "pack_b" },
    ],
  );
});

test("replaceOrgTrainingScenarioAttachments enforces one-training-only ownership inside an org", () => {
  const db = {
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [
      {
        id: "scenario_attachment_1",
        orgId: "org_123",
        trainingId: "training_a",
        scenarioId: "scenario_a",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
  };

  replaceOrgTrainingScenarioAttachments({
    db,
    orgId: "org_123",
    trainingId: "training_b",
    scenarioIds: ["scenario_a", "scenario_b"],
    now: "2026-03-20T00:00:00.000Z",
    createAttachmentId: () => `scenario_attachment_${db.orgTrainingScenarioAttachments.length + 1}`,
  });

  assert.deepEqual(
    db.orgTrainingScenarioAttachments.map((entry) => ({
      trainingId: entry.trainingId,
      scenarioId: entry.scenarioId,
    })),
    [
      { trainingId: "training_b", scenarioId: "scenario_a" },
      { trainingId: "training_b", scenarioId: "scenario_b" },
    ],
  );
});
