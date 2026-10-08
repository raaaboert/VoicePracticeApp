import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(componentsDir, "../../app/globals.css"), "utf8");
const rootTokens = css.slice(css.indexOf(":root {"), css.indexOf('html[data-theme="light"]'));
const lightTokens = css.slice(
  css.indexOf('html[data-theme="light"]'),
  css.indexOf("* {", css.indexOf('html[data-theme="light"]'))
);

test("light theme keeps distinct higher-contrast surface, text, border, and status tokens", () => {
  assert.equal(rootTokens.includes("--canvas: #101711"), true);
  assert.equal(rootTokens.includes("--surface: #18231c"), true);
  assert.equal(rootTokens.includes("--surface-raised: #202c23"), true);
  assert.equal(rootTokens.includes("--text-primary: #f6f0df"), true);
  assert.equal(lightTokens.includes("--canvas: #f5f1e8"), true);
  assert.equal(lightTokens.includes("--surface: #fbf8f0"), true);
  assert.equal(lightTokens.includes("--surface-raised: #fffdf8"), true);
  assert.equal(lightTokens.includes("--surface-muted: #e7ece2"), true);
  assert.equal(lightTokens.includes("--text-primary: #1f2921"), true);
  assert.equal(lightTokens.includes("--text-muted: #596761"), true);
  assert.equal(lightTokens.includes("--border: rgba(55, 74, 58, 0.3)"), true);
  assert.equal(lightTokens.includes("--border-strong: rgba(55, 74, 58, 0.5)"), true);
  assert.equal(lightTokens.includes("--success: #247044"), true);
  assert.equal(lightTokens.includes("--success-border: rgba(36, 112, 68, 0.42)"), true);
  assert.equal(lightTokens.includes("--danger: #a9363e"), true);
  assert.equal(lightTokens.includes("--danger-border: rgba(169, 54, 62, 0.42)"), true);
});

test("shared Dashboard controls consume theme tokens for normal, placeholder, disabled, and focus states", () => {
  assert.equal(css.includes("color: var(--text-placeholder)"), true);
  assert.equal(css.includes("color: var(--text-disabled)"), true);
  assert.equal(css.includes("background: var(--panel-strong)"), true);
  assert.equal(css.includes("border: 1px solid var(--border-strong)"), true);
  assert.equal(css.includes("outline: 2px solid var(--accent)"), true);
  assert.equal(css.includes("box-shadow: 0 0 0 3px var(--accent-soft)"), true);
  assert.equal(css.includes("background: var(--sidebar-bg)"), true);
  assert.equal(css.includes("border-color: var(--success-border)"), true);
  assert.equal(css.includes("border-color: var(--danger-border)"), true);
});

test("role and manager controls reserve readable width without changing global table overflow", () => {
  assert.equal(css.includes(".admin-role-select"), true);
  assert.equal(css.includes("min-width: 8rem"), true);
  assert.equal(css.includes(".manager-combobox-input"), true);
  assert.equal(css.includes("min-width: 15rem"), true);
  assert.equal(css.includes(".table-wrap"), true);
  assert.equal(css.includes("overflow-x: auto"), true);
});
