import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildVideoDiagnosticRows,
  createInitialVideoDiagnosticSnapshot,
} from "./videoDiagnosticPanel";
import { VIDEO_ASPECT_RATIO_FALLBACK } from "./videoLayout";

test("video diagnostic panel starts with safe fallback and pending values", () => {
  assert.deepEqual(
    buildVideoDiagnosticRows(
      "ios",
      VIDEO_ASPECT_RATIO_FALLBACK,
      createInitialVideoDiagnosticSnapshot(VIDEO_ASPECT_RATIO_FALLBACK)
    ),
    [
      { label: "Platform", value: "ios" },
      { label: "SourceLoad fired", value: "No" },
      { label: "Track count", value: "0" },
      { label: "Reported video width", value: "Pending" },
      { label: "Reported video height", value: "Pending" },
      { label: "Calculated aspect ratio", value: "1.7778" },
      { label: "Active aspect ratio", value: "1.7778" },
      { label: "Wrapper width", value: "Pending" },
      { label: "Wrapper height", value: "Pending" },
      { label: "Wrapper pageY (screen)", value: "Pending" },
      { label: "VideoView width", value: "Pending" },
      { label: "VideoView height", value: "Pending" },
      { label: "Diagnostic panel pageY (screen)", value: "Pending" },
      { label: "SourceLoad before first frame", value: "Pending" },
    ]
  );
});

test("video diagnostic panel formats only allowlisted runtime measurements", () => {
  const rows = buildVideoDiagnosticRows(
    "ios",
    9 / 16,
    {
      sourceLoadFired: true,
      trackCount: 1,
      reportedWidth: 1080,
      reportedHeight: 1920,
      calculatedAspectRatio: 9 / 16,
      wrapperWidth: 347.2,
      wrapperHeight: 617.2,
      wrapperPageY: 214.7,
      videoViewWidth: 347.2,
      videoViewHeight: 617.2,
      diagnosticPanelPageY: 841.6,
      sourceLoadBeforeFirstFrame: true,
      url: "https://asset.invalid/video?signature=secret",
      headers: { authorization: "secret" },
      contentId: "customer-content-id",
      filename: "private-video.mp4",
      localPath: "file:///private/video.mp4",
    } as Parameters<typeof buildVideoDiagnosticRows>[2]
  );

  assert.deepEqual(rows, [
    { label: "Platform", value: "ios" },
    { label: "SourceLoad fired", value: "Yes" },
    { label: "Track count", value: "1" },
    { label: "Reported video width", value: "1080" },
    { label: "Reported video height", value: "1920" },
    { label: "Calculated aspect ratio", value: "0.5625" },
    { label: "Active aspect ratio", value: "0.5625" },
    { label: "Wrapper width", value: "347" },
    { label: "Wrapper height", value: "617" },
    { label: "Wrapper pageY (screen)", value: "215" },
    { label: "VideoView width", value: "347" },
    { label: "VideoView height", value: "617" },
    { label: "Diagnostic panel pageY (screen)", value: "842" },
    { label: "SourceLoad before first frame", value: "Yes" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(rows),
    /signature|authorization|secret|customer|contentId|filename|localPath|file:/i
  );
});

test("video diagnostic panel is gated by the existing staging/development check", () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const viewerSource = readFileSync(
    resolve(sourceDirectory, "viewers", "VideoContentViewer.tsx"),
    "utf8"
  );

  assert.match(
    viewerSource,
    /shouldRecordTrainingContentViewerDiagnostics\([\s\S]*?__DEV__[\s\S]*?EXPO_PUBLIC_API_BASE_URL/
  );
  assert.match(
    viewerSource,
    /\{diagnosticsEnabled \? \(\s*<VideoDiagnosticPanel/
  );
});
