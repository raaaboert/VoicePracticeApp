import {
  DEFAULT_INDUSTRIES,
  type IndustryDefinition,
  type SimulationSessionIndustrySnapshot,
  type SimulationSessionIndustrySnapshotIndustry,
} from "@voicepractice/shared";

export const SIMULATION_SESSION_INDUSTRY_SNAPSHOT_VERSION = 1 as const;
export const MAX_SIMULATION_SESSION_INDUSTRY_PROMPT_BASELINE_CHARS = 30_000;

function normalizedText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizedIso(value: unknown): string | null {
  const text = normalizedText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeIndustryPromptBaseline(value: unknown): string {
  const baseline = normalizedText(value);
  return baseline ? baseline.slice(0, MAX_SIMULATION_SESSION_INDUSTRY_PROMPT_BASELINE_CHARS) : "";
}

export function resolveServerIndustryPromptBaseline(params: {
  industry: IndustryDefinition | undefined;
  canonicalIndustries?: readonly IndustryDefinition[];
}): string {
  const canonical = params.canonicalIndustries?.find((entry) => entry.id === params.industry?.id);
  const defaultIndustry = DEFAULT_INDUSTRIES.find((entry) => entry.id === params.industry?.id);
  const configuredBaseline = normalizeIndustryPromptBaseline(params.industry?.aiBaseline);
  if (configuredBaseline) {
    return configuredBaseline;
  }
  const canonicalBaseline = normalizeIndustryPromptBaseline(canonical?.aiBaseline);
  if (canonicalBaseline) {
    return canonicalBaseline;
  }
  return normalizeIndustryPromptBaseline(defaultIndustry?.aiBaseline);
}

function parseSnapshotIndustry(value: unknown): SimulationSessionIndustrySnapshotIndustry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizedText(candidate.id);
  const label = normalizedText(candidate.label);
  if (!id || !label || typeof candidate.promptBaseline !== "string"
    || typeof candidate.rawScoringAiBaseline !== "string"
    || typeof candidate.standardScoringGuidance !== "string") {
    return null;
  }
  if (candidate.promptBaseline.length > MAX_SIMULATION_SESSION_INDUSTRY_PROMPT_BASELINE_CHARS) {
    return null;
  }
  return {
    id,
    label,
    promptBaseline: candidate.promptBaseline,
    rawScoringAiBaseline: candidate.rawScoringAiBaseline,
    standardScoringGuidance: candidate.standardScoringGuidance,
  };
}

/** Returns null for malformed or unsupported persisted snapshots. */
export function parseSimulationSessionIndustrySnapshot(value: unknown): SimulationSessionIndustrySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== SIMULATION_SESSION_INDUSTRY_SNAPSHOT_VERSION) {
    return null;
  }
  const capturedAt = normalizedIso(candidate.capturedAt);
  const selection = candidate.selection;
  if (!capturedAt || !selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }
  const selectionCandidate = selection as Record<string, unknown>;
  const industryId = selectionCandidate.industryId === null ? null : normalizedText(selectionCandidate.industryId);
  const lockedAt = selectionCandidate.lockedAt === null ? null : normalizedIso(selectionCandidate.lockedAt);
  if ((industryId === null) !== (lockedAt === null) || !Array.isArray(candidate.eligibleIndustries)) {
    return null;
  }
  const eligibleIndustries = candidate.eligibleIndustries.map(parseSnapshotIndustry);
  if (eligibleIndustries.some((industry) => industry === null)) {
    return null;
  }
  const industries = eligibleIndustries as SimulationSessionIndustrySnapshotIndustry[];
  if (new Set(industries.map((industry) => industry.id)).size !== industries.length
    || (industryId !== null && !industries.some((industry) => industry.id === industryId))) {
    return null;
  }
  return {
    version: SIMULATION_SESSION_INDUSTRY_SNAPSHOT_VERSION,
    capturedAt,
    eligibleIndustries: industries,
    selection: { industryId, lockedAt },
  };
}

export function buildSimulationSessionIndustrySnapshot(params: {
  eligibleIndustryIds: readonly string[];
  industries: readonly IndustryDefinition[];
  canonicalIndustries?: readonly IndustryDefinition[];
  capturedAt: Date;
}): SimulationSessionIndustrySnapshot {
  const seen = new Set<string>();
  const eligibleIndustries = params.eligibleIndustryIds.flatMap((industryId) => {
    const id = normalizedText(industryId);
    if (!id || seen.has(id)) {
      return [];
    }
    const industry = params.industries.find((entry) => entry.id === id);
    if (!industry) {
      return [];
    }
    seen.add(id);
    return [{
      id,
      label: industry.label,
      promptBaseline: resolveServerIndustryPromptBaseline({
        industry,
        canonicalIndustries: params.canonicalIndustries,
      }),
      rawScoringAiBaseline: industry.aiBaseline ?? "",
      standardScoringGuidance: industry.standardScoringGuidance ?? "",
    }];
  });
  return {
    version: SIMULATION_SESSION_INDUSTRY_SNAPSHOT_VERSION,
    capturedAt: params.capturedAt.toISOString(),
    eligibleIndustries,
    selection: { industryId: null, lockedAt: null },
  };
}

export function resolveSnapshotIndustry(snapshot: SimulationSessionIndustrySnapshot, industryId: string | null): SimulationSessionIndustrySnapshotIndustry | null {
  if (!industryId) {
    return null;
  }
  return snapshot.eligibleIndustries.find((industry) => industry.id === industryId) ?? null;
}
