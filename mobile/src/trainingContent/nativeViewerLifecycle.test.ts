import assert from "node:assert/strict";
import test from "node:test";

import {
  activateViewerRequestLifecycle,
  beginViewerRequest,
  buildLocalPdfSource,
  buildProgressiveVideoSource,
  cancelViewerRequests,
  createNativeViewerLoadGuard,
  createNativeViewerInstanceKey,
  createViewerRequestLifecycle,
  disposeNativeViewerLoadGuard,
  disposeViewerRequestLifecycle,
  getAssetAccessRenewalDelayMs,
  isViewerRequestCurrent,
  resetNativeViewerLoadGuard,
  settleNativeViewerLoad,
} from "./nativeViewerLifecycle";

test("private video omits empty headers and PDF rendering uses only a local file", () => {
  assert.deepEqual(buildProgressiveVideoSource("https://asset.invalid/video", {}), {
    uri: "https://asset.invalid/video",
    useCaching: false,
    contentType: "progressive",
  });
  assert.deepEqual(buildLocalPdfSource("file:///cache/peritio-pdf-test.pdf"), {
    uri: "file:///cache/peritio-pdf-test.pdf",
    cache: false,
  });
});

test("required signed-access headers are preserved without changing source security", () => {
  const headers = { "x-required-header": "signed-value" };

  assert.equal(buildProgressiveVideoSource("https://asset.invalid/video", headers).headers, headers);
});

test("disposed and superseded access requests cannot commit viewer state", () => {
  const lifecycle = createViewerRequestLifecycle();
  const first = beginViewerRequest(lifecycle);
  assert.notEqual(first, null);
  assert.equal(isViewerRequestCurrent(lifecycle, first!), true);

  cancelViewerRequests(lifecycle);
  assert.equal(isViewerRequestCurrent(lifecycle, first!), false);

  const second = beginViewerRequest(lifecycle);
  assert.notEqual(second, null);
  disposeViewerRequestLifecycle(lifecycle);
  assert.equal(isViewerRequestCurrent(lifecycle, second!), false);
  assert.equal(beginViewerRequest(lifecycle), null);

  activateViewerRequestLifecycle(lifecycle);
  const strictModeRestart = beginViewerRequest(lifecycle);
  assert.notEqual(strictModeRestart, null);
  assert.equal(isViewerRequestCurrent(lifecycle, strictModeRestart!), true);
});

test("native load success, error, timeout, and teardown accept one terminal callback", () => {
  const guard = createNativeViewerLoadGuard();

  assert.equal(settleNativeViewerLoad(guard), true);
  assert.equal(settleNativeViewerLoad(guard), false);

  resetNativeViewerLoadGuard(guard);
  assert.equal(settleNativeViewerLoad(guard), true);

  resetNativeViewerLoadGuard(guard);
  disposeNativeViewerLoadGuard(guard);
  assert.equal(settleNativeViewerLoad(guard), false);
});

test("signed access renewal is bounded and invalid expiration is ignored", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");

  assert.equal(
    getAssetAccessRenewalDelayMs("2026-07-29T12:01:00.000Z", now),
    45_000
  );
  assert.equal(
    getAssetAccessRenewalDelayMs("2026-07-29T11:59:00.000Z", now),
    1_000
  );
  assert.equal(getAssetAccessRenewalDelayMs("not-a-date", now), null);
});

test("fresh access revisions recreate viewers without including signed URLs in keys", () => {
  assert.equal(createNativeViewerInstanceKey("content-123", 1), "content-123:1");
  assert.notEqual(
    createNativeViewerInstanceKey("content-123", 1),
    createNativeViewerInstanceKey("content-123", 2)
  );
});
