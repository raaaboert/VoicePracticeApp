import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_REACT_NATIVE_PDF_VERSION,
  patchReactNativePdfAndroidSource,
} from "./apply-react-native-pdf-android-gesture-patch.mjs";

const originalSource = `package org.wonday.pdf;

import android.view.MotionEvent;
import android.view.ViewGroup;

public class PdfView {
    private boolean scrollEnabled = true;

    @Override
    public void onPageChanged(int page, int numberOfPages) {
    }

    @Override
    public void onError(Throwable t){
    }
}
`;

test("Android PDF touch down synchronously prevents parent interception", () => {
  const patched = patchReactNativePdfAndroidSource(originalSource);

  assert.match(patched, /action == MotionEvent\.ACTION_DOWN/);
  assert.match(
    patched,
    /parent\.requestDisallowInterceptTouchEvent\(true\)/
  );
  assert.ok(
    patched.indexOf("disallowParentIntercept();") <
      patched.indexOf("super.dispatchTouchEvent(event)")
  );
});

test("Android PDF touch end and cancel restore parent interception", () => {
  const patched = patchReactNativePdfAndroidSource(originalSource);

  assert.match(patched, /action == MotionEvent\.ACTION_UP/);
  assert.match(patched, /action == MotionEvent\.ACTION_CANCEL/);
  assert.match(
    patched,
    /parent\.requestDisallowInterceptTouchEvent\(false\)/
  );
});

test("Android PDF unmount, error, and unhandled touch down cannot retain ownership", () => {
  const patched = patchReactNativePdfAndroidSource(originalSource);

  assert.match(
    patched,
    /protected void onDetachedFromWindow\(\) \{\s*allowParentIntercept\(\);/
  );
  assert.match(
    patched,
    /public void onError\(Throwable t\)\{\s*allowParentIntercept\(\);/
  );
  assert.match(
    patched,
    /action == MotionEvent\.ACTION_DOWN && !handled/
  );
});

test("Android PDF gesture patch is idempotent and fails closed on source drift", () => {
  const patched = patchReactNativePdfAndroidSource(originalSource);

  assert.equal(patchReactNativePdfAndroidSource(patched), patched);
  assert.throws(
    () => patchReactNativePdfAndroidSource("unexpected upstream source"),
    /ViewGroup import was not found/
  );
});

test("installed patch targets only Android react-native-pdf 6.7.7", () => {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("react-native-pdf/package.json", {
    paths: [resolve(scriptDirectory, "..")],
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const packageDirectory = dirname(packageJsonPath);
  const installedAndroidSource = readFileSync(
    resolve(
      packageDirectory,
      "android",
      "src",
      "main",
      "java",
      "org",
      "wonday",
      "pdf",
      "PdfView.java"
    ),
    "utf8"
  );
  const installedIosSource = readFileSync(
    resolve(packageDirectory, "ios", "RNPDFPdf", "RNPDFPdfView.mm"),
    "utf8"
  );
  const scriptSource = readFileSync(
    resolve(
      scriptDirectory,
      "apply-react-native-pdf-android-gesture-patch.mjs"
    ),
    "utf8"
  );

  assert.equal(packageJson.version, EXPECTED_REACT_NATIVE_PDF_VERSION);
  assert.match(
    installedAndroidSource,
    /parent\.requestDisallowInterceptTouchEvent\(true\)/
  );
  assert.match(
    installedAndroidSource,
    /parent\.requestDisallowInterceptTouchEvent\(false\)/
  );
  assert.doesNotMatch(
    installedIosSource,
    /requestDisallowInterceptTouchEvent|gestureParent/
  );
  assert.match(
    scriptSource,
    /"android",\s*"src",\s*"main",\s*"java"/
  );
  assert.doesNotMatch(scriptSource, /ios[/\\]|Tracks\.swift|componentProvider/);
});

test("clean installs and EAS installs both apply the Android PDF gesture patch", () => {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const mobilePackage = JSON.parse(
    readFileSync(resolve(scriptDirectory, "..", "package.json"), "utf8")
  );
  const patchCommand = "apply-react-native-pdf-android-gesture-patch.mjs";

  assert.match(mobilePackage.scripts.postinstall, new RegExp(patchCommand));
  assert.match(
    mobilePackage.scripts["eas-build-post-install"],
    new RegExp(patchCommand)
  );
});
