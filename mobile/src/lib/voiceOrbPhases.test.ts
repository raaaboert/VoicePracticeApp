import assert from "node:assert/strict";
import test from "node:test";

import { getCompactVoiceOrbStatus, getVoiceOrbStages } from "./voiceOrbPhases";

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

test("compact status maps idle mode to a visible ready capture label", () => {
  assert.deepEqual(getCompactVoiceOrbStatus({ mode: "idle" }), {
    label: "Capture",
    status: "Ready",
  });
});

test("compact status maps processing mode to a visible process label", () => {
  assert.deepEqual(getCompactVoiceOrbStatus({ mode: "thinking" }), {
    label: "Process",
    status: "Active",
  });
});

test("compact status can show the paused recovery state without blank labels", () => {
  assert.deepEqual(getCompactVoiceOrbStatus({ mode: "idle", paused: true }), {
    label: "Paused",
    status: "Resume when ready",
  });
});
