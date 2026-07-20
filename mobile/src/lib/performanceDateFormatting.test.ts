import assert from "node:assert/strict";
import test from "node:test";

import { formatPerformanceDate, getRemainingPerformancePlanDays } from "./performanceDateFormatting";

test("formatPerformanceDate preserves date-only plan values without timezone shifting", () => {
  assert.equal(formatPerformanceDate("2026-07-01"), "Jul 1, 2026");
  assert.equal(formatPerformanceDate("2026-02-31"), "2026-02-31");
});

test("getRemainingPerformancePlanDays uses the literal local end date", () => {
  assert.equal(
    getRemainingPerformancePlanDays("2026-07-01", new Date(2026, 6, 1, 12, 0, 0, 0)),
    1
  );
});
