import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CurrentTrainingProgressDisclosure } from "./CurrentTrainingProgressDisclosure";

test("current training progress starts collapsed with its count, accessible toggle and mounted content", () => {
  const markup = renderToStaticMarkup(createElement(CurrentTrainingProgressDisclosure, {
    summary: "3 currently accessible Focus Topics",
    children: createElement("table", null, createElement("tbody", null,
      createElement("tr", null, createElement("td", null, "Existing scoped Topic data")))),
  }));
  assert.match(markup, /<h3[^>]*>Current training progress<\/h3>/);
  assert.match(markup, /3 currently accessible Focus Topics/);
  assert.match(markup, /<button type="button"[^>]*aria-expanded="false"/);
  assert.match(markup, /aria-label="Expand Current training progress"/);
  const controls = markup.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(controls);
  assert.ok(markup.includes(`id="${controls}" class="performance-disclosure-body" hidden=""`));
  assert.match(markup, /Existing scoped Topic data/);
  assert.match(markup, /lucide-chevron-down/);
  const source = readFileSync(new URL("./CurrentTrainingProgressDisclosure.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => setOpen\(\(current\) => !current\)\}/);
  assert.match(css, /\.performance-disclosure-body\[hidden\]\s*\{\s*display: none;/);
  assert.match(css, /\.ghost-button:focus-visible/);
});

test("user detail retains independent scored history and uses the existing scoped learning data", () => {
  const page = readFileSync(new URL("../../app/app/users/[userId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const currentFocusTopicCount = \(payload\.currentFocusTopics \?\? \[\]\)\.length/);
  assert.match(page, /\$\{currentFocusTopicCount\} currently accessible Focus/);
  assert.match(page, /<CurrentTrainingProgressDisclosure key=\{user\.userId\} summary=\{trainingProgressSummary\}>/);
  assert.match(page, /payload\.currentFocusTopics\?\.map/);
  assert.match(page, /assignments\.map/);
  assert.match(page, /<details className="dashboard-history-disclosure" open>/);
  assert.match(page, /<UserAttemptHistory userId=\{user\.userId\} divisionId=\{divisionId\}/);
  const zero = renderToStaticMarkup(createElement(CurrentTrainingProgressDisclosure, {
    summary: "0 currently accessible Focus Topics", children: "No current Focus Topic access",
  }));
  assert.match(zero, /0 currently accessible Focus Topics/);
  assert.match(zero, /No current Focus Topic access/);
});
