import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { TrainingContentStoredObject } from "./trainingContentObjectStorage.js";

export type TrainingContentBackupCopyResult = "copied" | "already_present";

export interface TrainingContentBackupObjectStorage {
  copyFromSource(params: {
    sourceBucket: string;
    sourceKey: string;
    destinationKey: string;
    signal?: AbortSignal;
  }): Promise<TrainingContentBackupCopyResult>;
  headObject(key: string, signal?: AbortSignal): Promise<TrainingContentStoredObject | null>;
}

interface R2Client {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

interface R2BackupStorageOptions {
  client?: R2Client;
}

class DisabledTrainingContentBackupStorage implements TrainingContentBackupObjectStorage {
  async copyFromSource(): Promise<TrainingContentBackupCopyResult> {
    throw new Error("Training Content backup is disabled.");
  }

  async headObject(): Promise<TrainingContentStoredObject | null> {
    throw new Error("Training Content backup is disabled.");
  }
}

export class R2TrainingContentBackupStorage implements TrainingContentBackupObjectStorage {
  private readonly client: R2Client;
  private readonly destinationBucket: string;

  constructor(
    config: NonNullable<TrainingContentStorageConfig["backup"]["r2"]>,
    options: R2BackupStorageOptions = {}
  ) {
    this.destinationBucket = config.bucket;
    this.client = options.client ?? new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async copyFromSource(params: {
    sourceBucket: string;
    sourceKey: string;
    destinationKey: string;
    signal?: AbortSignal;
  }): Promise<TrainingContentBackupCopyResult> {
    const sourceBucket = normalizeBucket(params.sourceBucket);
    const sourceKey = normalizeObjectKey(params.sourceKey);
    const destinationKey = normalizeObjectKey(params.destinationKey);
    const command = new CopyObjectCommand({
      Bucket: this.destinationBucket,
      Key: destinationKey,
      CopySource: encodeCopySource(sourceBucket, sourceKey),
      MetadataDirective: "COPY",
    });
    command.middlewareStack.add(
      (next) => async (args) => {
        const request = args.request as { headers?: Record<string, string> };
        if (!request.headers) {
          throw new Error("R2 immutable backup request headers are unavailable.");
        }
        request.headers["cf-copy-destination-if-none-match"] = "*";
        return next(args);
      },
      {
        step: "build",
        name: "trainingContentImmutableBackupCopy",
        priority: "low",
      }
    );
    try {
      await this.client.send(command, { abortSignal: params.signal });
      return "copied";
    } catch (error) {
      if (isPreconditionFailedError(error)) {
        return "already_present";
      }
      throw error;
    }
  }

  async headObject(key: string, signal?: AbortSignal): Promise<TrainingContentStoredObject | null> {
    const normalizedKey = normalizeObjectKey(key);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.destinationBucket,
          Key: normalizedKey,
        }),
        { abortSignal: signal }
      );
      return {
        key: normalizedKey,
        byteSize: normalizeContentLength(result.ContentLength),
        contentType: normalizeOptionalString(result.ContentType),
        etag: normalizeOptionalString(result.ETag),
        lastModified: normalizeDate(result.LastModified),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function normalizeBucket(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error("Source bucket is invalid.");
  }
  return normalized;
}

function normalizeObjectKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\\")
    || normalized.includes("\0")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Object key is invalid.");
  }
  return normalized;
}

function encodeCopySource(bucket: string, key: string): string {
  return `/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeContentLength(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Backup storage returned an invalid content length.");
  }
  return parsed;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return candidate?.name === "NotFound"
    || candidate?.name === "NoSuchKey"
    || candidate?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailedError(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return candidate?.name === "PreconditionFailed"
    || candidate?.$metadata?.httpStatusCode === 412;
}

export function createTrainingContentBackupStorage(
  config: TrainingContentStorageConfig
): TrainingContentBackupObjectStorage {
  if (!config.backup.enabled) {
    return new DisabledTrainingContentBackupStorage();
  }
  if (!config.backup.r2) {
    throw new Error("Validated Training Content backup configuration is missing.");
  }
  return new R2TrainingContentBackupStorage(config.backup.r2);
}
