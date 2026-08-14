import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";

import { S3Client } from "@aws-sdk/client-s3";

import {
  R2TrainingContentBackupStorage,
  type TrainingContentBackupObjectStorage,
} from "./trainingContentBackupStorage.js";

const BACKUP_CONFIG = {
  environment: "staging" as const,
  accountId: "abc123",
  bucket: "peritio-training-content-backup-staging",
  accessKeyId: "backup-access",
  secretAccessKey: "backup-secret",
  endpoint: "https://abc123.r2.cloudflarestorage.com",
};

test("backup storage serializes the documented cross-bucket R2 CopyObject request", async () => {
  let capturedRequest: {
    method?: string;
    hostname?: string;
    path?: string;
    headers?: Record<string, string>;
  } | null = null;
  const client = new S3Client({
    region: "auto",
    endpoint: BACKUP_CONFIG.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: BACKUP_CONFIG.accessKeyId,
      secretAccessKey: BACKUP_CONFIG.secretAccessKey,
    },
    maxAttempts: 1,
    requestHandler: {
      async handle(request: unknown) {
        capturedRequest = request as typeof capturedRequest;
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/xml" },
            body: Readable.from(
              '<CopyObjectResult><ETag>"etag"</ETag><LastModified>2026-08-13T00:00:00Z</LastModified></CopyObjectResult>'
            ),
          },
        };
      },
    },
  });
  const storage = new R2TrainingContentBackupStorage(BACKUP_CONFIG, {
    client: client as any,
  });
  const sourceKey = "objects/org/content/primary/2/final name #1.pdf";

  try {
    assert.equal(await storage.copyFromSource({
      sourceBucket: "peritio-training-content-staging",
      sourceKey,
      destinationKey: sourceKey,
    }), "copied");
  } finally {
    client.destroy();
  }

  assert.ok(capturedRequest);
  const request = capturedRequest as {
    method?: string;
    hostname?: string;
    path?: string;
    headers?: Record<string, string>;
  };
  assert.equal(request.method, "PUT");
  assert.equal(request.hostname, "abc123.r2.cloudflarestorage.com");
  assert.equal(
    request.path,
    "/peritio-training-content-backup-staging/objects/org/content/primary/2/final%20name%20%231.pdf"
  );
  assert.equal(
    request.headers?.["x-amz-copy-source"],
    "/peritio-training-content-staging/objects/org/content/primary/2/final%20name%20%231.pdf"
  );
  assert.equal(request.headers?.["x-amz-metadata-directive"], "COPY");
  assert.equal(request.headers?.["cf-copy-destination-if-none-match"], "*");
  assert.match(request.headers?.authorization ?? "", /SignedHeaders=[^ ]*cf-copy-destination-if-none-match/);
  assert.equal(request.headers?.["x-amz-checksum-algorithm"], undefined);
  assert.equal(request.headers?.["x-amz-sdk-checksum-algorithm"], undefined);
  assert.equal(
    Object.keys(request.headers ?? {}).some((name) => name.startsWith("x-amz-object-lock")),
    false
  );
});

test("backup storage performs immutable cross-bucket copies at the unchanged final key", async () => {
  const commands: any[] = [];
  let destinationExists = false;
  const storage: TrainingContentBackupObjectStorage = new R2TrainingContentBackupStorage(
    BACKUP_CONFIG,
    {
      client: {
        async send(command: any) {
          commands.push(command);
          if (command.constructor.name === "CopyObjectCommand" && destinationExists) {
            throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
          }
          if (command.constructor.name === "HeadObjectCommand") {
            return {
              ContentLength: 42,
              ContentType: "application/pdf",
              ETag: '"backup-etag"',
            };
          }
          return {};
        },
      },
    }
  );
  const finalKey = "objects/org/content/primary/2/finalization-nonce";

  assert.equal(await storage.copyFromSource({
    sourceBucket: "peritio-training-content-staging",
    sourceKey: finalKey,
    destinationKey: finalKey,
  }), "copied");
  const copy = commands.find((command) => command.constructor.name === "CopyObjectCommand");
  assert.equal(copy.input.Bucket, BACKUP_CONFIG.bucket);
  assert.equal(copy.input.Key, finalKey);
  assert.equal(copy.input.CopySource, `/peritio-training-content-staging/${finalKey}`);
  assert.deepEqual(copy.middlewareStack.identify(), [
    "trainingContentImmutableBackupCopy - build",
  ]);

  destinationExists = true;
  assert.equal(await storage.copyFromSource({
    sourceBucket: "peritio-training-content-staging",
    sourceKey: finalKey,
    destinationKey: finalKey,
  }), "already_present");
  assert.equal((await storage.headObject(finalKey))?.byteSize, 42);
  assert.equal("deleteObject" in storage, false);
  assert.equal("listObjects" in storage, false);
  assert.equal("createPresignedAccess" in storage, false);
});

test("normal cleanup remains isolated from backup storage", async () => {
  const cleanupSource = await readFile(
    new URL("../services/trainingContentCleanup.ts", import.meta.url),
    "utf8"
  );
  const cleanupScript = await readFile(
    new URL("../../scripts/cleanup-training-content-storage.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(cleanupSource, /BackupStorage|backupStorage|BACKUP_R2_BUCKET/);
  assert.doesNotMatch(cleanupScript, /BackupStorage|backupStorage|BACKUP_R2_BUCKET/);
  assert.match(cleanupScript, /createTrainingContentObjectStorage/);
});
