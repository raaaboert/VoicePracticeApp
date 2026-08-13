import assert from "node:assert/strict";
import test from "node:test";

import {
  createTemporaryPdfUri,
  deferManagedTemporaryPdfDeletion,
  deleteManagedTemporaryPdf,
  hasPdfFileSignature,
  PDF_NATIVE_TEARDOWN_CLEANUP_DELAY_MS,
  type PdfTemporaryFileSystem,
  PdfTemporaryFileError,
  refreshTemporaryPdf,
  startTemporaryPdfDownload,
} from "./pdfTemporaryFile";

interface DownloadResult {
  status: number;
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
}

function createFileSystem(params: {
  downloadResult?: DownloadResult | undefined;
  fileInfo?: { exists: boolean; size?: number };
  downloadPromise?: Promise<DownloadResult | undefined>;
  signatureBase64?: string;
  onCancel?: () => void;
  events?: string[];
} = {}): PdfTemporaryFileSystem & {
  destinations: string[];
  requestOptions: Array<{ headers?: Record<string, string> }>;
  readOptions: Array<{
    encoding: "base64";
    position: number;
    length: number;
  }>;
} {
  const destinations: string[] = [];
  const requestOptions: Array<{ headers?: Record<string, string> }> = [];
  const readOptions: Array<{
    encoding: "base64";
    position: number;
    length: number;
  }> = [];
  return {
    cacheDirectory: "file:///app-cache/",
    destinations,
    requestOptions,
    readOptions,
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
    readAsStringAsync: async (_uri, options) => {
      readOptions.push(options);
      return params.signatureBase64 ?? "JVBERi0=";
    },
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

test("PDF download preserves headers and accepts a valid local PDF signature", async () => {
  const fileSystem = createFileSystem({
    downloadResult: {
      status: 200,
      uri: "file:///app-cache/download.pdf",
      headers: { "Content-Length": "5500000" },
    },
  });
  const headers = { "x-required-header": "signed-value" };
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private?signature=secret",
    headers,
    expectedByteSize: 5_500_000,
    nowMs: 10,
    randomValue: 0.5,
  });

  assert.equal(await session.result, session.destinationUri);
  assert.deepEqual(fileSystem.requestOptions, [{ headers }]);
  assert.deepEqual(fileSystem.readOptions, [
    { encoding: "base64", position: 0, length: 5 },
  ]);
  assert.equal(hasPdfFileSignature("JVBERi0="), true);
  assert.doesNotMatch(session.destinationUri, /signature|secret/);
});

test("non-PDF downloaded content fails safely and deletes the cache target", async () => {
  const events: string[] = [];
  const fileSystem = createFileSystem({
    signatureBase64: "PGh0bWw=",
    events,
  });
  const session = startTemporaryPdfDownload({
    fileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 10,
    randomValue: 0.75,
  });

  await assert.rejects(
    session.result,
    (caught) =>
      caught instanceof PdfTemporaryFileError &&
      caught.diagnosticCategory === "pdf_signature_invalid"
  );
  assert.equal(hasPdfFileSignature("PGh0bWw="), false);
  assert.deepEqual(events, [`delete:${session.destinationUri}`]);
});

test("PDF download size must match asset or response metadata when available", async () => {
  const assetEvents: string[] = [];
  const assetFileSystem = createFileSystem({
    fileInfo: { exists: true, size: 1_024 },
    events: assetEvents,
  });
  const assetSession = startTemporaryPdfDownload({
    fileSystem: assetFileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    expectedByteSize: 2_048,
    nowMs: 10,
    randomValue: 0.8,
  });

  await assert.rejects(
    assetSession.result,
    (caught) =>
      caught instanceof PdfTemporaryFileError &&
      caught.diagnosticCategory === "pdf_size_mismatch"
  );
  assert.deepEqual(assetEvents, [`delete:${assetSession.destinationUri}`]);

  const responseFileSystem = createFileSystem({
    fileInfo: { exists: true, size: 1_024 },
    downloadResult: {
      status: 200,
      uri: "file:///app-cache/download.pdf",
      headers: { "Content-Length": "2048" },
    },
  });
  const responseSession = startTemporaryPdfDownload({
    fileSystem: responseFileSystem,
    url: "https://asset.invalid/private",
    headers: {},
    nowMs: 10,
    randomValue: 0.85,
  });

  await assert.rejects(
    responseSession.result,
    (caught) =>
      caught instanceof PdfTemporaryFileError &&
      caught.diagnosticCategory === "pdf_size_mismatch"
  );
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

test("native teardown cleanup is deferred, bounded, and deduplicated per managed file", async () => {
  const events: string[] = [];
  const fileSystem = createFileSystem({ events });
  const uri = "file:///app-cache/peritio-pdf-deferred-cleanup.pdf";
  const scheduled: Array<{
    cleanup: () => Promise<void>;
    delayMs: number;
  }> = [];
  const schedule = (cleanup: () => Promise<void>, delayMs: number) => {
    scheduled.push({ cleanup, delayMs });
  };

  assert.equal(
    deferManagedTemporaryPdfDeletion(fileSystem, uri, schedule),
    true
  );
  assert.equal(
    deferManagedTemporaryPdfDeletion(fileSystem, uri, schedule),
    false
  );
  assert.deepEqual(events, []);
  assert.equal(scheduled.length, 1);
  assert.equal(
    scheduled[0]?.delayMs,
    PDF_NATIVE_TEARDOWN_CLEANUP_DELAY_MS
  );

  await scheduled[0]?.cleanup();
  assert.deepEqual(events, [`delete:${uri}`]);

  assert.equal(
    deferManagedTemporaryPdfDeletion(fileSystem, uri, schedule),
    true
  );
  assert.equal(scheduled.length, 2);
  await scheduled[1]?.cleanup();
  assert.deepEqual(events, [`delete:${uri}`, `delete:${uri}`]);
});
