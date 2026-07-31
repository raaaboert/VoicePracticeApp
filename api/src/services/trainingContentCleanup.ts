import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type {
  TrainingContentAssetCleanupCandidate,
  TrainingContentAssetStore,
} from "../storage/trainingContentAssetStore.js";
import type {
  TrainingContentObjectStorage,
  TrainingContentStoredObject,
} from "../storage/trainingContentObjectStorage.js";
import type {
  TrainingContentStorageReadinessService,
} from "./trainingContentStorageReadiness.js";

export interface TrainingContentCleanupReport {
  dryRun: boolean;
  scannedAssetCandidateCount: number;
  scannedFinalObjectCount: number;
  expiredAssetCount: number;
  temporaryObjectDeleteCount: number;
  finalObjectDeleteCount: number;
  orphanFinalObjectDeleteCount: number;
  skippedRecentOrphanCount: number;
  errors: Array<{
    category: string;
    orgId: string | null;
    assetId: string | null;
    objectKey: string | null;
  }>;
}

interface TrainingContentCleanupServiceParams {
  config: TrainingContentStorageConfig;
  assetStore: TrainingContentAssetStore;
  objectStorage: TrainingContentObjectStorage;
  readiness: TrainingContentStorageReadinessService;
}

export class TrainingContentCleanupService {
  constructor(private readonly dependencies: TrainingContentCleanupServiceParams) {}

  async run(params: {
    apply?: boolean;
    now?: Date;
    limit?: number;
  } = {}): Promise<TrainingContentCleanupReport> {
    const apply = params.apply === true;
    const now = params.now ?? new Date();
    const readiness = this.dependencies.readiness.isAvailable()
      ? this.dependencies.readiness.getStatus()
      : await this.dependencies.readiness.refresh(now);
    if (!readiness.available) {
      throw new Error("Training Content storage is unavailable; cleanup did not run.");
    }

    const supersededBefore = new Date(
      now.getTime() - this.dependencies.config.supersededRetentionDays * 24 * 60 * 60 * 1000
    );
    const candidates = await this.dependencies.assetStore.listCleanupCandidates({
      now,
      supersededBefore,
      limit: params.limit,
    });
    const report: TrainingContentCleanupReport = {
      dryRun: !apply,
      scannedAssetCandidateCount: candidates.length,
      scannedFinalObjectCount: 0,
      expiredAssetCount: 0,
      temporaryObjectDeleteCount: 0,
      finalObjectDeleteCount: 0,
      orphanFinalObjectDeleteCount: 0,
      skippedRecentOrphanCount: 0,
      errors: [],
    };

    for (const candidate of candidates) {
      await this.processCandidate(candidate, apply, now, report);
    }
    await this.processUnreferencedFinalObjects(apply, now, report);
    return report;
  }

  private async processCandidate(
    candidate: TrainingContentAssetCleanupCandidate,
    apply: boolean,
    now: Date,
    report: TrainingContentCleanupReport
  ): Promise<void> {
    const asset = candidate.asset;
    try {
      if (candidate.reason === "expired_pending") {
        report.expiredAssetCount += 1;
        if (apply) {
          await this.dependencies.assetStore.expirePendingAsset({
            orgId: asset.orgId,
            assetId: asset.id,
            actor: { actorType: "system", actorId: "training_content_cleanup" },
            now,
          });
        }
        if (asset.temporaryObjectKey) {
          report.temporaryObjectDeleteCount += 1;
          if (apply) {
            await this.dependencies.objectStorage.deleteObject(asset.temporaryObjectKey);
            await this.dependencies.assetStore.clearTemporaryObject({
              orgId: asset.orgId,
              assetId: asset.id,
              expectedTemporaryObjectKey: asset.temporaryObjectKey,
              now,
            });
          }
        }
        return;
      }

      if (
        candidate.reason === "temporary_after_finalization"
        || candidate.reason === "terminal_temporary"
      ) {
        if (!asset.temporaryObjectKey) {
          return;
        }
        report.temporaryObjectDeleteCount += 1;
        if (apply) {
          await this.dependencies.objectStorage.deleteObject(asset.temporaryObjectKey);
          await this.dependencies.assetStore.clearTemporaryObject({
            orgId: asset.orgId,
            assetId: asset.id,
            expectedTemporaryObjectKey: asset.temporaryObjectKey,
            now,
          });
        }
        return;
      }

      if (candidate.reason === "terminal_final" || candidate.reason === "superseded_retention") {
        if (!asset.finalObjectKey || asset.isCurrent || asset.uploadState === "ready") {
          return;
        }
        report.finalObjectDeleteCount += 1;
        if (apply) {
          await this.dependencies.objectStorage.deleteObject(asset.finalObjectKey);
          await this.dependencies.assetStore.markFinalObjectDeleted({
            orgId: asset.orgId,
            assetId: asset.id,
            expectedFinalObjectKey: asset.finalObjectKey,
            now,
          });
        }
      }
    } catch {
      report.errors.push({
        category: candidate.reason,
        orgId: asset.orgId,
        assetId: asset.id,
        objectKey: asset.temporaryObjectKey ?? asset.finalObjectKey,
      });
    }
  }

  private async processUnreferencedFinalObjects(
    apply: boolean,
    now: Date,
    report: TrainingContentCleanupReport
  ): Promise<void> {
    const referencedKeys = await this.dependencies.assetStore.listReferencedFinalObjectKeys();
    const orphanCutoff = now.getTime() - this.dependencies.config.orphanGracePeriodSeconds * 1000;
    let continuationToken: string | null = null;
    let pageCount = 0;

    do {
      const page = await this.dependencies.objectStorage.listObjects({
        prefix: "objects/",
        continuationToken,
        maximumKeys: 500,
      });
      pageCount += 1;
      report.scannedFinalObjectCount += page.objects.length;
      for (const object of page.objects) {
        if (referencedKeys.has(object.key)) {
          continue;
        }
        if (!isOlderThan(object, orphanCutoff)) {
          report.skippedRecentOrphanCount += 1;
          continue;
        }
        report.orphanFinalObjectDeleteCount += 1;
        if (apply) {
          try {
            const currentReferences =
              await this.dependencies.assetStore.listReferencedFinalObjectKeys();
            if (!currentReferences.has(object.key)) {
              await this.dependencies.objectStorage.deleteObject(object.key);
            }
          } catch {
            report.errors.push({
              category: "unreferenced_final",
              orgId: null,
              assetId: null,
              objectKey: object.key,
            });
          }
        }
      }
      continuationToken = page.continuationToken;
    } while (continuationToken && pageCount < 20);
  }
}

function isOlderThan(object: TrainingContentStoredObject, cutoffTime: number): boolean {
  if (!object.lastModified) {
    return false;
  }
  const modifiedAt = new Date(object.lastModified).getTime();
  return Number.isFinite(modifiedAt) && modifiedAt <= cutoffTime;
}
