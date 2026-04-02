import { AppConfig, EnterpriseOrg } from "@voicepractice/shared";

function hasStandardScenarioInConfig(configForUser: Pick<AppConfig, "segments">, scenarioId: string): boolean {
  return (configForUser.segments ?? []).some((segment) => {
    if (segment.enabled !== true) {
      return false;
    }

    return (segment.scenarios ?? []).some((scenario) => scenario.id === scenarioId && scenario.enabled !== false);
  });
}

function hasEnabledOrgCustomScenario(
  org: Pick<EnterpriseOrg, "customScenarios"> | null | undefined,
  scenarioId: string,
): boolean {
  return (org?.customScenarios ?? []).some((scenario) => scenario.id === scenarioId && scenario.enabled === true);
}

export function shouldBootstrapTrainingWorkspaceForSimulationRoute(params: {
  configForUser: Pick<AppConfig, "segments">;
  org: Pick<EnterpriseOrg, "customScenarios"> | null | undefined;
  scenarioId: string;
  existingOrgTrainingCount: number;
}): boolean {
  const scenarioId = params.scenarioId.trim();
  if (!scenarioId) {
    return false;
  }

  if (!params.org) {
    return false;
  }

  if (params.existingOrgTrainingCount > 0) {
    return false;
  }

  if (hasStandardScenarioInConfig(params.configForUser, scenarioId)) {
    return false;
  }

  return hasEnabledOrgCustomScenario(params.org, scenarioId);
}
