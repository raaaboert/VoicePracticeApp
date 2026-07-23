import {
  PERFORMANCE_ACTIVITY_METRIC_TYPES,
  PERFORMANCE_GOAL_METRIC_TYPES,
  PerformanceActivityGoal,
  PerformanceBaseline,
  PerformanceGoal,
  PerformancePlanScope
} from "@voicepractice/shared";

import {
  compareDateKeys,
  getDateKeyInTimeZone,
  isDateKey,
  isValidIanaTimeZone
} from "./performanceDateWindows.js";

export interface PerformancePlanValidationInput {
  startDate: string;
  endDate: string;
  timeZone: string;
  now: Date;
  activityGoal: PerformanceActivityGoal;
  performanceGoal: PerformanceGoal;
  scope: PerformancePlanScope;
  baseline: PerformanceBaseline | null;
}

export interface PerformancePlanValidationResult {
  valid: boolean;
  errors: string[];
}

const ACTIVITY_METRICS = new Set<string>(PERFORMANCE_ACTIVITY_METRIC_TYPES);
const PERFORMANCE_METRICS = new Set<string>(PERFORMANCE_GOAL_METRIC_TYPES);
const COMPARISON_MONTHS = new Set<number>([1, 2, 3, 6]);

export function validatePerformancePlanInput(input: PerformancePlanValidationInput): PerformancePlanValidationResult {
  const errors: string[] = [];

  if (!isValidIanaTimeZone(input.timeZone)) {
    errors.push("A valid IANA timezone is required.");
  }

  if (!isDateKey(input.startDate)) {
    errors.push("startDate must use YYYY-MM-DD format.");
  }
  if (!isDateKey(input.endDate)) {
    errors.push("endDate must use YYYY-MM-DD format.");
  }
  if (isDateKey(input.startDate) && isDateKey(input.endDate) && compareDateKeys(input.startDate, input.endDate) > 0) {
    errors.push("startDate must be on or before endDate.");
  }
  if (isValidIanaTimeZone(input.timeZone) && isDateKey(input.startDate)) {
    const today = getDateKeyInTimeZone(input.now, input.timeZone);
    if (compareDateKeys(input.startDate, today) < 0) {
      errors.push("Users cannot create a backdated Performance goal.");
    }
  }

  if (!input.activityGoal.enabled && !input.performanceGoal.enabled) {
    errors.push("At least one goal section must be enabled.");
  }

  validateActivityGoal(input.activityGoal, errors);
  validatePerformanceGoal(input.performanceGoal, input.baseline, errors);
  validateScope(input.scope, errors);

  return {
    valid: errors.length === 0,
    errors
  };
}

export function assertPerformancePlanValid(input: PerformancePlanValidationInput): void {
  const validation = validatePerformancePlanInput(input);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }
}

export function deriveTargetScore(params: {
  goal: PerformanceGoal;
  baselineAverage: number | null;
}): number | null {
  if (!params.goal.enabled) {
    return null;
  }
  if (params.goal.metricType === "target_average_score") {
    return params.goal.targetScore;
  }
  if (params.baselineAverage === null || params.baselineAverage === undefined) {
    return null;
  }
  if (params.goal.metricType === "improve_by_points") {
    return params.goal.improvementAmount === null ? null : params.baselineAverage + params.goal.improvementAmount;
  }
  if (params.goal.metricType === "improve_by_percent") {
    return params.goal.improvementAmount === null
      ? null
      : params.baselineAverage * (1 + params.goal.improvementAmount / 100);
  }
  return null;
}

function validateActivityGoal(goal: PerformanceActivityGoal, errors: string[]): void {
  if (!goal.enabled) {
    if (goal.metricType !== null || goal.targetValue !== null) {
      errors.push("Disabled activity goals must not carry metric details.");
    }
    return;
  }

  if (!goal.metricType || !ACTIVITY_METRICS.has(goal.metricType)) {
    errors.push("Activity metric type is required.");
  }
  if (goal.targetValue === null || !Number.isFinite(goal.targetValue) || goal.targetValue < 0) {
    errors.push("Activity target value must be a non-negative number.");
  }
}

function validatePerformanceGoal(goal: PerformanceGoal, baseline: PerformanceBaseline | null, errors: string[]): void {
  if (!goal.enabled) {
    if (
      goal.metricType !== null ||
      goal.targetScore !== null ||
      goal.improvementAmount !== null ||
      goal.comparisonMonthCount !== null
    ) {
      errors.push("Disabled performance goals must not carry metric details.");
    }
    return;
  }

  if (!goal.metricType || !PERFORMANCE_METRICS.has(goal.metricType)) {
    errors.push("Performance metric type is required.");
    return;
  }

  if (goal.metricType === "target_average_score") {
    if (goal.targetScore === null || !Number.isFinite(goal.targetScore) || goal.targetScore < 0 || goal.targetScore > 100) {
      errors.push("Target average score must be between 0 and 100.");
    }
    if (goal.improvementAmount !== null || goal.comparisonMonthCount !== null) {
      errors.push("Target average goals must not include improvement or comparison fields.");
    }
    return;
  }

  if (goal.improvementAmount === null || !Number.isFinite(goal.improvementAmount) || goal.improvementAmount < 0) {
    errors.push("Improvement amount must be a non-negative number.");
  }
  if (!goal.comparisonMonthCount || !COMPARISON_MONTHS.has(goal.comparisonMonthCount)) {
    errors.push("Comparison month count must be 1, 2, 3, or 6.");
  }
  if (!baseline) {
    errors.push("Improvement goals require a baseline.");
    return;
  }
  if (baseline.baselineSessionCount < 3) {
    errors.push("Improvement goals require at least 3 eligible baseline score records.");
  }
  const derivedTarget = deriveTargetScore({ goal, baselineAverage: baseline.baselineAverage });
  if (derivedTarget === null || !Number.isFinite(derivedTarget)) {
    errors.push("Derived target score could not be calculated.");
  } else if (derivedTarget < 0 || derivedTarget > 100) {
    errors.push("Derived target score must be between 0 and 100.");
  }
}

function validateScope(scope: PerformancePlanScope, errors: string[]): void {
  if (!Array.isArray(scope.scenarios) || scope.scenarios.length === 0) {
    errors.push("Performance goal scope must include at least one frozen scenario.");
    return;
  }

  const scenarioIds = new Set<string>();
  for (const scenario of scope.scenarios) {
    if (!scenario.scenarioId.trim()) {
      errors.push("Every scoped scenario must have an id.");
    }
    if (!scenario.displayName.trim()) {
      errors.push("Every scoped scenario must have a display name snapshot.");
    }
    if (scenarioIds.has(scenario.scenarioId)) {
      errors.push("Performance goal scope must deduplicate scenario ids.");
    }
    scenarioIds.add(scenario.scenarioId);
  }
}
