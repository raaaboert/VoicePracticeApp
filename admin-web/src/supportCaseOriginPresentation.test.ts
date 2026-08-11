import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getSupportCaseSourceLabel } from "./lib/supportCasePresentation";

test("Organization Plan support origin has a dedicated admin label", () => {
  assert.equal(getSupportCaseSourceLabel("organization_plan"), "Organization Plan");
});

test("existing and unknown support cases are not mislabeled as Organization Plan", () => {
  assert.equal(getSupportCaseSourceLabel(null), null);
  assert.equal(getSupportCaseSourceLabel("scorecard"), null);
});

test("admin support list, detail, and CSV visibly expose support case source", () => {
  const pageSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "app", "support", "page.tsx"),
    "utf8",
  );

  assert.match(pageSource, /renderSortButton\("Source", "source"\)/);
  assert.match(pageSource, /Source: \{getSupportCaseSourceLabel\(selectedDetail\.source\) \?\? "-"\}/);
  assert.match(pageSource, /"Source",/);
});
