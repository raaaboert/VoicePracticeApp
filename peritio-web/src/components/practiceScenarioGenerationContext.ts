import type { CustomerPracticeScenarioGeneratedDraft, CustomerPracticeScenarioGenerationRequest, CustomerPracticeScenarioListResponse } from "@voicepractice/shared";
import { scenarioRolesForIndustries } from "./practiceScenarioIndustryOptions";

export function scenarioGenerationSelectionError(
  options: Pick<CustomerPracticeScenarioListResponse, "roleOptions" | "industryOptions">,
  segmentId: string, industryIds: readonly string[],
): string | null {
  if (!industryIds.length) return "Select at least one applicable industry before generating.";
  if (industryIds.some((id) => !options.industryOptions.some((option) => option.id === id))) {
    return "Select only industries currently available to this organization.";
  }
  if (!segmentId) return "Select the learner Role before generating.";
  if (!scenarioRolesForIndustries(options.roleOptions, industryIds).some((role) => role.id === segmentId)) {
    return "Select a learner Role available for the selected industries.";
  }
  return null;
}

export function generatedScenarioContextMatches(
  generated: Pick<CustomerPracticeScenarioGeneratedDraft, "segmentId" | "applicableIndustryIds">,
  segmentId: string, industryIds: readonly string[],
): boolean {
  if (!Array.isArray(generated.applicableIndustryIds)) return false;
  const expected = [...new Set(generated.applicableIndustryIds)].sort();
  const current = [...new Set(industryIds)].sort();
  return generated.segmentId === segmentId && current.length === expected.length
    && current.every((id, index) => id === expected[index]);
}

export function buildScenarioGenerationRequest(
  options: Pick<CustomerPracticeScenarioListResponse, "roleOptions" | "industryOptions">,
  segmentId: string, industryIds: string[], sourceContentIds: string[], practiceGuidance: string,
): CustomerPracticeScenarioGenerationRequest {
  const error = scenarioGenerationSelectionError(options, segmentId, industryIds);
  if (error) throw new Error(error);
  if (!sourceContentIds.length) throw new Error("Select at least one generation-ready source.");
  return { segmentId, applicableIndustryIds: [...new Set(industryIds)].sort(),
    sourceContentIds: [...new Set(sourceContentIds)], practiceGuidance: practiceGuidance || null };
}
