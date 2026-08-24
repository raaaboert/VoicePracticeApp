import type { MobileRelatedPracticeScenarioSummary } from "@voicepractice/shared";

export function relatedPracticeScenariosPath(
  userId: string,
  contentId: string
): string {
  return `/mobile/users/${encodeURIComponent(userId)}/training-content/${encodeURIComponent(contentId)}/related-scenarios`;
}

export function normalizeRelatedPracticeScenarios(
  scenarios: readonly MobileRelatedPracticeScenarioSummary[]
): MobileRelatedPracticeScenarioSummary[] {
  const normalized = new Map<string, MobileRelatedPracticeScenarioSummary>();
  for (const scenario of scenarios) {
    const id = scenario.id.trim();
    if (!id || normalized.has(id)) {
      continue;
    }
    normalized.set(id, { ...scenario, id });
  }
  return [...normalized.values()];
}
