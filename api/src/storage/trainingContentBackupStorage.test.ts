import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
