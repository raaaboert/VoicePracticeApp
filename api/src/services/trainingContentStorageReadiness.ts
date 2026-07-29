import type { TrainingContentStorageConfig } from "../trainingContentStorageConfig.js";
import type { TrainingContentObjectStorage } from "../storage/trainingContentObjectStorage.js";

export interface TrainingContentStorageReadinessStatus {
  enabled: boolean;
  available: boolean;
  provider: "disabled" | "r2";
  environment: string | null;
  checkedAt: string;
  code: "storage_disabled" | "storage_ready" | "storage_unavailable";
}

export class TrainingContentStorageReadinessService {
  private status: TrainingContentStorageReadinessStatus;

  constructor(
    private readonly config: TrainingContentStorageConfig,
    private readonly storage: TrainingContentObjectStorage
  ) {
    this.status = {
      enabled: config.provider !== "disabled",
      available: false,
      provider: config.provider,
      environment: config.r2?.environment ?? null,
      checkedAt: new Date(0).toISOString(),
      code: config.provider === "disabled" ? "storage_disabled" : "storage_unavailable",
    };
  }

  getStatus(): TrainingContentStorageReadinessStatus {
    return { ...this.status };
  }

  async refresh(now = new Date()): Promise<TrainingContentStorageReadinessStatus> {
    if (this.config.provider === "disabled") {
      this.status = {
        enabled: false,
        available: false,
        provider: "disabled",
        environment: null,
        checkedAt: now.toISOString(),
        code: "storage_disabled",
      };
      return this.getStatus();
    }

    try {
      await this.storage.verifyReadiness();
      this.status = {
        enabled: true,
        available: true,
        provider: this.config.provider,
        environment: this.config.r2?.environment ?? null,
        checkedAt: now.toISOString(),
        code: "storage_ready",
      };
    } catch {
      this.status = {
        enabled: true,
        available: false,
        provider: this.config.provider,
        environment: this.config.r2?.environment ?? null,
        checkedAt: now.toISOString(),
        code: "storage_unavailable",
      };
    }
    return this.getStatus();
  }

  isAvailable(): boolean {
    return this.status.available;
  }
}
