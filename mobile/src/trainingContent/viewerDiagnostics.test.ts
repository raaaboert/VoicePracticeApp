import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPdfNativeError,
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

test("video diagnostics expose only safe source and measured-layout fields", () => {
  const entries: Array<Record<string, unknown>> = [];

  recordTrainingContentViewerDiagnostic(
    "video_source_load",
    {
      platform: "ios",
      sourceLoadFired: true,
      trackCount: 1,
      width: 1920,
      height: 1080,
      aspectRatio: 1920 / 1080,
      url: "https://asset.invalid/private?signature=secret",
      headers: { authorization: "secret" },
      contentId: "customer-content-id",
    } as {
      platform: string;
      sourceLoadFired: boolean;
      trackCount: number;
      width: number;
      height: number;
      aspectRatio: number;
    },
    {
      enabled: true,
      sink: (_message, payload) => entries.push(payload),
    }
  );

  assert.deepEqual(entries, [
    {
      category: "video_source_load",
      platform: "ios",
      sourceLoadFired: true,
      trackCount: 1,
      aspectRatio: 1.7778,
      width: 1920,
      height: 1080,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(entries),
    /signature|authorization|secret|customer|contentId/i
  );
});

test("PDF native errors are reduced to safe allowlisted message classes", () => {
  const entries: Array<{
    message: string;
    payload: Record<string, unknown>;
  }> = [];
  const nativeError = new Error(
    "Load pdf failed. path=file:///private/cache/customer-document.pdf?signature=secret"
  );
  const nativeErrorClass = classifyPdfNativeError(nativeError);

  assert.equal(nativeErrorClass, "document_load_failed");
  assert.equal(
    classifyPdfNativeError(new Error("Password required or incorrect password.")),
    "password_required"
  );
  assert.equal(
    classifyPdfNativeError(new Error("Malformed PDF signature.")),
    "invalid_document"
  );

  recordTrainingContentViewerDiagnostic(
    "pdf_render_failed",
    {
      nativeErrorClass,
      url: "https://asset.invalid/private?signature=secret",
      localPath: "file:///private/cache/customer-document.pdf",
      message: nativeError.message,
    } as { nativeErrorClass: typeof nativeErrorClass },
    {
      enabled: true,
      sink: (message, payload) => entries.push({ message, payload }),
    }
  );

  assert.deepEqual(entries, [
    {
      message: "[training-content-viewer]",
      payload: {
        category: "pdf_render_failed",
        nativeErrorClass: "document_load_failed",
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /signature|customer|file:\/\//i);
});
