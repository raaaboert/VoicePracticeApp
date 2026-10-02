import type {
  MobileFocusTopicCatalogItem,
  MobileFocusTopicCatalogResponse,
  MobileFocusTopicDetailResponse,
  MobileFocusTopicScenarioSummary,
  MobileTrainingContentSummary,
  TrainingContentType,
  UserProfile,
} from "@voicepractice/shared";

import { MobileApiError } from "../lib/apiError";

export const FOCUS_TOPICS_EMPTY_MESSAGE =
  "No Focus Topics are available right now.";

export interface FocusTopicNavigationSummary {
  id: string;
  name: string;
  description: string;
  scenarioCount: number;
  resourceCount: number;
}

export function canRequestFocusTopicCatalog(
  user: UserProfile | null,
  hasActiveSuperUserOrg = false
): boolean {
  return Boolean(
    user
    && (
      (user.accountType === "enterprise" && user.orgId)
      || (user.isSuperUser === true && hasActiveSuperUserOrg)
    )
    && user.status === "active"
    && user.emailVerifiedAt
    && user.firstName?.trim()
    && user.lastName?.trim()
    && user.mobileProfileReonboardingRequired !== true
  );
}

export function parseFocusTopicCatalogResponse(
  value: unknown
): MobileFocusTopicCatalogResponse {
  if (!value || typeof value !== "object" || !Array.isArray((value as { topics?: unknown }).topics)) {
    throw new Error("The Focus Topic catalog response was invalid.");
  }

  const topics = (value as { topics: unknown[] }).topics.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("The Focus Topic catalog response was invalid.");
    }
    const topic = entry as Record<string, unknown>;
    if (
      typeof topic.id !== "string"
      || !topic.id.trim()
      || typeof topic.name !== "string"
      || !topic.name.trim()
      || typeof topic.description !== "string"
      || !isNonNegativeInteger(topic.scenarioCount)
      || !isNonNegativeInteger(topic.resourceCount)
    ) {
      throw new Error("The Focus Topic catalog response was invalid.");
    }
    return {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      scenarioCount: topic.scenarioCount,
      resourceCount: topic.resourceCount,
    } satisfies MobileFocusTopicCatalogItem;
  });

  return { topics };
}

const TRAINING_CONTENT_TYPES = new Set<TrainingContentType>([
  "native",
  "external_url",
  "video",
  "audio",
  "pdf",
  "docx",
  "image",
]);

export function parseFocusTopicDetailResponse(
  value: unknown
): MobileFocusTopicDetailResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  const response = value as Record<string, unknown>;
  const topic = parseDetailTopic(response.topic);
  if (!Array.isArray(response.scenarios) || !Array.isArray(response.resources)) {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  const scenarios = response.scenarios.map((entry) => parseDetailScenario(entry, topic.id));
  const resources = response.resources.map(parseDetailResource);
  return { topic, scenarios, resources };
}

export function isFocusTopicDetailEmpty(
  detail: MobileFocusTopicDetailResponse
): boolean {
  return detail.scenarios.length === 0 && detail.resources.length === 0;
}

export function isFocusTopicUnavailableError(error: unknown): boolean {
  return error instanceof MobileApiError
    && (error.status === 404 || error.code === "focus_topic_not_available");
}

export function formatFocusTopicDetailCounts(
  detail: Pick<MobileFocusTopicDetailResponse, "scenarios" | "resources">
): string {
  return formatFocusTopicCounts({
    scenarioCount: detail.scenarios.length,
    resourceCount: detail.resources.length,
  });
}

function parseDetailTopic(value: unknown): MobileFocusTopicDetailResponse["topic"] {
  if (!value || typeof value !== "object") {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  const topic = value as Record<string, unknown>;
  if (
    !isNonEmptyString(topic.id)
    || !isNonEmptyString(topic.name)
    || typeof topic.description !== "string"
  ) {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  return { id: topic.id, name: topic.name, description: topic.description };
}

function parseDetailScenario(
  value: unknown,
  topicId: string
): MobileFocusTopicScenarioSummary {
  if (!value || typeof value !== "object") {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  const scenario = value as Record<string, unknown>;
  const source = scenario.source;
  const trainingId = scenario.trainingId;
  if (
    !isNonEmptyString(scenario.id)
    || !isNonEmptyString(scenario.title)
    || typeof scenario.description !== "string"
    || (source !== "standard" && source !== "custom")
    || !isNonEmptyString(scenario.segmentId)
    || !isNonEmptyString(scenario.segmentLabel)
    || !isNonEmptyString(scenario.industryId)
    || !isNonEmptyString(scenario.industryLabel)
    || (source === "standard" && trainingId !== null)
    || (source === "custom" && trainingId !== topicId)
  ) {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  return {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    source,
    segmentId: scenario.segmentId,
    segmentLabel: scenario.segmentLabel,
    industryId: scenario.industryId,
    industryLabel: scenario.industryLabel,
    trainingId: source === "standard" ? null : topicId,
  };
}

function parseDetailResource(value: unknown): MobileTrainingContentSummary {
  if (!value || typeof value !== "object") {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  const resource = value as Record<string, unknown>;
  const category = resource.category;
  if (
    !isNonEmptyString(resource.id)
    || !isNonEmptyString(resource.title)
    || typeof resource.description !== "string"
    || typeof resource.contentType !== "string"
    || !TRAINING_CONTENT_TYPES.has(resource.contentType as TrainingContentType)
    || !category
    || typeof category !== "object"
    || !isNonEmptyString((category as Record<string, unknown>).id)
    || !isNonEmptyString((category as Record<string, unknown>).name)
    || (resource.relatedFocusTopic !== null && typeof resource.relatedFocusTopic !== "string")
  ) {
    throw new Error("The Focus Topic detail response was invalid.");
  }
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    contentType: resource.contentType as TrainingContentType,
    category: {
      id: (category as { id: string }).id,
      name: (category as { name: string }).name,
    },
    relatedFocusTopic: resource.relatedFocusTopic as string | null,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function buildFocusTopicNavigationSummary(
  topic: MobileFocusTopicCatalogItem
): FocusTopicNavigationSummary {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    scenarioCount: topic.scenarioCount,
    resourceCount: topic.resourceCount,
  };
}

export function formatFocusTopicCounts(
  topic: Pick<MobileFocusTopicCatalogItem, "scenarioCount" | "resourceCount">
): string {
  const counts: string[] = [];
  if (topic.scenarioCount > 0) {
    counts.push(`${topic.scenarioCount} ${topic.scenarioCount === 1 ? "scenario" : "scenarios"}`);
  }
  if (topic.resourceCount > 0) {
    counts.push(`${topic.resourceCount} ${topic.resourceCount === 1 ? "resource" : "resources"}`);
  }
  return counts.join(" · ");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export interface FocusTopicRequestAttempt {
  generation: number;
  signal: AbortSignal;
}

export interface FocusTopicRequestGate {
  start(): FocusTopicRequestAttempt;
  isCurrent(attempt: FocusTopicRequestAttempt): boolean;
  invalidate(): void;
}

export function createFocusTopicRequestGate(): FocusTopicRequestGate {
  let generation = 0;
  let activeController: AbortController | null = null;

  return {
    start() {
      activeController?.abort();
      activeController = new AbortController();
      generation += 1;
      return { generation, signal: activeController.signal };
    },
    isCurrent(attempt) {
      return generation === attempt.generation && !attempt.signal.aborted;
    },
    invalidate() {
      generation += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}
