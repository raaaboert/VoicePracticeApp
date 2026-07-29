import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(componentsDir, "..", "..");
const editorSource = readFileSync(join(componentsDir, "TrainingContentEditor.tsx"), "utf8");
const adminSource = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const markdownSource = readFileSync(join(componentsDir, "TrainingContentMarkdown.tsx"), "utf8");

test("Training Content navigation is conditional and uses dedicated pages", () => {
  assert.equal(adminSource.includes("{trainingContentAvailable ? ("), true);
  assert.equal(adminSource.includes("viewer.orgRole"), false);
  assert.equal(
    existsSync(join(webRoot, "app", "app", "admin", "training-content", "page.tsx")),
    true
  );
  assert.equal(
    existsSync(join(webRoot, "app", "app", "admin", "training-content", "new", "page.tsx")),
    true
  );
  assert.equal(
    existsSync(join(webRoot, "app", "app", "admin", "training-content", "[contentId]", "page.tsx")),
    true
  );
});

test("Training Content editor guards destructive actions, conflicts, and duplicate submits", () => {
  assert.equal(editorSource.includes("beforeunload"), true);
  assert.equal(editorSource.includes("window.confirm(\"Archive this Training Content?"), true);
  assert.equal(editorSource.includes("window.confirm(\"Unpublish this Training Content"), true);
  assert.equal(editorSource.includes("window.confirm(\"Replace the current file"), true);
  assert.equal(editorSource.includes("Reload current version"), true);
  assert.equal(editorSource.includes("disabled={saving || uploading}"), true);
  assert.equal(editorSource.includes("await saveChanges();\n      let initiated"), true);
  assert.equal(editorSource.includes("caught instanceof TrainingContentDirectUploadError"), true);
});

test("Training Content preview uses safe Markdown and temporary access without embedded DOCX claims", () => {
  assert.equal(markdownSource.includes("skipHtml"), true);
  assert.equal(markdownSource.includes("safeTrainingContentMarkdownUrl"), true);
  assert.equal(editorSource.includes("/access`"), true);
  assert.equal(editorSource.includes("An in-app converted preview is not available yet."), true);
  assert.equal(editorSource.includes("Related Practice"), false);
  assert.equal(editorSource.includes("Usage"), false);
  assert.equal(editorSource.includes("Completion"), false);
});
