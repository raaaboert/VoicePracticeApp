import type { AppConfig, MobileAppConfig, MobileOrgCustomScenario, OrgCustomScenario } from "@voicepractice/shared";

function serializeMobileOrgCustomScenario(scenario: OrgCustomScenario): MobileOrgCustomScenario {
  const { scoringGuidance: _scoringGuidance, provenance: _provenance, ...learnerScenario } = scenario;
  return learnerScenario;
}

export function serializeMobileLearnerConfig(config: AppConfig): MobileAppConfig {
  return {
    ...config,
    ...(config.orgCustomScenarios
      ? { orgCustomScenarios: config.orgCustomScenarios.map(serializeMobileOrgCustomScenario) }
      : {}),
  };
}
