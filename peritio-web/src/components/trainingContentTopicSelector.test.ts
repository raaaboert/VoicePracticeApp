import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingContentTopicSelector } from "./TrainingContentTopicSelector";

const root = dirname(fileURLToPath(import.meta.url));
const options = [{ id: "a", name: "Alpha", status: "active" as const },
  { id: "b", name: "Bravo", status: "active" as const }, { id: "d", name: "Draft Topic", status: "draft" as const }];
const render = (props = {}) => renderToStaticMarkup(createElement(TrainingContentTopicSelector, {
  options, selectedIds: ["a", "b"], onChange: () => {}, ...props,
}));

test("searchable multi-select renders labeled native checkboxes and individual accessible removal controls", () => {
  const html = render();
  assert.match(html, /<legend>Related Focus Topics<\/legend>/);
  assert.match(html, /<label[^>]+for="[^"]+-search">Search Focus Topics/);
  assert.match(html, /type="search"/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2);
  assert.match(html, /aria-label="Remove Alpha"/);
  assert.match(html, /aria-label="Remove Bravo"/);
  assert.match(html, /type="checkbox"[^>]*disabled=""/);
  assert.match(html, /Draft.*change this Topic to Active and save/);
});

test("existing unavailable attachments remain visible and cannot be removed accidentally", () => {
  const html = render({ options: [], selectedIds: ["old"], existing: [
    { id: "old", name: "Retained Topic", status: "archived", available: false },
  ] });
  assert.match(html, /Retained Topic \(Unavailable; retained\)/);
  assert.match(html, /disabled=""[^>]*aria-label="Remove Retained Topic"/);
});

test("picker provides empty, loading and retryable error states", () => {
  assert.match(render({ options: [], selectedIds: [] }), /No Focus Topics are available/);
  assert.match(render({ loading: true }), /role="status">Loading Focus Topics/);
  const html = render({ error: "Could not load Topics", onRetry: () => {} });
  assert.match(html, /role="alert">Could not load Topics/);
  assert.match(html, /Retry loading Topics/);
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/); // Error must not disable its own Retry control.
});

test("full editor retains scoped permissions and returns to the authorized originating Topic", () => {
  const editor = readFileSync(join(root, "TrainingContentEditor.tsx"), "utf8");
  const workspace = readFileSync(join(root, "FocusTopicAdministration.tsx"), "utf8");
  assert.match(editor, /Back to Focus Topic/);
  assert.match(editor, /expectedFocusTopicIds = selectedContentTopicIds\(item\)/);
  assert.match(editor, /disabled=\{archived \|\| saving \|\| topicScoped\}/);
  assert.match(editor, /className="training-content-scoped-fields" disabled=\{topicScoped\}/);
  assert.match(workspace, /initialTopicId/);
  assert.match(workspace, /initialTopics.find\(\(entry\) => entry.id === initialTopicId\)/);
  assert.doesNotMatch(workspace, /const beginEditingContent|const saveContent/);
});

test("multi-select is contained and theme-aware without changing global checkbox appearance", () => {
  const css = readFileSync(join(root, "../../app/globals.css"), "utf8");
  assert.match(css, /\.training-content-topic-selector,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?min-width: 0/);
  assert.match(css, /\.training-content-topic-option\.is-selected \{[^}]*var\(--accent-soft\)/);
  assert.match(css, /\.training-content-topic-option:focus-within \{[^}]*outline: 2px solid var\(--accent\)/);
});
