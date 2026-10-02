import type {
  AppConfig,
  MobileRelatedPracticeScenarioSummary,
} from "@voicepractice/shared";

type MobileScenarioSetupConfig = Pick<
  AppConfig,
  "industries" | "roleIndustries" | "segments"
>;

export interface MobileScenarioSetupCandidate {
  id: string;
  title: string;
  source: "standard" | "custom";
  segmentId: string;
  allowedIndustryIds: readonly string[];
  trainingId: string | null;
}

export function resolveCanonicalMobileScenarioSetupSelection(
  config: MobileScenarioSetupConfig,
  candidate: MobileScenarioSetupCandidate
): MobileRelatedPracticeScenarioSummary | null {
  const scenarioId = candidate.id.trim();
  const title = candidate.title.trim();
  const segmentId = candidate.segmentId.trim();
  const trainingId = candidate.trainingId?.trim() ?? "";
  if (
    !scenarioId
    || !title
    || !segmentId
    || (candidate.source === "custom" && !trainingId)
  ) {
    return null;
  }

  const allowedIndustryIds = new Set(
    candidate.allowedIndustryIds.map((industryId) => industryId.trim()).filter(Boolean)
  );
  const enabledIndustries = config.industries.filter((industry) => industry.enabled);
  let industry = enabledIndustries.find((entry) => allowedIndustryIds.has(entry.id)) ?? null;

  if (!industry && candidate.source === "standard" && !hasMappedStandardSetupOptions(config)) {
    industry = enabledIndustries[0] ?? null;
  }
  if (!industry) {
    return null;
  }

  return {
    id: scenarioId,
    title,
    source: candidate.source,
    segmentId,
    industryId: industry.id,
    trainingId: candidate.source === "custom" ? trainingId : null,
  };
}

function hasMappedStandardSetupOptions(config: MobileScenarioSetupConfig): boolean {
  const enabledIndustryIds = new Set(
    config.industries.filter((industry) => industry.enabled).map((industry) => industry.id)
  );
  const enabledRoleIds = new Set(
    config.segments
      .filter(
        (segment) => segment.enabled
          && segment.scenarios.some((scenario) => scenario.enabled !== false)
      )
      .map((segment) => segment.id)
  );
  return config.roleIndustries.some(
    (entry) => entry.active
      && enabledIndustryIds.has(entry.industryId)
      && enabledRoleIds.has(entry.roleId)
  );
}
