import {
  TRAINING_PACK_SCORING_KEYS,
  TrainingPack,
  TrainingPackScoringKey,
  TrainingPackScoringWeightOverrides,
} from "@voicepractice/shared";

export type NormalizedScoringWeights = Record<TrainingPackScoringKey, number>;

const DEFAULT_SCORING_WEIGHTS: NormalizedScoringWeights = {
  persuasion: 0.25,
  clarity: 0.25,
  empathy: 0.25,
  assertiveness: 0.25,
};

const SCORING_WEIGHT_EPSILON = 1e-9;

interface ResolveScoringWeightOptions {
  logger?: (message: string) => void;
}

function warn(options: ResolveScoringWeightOptions | undefined, message: string): void {
  options?.logger?.(`[training-pack] ${message}`);
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "- (none)";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function getDefaultScoringWeights(): NormalizedScoringWeights {
  return { ...DEFAULT_SCORING_WEIGHTS };
}

export function resolveTrainingPackScoringWeights(
  overrides: TrainingPackScoringWeightOverrides | null | undefined,
  options?: ResolveScoringWeightOptions
): { weights: NormalizedScoringWeights; usedOverrides: boolean } {
  const merged: NormalizedScoringWeights = getDefaultScoringWeights();
  const allowed = new Set<string>(TRAINING_PACK_SCORING_KEYS);

  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { weights: merged, usedOverrides: false };
  }

  let validOverrideCount = 0;
  const entries = Object.entries(overrides);
  for (const [key, rawValue] of entries) {
    if (!allowed.has(key)) {
      warn(options, `Ignoring unsupported scoring override key "${key}".`);
      continue;
    }

    const weight = Number(rawValue);
    if (!Number.isFinite(weight) || weight <= 0) {
      warn(options, `Ignoring invalid non-positive scoring override for key "${key}".`);
      continue;
    }

    merged[key as TrainingPackScoringKey] = weight;
    validOverrideCount += 1;
  }

  if (validOverrideCount === 0) {
    if (entries.length > 0) {
      warn(options, "No valid scoring override values found; falling back to default scoring weights.");
    }
    return { weights: getDefaultScoringWeights(), usedOverrides: false };
  }

  const total = TRAINING_PACK_SCORING_KEYS.reduce((sum, key) => sum + merged[key], 0);
  if (!Number.isFinite(total) || total <= 0) {
    warn(options, "Scoring override total was invalid; falling back to default scoring weights.");
    return { weights: getDefaultScoringWeights(), usedOverrides: false };
  }

  if (Math.abs(total - 1) > SCORING_WEIGHT_EPSILON) {
    warn(options, `Normalizing scoring weights because total was ${total.toFixed(6)} (expected 1.0).`);
  }

  const normalized: NormalizedScoringWeights = {
    persuasion: merged.persuasion / total,
    clarity: merged.clarity / total,
    empathy: merged.empathy / total,
    assertiveness: merged.assertiveness / total,
  };

  return { weights: normalized, usedOverrides: true };
}

export function buildTrainingPackBriefBlock(trainingPack: TrainingPack): string {
  return [
    "TRAINING PACK BRIEF",
    `Training Topic: ${trainingPack.trainingTopic || "(none provided)"}`,
    "Learning Objectives:",
    bulletList(trainingPack.learningObjectives),
    "Required Success Behaviors:",
    bulletList(trainingPack.successBehaviors),
    "Common Failure Patterns:",
    bulletList(trainingPack.failurePatterns),
    `Audience Level: ${trainingPack.audienceLevel || "(none provided)"}`,
    `Compliance Constraints: ${trainingPack.complianceConstraints || "(none provided)"}`,
    "The counterpart should surface situations that test the required success behaviors.",
  ].join("\n");
}

export function buildTrainingPackBehavioralTriggerBlock(trainingPack: TrainingPack): string | null {
  if (trainingPack.requiredBehavioralTriggers.length === 0) {
    return null;
  }

  return [
    "REQUIRED BEHAVIORAL TRIGGERS",
    "During this simulation, the counterpart must create opportunities that test:",
    bulletList(trainingPack.requiredBehavioralTriggers),
    "Ensure these triggers are surfaced before softening (based on difficulty).",
  ].join("\n");
}

export function buildTrainingPackScoringWeightsBlock(weights: NormalizedScoringWeights): string {
  return [
    "TRAINING PACK SCORING WEIGHT OVERRIDES",
    "Apply these normalized rubric weights when evaluating the USER:",
    ...TRAINING_PACK_SCORING_KEYS.map((key) => `- ${key}: ${weights[key].toFixed(4)}`),
    "Use only these existing rubric keys. Do not create new scoring categories.",
  ].join("\n");
}

export function computeWeightedOverallScore(
  scorecard: {
    persuasion: number;
    clarity: number;
    empathy: number;
    assertiveness: number;
  },
  weights: NormalizedScoringWeights
): number {
  const weightedScore =
    scorecard.persuasion * 10 * weights.persuasion +
    scorecard.clarity * 10 * weights.clarity +
    scorecard.empathy * 10 * weights.empathy +
    scorecard.assertiveness * 10 * weights.assertiveness;

  return clamp(Math.round(weightedScore), 0, 100);
}
