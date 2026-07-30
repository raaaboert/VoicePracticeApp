import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_EXPO_VIDEO_VERSION = "3.0.16";

const ORIGINAL_TRACK_SIZE_BLOCK = `    if let cgSize = try? await assetTrack.load(.naturalSize) {
      size = VideoSize.from(cgSize)
    }`;

const PATCHED_TRACK_SIZE_BLOCK = `    if let naturalSize = try? await assetTrack.load(.naturalSize) {
      var displaySize = naturalSize
      if let preferredTransform = try? await assetTrack.load(.preferredTransform) {
        let transformedBounds = CGRect(origin: .zero, size: naturalSize)
          .applying(preferredTransform)
        let transformedSize = CGSize(
          width: abs(transformedBounds.width),
          height: abs(transformedBounds.height)
        )
        if transformedSize.width.isFinite,
          transformedSize.height.isFinite,
          transformedSize.width > 0,
          transformedSize.height > 0 {
          displaySize = transformedSize
        }
      }
      size = VideoSize.from(displaySize)
    }`;

const PATCH_MARKER =
  "let preferredTransform = try? await assetTrack.load(.preferredTransform)";
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);

function fail(message) {
  throw new Error(`[expo-video-ios-orientation-patch] ${message}`);
}

export function patchExpoVideoIosTracksSource(source) {
  if (source.includes(PATCH_MARKER)) {
    return source;
  }
  if (!source.includes(ORIGINAL_TRACK_SIZE_BLOCK)) {
    fail("Expected iOS VideoTrack naturalSize block was not found.");
  }
  return source.replace(ORIGINAL_TRACK_SIZE_BLOCK, PATCHED_TRACK_SIZE_BLOCK);
}

function applyInstalledPatch() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("expo-video/package.json", {
    paths: [resolve(scriptDirectory, "..")],
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== EXPECTED_EXPO_VIDEO_VERSION) {
    fail(
      `Expected expo-video ${EXPECTED_EXPO_VIDEO_VERSION}, found ${String(
        packageJson.version
      )}.`
    );
  }

  const tracksPath = resolve(
    dirname(packageJsonPath),
    "ios",
    "Records",
    "Tracks.swift"
  );
  const source = readFileSync(tracksPath, "utf8");
  const patchedSource = patchExpoVideoIosTracksSource(source);
  if (patchedSource !== source) {
    writeFileSync(tracksPath, patchedSource);
    console.log(
      "[expo-video-ios-orientation-patch] Applied display-orientation track sizing."
    );
    return;
  }
  console.log(
    "[expo-video-ios-orientation-patch] Display-orientation track sizing already applied."
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  applyInstalledPatch();
}
