import {
  PerformancePlanScope,
  PerformancePlanScopeItem,
  PerformanceScenarioSource,
  PerformanceScopeSelectionSource
} from "@voicepractice/shared";

export interface PerformanceScopeCandidate {
  scenarioId: string;
  displayName: string;
  source: PerformanceScenarioSource;
  segmentId: string | null;
  segmentLabel: string | null;
  focusTopics: Array<{ id: string; name: string }>;
  metadata?: Record<string, unknown>;
}

export interface PerformanceScopeSelection {
  allAssignedScenarios: boolean;
  selectedFocusTopicIds: string[];
  selectedScenarioIds: string[];
}

export interface FrozenPerformanceScopeResult {
  scope: PerformancePlanScope;
  scopeItems: PerformancePlanScopeItem[];
}

export function freezePerformancePlanScope(params: {
  selection: PerformanceScopeSelection;
  candidates: PerformanceScopeCandidate[];
  planId: string;
  orgId: string;
  userId: string;
  createdAt: string;
  createScopeItemId?: (scenarioId: string) => string;
}): FrozenPerformanceScopeResult {
  const normalizedCandidates = normalizeCandidates(params.candidates);
  const candidateByScenarioId = new Map(normalizedCandidates.map((candidate) => [candidate.scenarioId, candidate]));
  const selectedFocusTopicIds = uniqueStrings(params.selection.selectedFocusTopicIds);
  const selectedScenarioIds = uniqueStrings(params.selection.selectedScenarioIds);
  const selectedFocusTopicIdSet = new Set(selectedFocusTopicIds);
  const selectedScenarioIdSet = new Set(selectedScenarioIds);
  const selected = new Map<string, { candidate: PerformanceScopeCandidate; sources: Set<PerformanceScopeSelectionSource> }>();

  if (params.selection.allAssignedScenarios) {
    for (const candidate of normalizedCandidates) {
      selected.set(candidate.scenarioId, { candidate, sources: new Set(["all_assigned"]) });
    }
  }

  for (const focusTopicId of selectedFocusTopicIds) {
    const hasAnyCandidate = normalizedCandidates.some((candidate) =>
      candidate.focusTopics.some((topic) => topic.id === focusTopicId)
    );
    if (!hasAnyCandidate) {
      throw new Error(`Focus Topic is not available to this user: ${focusTopicId}`);
    }
    for (const candidate of normalizedCandidates) {
      if (!candidate.focusTopics.some((topic) => topic.id === focusTopicId)) {
        continue;
      }
      const existing = selected.get(candidate.scenarioId) ?? { candidate, sources: new Set<PerformanceScopeSelectionSource>() };
      existing.sources.add("focus_topic");
      selected.set(candidate.scenarioId, existing);
    }
  }

  for (const scenarioId of selectedScenarioIds) {
    const candidate = candidateByScenarioId.get(scenarioId);
    if (!candidate) {
      throw new Error(`Scenario is not available to this user: ${scenarioId}`);
    }
    const existing = selected.get(candidate.scenarioId) ?? { candidate, sources: new Set<PerformanceScopeSelectionSource>() };
    existing.sources.add("direct");
    selected.set(candidate.scenarioId, existing);
  }

  const scenarios = Array.from(selected.values())
    .map(({ candidate, sources }) => ({
      scenarioId: candidate.scenarioId,
      displayName: candidate.displayName,
      source: candidate.source,
      segmentId: candidate.segmentId,
      segmentLabel: candidate.segmentLabel,
      focusTopics: candidate.focusTopics,
      selectionSources: Array.from(sources).sort(sortSelectionSources),
      metadata: candidate.metadata ?? {}
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.scenarioId.localeCompare(right.scenarioId));

  if (scenarios.length === 0) {
    throw new Error("Performance plan scope must include at least one eligible scenario.");
  }

  const scope: PerformancePlanScope = {
    allAssignedScenarios: params.selection.allAssignedScenarios,
    selectedFocusTopicIds,
    selectedScenarioIds,
    scenarios
  };

  const createScopeItemId = params.createScopeItemId ?? ((scenarioId: string) => `perf_scope_${params.planId}_${scenarioId}`);
  const scopeItems: PerformancePlanScopeItem[] = scenarios.map((scenario) => {
    const primaryFocusTopic = scenario.focusTopics[0] ?? null;
    return {
      id: createScopeItemId(scenario.scenarioId),
      planId: params.planId,
      orgId: params.orgId,
      userId: params.userId,
      scenarioId: scenario.scenarioId,
      scenarioDisplayName: scenario.displayName,
      scenarioSource: scenario.source,
      segmentId: scenario.segmentId,
      segmentLabel: scenario.segmentLabel,
      focusTopicId: primaryFocusTopic?.id ?? null,
      focusTopicName: primaryFocusTopic?.name ?? null,
      selectionSources: scenario.selectionSources,
      metadataSnapshot: {
        ...(scenario.metadata ?? {}),
        focusTopics: scenario.focusTopics
      },
      createdAt: params.createdAt
    };
  });

  return { scope, scopeItems };
}

export function getFrozenScenarioIdSet(scope: PerformancePlanScope): Set<string> {
  return new Set(scope.scenarios.map((scenario) => scenario.scenarioId));
}

function normalizeCandidates(candidates: PerformanceScopeCandidate[]): PerformanceScopeCandidate[] {
  const byScenarioId = new Map<string, PerformanceScopeCandidate>();
  for (const candidate of candidates) {
    const scenarioId = candidate.scenarioId.trim();
    const displayName = candidate.displayName.trim();
    if (!scenarioId || !displayName) {
      continue;
    }
    const existing = byScenarioId.get(scenarioId);
    const focusTopics = uniqueFocusTopics([...(existing?.focusTopics ?? []), ...candidate.focusTopics]);
    byScenarioId.set(scenarioId, {
      scenarioId,
      displayName,
      source: candidate.source,
      segmentId: candidate.segmentId?.trim() || null,
      segmentLabel: candidate.segmentLabel?.trim() || null,
      focusTopics,
      metadata: candidate.metadata ?? existing?.metadata ?? {}
    });
  }
  return Array.from(byScenarioId.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueFocusTopics(values: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  const byId = new Map<string, { id: string; name: string }>();
  for (const value of values) {
    const id = value.id.trim();
    const name = value.name.trim();
    if (id && name && !byId.has(id)) {
      byId.set(id, { id, name });
    }
  }
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function sortSelectionSources(left: PerformanceScopeSelectionSource, right: PerformanceScopeSelectionSource): number {
  const order: Record<PerformanceScopeSelectionSource, number> = {
    all_assigned: 0,
    focus_topic: 1,
    direct: 2
  };
  return order[left] - order[right];
}
