import assert from "node:assert/strict";
import test from "node:test";

import {
  R2TrainingContentObjectStorage,
} from "./trainingContentObjectStorage.js";
import {
  createTrainingContentFinalObjectKey,
  createTrainingContentFinalizationNonce,
  createTrainingContentTemporaryObjectKey,
} from "./trainingContentObjectKeys.js";
import { TrainingContentStorageReadinessService } from "../services/trainingContentStorageReadiness.js";
import { loadTrainingContentStorageConfig } from "../trainingContentStorageConfig.js";

const R2_CONFIG = {
  environment: "staging" as const,
  accountId: "abc123",
  bucket: "peritio-training-content-staging",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: "https://abc123.r2.cloudflarestorage.com",
};

test("Training Content object keys are server-generated, tenant-readable, random, and traversal-safe", () => {
  const first = createTrainingContentTemporaryObjectKey({
    orgId: "org/../../a",
    contentId: "11111111-1111-4111-8111-111111111111",
    assetId: "22222222-2222-4222-8222-222222222222",
  });
  const second = createTrainingContentTemporaryObjectKey({
    orgId: "org/../../a",
    contentId: "11111111-1111-4111-8111-111111111111",
    assetId: "22222222-2222-4222-8222-222222222222",
  });
  assert.match(first, /^tmp\//);
  assert.notEqual(first, second);
  assert.equal(first.includes(".."), false);
  assert.equal(first.includes("\\"), false);

  const nonce = createTrainingContentFinalizationNonce();
  const finalKey = createTrainingContentFinalObjectKey({
    orgId: "org_a",
    contentId: "11111111-1111-4111-8111-111111111111",
    assetRole: "primary",
    version: 2,
    finalizationNonce: nonce,
  });
  assert.match(finalKey, /^objects\/org_a-/);
  assert.match(finalKey, /\/primary\/2\//);
  assert.equal(finalKey.endsWith(nonce), true);
});

test("R2 adapter signs bounded PUT and GET operations without returning raw configuration", async () => {
  const commands: any[] = [];
  const signed: Array<{ command: any; expiresIn: number }> = [];
  let copyDestinationExists = false;
  const storage = new R2TrainingContentObjectStorage(R2_CONFIG, {
    client: {
      async send(command: any) {
        commands.push(command);
        if (command.constructor.name === "HeadBucketCommand") {
          return {};
        }
        if (command.constructor.name === "HeadObjectCommand") {
          return {
            ContentLength: 12,
            ContentType: "application/pdf",
            ETag: "\"etag\"",
            LastModified: new Date("2026-07-28T00:00:00.000Z"),
          };
        }
        if (command.constructor.name === "GetObjectCommand") {
          return {
            Body: {
              async transformToByteArray() {
                return new Uint8Array([1, 2, 3]);
              },
            },
          };
        }
        if (command.constructor.name === "ListObjectsV2Command") {
          return {
            Contents: [{
              Key: "objects/org/content/primary/1/key",
              Size: 12,
              ETag: "\"etag\"",
              LastModified: new Date("2026-07-28T00:00:00.000Z"),
            }],
            IsTruncated: false,
          };
        }
        if (command.constructor.name === "CopyObjectCommand" && copyDestinationExists) {
          throw {
            name: "PreconditionFailed",
            $metadata: { httpStatusCode: 412 },
          };
        }
        return {};
      },
    },
    presigner: async (_client, command, options) => {
      signed.push({ command, expiresIn: options.expiresIn });
      return `https://signed.invalid/${signed.length}`;
    },
  });

  await storage.verifyReadiness();
  const upload = await storage.createPresignedUpload({
    key: "tmp/org/content/asset/nonce",
    contentType: "application/pdf",
    contentLength: 12,
    expiresInSeconds: 600,
    now: new Date("2026-07-28T00:00:00.000Z"),
  });
  assert.deepEqual(upload, {
    url: "https://signed.invalid/1",
    expiresAt: "2026-07-28T00:10:00.000Z",
    requiredHeaders: {
      "content-type": "application/pdf",
    },
  });
  assert.equal(signed[0]?.command.input.Bucket, R2_CONFIG.bucket);
  assert.equal(signed[0]?.command.input.Key, "tmp/org/content/asset/nonce");
  assert.equal(signed[0]?.command.input.ContentLength, 12);

  const access = await storage.createPresignedAccess({
    key: "objects/org/content/primary/1/nonce",
    expiresInSeconds: 300,
    now: new Date("2026-07-28T00:00:00.000Z"),
  });
  assert.equal(access.expiresAt, "2026-07-28T00:05:00.000Z");
  assert.equal(signed[1]?.expiresIn, 300);

  assert.equal((await storage.headObject("objects/org/content/primary/1/nonce"))?.byteSize, 12);
  assert.deepEqual(
    Array.from(await storage.readObjectRange("objects/org/content/primary/1/nonce", 0, 2)),
    [1, 2, 3]
  );
  await storage.copyObject({
    sourceKey: "tmp/org/content/asset/nonce",
    destinationKey: "objects/org/content/primary/1/nonce",
  });
  const copyCommand = commands.find((command) => command.constructor.name === "CopyObjectCommand");
  assert.equal(copyCommand?.input.CopySource, "/peritio-training-content-staging/tmp/org/content/asset/nonce");
  assert.deepEqual(copyCommand?.middlewareStack.identify(), [
    "trainingContentImmutableCopy - build",
  ]);
  copyDestinationExists = true;
  await assert.doesNotReject(storage.copyObject({
    sourceKey: "tmp/org/content/asset/nonce",
    destinationKey: "objects/org/content/primary/1/nonce",
  }));
  const listed = await storage.listObjects({ prefix: "objects/" });
  assert.equal(listed.objects.length, 1);
  assert.equal(commands.some((command) => command.constructor.name === "HeadBucketCommand"), true);

  const responseJson = JSON.stringify({ upload, access });
  assert.equal(responseJson.includes(R2_CONFIG.accessKeyId), false);
  assert.equal(responseJson.includes(R2_CONFIG.secretAccessKey), false);
  assert.equal(responseJson.includes(R2_CONFIG.endpoint), false);
  assert.equal(responseJson.includes(R2_CONFIG.bucket), false);
});

test("storage readiness exposes only structured availability and recovers on a later check", async () => {
  let fail = true;
  const config = loadTrainingContentStorageConfig({
    TRAINING_CONTENT_STORAGE_PROVIDER: "r2",
    TRAINING_CONTENT_R2_ENVIRONMENT: "staging",
    TRAINING_CONTENT_R2_ACCOUNT_ID: "abc123",
    TRAINING_CONTENT_R2_BUCKET: "peritio-training-content-staging",
    TRAINING_CONTENT_R2_ACCESS_KEY_ID: "test-access-key",
    TRAINING_CONTENT_R2_SECRET_ACCESS_KEY: "test-secret-key",
    TRAINING_CONTENT_R2_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  }, "staging");
  const readiness = new TrainingContentStorageReadinessService(config, {
    provider: "r2",
    async verifyReadiness() {
      if (fail) {
        throw new Error("provider error containing a secret");
      }
    },
  } as any);

  const unavailable = await readiness.refresh(new Date("2026-07-28T00:00:00.000Z"));
  assert.deepEqual(unavailable, {
    enabled: true,
    available: false,
    provider: "r2",
    environment: "staging",
    checkedAt: "2026-07-28T00:00:00.000Z",
    code: "storage_unavailable",
  });
  fail = false;
  const available = await readiness.refresh(new Date("2026-07-28T00:01:00.000Z"));
  assert.equal(available.available, true);
  assert.equal(available.code, "storage_ready");
});
