import "dotenv/config";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRuntimeConfig } from "../src/runtimeConfig.js";
import {
  createTrainingContentFinalObjectKey,
  createTrainingContentFinalizationNonce,
  createTrainingContentTemporaryObjectKey,
} from "../src/storage/trainingContentObjectKeys.js";
import { createTrainingContentObjectStorage } from "../src/storage/trainingContentObjectStorage.js";

function requireStagingSmokeTarget(): string {
  const targetIndex = process.argv.indexOf("--target");
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : null;
  if (target !== "staging") {
    throw new Error("--target staging is required; the R2 smoke command cannot target production.");
  }
  if (!process.argv.includes("--apply")) {
    throw new Error("--apply is required because the R2 smoke command writes temporary test objects.");
  }

  const origin = process.env.TRAINING_CONTENT_R2_SMOKE_ORIGIN?.trim();
  if (!origin || new URL(origin).origin !== origin || !origin.startsWith("https://")) {
    throw new Error(
      "TRAINING_CONTENT_R2_SMOKE_ORIGIN must be the exact HTTPS staging Dashboard origin."
    );
  }
  return origin;
}

function assertCorsResponse(response: Response, origin: string, operation: string): void {
  if (!response.ok) {
    throw new Error(`R2 ${operation} CORS check failed with status ${response.status}.`);
  }
  if (response.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`R2 ${operation} response did not allow the exact staging Dashboard origin.`);
  }
}

async function main(): Promise<void> {
  const origin = requireStagingSmokeTarget();
  const runtimeConfig = loadRuntimeConfig();
  if (
    runtimeConfig.deploymentEnvironment !== "staging"
    || runtimeConfig.trainingContentStorage.provider !== "r2"
    || runtimeConfig.trainingContentStorage.r2?.environment !== "staging"
  ) {
    throw new Error("The R2 smoke command requires the locked staging R2 configuration lane.");
  }

  const objectStorage = createTrainingContentObjectStorage(runtimeConfig.trainingContentStorage);
  const orgId = `storage-smoke-${randomUUID()}`;
  const contentId = randomUUID();
  const assetId = randomUUID();
  const temporaryKey = createTrainingContentTemporaryObjectKey({
    orgId,
    contentId,
    assetId,
  });
  const finalKey = createTrainingContentFinalObjectKey({
    orgId,
    contentId,
    assetRole: "primary",
    version: 1,
    finalizationNonce: createTrainingContentFinalizationNonce(),
  });
  const payload = new TextEncoder().encode("%PDF-1.7\n% R2 staging smoke\n");
  let primaryError: unknown = null;

  try {
    await objectStorage.verifyReadiness();
    const upload = await objectStorage.createPresignedUpload({
      key: temporaryKey,
      contentType: "application/pdf",
      contentLength: payload.byteLength,
      expiresInSeconds: 120,
    });
    const preflight = await fetch(upload.url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assertCorsResponse(preflight, origin, "upload preflight");

    const uploadResponse = await fetch(upload.url, {
      method: "PUT",
      headers: {
        Origin: origin,
        "Content-Type": upload.requiredHeaders["content-type"]!,
      },
      body: payload,
    });
    assertCorsResponse(uploadResponse, origin, "upload");

    const uploaded = await objectStorage.headObject(temporaryKey);
    if (
      !uploaded
      || uploaded.byteSize !== payload.byteLength
      || uploaded.contentType !== "application/pdf"
    ) {
      throw new Error("R2 staging smoke HEAD metadata did not match the uploaded object.");
    }
    const prefix = await objectStorage.readObjectRange(temporaryKey, 0, 4);
    if (new TextDecoder().decode(prefix) !== "%PDF-") {
      throw new Error("R2 staging smoke byte-range read returned unexpected content.");
    }

    await objectStorage.copyObject({ sourceKey: temporaryKey, destinationKey: finalKey });
    const copied = await objectStorage.headObject(finalKey);
    if (!copied || copied.byteSize !== payload.byteLength) {
      throw new Error("R2 staging smoke immutable copy verification failed.");
    }
    const replacementPayload = payload.slice();
    replacementPayload[replacementPayload.byteLength - 1] ^= 1;
    const replacementUploadResponse = await fetch(upload.url, {
      method: "PUT",
      headers: {
        Origin: origin,
        "Content-Type": upload.requiredHeaders["content-type"]!,
      },
      body: replacementPayload,
    });
    assertCorsResponse(replacementUploadResponse, origin, "replacement upload");
    await objectStorage.copyObject({ sourceKey: temporaryKey, destinationKey: finalKey });

    const access = await objectStorage.createPresignedAccess({
      key: finalKey,
      expiresInSeconds: 120,
    });
    const accessResponse = await fetch(access.url, {
      headers: { Origin: origin },
    });
    assertCorsResponse(accessResponse, origin, "download");
    const downloaded = new Uint8Array(await accessResponse.arrayBuffer());
    if (
      downloaded.byteLength !== payload.byteLength
      || !downloaded.every((value, index) => value === payload[index])
    ) {
      throw new Error("R2 staging smoke temporary download returned unexpected content.");
    }

    console.log(JSON.stringify({
      target: "staging",
      providerReady: true,
      uploadCorsReady: true,
      downloadCorsReady: true,
      uploadVerified: true,
      rangeReadVerified: true,
      immutableCopyVerified: true,
      immutableOverwriteBlocked: true,
      temporaryAccessVerified: true,
    }, null, 2));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      objectStorage.deleteObject(temporaryKey),
      objectStorage.deleteObject(finalKey),
    ]);
    if (!primaryError && cleanupResults.some((result) => result.status === "rejected")) {
      throw new Error("R2 staging smoke succeeded but test-object cleanup failed.");
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
