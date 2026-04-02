import assert from "node:assert/strict";
import test from "node:test";

import { buildUsageSessionDeterministicId } from "./usageSessionWriteModel.js";

const baseParams = {
  userId: "user_1",
  orgId: "org_1",
  segmentId: "segment_1",
  scenarioId: "scenario_1",
  trainingId: "training_1",
  submittedTrainingPackId: "pack_1",
  startedAt: "2026-03-31T10:00:00.000Z",
  endedAt: "2026-03-31T10:05:00.000Z",
  requestedRawDurationSeconds: 305
} as const;

test("usageSession deterministic ids stay stable for semantic replays", () => {
  const first = buildUsageSessionDeterministicId(baseParams);
  const replay = buildUsageSessionDeterministicId({ ...baseParams });

  assert.equal(first, replay);
});

test("usageSession deterministic ids change when real session identity inputs change", () => {
  const baseline = buildUsageSessionDeterministicId(baseParams);

  assert.notEqual(
    baseline,
    buildUsageSessionDeterministicId({ ...baseParams, endedAt: "2026-03-31T10:05:01.000Z" })
  );
  assert.notEqual(
    baseline,
    buildUsageSessionDeterministicId({ ...baseParams, submittedTrainingPackId: "pack_2" })
  );
  assert.notEqual(
    baseline,
    buildUsageSessionDeterministicId({ ...baseParams, requestedRawDurationSeconds: 306 })
  );
});

test("usageSession deterministic ids intentionally use requested raw duration before clamp", () => {
  const clampedReplayId = buildUsageSessionDeterministicId({
    ...baseParams,
    requestedRawDurationSeconds: 10_000
  });
  const smallerRequestedDurationId = buildUsageSessionDeterministicId({
    ...baseParams,
    requestedRawDurationSeconds: 600
  });

  assert.notEqual(clampedReplayId, smallerRequestedDurationId);
});
