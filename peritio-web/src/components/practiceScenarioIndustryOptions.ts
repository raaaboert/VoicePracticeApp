import type { CustomerPracticeScenario, CustomerPracticeScenarioListResponse } from "@voicepractice/shared";

export function publishedScenarioIndustriesUnavailable(
  scenario: CustomerPracticeScenario, options: CustomerPracticeScenarioListResponse["industryOptions"],
): boolean {
  return Boolean(scenario.publishedVersion && !scenario.publishedVersion.applicableIndustryIds.some((id) =>
    options.some((option) => option.id === id)));
}

export function scenarioIndustryLabel(id: string, context: Pick<CustomerPracticeScenarioListResponse,
  "industryOptions" | "historicalIndustryLabels">): string {
  const active = context.industryOptions.find((industry) => industry.id === id);
  if (active) return active.label;
  const label = context.historicalIndustryLabels?.find((industry) => industry.id === id)?.label ?? id.replaceAll("_", " ");
  return `${label} (currently unavailable)`;
}

export function scenarioRolesForIndustries(
  roles: CustomerPracticeScenarioListResponse["roleOptions"], industryIds: readonly string[],
) {
  return roles.filter((role) => industryIds.length === 0 || industryIds.some((id) => role.industryIds.includes(id)));
}

export function editableScenarioIndustries(
  savedIds: readonly string[], options: CustomerPracticeScenarioListResponse["industryOptions"],
): string[] {
  return savedIds.filter((id) => options.some((option) => option.id === id));
}
