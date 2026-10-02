export const TRAINING_PACK_SCENARIO_OPT_IN_PREFIX = "scenario:";

export interface TrainingPackScenarioSelection {
  mode: "all" | "selected" | "none";
  selectedScenarioIds: string[];
}

export function parseTrainingPackScenarioSelection(
  triggers: readonly string[]
): TrainingPackScenarioSelection {
  let mode: TrainingPackScenarioSelection["mode"] = "none";
  const selectedScenarioIds = new Set<string>();

  for (const trigger of triggers) {
    const lower = trigger.trim().toLowerCase();
    if (!lower.startsWith(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX)) {
      continue;
    }

    const scenarioId = trigger.slice(TRAINING_PACK_SCENARIO_OPT_IN_PREFIX.length).trim();
    if (!scenarioId) {
      continue;
    }

    if (scenarioId === "*") {
      mode = "all";
      selectedScenarioIds.clear();
      break;
    }

    mode = "selected";
    selectedScenarioIds.add(scenarioId);
  }

  return { mode, selectedScenarioIds: Array.from(selectedScenarioIds) };
}
