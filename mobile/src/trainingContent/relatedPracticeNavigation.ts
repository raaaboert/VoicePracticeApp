import type { MobileRelatedPracticeScenarioSummary } from "@voicepractice/shared";

export interface RelatedPracticeSetupSelection {
  scenarioCatalogTab: "standard" | "custom";
  selectedTrainingId: string;
  selectedIndustryId: string;
  selectedRoleId: string;
  selectedScenarioId: string;
}

export function buildRelatedPracticeSetupSelection(
  scenario: MobileRelatedPracticeScenarioSummary
): RelatedPracticeSetupSelection {
  return {
    scenarioCatalogTab: scenario.source,
    selectedTrainingId: scenario.trainingId ?? "",
    selectedIndustryId: scenario.industryId,
    selectedRoleId: scenario.segmentId,
    selectedScenarioId: scenario.id,
  };
}

export function relatedPracticeSetupBackDestination(
  returnContentId: string | null
): "training_content" | "home" {
  return returnContentId ? "training_content" : "home";
}
