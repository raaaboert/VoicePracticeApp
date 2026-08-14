import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type {
  TrainingContentAssetRecord,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentBackupObjectStorage,
} from "../storage/trainingContentBackupStorage.js";

export type TrainingContentBackupOutcome =
  | "disabled"
  | "skipped"
  | "copied"
  | "already_present"
  | "failed";

export interface TrainingContentBackupReconciliationReport {
  scanned: number;
  backedUp: number;
  alreadyPresent: number;
  failed: number;
  stillPending: number;
}

export interface TrainingContentBackupService {
  backupFinalizedAsset(asset: TrainingContentAssetRecord): Promise<TrainingContentBackupOutcome>;
  reconcilePendingBackups(limit: number): Promise<TrainingContentBackupReconciliationReport>;
}

interface TrainingContentBackupDependencies {
  config: TrainingContentStorageConfig;
  assetStore: TrainingContentAssetStore;
  backupStorage: TrainingContentBackupObjectStorage;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn">;
}

export class DefaultTrainingContentBackupService implements TrainingContentBackupService {
  private readonly logger: Pick<Console, "info" | "warn">;

  constructor(private readonly dependencies: TrainingContentBackupDependencies) {
    this.logger = dependencies.logger ?? console;
  }

  async backupFinalizedAsset(
    asset: TrainingContentAssetRecord
  ): Promise<TrainingContentBackupOutcome> {
    if (!this.dependencies.config.backup.enabled) {
      return "disabled";
    }
    if (
      asset.uploadState !== "ready"
      || !asset.finalObjectKey
      || asset.backedUpAt
      || !this.dependencies.config.r2
    ) {
      return "skipped";
    }

    try {
      const copyResult = await this.dependencies.backupStorage.copyFromSource({
        sourceBucket: this.dependencies.config.r2.bucket,
        sourceKey: asset.finalObjectKey,
        destinationKey: asset.finalObjectKey,
      });
      const stored = await this.dependencies.backupStorage.headObject(asset.finalObjectKey);
      if (!stored || (asset.byteSize !== null && stored.byteSize !== asset.byteSize)) {
        throw new Error("backup_object_confirmation_failed");
      }
      await this.dependencies.assetStore.markAssetBackedUp(
        asset.id,
        this.dependencies.now?.() ?? new Date()
      );
      this.logger.info(
        `[training-content-backup] outcome=${copyResult} assetId=${asset.id} orgId=${asset.orgId} byteSize=${stored.byteSize}`
      );
      return copyResult;
    } catch (error) {
      let attemptCount = asset.backupAttemptCount + 1;
      try {
        const recorded = await this.dependencies.assetStore.recordBackupFailure(
          asset.id,
          this.dependencies.now?.() ?? new Date()
        );
        attemptCount = recorded.backupAttemptCount;
      } catch {
        // The ready asset remains usable even if recording the retry state also fails.
      }
      const diagnostics = describeBackupError(error, [
        asset.finalObjectKey,
        asset.originalFilename,
        this.dependencies.config.r2?.bucket,
        this.dependencies.config.r2?.endpoint,
        this.dependencies.config.r2?.accessKeyId,
        this.dependencies.config.r2?.secretAccessKey,
        this.dependencies.config.backup.r2?.bucket,
        this.dependencies.config.backup.r2?.endpoint,
        this.dependencies.config.backup.r2?.accessKeyId,
        this.dependencies.config.backup.r2?.secretAccessKey,
      ]);
      this.logger.warn(
        `[training-content-backup] outcome=failed assetId=${asset.id} orgId=${asset.orgId} category=${diagnostics.category}${formatProviderDiagnostics(diagnostics)} attemptCount=${attemptCount}`
      );
      return "failed";
    }
  }

  async reconcilePendingBackups(
    limit: number
  ): Promise<TrainingContentBackupReconciliationReport> {
    const pending = await this.dependencies.assetStore.listAssetsPendingBackup(limit);
    let backedUp = 0;
    let alreadyPresent = 0;
    let failed = 0;
    for (const asset of pending) {
      const outcome = await this.backupFinalizedAsset(asset);
      if (outcome === "copied") {
        backedUp += 1;
      } else if (outcome === "already_present") {
        alreadyPresent += 1;
      } else if (outcome === "failed") {
        failed += 1;
      }
    }
    return {
      scanned: pending.length,
      backedUp,
      alreadyPresent,
      failed,
      stillPending: await this.dependencies.assetStore.countAssetsPendingBackup(),
    };
  }
}

export async function backupFinalizedAssetBestEffort(
  backup: Pick<TrainingContentBackupService, "backupFinalizedAsset"> | undefined,
  asset: TrainingContentAssetRecord
): Promise<void> {
  if (!backup) {
    return;
  }
  try {
    await backup.backupFinalizedAsset(asset);
  } catch {
    // This boundary protects finalization even if a custom backup implementation violates its contract.
  }
}

interface BackupErrorDiagnostics {
  category: string;
  providerCode: string | null;
  providerMessage: string | null;
  requestId: string | null;
}

function describeBackupError(
  error: unknown,
  sensitiveValues: Array<string | null | undefined>
): BackupErrorDiagnostics {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    Code?: unknown;
    Message?: unknown;
    RequestId?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
  } | null;
  const status = candidate?.$metadata?.httpStatusCode;
  const providerCode = normalizeDiagnosticToken(candidate?.Code)
    ?? (status !== undefined ? normalizeDiagnosticToken(candidate?.name) : null);
  const requestId = normalizeDiagnosticToken(
    candidate?.$metadata?.requestId ?? candidate?.RequestId,
    false
  );
  const hasProviderDiagnostics = typeof status === "number"
    || providerCode !== null
    || requestId !== null;
  return {
    category: categorizeBackupError(error),
    providerCode,
    providerMessage: hasProviderDiagnostics
      ? sanitizeProviderMessage(candidate?.Message ?? candidate?.message, sensitiveValues)
      : null,
    requestId,
  };
}

function categorizeBackupError(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]{1,80}$/i.test(error.message)) {
    return error.message.toLowerCase();
  }
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  if (typeof candidate?.$metadata?.httpStatusCode === "number") {
    return `provider_http_${candidate.$metadata.httpStatusCode}`;
  }
  if (typeof candidate?.name === "string" && /^[a-z0-9_]{1,80}$/i.test(candidate.name)) {
    return candidate.name.toLowerCase();
  }
  return "provider_error";
}

function normalizeDiagnosticToken(value: unknown, lowercase = true): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^[a-z0-9._:-]{1,160}$/i.test(normalized)) {
    return null;
  }
  return lowercase ? normalized.toLowerCase() : normalized;
}

function sanitizeProviderMessage(
  value: unknown,
  sensitiveValues: Array<string | null | undefined>
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) {
    return null;
  }
  const redactions = new Set<string>();
  for (const candidate of sensitiveValues) {
    if (!candidate) {
      continue;
    }
    redactions.add(candidate);
    redactions.add(encodeURIComponent(candidate));
    redactions.add(candidate.split("/").map(encodeURIComponent).join("/"));
  }
  for (const redaction of [...redactions].sort((left, right) => right.length - left.length)) {
    if (redaction.length < 3) {
      continue;
    }
    sanitized = sanitized.replace(new RegExp(escapeRegExp(redaction), "gi"), "[redacted]");
  }
  sanitized = sanitized
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(?:%2f|[\\/])[^\s"',;]*/gi, "[redacted-path]")
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 240)
    .trim();
  return sanitized || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatProviderDiagnostics(diagnostics: BackupErrorDiagnostics): string {
  const fields: string[] = [];
  if (diagnostics.providerCode) {
    fields.push(`providerCode=${diagnostics.providerCode}`);
  }
  if (diagnostics.providerMessage) {
    fields.push(`providerMessage=${JSON.stringify(diagnostics.providerMessage)}`);
  }
  if (diagnostics.requestId) {
    fields.push(`requestId=${diagnostics.requestId}`);
  }
  return fields.length ? ` ${fields.join(" ")}` : "";
}

export function createTrainingContentBackupService(
  dependencies: TrainingContentBackupDependencies
): TrainingContentBackupService {
  return new DefaultTrainingContentBackupService(dependencies);
}
