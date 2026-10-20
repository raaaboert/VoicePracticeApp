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
  // The shared row renderer still selects the two distinct server-authorized routes.
  // Executed request assertions live in topicAuthorityBehavior.test.ts.
  assert.match(source, /row\.grantsManagement \? "management-grants" : "assignments"/);
});

test("workspace presentation keeps hidden bodies mounted and uses shared light/dark tokens with narrow-window rules", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\[role="tabpanel"\]\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.topic-draft-dialog \{[^}]*var\(--vp-text\)[^}]*var\(--vp-surface-strong\)/);
  assert.match(css, /summary:focus-visible[^}]*var\(--vp-focus\)/);
  assert.match(css, /@media \(max-width: 740px\)[\s\S]*\.topic-metadata-fields \.enterprise-detail-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(source, /hidden=\{view !== "access"\}/);
  assert.match(source, /hidden=\{view !== "content"\}/);
  assert.match(source, /hidden=\{view !== "history"\}/);
});
