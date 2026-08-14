import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const simulationScreenSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../screens/SimulationScreen.tsx"),
  "utf8",
);

test("capture retry feedback renders inside the fixed action dock without the compact status gate", () => {
  const dockStart = simulationScreenSource.indexOf("styles.actionDock,");
  const dockEnd = simulationScreenSource.indexOf("function createStyles", dockStart);
  const dockSource = simulationScreenSource.slice(dockStart, dockEnd);

  assert(dockStart >= 0 && dockEnd > dockStart);
  assert.match(dockSource, /actionDockFeedback\s*\?/);
  assert.match(dockSource, /\{actionDockFeedback\}/);
  assert.match(dockSource, /styles\.actionDockFeedback/);
  assert.doesNotMatch(dockSource, /showCompactEngineSummary/);
  assert(dockSource.indexOf("actionDockFeedback ?") < dockSource.indexOf("<Pressable"));
});

test("finalize lifecycle clears stale feedback and supplies safe retry feedback before restart", () => {
  assert.match(
    simulationScreenSource,
    /setStatus\("Finalizing your audio\.\.\."\);\s*setError\(null\);\s*setActionDockRetryFeedback\(null\);/,
  );
  assert.match(
    simulationScreenSource,
    /captureRetryStatus = SIMULATION_FINALIZE_RETRY_STATUS;\s*setActionDockRetryFeedback\(captureRetryStatus\);/,
  );
  assert.match(simulationScreenSource, /startListeningTurn\(captureRetryStatus\)/);
});
