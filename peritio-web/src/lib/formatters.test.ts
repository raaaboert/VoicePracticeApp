import assert from "node:assert/strict";
import test from "node:test";

import { formatDate } from "./formatters";

test("formatDate preserves date-only plan values without timezone shifting", () => {
  assert.equal(formatDate("2026-07-01"), "Jul 01, 2026");
  assert.equal(formatDate("2026-02-31"), "-");
});
