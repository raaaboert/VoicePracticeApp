export const PDF_DOWNLOAD_TIMEOUT_MS = 45_000;

export type PdfFileDiagnosticCategory =
  | "pdf_download_failed"
  | "pdf_local_file_missing";

export interface PdfTemporaryFileSystem {
  cacheDirectory: string | null;
  createDownloadResumable: (
    url: string,
    destinationUri: string,
    options: { headers?: Record<string, string> }
  ) => {
    downloadAsync: () => Promise<{ status: number; uri: string } | undefined>;
    cancelAsync: () => Promise<void>;
  };
  getInfoAsync: (
    uri: string
  ) => Promise<{ exists: boolean; size?: number }>;
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
      if (!info.exists || info.size === 0) {
        throw new PdfTemporaryFileError("pdf_local_file_missing");
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
