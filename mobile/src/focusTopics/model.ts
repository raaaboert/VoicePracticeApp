import type {
  MobileFocusTopicCatalogItem,
  MobileFocusTopicCatalogResponse,
  UserProfile,
} from "@voicepractice/shared";

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
