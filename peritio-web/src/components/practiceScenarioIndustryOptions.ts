import type { CustomerPracticeScenarioListResponse } from "@voicepractice/shared";

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
