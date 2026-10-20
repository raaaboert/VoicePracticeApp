import assert from "node:assert/strict";
import test from "node:test";
import { createDayKeyFormatter, getDayKey, getMonthKey } from "@voicepractice/shared";
import { budgetTimezones, budgetCutoffs, explicitBudgetTimezones, legacyDayKeyFormatter } from "./aiUsageBudgetTimezoneFixtures.js";

test("reusable shared formatter preserves legacy Node semantics for every runtime zone and explicit offset/alias", () => {
  for (const zone of explicitBudgetTimezones) assert.ok(budgetTimezones.includes(zone), `${zone} must be exercised`);
  for (const zone of budgetTimezones) {
    const actual = createDayKeyFormatter(zone), legacy = legacyDayKeyFormatter(zone);
    for (const iso of budgetCutoffs) {
      const date = new Date(iso), expected = legacy(date);
      assert.equal(actual(date), expected, `${zone} ${iso}`);
      assert.equal(getDayKey(date,zone), expected);
      assert.equal(getMonthKey(date,zone), expected.slice(0,7));
    }
  }
});

test("reusable formatter retains Node rejection of invalid timezone and invalid dates", () => {
  assert.throws(() => createDayKeyFormatter("Not/A_Timezone"), RangeError);
  assert.throws(() => createDayKeyFormatter("UTC")(new Date(NaN)), RangeError);
});
