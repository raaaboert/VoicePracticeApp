import type { DashboardTrainingContentUploadInitiationResponse } from "@voicepractice/shared";

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
      reject(new Error(`Private storage rejected the upload (${request.status}).`));
    };
    request.onerror = () => {
      reject(new Error("The browser could not reach private storage. Check the connection and retry."));
    };
    request.onabort = () => reject(new Error("The upload was cancelled."));
    request.send(file);
  });
}
