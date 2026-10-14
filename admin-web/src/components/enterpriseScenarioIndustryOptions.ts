import type { AppConfig, OrgCustomScenario } from "@voicepractice/shared";

export function effectiveScenarioEditorConfig(config: AppConfig | null, effectiveIds: readonly string[]): AppConfig | null {
  if (!config) return null;
  const industries = config.industries.filter((industry) => industry.enabled && effectiveIds.includes(industry.id));
  const roleIndustries = config.roleIndustries.filter((link) => link.active && industries.some((industry) => industry.id === link.industryId));
  return { ...config, industries, roleIndustries,
    segments: config.segments.filter((role) => role.enabled && roleIndustries.some((link) => link.roleId === role.id)) };
}

export function editableMasterScenarioIndustries(scenario: OrgCustomScenario, config: AppConfig | null): string[] {
  return scenario.applicableIndustryIds.filter((id) => config?.industries.some((industry) => industry.id === id));
}

export function masterScenarioIndustriesUnavailable(
  scenario: Pick<OrgCustomScenario, "applicableIndustryIds">, effectiveIndustryIds: readonly string[],
): boolean {
  return !scenario.applicableIndustryIds.some((id) => effectiveIndustryIds.includes(id));
}
