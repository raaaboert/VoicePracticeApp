import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "EnterpriseTrainingsWorkspace.tsx"),
  "utf8",
);

test("Focus Topic workspace exposes accessible complete-list ordering controls", () => {
  assert.match(source, /"Save Company Order"/);
  assert.match(source, /disabled=\{!orderDirty \|\| reorderBlockedBySearch \|\| orderSaving \|\| loading\}/);
  assert.match(source, /aria-label=\{`Move \$\{training\.name\} up`\}/);
  assert.match(source, /aria-label=\{`Move \$\{training\.name\} down`\}/);
  assert.match(source, /activeTrainingPositionById\.get\(training\.id\) === 0/);
  assert.match(source, /activeTrainingPositionById\.get\(training\.id\) === activeTrainingIds\.length - 1/);
  assert.match(source, /trainingIds: activeFocusTopicIds\(trainings\)/);
});

test("filtered, inactive, and stale ordering states fail safely", () => {
  assert.match(source, /Clear the Focus Topic search to change company order\./);
  assert.match(source, /training\.status === "active" \? \(/);
  assert.match(source, />Not active<\/span>/);
  assert.match(source, /message\.includes\("\(409"\)/);
  assert.match(source, /The current company order has been reloaded\./);
  assert.match(source, /expectedOrderRevision: orderRevision/);
});
