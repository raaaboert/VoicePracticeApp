import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_SIMULATION_BACKGROUND_GRACE_MS,
  classifySimulationAppStateTransition,
  normalizeSimulationAppStateStatus,
  shouldExpireBackgroundPause,
} from "./simulationAppStateLifecycle";

test("normalizeSimulationAppStateStatus keeps the supported foreground/background states", () => {
  assert.equal(normalizeSimulationAppStateStatus("active"), "active");
  assert.equal(normalizeSimulationAppStateStatus("inactive"), "inactive");
  assert.equal(normalizeSimulationAppStateStatus("background"), "background");
  assert.equal(normalizeSimulationAppStateStatus("unknown"), "active");
});

test("classifySimulationAppStateTransition pauses an active session when the app leaves the foreground", () => {
  const result = classifySimulationAppStateTransition({
    previousAppState: "active",
    nextAppState: "background",
    sessionActive: true,
    simulationClosed: false,
    backgroundedAtMs: null,
    nowMs: 10_000,
  });

  assert.deepEqual(result, {
    kind: "pause_session",
    previousAppState: "active",
    nextAppState: "background",
    sessionPreserved: true,
  });
});

test("classifySimulationAppStateTransition resumes an active session within the grace period", () => {
  const result = classifySimulationAppStateTransition({
    previousAppState: "background",
    nextAppState: "active",
    sessionActive: true,
    simulationClosed: false,
    backgroundedAtMs: 10_000,
    nowMs: 10_000 + ACTIVE_SIMULATION_BACKGROUND_GRACE_MS,
  });

  assert.deepEqual(result, {
    kind: "resume_session",
    previousAppState: "background",
    nextAppState: "active",
    elapsedMs: ACTIVE_SIMULATION_BACKGROUND_GRACE_MS,
    sessionPreserved: true,
  });
});

test("classifySimulationAppStateTransition expires an active session after the grace period", () => {
  const result = classifySimulationAppStateTransition({
    previousAppState: "inactive",
    nextAppState: "active",
    sessionActive: true,
    simulationClosed: false,
    backgroundedAtMs: 30_000,
    nowMs: 30_000 + ACTIVE_SIMULATION_BACKGROUND_GRACE_MS + 1,
  });

  assert.deepEqual(result, {
    kind: "expire_session",
    previousAppState: "inactive",
    nextAppState: "active",
    elapsedMs: ACTIVE_SIMULATION_BACKGROUND_GRACE_MS + 1,
    sessionPreserved: false,
  });
});

test("classifySimulationAppStateTransition ignores inactive app changes when no live session exists", () => {
  const result = classifySimulationAppStateTransition({
    previousAppState: "active",
    nextAppState: "background",
    sessionActive: false,
    simulationClosed: false,
    backgroundedAtMs: null,
    nowMs: 10_000,
  });

  assert.deepEqual(result, {
    kind: "ignore",
    previousAppState: "active",
    nextAppState: "background",
    sessionPreserved: false,
  });
});

test("shouldExpireBackgroundPause respects the exact grace boundary", () => {
  assert.equal(
    shouldExpireBackgroundPause({
      pausedAtMs: 1_000,
      resumedAtMs: 1_000 + ACTIVE_SIMULATION_BACKGROUND_GRACE_MS,
    }),
    false,
  );

  assert.equal(
    shouldExpireBackgroundPause({
      pausedAtMs: 1_000,
      resumedAtMs: 1_000 + ACTIVE_SIMULATION_BACKGROUND_GRACE_MS + 1,
    }),
    true,
  );
});
