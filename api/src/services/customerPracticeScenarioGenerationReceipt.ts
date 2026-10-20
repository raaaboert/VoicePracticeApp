import { randomUUID } from "node:crypto";

import type { OrgCustomScenarioProvenance } from "@voicepractice/shared";

export const CUSTOMER_PRACTICE_SCENARIO_GENERATION_RECEIPT_TTL_MS = 15 * 60 * 1000;

export interface CustomerPracticeScenarioGenerationReceipt {
  token: string;
  actorId: string;
  orgId: string;
  topicId: string;
  segmentId: string;
  applicableIndustryIds: string[];
  sourceContentIds: string[];
  provenance: OrgCustomScenarioProvenance;
  expiresAt: number;
}

/** Stores metadata only: never source, transcript, or generated scenario text. */
export class CustomerPracticeScenarioGenerationReceiptRegistry {
  private readonly receipts = new Map<string, CustomerPracticeScenarioGenerationReceipt>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(input: Omit<CustomerPracticeScenarioGenerationReceipt, "token" | "expiresAt">): CustomerPracticeScenarioGenerationReceipt {
    this.purge();
    const receipt = { ...input, applicableIndustryIds: [...new Set(input.applicableIndustryIds)].sort(),
      sourceContentIds: [...new Set(input.sourceContentIds)], token: randomUUID(),
      expiresAt: this.now() + CUSTOMER_PRACTICE_SCENARIO_GENERATION_RECEIPT_TTL_MS };
    this.receipts.set(receipt.token, receipt);
    return receipt;
  }

  resolve(input: { token: unknown; actorId: string; orgId: string; topicId: string; sourceContentIds: readonly string[];
    segmentId: string; applicableIndustryIds: readonly string[] }): OrgCustomScenarioProvenance | null {
    this.purge();
    if (typeof input.token !== "string" || !input.token.trim()) return null;
    const receipt = this.receipts.get(input.token);
    if (!receipt || receipt.actorId !== input.actorId || receipt.orgId !== input.orgId || receipt.topicId !== input.topicId) return null;
    const industries = [...new Set(input.applicableIndustryIds)].sort();
    if (receipt.segmentId !== input.segmentId || industries.length !== receipt.applicableIndustryIds.length
      || industries.some((id, index) => id !== receipt.applicableIndustryIds[index])) return null;
    const requested = [...new Set(input.sourceContentIds)].sort();
    const recorded = [...receipt.sourceContentIds].sort();
    if (requested.length !== recorded.length || requested.some((id, index) => id !== recorded[index])) return null;
    return { ...receipt.provenance };
  }

  private purge(): void { for (const [token, receipt] of this.receipts) if (receipt.expiresAt <= this.now()) this.receipts.delete(token); }
}
