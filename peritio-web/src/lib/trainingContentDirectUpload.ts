import type { DashboardTrainingContentUploadInitiationResponse } from "@voicepractice/shared";

export class TrainingContentDirectUploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "TrainingContentDirectUploadError";
  }
}

export function directUploadTrainingContentAsset(
  upload: DashboardTrainingContentUploadInitiationResponse["upload"],
  file: Blob,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url);
    for (const [header, value] of Object.entries(upload.requiredHeaders)) {
      request.setRequestHeader(header, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new TrainingContentDirectUploadError(
        `The private upload link was rejected or expired (${request.status}).`,
        request.status
      ));
    };
    request.onerror = () => {
      reject(new TrainingContentDirectUploadError(
        "The browser could not reach private storage. Check the connection and retry.",
        null
      ));
    };
    request.onabort = () => reject(
      new TrainingContentDirectUploadError("The upload was cancelled.", null)
    );
    request.send(file);
  });
}
