import type { DashboardTrainingContentDetail, DashboardTrainingContentFocusTopic } from "@voicepractice/shared";

export type TopicChoice = DashboardTrainingContentFocusTopic & { available?: boolean };

export function selectedContentTopicIds(item: Pick<DashboardTrainingContentDetail, "focusTopicId" | "relatedFocusTopics" | "focusTopicAuthority">): string[] {
  return item.focusTopicAuthority === "assignments"
    ? (item.relatedFocusTopics ?? []).map((topic) => topic.id)
    : item.focusTopicId ? [item.focusTopicId] : [];
}

export function sameTopicIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export function contentTopicChoices(options: readonly TopicChoice[], existing: readonly TopicChoice[], query: string): TopicChoice[] {
  const choices = new Map(existing.map((topic) => [topic.id, topic]));
  for (const topic of options) choices.set(topic.id, topic);
  const search = query.trim().toLocaleLowerCase();
  return [...choices.values()].filter((topic) => !search || topic.name.toLocaleLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
