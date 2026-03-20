import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase } from "@voicepractice/shared";

import {
  buildOrgTrainingSummaries,
  ensureOrgTrainingCollections,
  LEGACY_TEST_TRAINING_DESCRIPTION,
  LEGACY_TEST_TRAINING_NAME,
  normalizeOrgTrainingPackAttachments,
  normalizeOrgTrainingRecords,
  normalizeOrgTrainingScenarioAttachments,
  seedLegacyOrgTraining,
} from "./orgTrainingWorkspace.js";

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
