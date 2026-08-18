import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getCompactVoiceOrbStatus, getVoiceOrbStages } from "./voiceOrbPhases";

const voiceOrbSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../components/VoiceOrb.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

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

test("recording mode keeps Process visible as the middle standby phase", () => {
  const stages = getVoiceOrbStages("recording");

  assert.deepEqual(
    stages.map((stage) => stage.label),
    ["Capture", "Process", "Deliver"],
  );
  assert.deepEqual(stages[1], {
    key: "process",
    label: "Process",
    state: "standby",
    status: "Standby",
  });
});

test("regular stage rows do not enable Android paint clipping", () => {
  const stepRowStart = voiceOrbSource.indexOf("stepRow: {");
  const stepRowEnd = voiceOrbSource.indexOf("stepRowCompact: {", stepRowStart);
  assert.ok(stepRowStart >= 0 && stepRowEnd > stepRowStart);
  const stepRowStyle = voiceOrbSource.slice(stepRowStart, stepRowEnd);

  // Android can clip rounded-row children when overflow is hidden beside an asymmetric hairline border.
  assert.doesNotMatch(stepRowStyle, /overflow:\s*["']hidden["']/);
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
