import type { MobileFocusTopicCatalogItem } from "@voicepractice/shared";

export type FocusTopicLearnerSort = "company" | "alphabetical";

const FOCUS_TOPIC_NAME_COLLATOR = new Intl.Collator("en-US", {
  sensitivity: "base",
  numeric: false,
  caseFirst: "false",
});

export function compactFocusTopicQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeFocusTopicQuery(value: string): string {
  return compactFocusTopicQuery(value).toLocaleLowerCase("en-US");
}

export function matchesFocusTopicQuery(
  topic: Pick<MobileFocusTopicCatalogItem, "name" | "description">,
  query: string,
): boolean {
  const normalizedQuery = normalizeFocusTopicQuery(query);
  if (!normalizedQuery) {
    return true;
  }
  const searchableText = normalizeFocusTopicQuery(`${topic.name} ${topic.description}`);
  return normalizedQuery.split(" ").every((token) => searchableText.includes(token));
}

export function sortFocusTopicsForLearner(
  topics: readonly MobileFocusTopicCatalogItem[],
  sort: FocusTopicLearnerSort,
): MobileFocusTopicCatalogItem[] {
  const copy = [...topics];
  if (sort === "company") {
    return copy;
  }
  return copy.sort((left, right) => {
    const nameOrder = FOCUS_TOPIC_NAME_COLLATOR.compare(left.name, right.name);
    return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
  });
}

export function applyFocusTopicDiscovery(
  topics: readonly MobileFocusTopicCatalogItem[],
  sort: FocusTopicLearnerSort,
  query: string,
): MobileFocusTopicCatalogItem[] {
  return sortFocusTopicsForLearner(topics, sort)
    .filter((topic) => matchesFocusTopicQuery(topic, query));
}

export function getFocusTopicDiscoveryVisibility(topicCount: number, query: string): {
  showSearch: boolean;
  showSort: boolean;
} {
  const activeQuery = Boolean(normalizeFocusTopicQuery(query));
  return {
    showSearch: topicCount >= 5 || activeQuery,
    showSort: topicCount >= 2,
  };
}
