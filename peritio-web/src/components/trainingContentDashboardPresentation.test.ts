import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(componentsDir, "..", "..");
const editorSource = readFileSync(join(componentsDir, "TrainingContentEditor.tsx"), "utf8");
const createSource = readFileSync(join(componentsDir, "TrainingContentCreateForm.tsx"), "utf8");
const categoriesSource = readFileSync(
  join(componentsDir, "TrainingContentCategoryManager.tsx"),
  "utf8"
);
const reorderSource = readFileSync(join(componentsDir, "TrainingContentReorder.tsx"), "utf8");
const unsavedDialogSource = readFileSync(join(componentsDir, "UnsavedChangesDialog.tsx"), "utf8");
const adminSource = readFileSync(join(componentsDir, "AdminWorkspace.tsx"), "utf8");
const markdownSource = readFileSync(join(componentsDir, "TrainingContentMarkdown.tsx"), "utf8");
const librarySource = readFileSync(
  join(webRoot, "app", "app", "admin", "training-content", "page.tsx"),
  "utf8"
);

test("Training Content navigation is conditional and uses dedicated pages", () => {
  assert.equal(adminSource.includes("{trainingContentAvailable ? ("), true);
  assert.equal(adminSource.includes("viewer.orgRole"), false);
  assert.equal(adminSource.includes("Learning Resources"), true);
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
  assert.equal(
    existsSync(join(webRoot, "app", "app", "admin", "training-content", "categories", "page.tsx")),
    true
  );
  assert.equal(
    existsSync(join(webRoot, "app", "app", "admin", "training-content", "reorder", "page.tsx")),
    true
  );
});

test("Training Content editor guards destructive actions, conflicts, and duplicate submits", () => {
  assert.equal(editorSource.includes("beforeunload"), true);
  assert.equal(editorSource.includes("window.confirm(\"Archive this Learning Resource?"), true);
  assert.equal(editorSource.includes("window.confirm(\"Unpublish this Learning Resource"), true);
  assert.equal(editorSource.includes("window.confirm(\"Replace the current file"), true);
  assert.equal(editorSource.includes("Reload current version"), true);
  assert.equal(editorSource.includes("disabled={saving || uploading}"), true);
  assert.equal(editorSource.includes("await saveChanges();\n      let initiated"), true);
  assert.equal(editorSource.includes("caught instanceof TrainingContentDirectUploadError"), true);
});

test("Training Content forms separate categories from optional Focus Topics and hide raw order", () => {
  for (const source of [createSource, editorSource]) {
    assert.equal(source.includes("Content Category"), true);
    assert.equal(source.includes("Related Focus Topic"), true);
    assert.equal(source.includes("Display order"), false);
    assert.equal(source.includes("beforeunload"), true);
    assert.equal(source.includes("<UnsavedChangesDialog"), true);
    assert.equal(source.includes("Back to Learning Resources"), true);
    assert.equal(source.includes("training-content-sticky-actions"), true);
  }
  assert.equal(createSource.includes("required"), true);
  assert.equal(createSource.includes("Cancel"), true);
  assert.equal(editorSource.includes("Close"), true);
  assert.equal(unsavedDialogSource.includes("Discard unsaved changes?"), true);
  assert.equal(unsavedDialogSource.includes("Keep editing"), true);
});

test("Training Content library groups the default view and exposes category-aware filters", () => {
  assert.equal(librarySource.includes("sort === \"library_order\""), true);
  assert.equal(librarySource.includes("training-content-category-groups"), true);
  assert.equal(librarySource.includes("Content Category"), true);
  assert.equal(librarySource.includes("Related Focus Topic"), true);
  assert.equal(librarySource.includes("Manage Categories"), true);
  assert.equal(librarySource.includes("Reorder Content"), true);
  assert.equal(librarySource.includes("Add Learning Resource"), true);
  assert.equal(librarySource.includes("showCategory"), true);
});

test("video processing status persists in the editor and is visible in the library", () => {
  assert.equal(editorSource.includes("TRAINING_CONTENT_VIDEO_STATUS_POLL_MS"), true);
  assert.equal(editorSource.includes("/assets/${encodeURIComponent(latestVideoUploadAsset.id)}"), true);
  assert.equal(editorSource.includes("Video processing complete. File is ready."), true);
  assert.equal(editorSource.includes("Video processing failed."), true);
  assert.equal(editorSource.includes("Current published file"), true);
  assert.equal(editorSource.includes("disabled={uploading || videoUploadBlocked}"), true);
  assert.equal(librarySource.includes("item.hasActiveVideoProcessing"), true);
  assert.equal(librarySource.includes("status-processing"), true);
  assert.equal(librarySource.includes(">Processing</span>"), true);
});

test("category and content ordering use accessible controls and optimistic revisions", () => {
  assert.equal(categoriesSource.includes("Move ${category.name} up"), true);
  assert.equal(categoriesSource.includes("Move ${category.name} down"), true);
  assert.equal(categoriesSource.includes("expectedOrderRevision"), true);
  assert.equal(categoriesSource.includes("destinationCategoryId"), true);
  assert.equal(categoriesSource.includes("The default Content Category cannot be archived"), true);
  assert.equal(reorderSource.includes("Move ${item.title} up"), true);
  assert.equal(reorderSource.includes("Move ${item.title} down"), true);
  assert.equal(reorderSource.includes("Move to category"), true);
  assert.equal(reorderSource.includes("expectedOrderRevision"), true);
  assert.equal(reorderSource.includes("beforeunload"), true);
});

test("assignment pickers use chips and checkboxes without duplicate selected rows", () => {
  assert.equal(editorSource.includes("Selected users ("), true);
  assert.equal(editorSource.includes("assignment-chip"), true);
  assert.equal(editorSource.includes("type=\"checkbox\""), true);
  assert.equal(editorSource.includes("aria-label={`Assign ${target.displayName}`}"), true);
  assert.equal(editorSource.includes("selected-target"), false);
  assert.equal(editorSource.includes("Assign to manager"), true);
  assert.equal(editorSource.includes("Assign to manager&apos;s team"), true);
  assert.equal(editorSource.includes("Manager + Team"), true);
  assert.equal(editorSource.includes("Targeted assignments remain saved"), true);
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
