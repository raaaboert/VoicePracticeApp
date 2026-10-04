import type {
  OrgTrainingSummary,
  ReorderOrgTrainingsRequest,
} from "@voicepractice/shared";

export function projectActiveFocusTopicOrder(
  topics: readonly OrgTrainingSummary[]
): OrgTrainingSummary[] {
  return topics.filter((topic) => topic.status === "active");
}

export function projectInactiveFocusTopics(
  topics: readonly OrgTrainingSummary[]
): OrgTrainingSummary[] {
  return topics.filter((topic) => topic.status !== "active");
}

export function moveActiveFocusTopic(
  topics: readonly OrgTrainingSummary[],
  topicId: string,
  direction: -1 | 1
): OrgTrainingSummary[] {
  const index = topics.findIndex((topic) => topic.id === topicId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= topics.length) return topics.slice();
  const next = topics.slice();
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

export function buildFocusTopicOrderRequest(
  activeTopics: readonly OrgTrainingSummary[],
  expectedOrderRevision: string
): ReorderOrgTrainingsRequest {
  return {
    expectedOrderRevision,
    trainingIds: activeTopics.map((topic) => topic.id),
  };
}
