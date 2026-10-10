import type { CustomerPracticeScenarioSourceReference } from "@voicepractice/shared";
import type { TrainingContentAuthorityRecord } from "../storage/trainingContentStore.js";

export class CustomerPracticeScenarioSourceError extends Error {
  constructor(message: string, readonly code = "scenario_source_invalid") {
    super(message);
    this.name = "CustomerPracticeScenarioSourceError";
  }
}

export function resolveCustomerPracticeScenarioSourceReferences(input: {
  orgId: string;
  topicId: string;
  requestedContentIds: unknown;
  contentAuthority: readonly TrainingContentAuthorityRecord[];
}): CustomerPracticeScenarioSourceReference[] {
  const requested = Array.isArray(input.requestedContentIds)
    ? [...new Set(input.requestedContentIds.filter((value): value is string => typeof value === "string")
      .map((value) => value.trim()).filter(Boolean))]
    : [];
  if (requested.length > 24) {
    throw new CustomerPracticeScenarioSourceError("Select no more than 24 source resources.");
  }
  const byId = new Map(input.contentAuthority.map((record) => [record.content.id, record]));
  return requested.map((contentId) => {
    const record = byId.get(contentId);
    const attached = record?.topicAttachments.some((attachment) =>
      attachment.topicId === input.topicId && attachment.detachedAt === null);
    if (!record || record.content.orgId !== input.orgId || !attached
      || record.content.archivedAt !== null || record.categoryArchivedAt !== null) {
      throw new CustomerPracticeScenarioSourceError(
        "Each source resource must be a current Related Content item for this Focus Topic.",
      );
    }
    return { kind: "training_content" as const, referenceId: contentId, label: record.content.title };
  });
}
