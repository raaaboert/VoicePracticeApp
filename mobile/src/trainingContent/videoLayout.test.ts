import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getValidatedVideoAspectRatio,
  resolveVideoAspectRatio,
  VIDEO_ASPECT_RATIO_FALLBACK,
} from "./videoLayout";

test("video layout uses 16:9 before metadata is available", () => {
  assert.equal(resolveVideoAspectRatio(null), VIDEO_ASPECT_RATIO_FALLBACK);
});

test("video layout accepts landscape metadata", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1920, height: 1080 }), 16 / 9);
});

test("video layout accepts portrait metadata without blindly inverting it", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1080, height: 1920 }), 9 / 16);
});

test("video layout accepts nonstandard aspect ratios", () => {
  assert.equal(resolveVideoAspectRatio({ width: 1600, height: 1200 }), 4 / 3);
});

test("video layout rejects invalid dimensions and retains the fallback", () => {
  for (const dimensions of [
    { width: 0, height: 1080 },
    { width: 1920, height: 0 },
    { width: -1920, height: 1080 },
    { width: Number.NaN, height: 1080 },
    { width: Number.POSITIVE_INFINITY, height: 1080 },
  ]) {
    assert.equal(getValidatedVideoAspectRatio(dimensions), null);
    assert.equal(
      resolveVideoAspectRatio(dimensions),
      VIDEO_ASPECT_RATIO_FALLBACK
    );
  }
});

test("installed Expo Video 56.1.4 uses its stock iOS naturalSize metadata", () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("expo-video/package.json", {
    paths: [resolve(sourceDirectory, "..", "..")],
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const tracksSource = readFileSync(
    resolve(dirname(packageJsonPath), "ios", "Records", "Tracks.swift"),
    "utf8"
  );
  const mobilePackage = JSON.parse(
    readFileSync(resolve(sourceDirectory, "..", "..", "package.json"), "utf8")
  );

  assert.equal(packageJson.version, "56.1.4");
  assert.match(
    tracksSource,
    /if let cgSize = try\? await assetTrack\.load\(\.naturalSize\),\s*cgSize\.width\.isFinite,\s*cgSize\.height\.isFinite \{\s*size = VideoSize\.from\(cgSize\)\s*\}/
  );
  assert.doesNotMatch(
    tracksSource,
    /preferredTransform|transformedBounds|displaySize/
  );
  assert.doesNotMatch(
    `${mobilePackage.scripts.postinstall} ${mobilePackage.scripts["eas-build-post-install"]}`,
    /expo-video.*patch/
  );
});
