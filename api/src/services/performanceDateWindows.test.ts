import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBaselineWindow,
  buildPlanWeekWindows,
  buildPlanWindow,
  isValidIanaTimeZone,
  localDateMidnightToUtc
} from "./performanceDateWindows.js";

test("performance date windows use local date midnight with inclusive start and exclusive end", () => {
  assert.equal(localDateMidnightToUtc("2026-07-20", "America/Denver").toISOString(), "2026-07-20T06:00:00.000Z");

  const window = buildPlanWindow({
    startDate: "2026-07-20",
    endDate: "2026-07-20",
    timeZone: "America/Denver",
    effectiveAt: "2026-07-20T16:00:00.000Z"
  });

  assert.equal(window.startAt, "2026-07-20T16:00:00.000Z");
  assert.equal(window.endAt, "2026-07-21T06:00:00.000Z");
  assert.equal(window.planStartAt, "2026-07-20T06:00:00.000Z");
});

test("performance baseline windows end at effectiveAt and use fixed month options", () => {
  const window = buildBaselineWindow({
    effectiveAt: "2026-07-20T16:00:00.000Z",
    timeZone: "America/Denver",
    comparisonMonthCount: 3
  });

  assert.equal(window.endAt, "2026-07-20T16:00:00.000Z");
  assert.equal(window.startAt, "2026-04-20T16:00:00.000Z");
});

test("performance plan weeks are seven-day intervals anchored to the plan start date", () => {
  const weeks = buildPlanWeekWindows({
    startDate: "2026-07-01",
    endDate: "2026-07-10",
    timeZone: "America/Denver",
    effectiveAt: "2026-07-01T06:00:00.000Z",
    capAt: "2026-07-11T06:00:00.000Z"
  });

  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].proratedFraction, 1);
  assert.equal(Math.round(weeks[1].proratedFraction * 1000) / 1000, 0.429);
});

test("performance date windows reject invalid timezones", () => {
  assert.equal(isValidIanaTimeZone("America/Denver"), true);
  assert.equal(isValidIanaTimeZone("Not/AZone"), false);
  assert.throws(
    () =>
      buildPlanWindow({
        startDate: "2026-07-20",
        endDate: "2026-07-20",
        timeZone: "Not/AZone",
        effectiveAt: "2026-07-20T16:00:00.000Z"
      }),
    /valid IANA timezone/
  );
});
