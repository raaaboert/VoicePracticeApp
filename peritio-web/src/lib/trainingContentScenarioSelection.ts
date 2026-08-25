import type {
  DashboardTrainingContentRelatedScenario,
  DashboardTrainingContentScenarioOption,
} from "@voicepractice/shared";

export interface TrainingContentScenarioSelectionItem {
  id: string;
  title: string;
  available: boolean;
  source: DashboardTrainingContentScenarioOption["source"] | null;
}

export type TrainingContentScenarioSourceFilter = "all" | "standard" | "custom";

export interface TrainingContentScenarioOptionFilters {
  roleId?: string;
  source?: TrainingContentScenarioSourceFilter;
  focusTopicId?: string;
}

export interface TrainingContentScenarioFilterOption {
  id: string;
  label: string;
}

export function createTrainingContentScenarioSelection(
  relatedScenarios: readonly DashboardTrainingContentRelatedScenario[],
  options: readonly DashboardTrainingContentScenarioOption[]
): TrainingContentScenarioSelectionItem[] {
  const optionsById = new Map(
    normalizeTrainingContentScenarioOptions(options).map((option) => [option.id, option])
  );
  const selected = new Map<string, TrainingContentScenarioSelectionItem>();
  for (const scenario of relatedScenarios) {
    const id = normalizeId(scenario.id);
    if (!id || selected.has(id)) {
      continue;
    }
    const option = optionsById.get(id);
    selected.set(id, {
      id,
      title: scenario.title.trim() || option?.title || "Unavailable scenario",
      available: scenario.available,
      source: option?.source ?? null,
    });
  }
  return [...selected.values()];
}

export function filterTrainingContentScenarioOptions(
  options: readonly DashboardTrainingContentScenarioOption[],
  selected: readonly TrainingContentScenarioSelectionItem[],
  query: string,
  filters: TrainingContentScenarioOptionFilters = {}
): DashboardTrainingContentScenarioOption[] {
  const selectedIds = new Set(trainingContentScenarioSelectionIds(selected));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const roleId = normalizeId(filters.roleId ?? "");
  const source = filters.source ?? "all";
  const focusTopicId = source === "custom" ? normalizeId(filters.focusTopicId ?? "") : "";
  return normalizeTrainingContentScenarioOptions(options).filter((option) => {
    if (selectedIds.has(option.id)) {
      return false;
    }
    if (source !== "all" && option.source !== source) {
      return false;
    }
    if (roleId && option.role?.id !== roleId) {
      return false;
    }
    if (focusTopicId && !option.focusTopics.some((topic) => topic.id === focusTopicId)) {
      return false;
    }
    return !normalizedQuery || [
      option.title,
      option.source,
      option.role?.label ?? "",
      ...option.focusTopics.map((topic) => topic.label),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function listTrainingContentScenarioRoleFilters(
  options: readonly DashboardTrainingContentScenarioOption[]
): TrainingContentScenarioFilterOption[] {
  const roles = new Map<string, TrainingContentScenarioFilterOption>();
  for (const option of normalizeTrainingContentScenarioOptions(options)) {
    if (option.role) {
      roles.set(option.role.id, option.role);
    }
  }
  return sortFilterOptions(roles.values());
}

export function listTrainingContentScenarioFocusTopicFilters(
  options: readonly DashboardTrainingContentScenarioOption[]
): TrainingContentScenarioFilterOption[] {
  const focusTopics = new Map<string, TrainingContentScenarioFilterOption>();
  for (const option of normalizeTrainingContentScenarioOptions(options)) {
    if (option.source !== "custom") {
      continue;
    }
    for (const focusTopic of option.focusTopics) {
      focusTopics.set(focusTopic.id, focusTopic);
    }
  }
  return sortFilterOptions(focusTopics.values());
}

export function addTrainingContentScenarioSelection(
  selected: readonly TrainingContentScenarioSelectionItem[],
  option: DashboardTrainingContentScenarioOption
): TrainingContentScenarioSelectionItem[] {
  const id = normalizeId(option.id);
  if (!id || trainingContentScenarioSelectionIds(selected).includes(id)) {
    return [...selected];
  }
  return [
    ...selected,
    {
      id,
      title: option.title.trim() || "Scenario",
      available: true,
      source: option.source,
    },
  ];
}

export function removeTrainingContentScenarioSelection(
  selected: readonly TrainingContentScenarioSelectionItem[],
  scenarioId: string
): TrainingContentScenarioSelectionItem[] {
  const id = normalizeId(scenarioId);
  return selected.filter((scenario) => scenario.id !== id);
}

export function trainingContentScenarioSelectionIds(
  selected: readonly Pick<TrainingContentScenarioSelectionItem, "id">[]
): string[] {
  const ids = new Set<string>();
  for (const scenario of selected) {
    const id = normalizeId(scenario.id);
    if (id) {
      ids.add(id);
    }
  }
  return [...ids];
}

export function hasTrainingContentScenarioSelectionChanges(
  initial: readonly Pick<TrainingContentScenarioSelectionItem, "id">[],
  selected: readonly Pick<TrainingContentScenarioSelectionItem, "id">[]
): boolean {
  return sortedIds(initial).join("\u0000") !== sortedIds(selected).join("\u0000");
}

export function buildCreateRelatedScenarioIdsField(
  selected: readonly Pick<TrainingContentScenarioSelectionItem, "id">[],
  touched: boolean
): { relatedScenarioIds?: string[] } {
  return touched ? { relatedScenarioIds: trainingContentScenarioSelectionIds(selected) } : {};
}

export function buildUpdateRelatedScenarioIdsField(
  initial: readonly Pick<TrainingContentScenarioSelectionItem, "id">[],
  selected: readonly Pick<TrainingContentScenarioSelectionItem, "id">[]
): { relatedScenarioIds?: string[] } {
  return hasTrainingContentScenarioSelectionChanges(initial, selected)
    ? { relatedScenarioIds: trainingContentScenarioSelectionIds(selected) }
    : {};
}

function normalizeTrainingContentScenarioOptions(
  options: readonly DashboardTrainingContentScenarioOption[]
): DashboardTrainingContentScenarioOption[] {
  const normalized = new Map<string, DashboardTrainingContentScenarioOption>();
  for (const option of options) {
    const id = normalizeId(option.id);
    const title = option.title.trim();
    if (!id || !title || normalized.has(id)) {
      continue;
    }
    const role = normalizeFilterOption(option.role);
    const focusTopics = option.source === "custom"
      ? sortFilterOptions(normalizeFilterOptions(option.focusTopics ?? []).values())
      : [];
    normalized.set(id, { id, title, source: option.source, role, focusTopics });
  }
  return [...normalized.values()];
}

function normalizeFilterOptions(
  values: readonly TrainingContentScenarioFilterOption[]
): Map<string, TrainingContentScenarioFilterOption> {
  const normalized = new Map<string, TrainingContentScenarioFilterOption>();
  for (const value of values) {
    const option = normalizeFilterOption(value);
    if (option) {
      normalized.set(option.id, option);
    }
  }
  return normalized;
}

function normalizeFilterOption(
  value: TrainingContentScenarioFilterOption | null | undefined
): TrainingContentScenarioFilterOption | null {
  const id = normalizeId(value?.id ?? "");
  const label = value?.label.trim() ?? "";
  return id && label ? { id, label } : null;
}

function sortFilterOptions(
  values: Iterable<TrainingContentScenarioFilterOption>
): TrainingContentScenarioFilterOption[] {
  return [...values].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
      || left.id.localeCompare(right.id)
  );
}

function sortedIds(
  selected: readonly Pick<TrainingContentScenarioSelectionItem, "id">[]
): string[] {
  return trainingContentScenarioSelectionIds(selected).sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeId(value: string): string {
  return value.trim();
}
