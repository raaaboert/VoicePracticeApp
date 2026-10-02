import type { MobileRelatedPracticeScenarioSummary } from "@voicepractice/shared";

export interface ScenarioSetupSelection {
  scenarioCatalogTab: "standard" | "custom";
  selectedTrainingId: string;
  selectedIndustryId: string;
  selectedRoleId: string;
  selectedScenarioId: string;
}

export interface AppliedScenarioSetupSelection {
  scenarioCatalogTab: "standard" | "custom";
  trainingId: string | null;
  industryId: string | null;
  roleId: string | null;
  scenarioId: string | null;
}

export type SetupOrigin =
  | { type: "focus_topic"; topicId: string }
  | { type: "learning_resource"; contentId: string };

export function buildScenarioSetupSelection(
  scenario: MobileRelatedPracticeScenarioSummary
): ScenarioSetupSelection {
  return {
    scenarioCatalogTab: scenario.source,
    selectedTrainingId: scenario.source === "custom" ? scenario.trainingId ?? "" : "",
    selectedIndustryId: scenario.industryId,
    selectedRoleId: scenario.segmentId,
    selectedScenarioId: scenario.id,
  };
}

export function isExactScenarioSetupSelection(
  requested: ScenarioSetupSelection,
  applied: AppliedScenarioSetupSelection
): boolean {
  const expectedTrainingId = requested.scenarioCatalogTab === "custom"
    ? requested.selectedTrainingId
    : null;
  return applied.scenarioCatalogTab === requested.scenarioCatalogTab
    && applied.trainingId === expectedTrainingId
    && applied.industryId === requested.selectedIndustryId
    && applied.roleId === requested.selectedRoleId
    && applied.scenarioId === requested.selectedScenarioId;
}

export function setupBackDestination(
  origin: SetupOrigin | null
): "focus_topics" | "training_content" | "home" {
  if (origin?.type === "focus_topic") {
    return "focus_topics";
  }
  return origin?.type === "learning_resource" ? "training_content" : "home";
}

export function setupOriginTopicId(origin: SetupOrigin | null): string | null {
  return origin?.type === "focus_topic" ? origin.topicId : null;
}

export function setupOriginContentId(origin: SetupOrigin | null): string | null {
  return origin?.type === "learning_resource" ? origin.contentId : null;
}
