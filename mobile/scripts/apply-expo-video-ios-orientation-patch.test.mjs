import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_EXPO_VIDEO_VERSION,
  patchExpoVideoIosTracksSource,
} from "./apply-expo-video-ios-orientation-patch.mjs";

const originalBlock = `    if let cgSize = try? await assetTrack.load(.naturalSize) {
      size = VideoSize.from(cgSize)
    }`;

test("Expo Video iOS patch derives displayed dimensions from preferredTransform", () => {
  const patched = patchExpoVideoIosTracksSource(originalBlock);

  assert.match(patched, /assetTrack\.load\(\.naturalSize\)/);
  assert.match(patched, /assetTrack\.load\(\.preferredTransform\)/);
  assert.match(patched, /CGRect\(origin: \.zero, size: naturalSize\)/);
  assert.match(patched, /\.applying\(preferredTransform\)/);
  assert.match(patched, /width: abs\(transformedBounds\.width\)/);
  assert.match(patched, /height: abs\(transformedBounds\.height\)/);
  assert.equal(patchExpoVideoIosTracksSource(patched), patched);
});

test("Expo Video iOS patch fails closed when the pinned source shape changes", () => {
  assert.throws(
    () => patchExpoVideoIosTracksSource("unexpected upstream source"),
    /naturalSize block was not found/
  );
});

test("installed Expo Video iOS metadata contains the pinned orientation patch", () => {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("expo-video/package.json", {
    paths: [resolve(scriptDirectory, "..")],
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const tracksSource = readFileSync(
    resolve(dirname(packageJsonPath), "ios", "Records", "Tracks.swift"),
    "utf8"
  );

  assert.equal(packageJson.version, EXPECTED_EXPO_VIDEO_VERSION);
  assert.match(tracksSource, /assetTrack\.load\(\.preferredTransform\)/);
  assert.match(tracksSource, /\.applying\(preferredTransform\)/);
});

test("clean installs and EAS installs both apply the Expo Video iOS patch", () => {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const mobilePackage = JSON.parse(
    readFileSync(resolve(scriptDirectory, "..", "package.json"), "utf8")
  );
  const patchCommand = "apply-expo-video-ios-orientation-patch.mjs";

  assert.match(mobilePackage.scripts.postinstall, new RegExp(patchCommand));
  assert.match(
    mobilePackage.scripts["eas-build-post-install"],
    new RegExp(patchCommand)
  );
});
