import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, "EnterpriseFocusTopicAuthorityCard.tsx"), "utf8");

test("Master Focus Topic utility keeps learner authority and management grants separate", () => {
  assert.match(source, /Learner authority/);
  assert.match(source, /Management grants/);
  assert.match(source, /!row\.grantsManagement/);
  assert.match(source, /row\.grantsManagement/);
  assert.match(source, /management-grants\/\$\{encodeURIComponent\(row\.id\)\}/);
  assert.match(source, /assignments\/\$\{encodeURIComponent\(row\.id\)\}/);
});
