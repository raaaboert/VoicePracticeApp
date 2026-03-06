import { Difficulty, PersonaStyle, Scenario, TrainingPack } from "@voicepractice/shared";
import { buildEvaluationSystemPrompt, buildOpeningPrompt, buildRoleplaySystemPrompt } from "../aiPrompts.js";
import {
  buildTrainingPackBehavioralTriggerBlock,
  buildTrainingPackBriefBlock,
  buildTrainingPackScoringWeightsBlock,
  getDefaultScoringWeights,
  NormalizedScoringWeights,
  resolveTrainingPackScoringWeights,
} from "./trainingPackRuntime.js";

interface RoleplayOrchestratorParams {
  scenario: Scenario;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  industryLabel?: string | null;
  industryBaseline?: string | null;
  counterpartBehaviorGuidance?: string | null;
  trainingPack?: TrainingPack | null;
}

interface EvaluationOrchestratorParams {
  scenario: Scenario;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  industryLabel?: string | null;
  industryBaseline?: string | null;
  scoringGuidance?: string | null;
  trainingPack?: TrainingPack | null;
  logger?: (message: string) => void;
}

export function buildRoleplayPromptsWithOrchestrator(params: RoleplayOrchestratorParams): {
  systemPrompt: string;
  openingPrompt: string;
} {
  const systemPrompt = buildRoleplaySystemPrompt({
    scenario: params.scenario,
    difficulty: params.difficulty,
    segmentLabel: params.segmentLabel,
    personaStyle: params.personaStyle,
    industryLabel: params.industryLabel,
    industryBaseline: params.industryBaseline,
    counterpartBehaviorGuidance: params.counterpartBehaviorGuidance,
  });
  const openingPrompt = buildOpeningPrompt(params.scenario);

  if (!params.trainingPack) {
    return { systemPrompt, openingPrompt };
  }

  const sections = [systemPrompt, buildTrainingPackBriefBlock(params.trainingPack)];
  const triggersBlock = buildTrainingPackBehavioralTriggerBlock(params.trainingPack);
  if (triggersBlock) {
    sections.push(triggersBlock);
  }

  return {
    systemPrompt: sections.join("\n\n"),
    openingPrompt,
  };
}

export function buildEvaluationPromptWithOrchestrator(params: EvaluationOrchestratorParams): {
  evaluationPrompt: string;
  scoringWeights: NormalizedScoringWeights;
  usesTrainingPackScoringOverrides: boolean;
} {
  const evaluationPrompt = buildEvaluationSystemPrompt({
    scenario: params.scenario,
    difficulty: params.difficulty,
    segmentLabel: params.segmentLabel,
    personaStyle: params.personaStyle,
    industryLabel: params.industryLabel,
    industryBaseline: params.industryBaseline,
    scoringGuidance: params.scoringGuidance,
  });

  if (!params.trainingPack) {
    return {
      evaluationPrompt,
      scoringWeights: getDefaultScoringWeights(),
      usesTrainingPackScoringOverrides: false,
    };
  }

  const resolvedWeights = resolveTrainingPackScoringWeights(params.trainingPack.scoringWeightOverrides, {
    logger: params.logger,
  });

  if (!resolvedWeights.usedOverrides) {
    return {
      evaluationPrompt,
      scoringWeights: resolvedWeights.weights,
      usesTrainingPackScoringOverrides: false,
    };
  }

  return {
    evaluationPrompt: `${evaluationPrompt}\n\n${buildTrainingPackScoringWeightsBlock(resolvedWeights.weights)}`,
    scoringWeights: resolvedWeights.weights,
    usesTrainingPackScoringOverrides: true,
  };
}
