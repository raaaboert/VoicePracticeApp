import assert from "node:assert/strict";
import test from "node:test";

import {
  createTemporaryPdfUri,
  deleteManagedTemporaryPdf,
  type PdfTemporaryFileSystem,
  PdfTemporaryFileError,
  refreshTemporaryPdf,
  startTemporaryPdfDownload,
} from "./pdfTemporaryFile";

function createFileSystem(params: {
  downloadResult?: { status: number; uri: string } | undefined;
  fileInfo?: { exists: boolean; size?: number };
  downloadPromise?: Promise<{ status: number; uri: string } | undefined>;
  onCancel?: () => void;
  events?: string[];
} = {}): PdfTemporaryFileSystem & {
  destinations: string[];
  requestOptions: Array<{ headers?: Record<string, string> }>;
} {
  const destinations: string[] = [];
  const requestOptions: Array<{ headers?: Record<string, string> }> = [];
  return {
    cacheDirectory: "file:///app-cache/",
    destinations,
    requestOptions,
    createDownloadResumable: (_url, destination, options) => {
      destinations.push(destination);
      requestOptions.push(options);
      return {
        downloadAsync: () =>
          params.downloadPromise ??
          Promise.resolve(
            params.downloadResult ?? { status: 200, uri: destination }
          ),
        cancelAsync: async () => {
          params.events?.push("cancel");
          params.onCancel?.();
        },
      };
    },
    getInfoAsync: async () =>
      params.fileInfo ?? { exists: true, size: 5_500_000 },
    deleteAsync: async (uri) => {
      params.events?.push(`delete:${uri}`);
    },
  };
}

test("temporary PDF names are generated in cache without signed or user path data", () => {
  const uri = createTemporaryPdfUri(
    "file:///app-cache/",
    1_722_252_800_000,
    0.25
  );

  assert.match(
    uri,
    /^file:\/\/\/app-cache\/peritio-pdf-[a-z0-9]+-[a-z0-9]+\.pdf$/
  );
  assert.doesNotMatch(uri, /X-Amz|signature|customer|document-name/i);
});

test("PDF download streams to cache, preserves required headers, and verifies nonzero size", async () => {
  const fileSystem = createFileSystem();
  const headers = { "x-required-header": "signed-value" };
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private?signature=secret",
    headers,
    nowMs: 10,
    randomValue: 0.5,
  });

  assert.equal(await session.result, session.destinationUri);
  assert.deepEqual(fileSystem.requestOptions, [{ headers }]);
  assert.doesNotMatch(session.destinationUri, /signature|secret/);
});

test("empty required headers are omitted from the filesystem request options", async () => {
  const fileSystem = createFileSystem();
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 11,
    randomValue: 0.5,
  });

  await session.result;
  assert.deepEqual(fileSystem.requestOptions, [{}]);
});

test("missing and zero-byte local PDF results fail safely and delete the cache target", async () => {
  const events: string[] = [];
  const fileSystem = createFileSystem({
    fileInfo: { exists: true, size: 0 },
    events,
  });
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 12,
    randomValue: 0.5,
  });

  await assert.rejects(
    session.result,
    (caught) =>
      caught instanceof PdfTemporaryFileError &&
      caught.diagnosticCategory === "pdf_local_file_missing"
  );
  assert.deepEqual(events, [`delete:${session.destinationUri}`]);
});

test("download failure and timeout cancel work and remove partial cache files", async () => {
  const failedEvents: string[] = [];
  const failedFileSystem = createFileSystem({
    downloadResult: { status: 503, uri: "file:///partial" },
    events: failedEvents,
  });
  const failedSession = startTemporaryPdfDownload({
    fileSystem: failedFileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 13,
    randomValue: 0.5,
  });

  await assert.rejects(
    failedSession.result,
    (caught) =>
      caught instanceof PdfTemporaryFileError &&
      caught.diagnosticCategory === "pdf_download_failed"
  );
  assert.deepEqual(failedEvents, [`delete:${failedSession.destinationUri}`]);

  const timeoutEvents: string[] = [];
  const timeoutFileSystem = createFileSystem({
    downloadPromise: new Promise(() => {}),
    events: timeoutEvents,
  });
  const timeoutSession = startTemporaryPdfDownload({
    fileSystem: timeoutFileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    timeoutMs: 5,
    nowMs: 14,
    randomValue: 0.5,
  });

  await assert.rejects(timeoutSession.result, PdfTemporaryFileError);
  assert.deepEqual(timeoutEvents, [
    "cancel",
    `delete:${timeoutSession.destinationUri}`,
  ]);
});

test("explicit cancellation is idempotent and prevents a stale download commit", async () => {
  const events: string[] = [];
  let finishDownload: ((result: undefined) => void) | null = null;
  const downloadPromise = new Promise<undefined>((resolve) => {
    finishDownload = resolve;
  });
  const fileSystem = createFileSystem({
    downloadPromise,
    events,
    onCancel: () => finishDownload?.(undefined),
  });
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 15,
    randomValue: 0.5,
  });

  await session.cancel();
  await session.cancel();
  await assert.rejects(
    session.result,
    (caught) => caught instanceof PdfTemporaryFileError && caught.canceled
  );
  assert.equal(events.filter((event) => event === "cancel").length, 1);
  assert.ok(
    events.filter((event) => event === `delete:${session.destinationUri}`)
      .length >= 1
  );
});

test("refresh cancels download, deletes the current managed file, then requests fresh access", async () => {
  const events: string[] = [];
  const fileSystem = createFileSystem({ events });
  const localUri = "file:///app-cache/peritio-pdf-old-copy.pdf";

  await refreshTemporaryPdf({
    fileSystem,
    activeDownload: {
      destinationUri: "file:///app-cache/peritio-pdf-active-copy.pdf",
      result: Promise.resolve(
        "file:///app-cache/peritio-pdf-active-copy.pdf"
      ),
      cancel: async () => {
        events.push("cancel-session");
      },
    },
    localUri,
    requestFreshAccess: async () => {
      events.push("request-access");
    },
  });

  assert.deepEqual(events, [
    "cancel-session",
    `delete:${localUri}`,
    "request-access",
  ]);
});

test("cleanup refuses to delete unrelated cache or permanent files", async () => {
  const events: string[] = [];
  const fileSystem = createFileSystem({ events });

  assert.equal(
    await deleteManagedTemporaryPdf(
      fileSystem,
      "file:///app-cache/unrelated.pdf"
    ),
    false
  );
  assert.equal(
    await deleteManagedTemporaryPdf(
      fileSystem,
      "file:///documents/peritio-pdf-a-b.pdf"
    ),
    false
  );
  assert.deepEqual(events, []);
});
