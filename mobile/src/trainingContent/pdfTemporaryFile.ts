export const PDF_DOWNLOAD_TIMEOUT_MS = 45_000;

export type PdfFileDiagnosticCategory =
  | "pdf_download_failed"
  | "pdf_local_file_missing"
  | "pdf_signature_invalid"
  | "pdf_size_mismatch";

const PDF_SIGNATURE_BYTE_LENGTH = 5;
const PDF_SIGNATURE_BASE64 = "JVBERi0=";

interface PdfDownloadResult {
  status: number;
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
}

export interface PdfTemporaryFileSystem {
  cacheDirectory: string | null;
  createDownloadResumable: (
    url: string,
    destinationUri: string,
    options: { headers?: Record<string, string> }
  ) => {
    downloadAsync: () => Promise<PdfDownloadResult | undefined>;
    cancelAsync: () => Promise<void>;
  };
  getInfoAsync: (
    uri: string
  ) => Promise<{ exists: boolean; size?: number }>;
  readAsStringAsync: (
    uri: string,
    options: { encoding: "base64"; position: number; length: number }
  ) => Promise<string>;
  deleteAsync: (
    uri: string,
    options: { idempotent: true }
  ) => Promise<void>;
}

export interface PdfTemporaryDownloadSession {
  destinationUri: string;
  result: Promise<string>;
  cancel: () => Promise<void>;
}

export class PdfTemporaryFileError extends Error {
  constructor(
    readonly diagnosticCategory: PdfFileDiagnosticCategory,
    readonly canceled = false
  ) {
    super(diagnosticCategory);
    this.name = "PdfTemporaryFileError";
  }
}

function normalizedCacheDirectory(cacheDirectory: string): string {
  return cacheDirectory.endsWith("/") ? cacheDirectory : `${cacheDirectory}/`;
}

function positiveByteSize(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function responseHeader(
  headers: Record<string, string> | undefined,
  name: string
): string | null {
  if (!headers) {
    return null;
  }
  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === normalizedName
  );
  return entry?.[1] ?? null;
}

function responseContentLength(response: PdfDownloadResult): number | null {
  if (response.status !== 200) {
    return null;
  }
  const contentEncoding = responseHeader(response.headers, "content-encoding");
  if (
    contentEncoding &&
    contentEncoding.trim().toLowerCase() !== "identity"
  ) {
    return null;
  }
  const rawContentLength = responseHeader(response.headers, "content-length");
  if (!rawContentLength || !/^\d+$/.test(rawContentLength.trim())) {
    return null;
  }
  return positiveByteSize(Number(rawContentLength));
}

export function hasPdfFileSignature(base64Prefix: string): boolean {
  return base64Prefix.replace(/\s/g, "") === PDF_SIGNATURE_BASE64;
}

export function createTemporaryPdfUri(
  cacheDirectory: string | null,
  nowMs = Date.now(),
  randomValue = Math.random()
): string {
  if (!cacheDirectory?.trim()) {
    throw new PdfTemporaryFileError("pdf_local_file_missing");
  }
  const timestamp = Math.max(0, Math.floor(nowMs)).toString(36);
  const randomToken = Math.max(
    0,
    Math.floor(randomValue * Number.MAX_SAFE_INTEGER)
  ).toString(36);
  return `${normalizedCacheDirectory(cacheDirectory)}peritio-pdf-${timestamp}-${randomToken}.pdf`;
}

export function isManagedTemporaryPdfUri(
  uri: string,
  cacheDirectory: string | null
): boolean {
  if (!cacheDirectory?.trim()) {
    return false;
  }
  const normalizedDirectory = normalizedCacheDirectory(cacheDirectory);
  if (!uri.startsWith(normalizedDirectory)) {
    return false;
  }
  const filename = uri.slice(normalizedDirectory.length);
  return /^peritio-pdf-[a-z0-9]+-[a-z0-9]+\.pdf$/i.test(filename);
}

export async function deleteManagedTemporaryPdf(
  fileSystem: PdfTemporaryFileSystem,
  uri: string | null
): Promise<boolean> {
  if (!uri || !isManagedTemporaryPdfUri(uri, fileSystem.cacheDirectory)) {
    return false;
  }
  await fileSystem
    .deleteAsync(uri, { idempotent: true })
    .catch(() => {});
  return true;
}

export function startTemporaryPdfDownload(params: {
  fileSystem: PdfTemporaryFileSystem;
  url: string;
  headers: Record<string, string>;
  expectedByteSize?: number | null;
  timeoutMs?: number;
  nowMs?: number;
  randomValue?: number;
}): PdfTemporaryDownloadSession {
  const destinationUri = createTemporaryPdfUri(
    params.fileSystem.cacheDirectory,
    params.nowMs,
    params.randomValue
  );
  const download = params.fileSystem.createDownloadResumable(
    params.url,
    destinationUri,
    Object.keys(params.headers).length > 0 ? { headers: params.headers } : {}
  );
  const timeoutMs = Math.max(1, params.timeoutMs ?? PDF_DOWNLOAD_TIMEOUT_MS);
  let canceled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let timeoutCancellation: Promise<void> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timeoutCancellation = download.cancelAsync().catch(() => {});
      reject(new PdfTemporaryFileError("pdf_download_failed"));
    }, timeoutMs);
  });

  const result = (async () => {
    try {
      const response = await Promise.race([
        download.downloadAsync(),
        timeoutPromise,
      ]);
      if (canceled) {
        throw new PdfTemporaryFileError("pdf_download_failed", true);
      }
      if (!response || response.status < 200 || response.status >= 300) {
        throw new PdfTemporaryFileError("pdf_download_failed");
      }
      const info = await params.fileSystem.getInfoAsync(destinationUri);
      if (canceled) {
        throw new PdfTemporaryFileError("pdf_download_failed", true);
      }
      const actualByteSize = positiveByteSize(info.size);
      if (!info.exists || actualByteSize === null) {
        throw new PdfTemporaryFileError("pdf_local_file_missing");
      }
      const expectedByteSizes = [
        positiveByteSize(params.expectedByteSize),
        responseContentLength(response),
      ].filter((value): value is number => value !== null);
      if (
        expectedByteSizes.some(
          (expectedByteSize) => expectedByteSize !== actualByteSize
        )
      ) {
        throw new PdfTemporaryFileError("pdf_size_mismatch");
      }
      let signature: string;
      try {
        signature = await params.fileSystem.readAsStringAsync(destinationUri, {
          encoding: "base64",
          position: 0,
          length: PDF_SIGNATURE_BYTE_LENGTH,
        });
      } catch {
        throw new PdfTemporaryFileError("pdf_signature_invalid");
      }
      if (canceled) {
        throw new PdfTemporaryFileError("pdf_download_failed", true);
      }
      if (!hasPdfFileSignature(signature)) {
        throw new PdfTemporaryFileError("pdf_signature_invalid");
      }
      return destinationUri;
    } catch (caught) {
      if (timeoutCancellation) {
        await timeoutCancellation;
      }
      await deleteManagedTemporaryPdf(params.fileSystem, destinationUri);
      if (canceled) {
        throw new PdfTemporaryFileError("pdf_download_failed", true);
      }
      if (caught instanceof PdfTemporaryFileError) {
        throw caught;
      }
      throw new PdfTemporaryFileError("pdf_download_failed");
    } finally {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
  })();

  return {
    destinationUri,
    result,
    cancel: async () => {
      if (!canceled) {
        canceled = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        await download.cancelAsync().catch(() => {});
      }
      await deleteManagedTemporaryPdf(params.fileSystem, destinationUri);
    },
  };
}

export async function refreshTemporaryPdf(params: {
  fileSystem: PdfTemporaryFileSystem;
  activeDownload: PdfTemporaryDownloadSession | null;
  localUri: string | null;
  requestFreshAccess: () => Promise<void>;
}): Promise<void> {
  await params.activeDownload?.cancel();
  await deleteManagedTemporaryPdf(params.fileSystem, params.localUri);
  await params.requestFreshAccess();
}
