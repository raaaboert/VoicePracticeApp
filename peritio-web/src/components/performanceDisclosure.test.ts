import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PerformanceCardDisclosure } from "./PerformanceCardDisclosure";

const root = dirname(fileURLToPath(import.meta.url));

test("performance card disclosure keeps its heading, summary, and mounted controlled body accessible", () => {
  const markup = renderToStaticMarkup(createElement(PerformanceCardDisclosure, {
    eyebrow: "Scores",
    title: "Performance dimensions",
    headingId: "dimensions-title",
    contentId: "dimensions-content",
    description: "Generation-specific scores.",
    summary: createElement("span", null, "generation a: Overall 84 / 100"),
    children: createElement("div", null, "Full score details"),
  }));
  assert.equal(markup.includes('aria-labelledby="dimensions-title"'), true);
  assert.equal(markup.includes('aria-expanded="true"'), true);
  assert.equal(markup.includes('aria-controls="dimensions-content"'), true);
  assert.equal(markup.includes('aria-label="Collapse Performance dimensions"'), true);
  assert.equal(markup.includes('id="dimensions-content"'), true);
  assert.equal(markup.includes("generation a: Overall 84 / 100"), true);
  assert.equal(markup.includes("Full score details"), true);

  const source = readFileSync(join(root, "PerformanceCardDisclosure.tsx"), "utf8");
  const css = readFileSync(join(root, "../../app/globals.css"), "utf8");
  assert.equal(source.includes("hidden={!open}"), true);
  assert.match(css, /\.performance-disclosure-body\[hidden\]\s*{\s*display:\s*none;/s);
});

test("performance summaries retain separate generation labels", () => {
  const source = readFileSync(join(root, "OrganizationPerformanceOverview.tsx"), "utf8");
  assert.equal(source.includes("data.completionGroups.map((group)"), true);
  assert.equal(source.includes("metricGenerations.map((generation)"), true);
  assert.equal(source.includes("readableGeneration(group.scoringGeneration)"), true);
  assert.equal(source.includes("readableGeneration(generation.scoringGeneration)"), true);
  assert.equal(source.includes('contentId="completion-content"'), true);
  assert.equal(source.includes('contentId="dimensions-content"'), true);
});
