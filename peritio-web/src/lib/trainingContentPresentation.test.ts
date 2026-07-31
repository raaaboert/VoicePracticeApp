import assert from "node:assert/strict";
import test from "node:test";

import type {
  DashboardTrainingContentTarget,
  TrainingContentFileLimitsBytes,
} from "@voicepractice/shared";

import {
  formatFileSize,
  mergeTrainingContentTargets,
  safeTrainingContentMarkdownUrl,
  trainingContentDeclaredMimeType,
  trainingContentUploadFinalizationMessage,
  validateTrainingContentFileSelection,
} from "./trainingContentPresentation";

const limits: TrainingContentFileLimitsBytes = {
  video: 500 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  image: 20 * 1024 * 1024,
};

test("Training Content file selection follows the effective API limits and allowlist", () => {
  assert.equal(
    validateTrainingContentFileSelection({
      contentType: "pdf",
      file: { name: "guide.pdf", type: "application/pdf", size: limits.pdf },
      limits,
    }),
    null
  );
  assert.match(
    validateTrainingContentFileSelection({
      contentType: "pdf",
      file: { name: "guide.pdf", type: "application/pdf", size: limits.pdf + 1 },
      limits,
    }) ?? "",
    /50 MB limit/
  );
  assert.match(
    validateTrainingContentFileSelection({
      contentType: "image",
      file: { name: "unsafe.svg", type: "image/svg+xml", size: 100 },
      limits,
    }) ?? "",
    /JPG or JPEG or PNG or WEBP/
  );
  assert.match(
    validateTrainingContentFileSelection({
      contentType: "video",
      file: { name: "training.mp4", type: "application/pdf", size: 100 },
      limits,
    }) ?? "",
    /does not match/
  );
  assert.equal(formatFileSize(limits.docx), "25 MB");
  assert.equal(
    trainingContentDeclaredMimeType("audio", { name: "briefing.m4a", type: "" }),
    "audio/mp4"
  );
});

test("synchronously ready uploads retain the ready message", () => {
  assert.equal(
    trainingContentUploadFinalizationMessage({
      uploadState: "ready",
      replacing: false,
    }),
    "File is ready."
  );
});

test("processing video uploads report processing instead of ready", () => {
  assert.equal(
    trainingContentUploadFinalizationMessage({
      uploadState: "processing",
      replacing: false,
    }),
    "Video uploaded. Processing is in progress."
  );
});

test("processing replacement videos report processing instead of ready", () => {
  assert.equal(
    trainingContentUploadFinalizationMessage({
      uploadState: "processing",
      replacing: true,
    }),
    "Replacement video uploaded. Processing is in progress."
  );
});

test("Training Content Markdown URL policy permits only safe links", () => {
  assert.equal(safeTrainingContentMarkdownUrl("#section"), "#section");
  assert.equal(
    safeTrainingContentMarkdownUrl("https://example.com/resource"),
    "https://example.com/resource"
  );
  assert.equal(safeTrainingContentMarkdownUrl("mailto:support@example.com"), "mailto:support@example.com");
  assert.equal(safeTrainingContentMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeTrainingContentMarkdownUrl("data:text/html,bad"), "");
  assert.equal(safeTrainingContentMarkdownUrl("https://user:secret@example.com"), "");
  assert.equal(safeTrainingContentMarkdownUrl("relative/resource"), "");
});

test("assignment target merge deduplicates users and keeps deterministic display order", () => {
  const target = (
    userId: string,
    displayName: string,
    email: string
  ): DashboardTrainingContentTarget => ({
    userId,
    displayName,
    email,
    employeeId: null,
    orgRole: "user",
    status: "active",
    available: true,
  });
  const merged = mergeTrainingContentTargets(
    [target("user_2", "Zoe", "zoe@example.com")],
    [
      target("user_1", "Alex", "alex@example.com"),
      target("user_2", "Zoe Updated", "zoe@example.com"),
    ]
  );

  assert.deepEqual(merged.map((entry) => entry.userId), ["user_1", "user_2"]);
  assert.equal(merged[1]?.displayName, "Zoe Updated");
});
