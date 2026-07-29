import assert from "node:assert/strict";
import test from "node:test";

import { directUploadTrainingContentAsset } from "./trainingContentDirectUpload";

class FakeXmlHttpRequest {
  static status = 200;
  static failure: "none" | "error" | "abort" = "none";
  static last: FakeXmlHttpRequest | null = null;

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
  } = { onprogress: null };
  readonly headers = new Map<string, string>();
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;

  constructor() {
    FakeXmlHttpRequest.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(header: string, value: string): void {
    this.headers.set(header, value);
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 40,
      total: 100,
    } as ProgressEvent);
    this.status = FakeXmlHttpRequest.status;
    if (FakeXmlHttpRequest.failure === "error") {
      this.onerror?.({} as ProgressEvent);
    } else if (FakeXmlHttpRequest.failure === "abort") {
      this.onabort?.({} as ProgressEvent);
    } else {
      this.onload?.({} as ProgressEvent);
    }
  }
}

function useFakeXmlHttpRequest(): () => void {
  const original = globalThis.XMLHttpRequest;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: FakeXmlHttpRequest as unknown as typeof XMLHttpRequest,
  });
  return () => {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      value: original,
    });
  };
}

test("direct upload sends bytes to the signed storage URL with headers and progress", async () => {
  const restore = useFakeXmlHttpRequest();
  FakeXmlHttpRequest.status = 200;
  FakeXmlHttpRequest.failure = "none";
  const body = new Blob(["training"]);
  const progress: number[] = [];

  try {
    await directUploadTrainingContentAsset(
      {
        method: "PUT",
        url: "https://storage.example.test/signed-upload",
        expiresAt: "2026-07-28T12:00:00.000Z",
        requiredHeaders: { "Content-Type": "application/pdf" },
      },
      body,
      (value) => progress.push(value)
    );

    assert.equal(FakeXmlHttpRequest.last?.method, "PUT");
    assert.equal(FakeXmlHttpRequest.last?.url, "https://storage.example.test/signed-upload");
    assert.equal(FakeXmlHttpRequest.last?.headers.get("Content-Type"), "application/pdf");
    assert.equal(FakeXmlHttpRequest.last?.body, body);
    assert.deepEqual(progress, [40, 100]);
  } finally {
    restore();
  }
});

test("direct upload returns safe storage and network errors", async () => {
  const restore = useFakeXmlHttpRequest();
  try {
    FakeXmlHttpRequest.status = 403;
    FakeXmlHttpRequest.failure = "none";
    await assert.rejects(
      () => directUploadTrainingContentAsset(
        {
          method: "PUT",
          url: "https://storage.example.test/expired",
          expiresAt: "2026-07-28T12:00:00.000Z",
          requiredHeaders: {},
        },
        new Blob(["training"]),
        () => undefined
      ),
      /Private storage rejected the upload \(403\)\./
    );

    FakeXmlHttpRequest.failure = "error";
    await assert.rejects(
      () => directUploadTrainingContentAsset(
        {
          method: "PUT",
          url: "https://storage.example.test/network-error",
          expiresAt: "2026-07-28T12:00:00.000Z",
          requiredHeaders: {},
        },
        new Blob(["training"]),
        () => undefined
      ),
      /could not reach private storage/
    );
  } finally {
    FakeXmlHttpRequest.failure = "none";
    restore();
  }
});
