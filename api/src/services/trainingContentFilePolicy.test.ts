import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrainingContentAssetRoleMatchesContent,
  validateDeclaredTrainingContentFile,
  validateTrainingContentFileSignature,
} from "./trainingContentFilePolicy.js";

const LIMITS = {
  video: 500 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  image: 20 * 1024 * 1024,
};

const MINIMAL_DOCX = Buffer.from(
  "UEsDBBQAAAAIAPqT/FzHHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgA+pP8XF9b0UwNAAAACwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLNJyU8uzU3NK9G3AwBQSwECFAAUAAAACAD6k/xcxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAIAPqT/FxfW9FMDQAAAAsAAAARAAAAAAAAAAAAAAAAADsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAB3AAAAAAA=",
  "base64"
);

function declared(filename: string, mimeType: string, byteSize = 100) {
  return validateDeclaredTrainingContentFile({
    originalFilename: filename,
    declaredMimeType: mimeType,
    declaredByteSize: byteSize,
    limits: LIMITS,
  });
}

test("declared upload policy accepts only the initial allowlist and rejects mismatches", () => {
  assert.equal(declared("video.mp4", "video/mp4").kind, "video");
  assert.equal(declared("audio.mp3", "audio/mpeg").kind, "audio");
  assert.equal(declared("audio.m4a", "audio/x-m4a").mimeType, "audio/mp4");
  assert.equal(declared("document.pdf", "application/pdf").kind, "pdf");
  assert.equal(declared(
    "document.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ).kind, "docx");
  assert.equal(declared("photo.jpeg", "image/jpeg").kind, "image");

  for (const filename of [
    "script.html",
    "vector.svg",
    "archive.zip",
    "legacy.doc",
    "sheet.xlsx",
    "slides.pptx",
    "program.exe",
  ]) {
    assert.throws(
      () => declared(filename, "application/octet-stream"),
      /not supported/
    );
  }
  assert.throws(
    () => declared("photo.jpg", "text/html"),
    /does not match/
  );
  assert.throws(
    () => declared("../photo.jpg", "image/jpeg"),
    /filename is invalid/
  );
  assert.throws(
    () => declared("..\\photo.jpg", "image/jpeg"),
    /filename is invalid/
  );
  assert.throws(
    () => declared("photo.png", "image/png", LIMITS.image + 1),
    /exceeds the 20 MB/
  );
});

test("asset roles enforce content-type alignment", () => {
  assert.doesNotThrow(() => assertTrainingContentAssetRoleMatchesContent({
    contentType: "video",
    assetRole: "primary",
    fileKind: "video",
  }));
  assert.doesNotThrow(() => assertTrainingContentAssetRoleMatchesContent({
    contentType: "video",
    assetRole: "thumbnail",
    fileKind: "image",
  }));
  assert.throws(() => assertTrainingContentAssetRoleMatchesContent({
    contentType: "pdf",
    assetRole: "primary",
    fileKind: "image",
  }), /primary asset type must match/);
  assert.throws(() => assertTrainingContentAssetRoleMatchesContent({
    contentType: "native",
    assetRole: "inline",
    fileKind: "image",
  }), /file-based Training Content/);
});

test("magic-byte validation recognizes supported formats and rejects declared-type deception", async () => {
  const samples = [
    {
      file: declared("file.pdf", "application/pdf", 8),
      bytes: Buffer.from("%PDF-1.7"),
    },
    {
      file: declared("file.jpg", "image/jpeg", 4),
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    },
    {
      file: declared("file.png", "image/png", 8),
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    {
      file: declared("file.webp", "image/webp", 12),
      bytes: Buffer.from("RIFF0000WEBP", "ascii"),
    },
    {
      file: declared("file.mp3", "audio/mpeg", 4),
      bytes: Buffer.from([0x49, 0x44, 0x33, 0x04]),
    },
    {
      file: declared("file.mp4", "video/mp4", 24),
      bytes: Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypisom00000000", "ascii"),
      ]),
    },
  ];
  for (const sample of samples) {
    assert.equal(
      await validateTrainingContentFileSignature({
        declaredFile: sample.file,
        bytes: sample.bytes,
      }),
      sample.file.mimeType
    );
  }

  await assert.rejects(
    validateTrainingContentFileSignature({
      declaredFile: declared("fake.pdf", "application/pdf", 8),
      bytes: Buffer.from("<script>"),
    }),
    /signature does not match/
  );
});

test("DOCX validation requires the expected OOXML structure and does not accept an arbitrary ZIP", async () => {
  const docx = declared(
    "document.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    MINIMAL_DOCX.byteLength
  );
  assert.equal(
    await validateTrainingContentFileSignature({ declaredFile: docx, bytes: MINIMAL_DOCX }),
    docx.mimeType
  );
  await assert.rejects(
    validateTrainingContentFileSignature({
      declaredFile: docx,
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    }),
    /DOCX container is invalid|not a valid DOCX/
  );
});
