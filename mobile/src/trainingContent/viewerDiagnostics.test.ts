import assert from "node:assert/strict";
import test from "node:test";

import {
  recordTrainingContentViewerDiagnostic,
  shouldRecordTrainingContentViewerDiagnostics,
} from "./viewerDiagnostics";

test("viewer diagnostics are limited to development and the staging API target", () => {
  assert.equal(
    shouldRecordTrainingContentViewerDiagnostics(false, undefined),
    false
  );
  assert.equal(
    shouldRecordTrainingContentViewerDiagnostics(
      false,
      "https://peritio-api-prod.onrender.com"
    ),
    false
  );
  assert.equal(
    shouldRecordTrainingContentViewerDiagnostics(
      false,
      "https://voicepractice-api-dev.onrender.com/"
    ),
    true
  );
  assert.equal(
    shouldRecordTrainingContentViewerDiagnostics(true, undefined),
    true
  );
});

test("viewer diagnostics emit only allowlisted categories and numeric dimensions", () => {
  const entries: Array<{
    message: string;
    payload: Record<string, unknown>;
  }> = [];

  recordTrainingContentViewerDiagnostic(
    "video_track_dimensions",
    {
      width: 1920,
      height: 1080,
      url: "https://asset.invalid/private?signature=secret",
      localPath: "file:///private/cache/document.pdf",
    } as { width: number; height: number },
    {
      enabled: true,
      sink: (message, payload) => entries.push({ message, payload }),
    }
  );

  assert.deepEqual(entries, [
    {
      message: "[training-content-viewer]",
      payload: {
        category: "video_track_dimensions",
        width: 1920,
        height: 1080,
      },
    },
  ]);
});
