import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";

export interface TrainingContentStoredObject {
  key: string;
  byteSize: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface TrainingContentObjectListPage {
  objects: TrainingContentStoredObject[];
  continuationToken: string | null;
}

export interface TrainingContentPresignedRequest {
  url: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface TrainingContentObjectStorage {
  readonly provider: "disabled" | "r2";
  verifyReadiness(): Promise<void>;
  createPresignedUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<TrainingContentPresignedRequest>;
  headObject(key: string): Promise<TrainingContentStoredObject | null>;
  readObjectRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;
  readObjectBytes(key: string, maximumBytes: number): Promise<Uint8Array>;
  copyObject(params: { sourceKey: string; destinationKey: string }): Promise<void>;
  deleteObject(key: string): Promise<void>;
  createPresignedAccess(params: {
    key: string;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<TrainingContentPresignedRequest>;
  listObjects(params: {
    prefix: string;
    continuationToken?: string | null;
    maximumKeys?: number;
  }): Promise<TrainingContentObjectListPage>;
}

export class TrainingContentObjectStorageUnavailableError extends Error {
  readonly code = "training_content_storage_unavailable";

  constructor(message = "Training Content object storage is unavailable.") {
    super(message);
    this.name = "TrainingContentObjectStorageUnavailableError";
  }
}

class DisabledTrainingContentObjectStorage implements TrainingContentObjectStorage {
  readonly provider = "disabled" as const;

  async verifyReadiness(): Promise<void> {
    throw new TrainingContentObjectStorageUnavailableError(
      "Training Content object storage is not configured."
    );
  }

  async createPresignedUpload(): Promise<TrainingContentPresignedRequest> {
    return this.unavailable();
  }

  async headObject(): Promise<TrainingContentStoredObject | null> {
    return this.unavailable();
  }

  async readObjectRange(): Promise<Uint8Array> {
    return this.unavailable();
  }

  async readObjectBytes(): Promise<Uint8Array> {
    return this.unavailable();
  }

  async copyObject(): Promise<void> {
    return this.unavailable();
  }

  async deleteObject(): Promise<void> {
    return this.unavailable();
  }

  async createPresignedAccess(): Promise<TrainingContentPresignedRequest> {
    return this.unavailable();
  }

  async listObjects(): Promise<TrainingContentObjectListPage> {
    return this.unavailable();
  }

  private unavailable<T>(): T {
    throw new TrainingContentObjectStorageUnavailableError(
      "Training Content object storage is not configured."
    );
  }
}

interface R2Client {
  send(command: unknown): Promise<any>;
}

type Presigner = (
  client: R2Client,
  command: unknown,
  options: { expiresIn: number }
) => Promise<string>;

interface R2StorageOptions {
  client?: R2Client;
  presigner?: Presigner;
}

export class R2TrainingContentObjectStorage implements TrainingContentObjectStorage {
  readonly provider = "r2" as const;
  private readonly client: R2Client;
  private readonly presigner: Presigner;
  private readonly bucket: string;

  constructor(config: NonNullable<TrainingContentStorageConfig["r2"]>, options: R2StorageOptions = {}) {
    this.bucket = config.bucket;
    this.client = options.client ?? new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.presigner = options.presigner ?? (getSignedUrl as Presigner);
  }

  async verifyReadiness(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createPresignedUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<TrainingContentPresignedRequest> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: normalizeObjectKey(params.key),
      ContentType: params.contentType,
      ContentLength: requirePositiveInteger(params.contentLength, "Upload content length"),
    });
    const expiresInSeconds = requirePositiveInteger(params.expiresInSeconds, "Upload URL TTL");
    const url = await this.presigner(this.client, command, { expiresIn: expiresInSeconds });
    return {
      url,
      expiresAt: addSeconds(params.now ?? new Date(), expiresInSeconds),
      requiredHeaders: {
        "content-type": params.contentType,
      },
    };
  }

  async headObject(key: string): Promise<TrainingContentStoredObject | null> {
    const normalizedKey = normalizeObjectKey(key);
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
      }));
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

  async readObjectRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(endInclusive) || endInclusive < start) {
      throw new Error("Object byte range is invalid.");
    }
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizeObjectKey(key),
      Range: `bytes=${start}-${endInclusive}`,
    }));
    return readSdkBody(result.Body);
  }

  async readObjectBytes(key: string, maximumBytes: number): Promise<Uint8Array> {
    const boundedMaximum = requirePositiveInteger(maximumBytes, "Maximum object bytes");
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizeObjectKey(key),
      Range: `bytes=0-${boundedMaximum - 1}`,
    }));
    const bytes = await readSdkBody(result.Body);
    if (bytes.byteLength > boundedMaximum) {
      throw new Error("Object read exceeded the configured byte limit.");
    }
    return bytes;
  }

  async copyObject(params: { sourceKey: string; destinationKey: string }): Promise<void> {
    const sourceKey = normalizeObjectKey(params.sourceKey);
    const destinationKey = normalizeObjectKey(params.destinationKey);
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destinationKey,
      CopySource: encodeCopySource(this.bucket, sourceKey),
      MetadataDirective: "COPY",
    });
    command.middlewareStack.add(
      (next) => async (args) => {
        const request = args.request as { headers?: Record<string, string> };
        if (!request.headers) {
          throw new Error("R2 immutable copy request headers are unavailable.");
        }
        request.headers["cf-copy-destination-if-none-match"] = "*";
        return next(args);
      },
      {
        step: "build",
        name: "trainingContentImmutableCopy",
        priority: "low",
      }
    );
    try {
      await this.client.send(command);
    } catch (error) {
      if (!isPreconditionFailedError(error)) {
        throw error;
      }
      // A previous attempt already committed this immutable key. Callers verify its bytes.
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: normalizeObjectKey(key),
    }));
  }

  async createPresignedAccess(params: {
    key: string;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<TrainingContentPresignedRequest> {
    const expiresInSeconds = requirePositiveInteger(params.expiresInSeconds, "Access URL TTL");
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizeObjectKey(params.key),
    });
    const url = await this.presigner(this.client, command, { expiresIn: expiresInSeconds });
    return {
      url,
      expiresAt: addSeconds(params.now ?? new Date(), expiresInSeconds),
      requiredHeaders: {},
    };
  }

  async listObjects(params: {
    prefix: string;
    continuationToken?: string | null;
    maximumKeys?: number;
  }): Promise<TrainingContentObjectListPage> {
    const maximumKeys = Math.max(1, Math.min(1000, params.maximumKeys ?? 500));
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: normalizeObjectPrefix(params.prefix),
      ContinuationToken: params.continuationToken ?? undefined,
      MaxKeys: maximumKeys,
    }));
    return {
      objects: (result.Contents ?? [])
        .filter((entry: any) => typeof entry.Key === "string" && entry.Key)
        .map((entry: any) => ({
          key: entry.Key,
          byteSize: normalizeContentLength(entry.Size),
          contentType: null,
          etag: normalizeOptionalString(entry.ETag),
          lastModified: normalizeDate(entry.LastModified),
        })),
      continuationToken: result.IsTruncated
        ? normalizeOptionalString(result.NextContinuationToken)
        : null,
    };
  }
}

function normalizeObjectKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.endsWith("/")
    || normalized.includes("\\")
    || normalized.includes("\0")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Object key is invalid.");
  }
  return normalized;
}

function normalizeObjectPrefix(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error("Object prefix is invalid.");
  }
  return normalized;
}

function encodeCopySource(bucket: string, key: string): string {
  return `/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function addSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function normalizeContentLength(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Object storage returned an invalid content length.");
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

async function readSdkBody(body: unknown): Promise<Uint8Array> {
  const candidate = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  } | null;
  if (!candidate?.transformToByteArray) {
    throw new Error("Object storage did not return a readable response body.");
  }
  return candidate.transformToByteArray();
}

export function createTrainingContentObjectStorage(
  config: TrainingContentStorageConfig
): TrainingContentObjectStorage {
  if (config.provider === "r2") {
    if (!config.r2) {
      throw new Error("Validated R2 configuration is missing.");
    }
    return new R2TrainingContentObjectStorage(config.r2);
  }
  return new DisabledTrainingContentObjectStorage();
}
