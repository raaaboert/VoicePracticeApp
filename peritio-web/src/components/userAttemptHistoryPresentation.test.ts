import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const component = readFileSync(join(componentsDir, "UserAttemptHistory.tsx"), "utf8");
const page = readFileSync(join(componentsDir, "../../app/app/users/[userId]/page.tsx"), "utf8");

test("user attempt history provides compact filters, lazy scoring detail, and paging", () => {
  for (const label of ["Focus Topic", "Scenario", "Start date", "End date", "Clear filters", "Load more"]) {
    assert.equal(component.includes(label), true, label);
  }
  assert.match(component, /focusTopicTitle \?\? "Unattributed"/);
  assert.match(component, /Loading scored attempt history/);
  assert.match(component, /No attempts match these filters/);
  assert.match(component, /\/api\/dashboard\/attempts\//);
  assert.match(component, /onToggle=.*loadDetail/s);
  assert.match(page, /dashboard-history-disclosure/);
  assert.match(page, /<UserAttemptHistory userId=\{user\.userId\} divisionId=\{divisionId\}/);
});

test("user detail uses current Focus Topic access when assignment authority is active", () => {
  assert.match(page, /learningAccessMode === "focus_topic_assignments"/);
  assert.match(page, /Current learning access reflects active Focus Topic assignments/);
  assert.match(page, /Historical Training Pack links do not determine this access/);
  assert.match(page, /No current Focus Topic access/);
});
