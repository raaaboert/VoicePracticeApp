import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EnterpriseCustomScenariosCard.tsx", import.meta.url), "utf8");

test("Master Utility exposes canonical customer Practice Scenario lifecycle read-only", () => {
  for (const copy of [
    "Customer Practice Scenario Lifecycle",
    "Stable scenario:",
    "Home Focus Topic:",
    "Approved version:",
    "Published version:",
    "Source references:",
    "Review comment:",
    "History:",
  ]) assert.equal(source.includes(copy), true, copy);
  assert.match(source, /practiceScenarios: CustomerPracticeScenario\[\]/);
  assert.match(source, /setPracticeScenarios\(payload\.practiceScenarios/);
  assert.match(source, /Read-only canonical scenario identities/);
});

test("Master Utility leaves lifecycle-managed legacy projections read-only", () => {
  assert.match(source, /const lifecycleManaged = Boolean\(scenario\.customerScenarioVersionId\)/);
  assert.match(source, /Managed in Focus Topic workspace/);
  assert.equal(source.includes("onClick={() => openEditEditor(scenario)}"), true);
  assert.equal(source.includes("!lifecycleManaged ? <button"), true);
  assert.equal(source.includes(">\n                              Delete\n                            </button> : null"), true);
});
