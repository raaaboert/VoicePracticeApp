import type { MobileTrainingContentSummary } from "@voicepractice/shared";

export interface RelatedTrainingContentPresentation {
  items: MobileTrainingContentSummary[];
  title: string;
  actionLabel: "Review Learning Resource" | "Review Learning Resources";
  accessibilityLabel: string;
  destination:
    | { type: "detail"; contentId: string }
    | { type: "list" };
}

export function relatedTrainingContentPath(
  userId: string,
  scenarioId: string,
  trainingId?: string | null
): string {
  const normalizedTrainingId = trainingId?.trim() ?? "";
  const query = normalizedTrainingId
    ? `?trainingId=${encodeURIComponent(normalizedTrainingId)}`
    : "";
  return `/mobile/users/${encodeURIComponent(userId)}/scenarios/${encodeURIComponent(scenarioId)}/training-content${query}`;
}

export function buildRelatedTrainingContentPresentation(
  items: readonly MobileTrainingContentSummary[]
): RelatedTrainingContentPresentation | null {
  const normalized = new Map<string, MobileTrainingContentSummary>();
  for (const item of items) {
    const id = item.id.trim();
    if (!id || normalized.has(id)) {
      continue;
    }
    normalized.set(id, { ...item, id });
  }
  const availableItems = [...normalized.values()];
  if (availableItems.length === 0) {
    return null;
  }
  if (availableItems.length === 1) {
    const item = availableItems[0]!;
    return {
      items: availableItems,
      title: item.title,
      actionLabel: "Review Learning Resource",
      accessibilityLabel: `Review Learning Resource: ${item.title}`,
      destination: { type: "detail", contentId: item.id },
    };
  }
  return {
    items: availableItems,
    title: `${availableItems.length} resources available`,
    actionLabel: "Review Learning Resources",
    accessibilityLabel: `Review ${availableItems.length} related Learning Resources`,
    destination: { type: "list" },
  };
}
