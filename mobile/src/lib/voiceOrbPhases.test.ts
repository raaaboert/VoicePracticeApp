import assert from "node:assert/strict";
import test from "node:test";

import { getVoiceOrbStages } from "./voiceOrbPhases";

test("idle mode keeps all three stable phase rows visible before start", () => {
  const stages = getVoiceOrbStages("idle");

  assert.deepEqual(stages, [
    {
      key: "capture",
      label: "Capture",
      state: "ready",
      status: "Ready",
    },
    {
      key: "process",
      label: "Process",
      state: "standby",
      status: "Standby",
    },
    {
      key: "deliver",
      label: "Deliver",
      state: "standby",
      status: "Standby",
    },
  ]);
});

test("thinking mode keeps the process row present and active", () => {
  const stages = getVoiceOrbStages("thinking");

  assert.deepEqual(
    stages.map((stage) => stage.key),
    ["capture", "process", "deliver"],
  );
  assert.deepEqual(stages[1], {
    key: "process",
    label: "Process",
    state: "active",
    status: "Active",
  });
});

test("speaking mode preserves completed earlier phases", () => {
  const stages = getVoiceOrbStages("speaking");

  assert.deepEqual(
    stages.map((stage) => stage.state),
    ["complete", "complete", "active"],
  );
});
