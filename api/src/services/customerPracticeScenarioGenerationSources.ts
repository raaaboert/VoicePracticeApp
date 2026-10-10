import type { TrainingContentItem } from "@voicepractice/shared";

import { resolveCustomerPracticeScenarioSourceReferences } from "./customerPracticeScenarioSources.js";
import {
  evaluateTrainingContentGenerationSource,
  TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1,
  type TrainingContentGenerationSourceKind,
} from "./trainingContentGenerationSourcePolicy.js";
import { extractDocxGenerationText, extractPdfGenerationText } from "./trainingContentTextExtraction.js";
import type { TrainingContentAuthorityRecord } from "../storage/trainingContentStore.js";

export const CUSTOMER_SCENARIO_GENERATION_MAX_BUNDLE_CHARACTERS = 200_000;

export class CustomerPracticeScenarioGenerationSourceError extends Error {
  constructor(message: string, readonly code: "scenario_source_denied" | "generation_source_not_ready" | "generation_source_invalid") {
    super(message);
    this.name = "CustomerPracticeScenarioGenerationSourceError";
  }
}

export interface CustomerPracticeScenarioGenerationSourceMetadata {
  contentId: string;
  label: string;
  sourceKind: TrainingContentGenerationSourceKind;
  characterCount: number;
}

/** Internal-only payload. Its `text` must never be projected into learner, notification, or audit DTOs. */
export interface CustomerPracticeScenarioGenerationSourceBundle {
  text: string;
  sources: CustomerPracticeScenarioGenerationSourceMetadata[];
}

export async function buildCustomerPracticeScenarioGenerationSourceBundle(input: {
  orgId: string;
  homeFocusTopicId: string;
  selectedContentIds: unknown;
  actorCurrentlyAuthorized: boolean;
  moduleEnabled: boolean;
  contentAuthority: readonly TrainingContentAuthorityRecord[];
  getCurrentAsset: (contentId: string) => Promise<{ id: string; uploadState: string; finalObjectKey: string | null } | null>;
  getCurrentTranscript: (contentId: string) => Promise<{ body: string; sourceFingerprint: string } | null>;
  readAssetBytes: (objectKey: string, maximumBytes: number) => Promise<Uint8Array>;
}): Promise<CustomerPracticeScenarioGenerationSourceBundle> {
  if (!input.actorCurrentlyAuthorized) {
    throw new CustomerPracticeScenarioGenerationSourceError("You are not authorized to use these source resources.", "scenario_source_denied");
  }
  let references;
  try {
    references = resolveCustomerPracticeScenarioSourceReferences({ orgId: input.orgId, topicId: input.homeFocusTopicId,
      requestedContentIds: input.selectedContentIds, contentAuthority: input.contentAuthority });
  } catch {
    throw new CustomerPracticeScenarioGenerationSourceError("A selected source is not available for this Focus Topic.", "scenario_source_denied");
  }
  const records = new Map(input.contentAuthority.map((record) => [record.content.id, record]));
  const parts: string[] = []; const sources: CustomerPracticeScenarioGenerationSourceMetadata[] = [];
  for (const reference of references) {
    const contentId = reference.referenceId;
    if (!contentId) throw new CustomerPracticeScenarioGenerationSourceError("A selected source is not available for this Focus Topic.", "scenario_source_denied");
    const record = records.get(contentId);
    if (!record || record.content.orgId !== input.orgId) throw new CustomerPracticeScenarioGenerationSourceError("A selected source is not available for this Focus Topic.", "scenario_source_denied");
    const text = await prepareSourceText({ content: record.content, contentId, moduleEnabled: input.moduleEnabled,
      getCurrentAsset: input.getCurrentAsset, getCurrentTranscript: input.getCurrentTranscript, readAssetBytes: input.readAssetBytes });
    const remaining = CUSTOMER_SCENARIO_GENERATION_MAX_BUNDLE_CHARACTERS - parts.join("\n\n").length;
    if (remaining <= 0) break;
    const bounded = text.slice(0, remaining);
    parts.push(bounded);
    sources.push({ contentId, label: reference.label, sourceKind: sourceKind(record.content), characterCount: bounded.length });
  }
  if (references.length && !parts.length) throw new CustomerPracticeScenarioGenerationSourceError("No selected source is ready for generation.", "generation_source_not_ready");
  return { text: parts.join("\n\n"), sources };
}

async function prepareSourceText(input: {
  content: TrainingContentItem; contentId: string; moduleEnabled: boolean;
  getCurrentAsset: (contentId: string) => Promise<{ id: string; uploadState: string; finalObjectKey: string | null } | null>;
  getCurrentTranscript: (contentId: string) => Promise<{ body: string; sourceFingerprint: string } | null>;
  readAssetBytes: (objectKey: string, maximumBytes: number) => Promise<Uint8Array>;
}): Promise<string> {
  const [asset, transcript] = await Promise.all([input.getCurrentAsset(input.contentId), input.getCurrentTranscript(input.contentId)]);
  const eligibility = evaluateTrainingContentGenerationSource({ contentType: input.content.contentType,
    publicationState: input.content.publicationState, archivedAt: input.content.archivedAt, externalKind: input.content.externalKind,
    externalUrl: input.content.externalUrl, nativeBody: input.content.nativeBody, hasReadyPrimaryAsset: asset?.uploadState === "ready",
    currentPrimaryAssetId: asset?.id ?? null, currentTranscriptSourceFingerprint: transcript?.sourceFingerprint ?? null, moduleEnabled: input.moduleEnabled });
  if (!eligibility.eligible) throw new CustomerPracticeScenarioGenerationSourceError("A selected source is not currently ready for generation.", "generation_source_not_ready");
  if (input.content.contentType === "native") return input.content.nativeBody!.trim();
  if (input.content.contentType === "video" || (input.content.contentType === "external_url" && input.content.externalKind === "youtube")) return transcript!.body.trim();
  if ((input.content.contentType === "pdf" || input.content.contentType === "docx") && asset?.finalObjectKey) {
    const bytes = await input.readAssetBytes(asset.finalObjectKey, 12 * 1024 * 1024);
    try { return input.content.contentType === "pdf" ? extractPdfGenerationText(bytes) : await extractDocxGenerationText(bytes); }
    catch { throw new CustomerPracticeScenarioGenerationSourceError("A selected document cannot be safely prepared for generation.", "generation_source_invalid"); }
  }
  throw new CustomerPracticeScenarioGenerationSourceError("A selected source is not currently ready for generation.", "generation_source_not_ready");
}

function sourceKind(content: TrainingContentItem): TrainingContentGenerationSourceKind {
  return evaluateTrainingContentGenerationSource({ contentType: content.contentType, publicationState: content.publicationState,
    archivedAt: content.archivedAt, externalKind: content.externalKind, externalUrl: content.externalUrl, nativeBody: content.nativeBody,
    hasReadyPrimaryAsset: true, moduleEnabled: true }).sourceKind;
}

export const CUSTOMER_SCENARIO_GENERATION_SOURCE_BUNDLE_SECURITY_CONTRACT = Object.freeze({
  maximumCharacters: CUSTOMER_SCENARIO_GENERATION_MAX_BUNDLE_CHARACTERS,
  maximumPerExtraction: TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters,
  learnerDtoIncludesText: false,
  notificationsIncludeText: false,
  auditIncludesText: false,
  logsIncludeText: false,
});
