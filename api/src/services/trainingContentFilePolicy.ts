import yauzl from "yauzl";

import type {
  TrainingContentAssetRole,
  TrainingContentType,
} from "@voicepractice/shared";

import type {
  TrainingContentFileKind,
  TrainingContentFileSizeLimits,
} from "../trainingContentStorageConfig.js";

export type TrainingContentSupportedExtension =
  | "mp4"
  | "mp3"
  | "m4a"
  | "pdf"
  | "docx"
  | "jpg"
  | "jpeg"
  | "png"
  | "webp";

export interface TrainingContentDeclaredFile {
  originalFilename: string;
  extension: TrainingContentSupportedExtension;
  mimeType: string;
  byteSize: number;
  kind: TrainingContentFileKind;
}

interface FilePolicyDefinition {
  extension: TrainingContentSupportedExtension;
  kind: TrainingContentFileKind;
  canonicalMimeType: string;
  acceptedMimeTypes: ReadonlySet<string>;
}

const FILE_POLICIES: Record<TrainingContentSupportedExtension, FilePolicyDefinition> = {
  mp4: {
    extension: "mp4",
    kind: "video",
    canonicalMimeType: "video/mp4",
    acceptedMimeTypes: new Set(["video/mp4"]),
  },
  mp3: {
    extension: "mp3",
    kind: "audio",
    canonicalMimeType: "audio/mpeg",
    acceptedMimeTypes: new Set(["audio/mpeg", "audio/mp3"]),
  },
  m4a: {
    extension: "m4a",
    kind: "audio",
    canonicalMimeType: "audio/mp4",
    acceptedMimeTypes: new Set(["audio/mp4", "audio/m4a", "audio/x-m4a"]),
  },
  pdf: {
    extension: "pdf",
    kind: "pdf",
    canonicalMimeType: "application/pdf",
    acceptedMimeTypes: new Set(["application/pdf"]),
  },
  docx: {
    extension: "docx",
    kind: "docx",
    canonicalMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    acceptedMimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  },
  jpg: {
    extension: "jpg",
    kind: "image",
    canonicalMimeType: "image/jpeg",
    acceptedMimeTypes: new Set(["image/jpeg"]),
  },
  jpeg: {
    extension: "jpeg",
    kind: "image",
    canonicalMimeType: "image/jpeg",
    acceptedMimeTypes: new Set(["image/jpeg"]),
  },
  png: {
    extension: "png",
    kind: "image",
    canonicalMimeType: "image/png",
    acceptedMimeTypes: new Set(["image/png"]),
  },
  webp: {
    extension: "webp",
    kind: "image",
    canonicalMimeType: "image/webp",
    acceptedMimeTypes: new Set(["image/webp"]),
  },
};

const FILE_POLICY_SET = new Set<string>(Object.keys(FILE_POLICIES));
const MAX_FILENAME_LENGTH = 255;
const MAX_DOCX_ENTRIES = 10_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_DOCX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 500;

export class TrainingContentFilePolicyError extends Error {
  constructor(
    message: string,
    readonly category:
      | "unsupported_file_type"
      | "invalid_filename"
      | "invalid_declared_size"
      | "declared_size_exceeded"
      | "extension_mime_mismatch"
      | "content_type_mismatch"
      | "magic_byte_mismatch"
      | "invalid_docx"
  ) {
    super(message);
    this.name = "TrainingContentFilePolicyError";
  }
}

export function validateDeclaredTrainingContentFile(params: {
  originalFilename: unknown;
  declaredMimeType: unknown;
  declaredByteSize: unknown;
  limits: TrainingContentFileSizeLimits;
}): TrainingContentDeclaredFile {
  if (typeof params.originalFilename !== "string") {
    throw new TrainingContentFilePolicyError("A filename is required.", "invalid_filename");
  }
  const originalFilename = params.originalFilename.trim();
  if (
    !originalFilename
    || originalFilename.length > MAX_FILENAME_LENGTH
    || /[\0-\u001f\u007f]/.test(originalFilename)
    || /[\\/]/.test(originalFilename)
    || originalFilename === "."
    || originalFilename === ".."
  ) {
    throw new TrainingContentFilePolicyError("The filename is invalid.", "invalid_filename");
  }

  const extension = originalFilename.includes(".")
    ? originalFilename.slice(originalFilename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (!FILE_POLICY_SET.has(extension)) {
    throw new TrainingContentFilePolicyError(
      "This file type is not supported for Training Content.",
      "unsupported_file_type"
    );
  }
  const definition = FILE_POLICIES[extension as TrainingContentSupportedExtension];

  const declaredMimeType = typeof params.declaredMimeType === "string"
    ? params.declaredMimeType.trim().toLowerCase()
    : "";
  if (!definition.acceptedMimeTypes.has(declaredMimeType)) {
    throw new TrainingContentFilePolicyError(
      "The declared MIME type does not match the filename extension.",
      "extension_mime_mismatch"
    );
  }

  const declaredByteSize = Number(params.declaredByteSize);
  if (!Number.isSafeInteger(declaredByteSize) || declaredByteSize <= 0) {
    throw new TrainingContentFilePolicyError(
      "The declared file size must be a positive integer.",
      "invalid_declared_size"
    );
  }
  if (declaredByteSize > params.limits[definition.kind]) {
    throw new TrainingContentFilePolicyError(
      `The file exceeds the ${formatByteLimit(params.limits[definition.kind])} ${definition.kind} limit.`,
      "declared_size_exceeded"
    );
  }

  return {
    originalFilename,
    extension: definition.extension,
    mimeType: definition.canonicalMimeType,
    byteSize: declaredByteSize,
    kind: definition.kind,
  };
}

export function assertTrainingContentAssetRoleMatchesContent(params: {
  contentType: TrainingContentType;
  assetRole: TrainingContentAssetRole;
  fileKind: TrainingContentFileKind;
}): void {
  if (params.assetRole === "primary") {
    if (params.contentType !== params.fileKind) {
      throw new TrainingContentFilePolicyError(
        "The primary asset type must match the Training Content item type.",
        "content_type_mismatch"
      );
    }
    return;
  }

  if (params.fileKind !== "image" || params.contentType === "native" || params.contentType === "external_url") {
    throw new TrainingContentFilePolicyError(
      "Thumbnail and inline assets must be supported images on file-based Training Content.",
      "content_type_mismatch"
    );
  }
}

export async function validateTrainingContentFileSignature(params: {
  declaredFile: TrainingContentDeclaredFile;
  bytes: Uint8Array;
}): Promise<string> {
  const bytes = params.bytes;
  let valid = false;
  switch (params.declaredFile.extension) {
    case "pdf":
      valid = startsWithAscii(bytes, "%PDF-");
      break;
    case "jpg":
    case "jpeg":
      valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      break;
    case "png":
      valid = matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      break;
    case "webp":
      valid = startsWithAscii(bytes, "RIFF") && asciiAt(bytes, 8, 4) === "WEBP";
      break;
    case "mp3":
      valid = startsWithAscii(bytes, "ID3") || hasValidMpegAudioFrameHeader(bytes);
      break;
    case "mp4":
    case "m4a":
      valid = hasIsoBaseMediaFtyp(bytes);
      break;
    case "docx":
      await validateDocxContainer(bytes);
      valid = true;
      break;
  }

  if (!valid) {
    throw new TrainingContentFilePolicyError(
      "The uploaded file signature does not match the declared file type.",
      "magic_byte_mismatch"
    );
  }
  return params.declaredFile.mimeType;
}

export function getTrainingContentSignatureReadSize(
  declaredFile: TrainingContentDeclaredFile
): number {
  return declaredFile.kind === "docx" ? declaredFile.byteSize : Math.min(declaredFile.byteSize, 64);
}

function startsWithAscii(bytes: Uint8Array, expected: string): boolean {
  return asciiAt(bytes, 0, expected.length) === expected;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) {
    return "";
  }
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("ascii");
}

function matchesBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function hasValidMpegAudioFrameHeader(bytes: Uint8Array): boolean {
  const scanLimit = Math.min(bytes.length - 3, 32);
  for (let index = 0; index <= scanLimit; index += 1) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const sync = first === 0xff && (second & 0xe0) === 0xe0;
    const version = (second >> 3) & 0x03;
    const layer = (second >> 1) & 0x03;
    const bitrate = (third >> 4) & 0x0f;
    const sampleRate = (third >> 2) & 0x03;
    if (sync && version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3) {
      return true;
    }
  }
  return false;
}

function hasIsoBaseMediaFtyp(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || asciiAt(bytes, 4, 4) !== "ftyp") {
    return false;
  }
  const boxSize = Buffer.from(bytes.subarray(0, 4)).readUInt32BE(0);
  return boxSize >= 12 && boxSize <= Math.max(bytes.length, 32);
}

async function validateDocxContainer(bytes: Uint8Array): Promise<void> {
  if (!matchesBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new TrainingContentFilePolicyError(
      "The DOCX file is not a valid ZIP container.",
      "invalid_docx"
    );
  }

  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      {
        lazyEntries: true,
        validateEntrySizes: true,
        decodeStrings: true,
        strictFileNames: true,
      },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(new TrainingContentFilePolicyError("The DOCX container is invalid.", "invalid_docx"));
          return;
        }

        let entryCount = 0;
        let totalUncompressedBytes = 0;
        let hasContentTypes = false;
        let hasDocument = false;
        const fail = (message: string) => {
          zipFile.close();
          reject(new TrainingContentFilePolicyError(message, "invalid_docx"));
        };

        zipFile.on("entry", (entry) => {
          entryCount += 1;
          totalUncompressedBytes += entry.uncompressedSize;
          const normalizedName = entry.fileName.replace(/\\/g, "/");
          const compressionRatio = entry.compressedSize > 0
            ? entry.uncompressedSize / entry.compressedSize
            : entry.uncompressedSize;

          if (
            entryCount > MAX_DOCX_ENTRIES
            || entry.uncompressedSize > MAX_DOCX_ENTRY_BYTES
            || totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES
            || compressionRatio > MAX_DOCX_COMPRESSION_RATIO
            || (entry.generalPurposeBitFlag & 0x1) !== 0
            || normalizedName.startsWith("/")
            || normalizedName.split("/").includes("..")
          ) {
            fail("The DOCX container exceeds safe archive limits.");
            return;
          }

          hasContentTypes ||= normalizedName === "[Content_Types].xml";
          hasDocument ||= normalizedName === "word/document.xml";
          zipFile.readEntry();
        });
        zipFile.once("error", () => fail("The DOCX container is invalid."));
        zipFile.once("end", () => {
          zipFile.close();
          if (!hasContentTypes || !hasDocument) {
            reject(new TrainingContentFilePolicyError(
              "The ZIP container is not a valid DOCX document.",
              "invalid_docx"
            ));
            return;
          }
          resolve();
        });
        zipFile.readEntry();
      }
    );
  });
}

function formatByteLimit(value: number): string {
  const megabytes = value / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}
