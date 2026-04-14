import { Difficulty, PersonaStyle, Scenario, SegmentDefinition, TrainingPack } from "@voicepractice/shared";

export type SimulationRuntimeCacheStatus = "hit" | "miss" | "bypass";

export interface SimulationRuntimeCacheLookupInput {
  simulationSessionId: string | null | undefined;
  userId: string;
  actingOrgId: string | null | undefined;
  scenarioId: string;
  trainingId: string | null | undefined;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  requestedIndustryId: string | null | undefined;
  submittedTrainingPackId: string | null | undefined;
  useModularPromptArchitecture: boolean;
}

export interface SimulationRuntimeCacheValue {
  segment: SegmentDefinition;
  scenario: Scenario;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  industryId: string | null;
  industryLabel: string | null;
  industryBaseline: string | null;
  counterpartBehaviorGuidance: string | null;
  useModularPromptArchitecture: boolean;
  activeTrainingPack: TrainingPack | null;
  systemPrompt: string;
  openingPrompt: string;
}

interface SimulationRuntimeCacheEntry {
  key: string;
  normalizedSessionId: string;
  userId: string;
  actingOrgId: string | null;
  scenarioId: string;
  trainingId: string | null;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  requestedIndustryId: string | null;
  submittedTrainingPackId: string | null;
  useModularPromptArchitecture: boolean;
  value: SimulationRuntimeCacheValue;
  createdAtMs: number;
  lastAccessedAtMs: number;
}

export interface SimulationRuntimeCacheReadResult {
  status: SimulationRuntimeCacheStatus;
  value: SimulationRuntimeCacheValue | null;
  reason?: string;
}

export interface CreateSimulationRuntimeCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function buildFingerprint(input: SimulationRuntimeCacheLookupInput): Omit<SimulationRuntimeCacheEntry, "key" | "value" | "createdAtMs" | "lastAccessedAtMs"> | null {
  const normalizedSessionId = normalizeOptionalId(input.simulationSessionId);
  const userId = normalizeOptionalId(input.userId);
  const scenarioId = normalizeOptionalId(input.scenarioId);
  if (!normalizedSessionId || !userId || !scenarioId) {
    return null;
  }

  return {
    normalizedSessionId,
    userId,
    actingOrgId: normalizeOptionalId(input.actingOrgId),
    scenarioId,
    trainingId: normalizeOptionalId(input.trainingId),
    difficulty: input.difficulty,
    personaStyle: input.personaStyle,
    requestedIndustryId: normalizeOptionalId(input.requestedIndustryId),
    submittedTrainingPackId: normalizeOptionalId(input.submittedTrainingPackId),
    useModularPromptArchitecture: input.useModularPromptArchitecture,
  };
}

function matchesFingerprint(
  entry: SimulationRuntimeCacheEntry,
  fingerprint: Omit<SimulationRuntimeCacheEntry, "key" | "value" | "createdAtMs" | "lastAccessedAtMs">,
): boolean {
  return (
    entry.normalizedSessionId === fingerprint.normalizedSessionId &&
    entry.userId === fingerprint.userId &&
    entry.actingOrgId === fingerprint.actingOrgId &&
    entry.scenarioId === fingerprint.scenarioId &&
    entry.trainingId === fingerprint.trainingId &&
    entry.difficulty === fingerprint.difficulty &&
    entry.personaStyle === fingerprint.personaStyle &&
    entry.requestedIndustryId === fingerprint.requestedIndustryId &&
    entry.submittedTrainingPackId === fingerprint.submittedTrainingPackId &&
    entry.useModularPromptArchitecture === fingerprint.useModularPromptArchitecture
  );
}

export function createSimulationRuntimeCache(options?: CreateSimulationRuntimeCacheOptions) {
  const ttlMs = typeof options?.ttlMs === "number" && Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? Math.floor(options.ttlMs)
    : 2 * 60 * 60 * 1000;
  const maxEntries = typeof options?.maxEntries === "number" && Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? Math.floor(options.maxEntries)
    : 500;
  const now = options?.now ?? (() => Date.now());
  const entries = new Map<string, SimulationRuntimeCacheEntry>();

  const pruneExpired = (referenceNow: number) => {
    for (const [key, entry] of entries) {
      if (referenceNow - entry.lastAccessedAtMs >= ttlMs) {
        entries.delete(key);
      }
    }
  };

  const pruneOverflow = () => {
    if (entries.size <= maxEntries) {
      return;
    }

    const sortedByLastAccess = [...entries.values()].sort((left, right) => left.lastAccessedAtMs - right.lastAccessedAtMs);
    for (const entry of sortedByLastAccess) {
      if (entries.size <= maxEntries) {
        break;
      }
      entries.delete(entry.key);
    }
  };

  return {
    read(input: SimulationRuntimeCacheLookupInput): SimulationRuntimeCacheReadResult {
      const fingerprint = buildFingerprint(input);
      if (!fingerprint) {
        return { status: "bypass", value: null, reason: "missing_session_fingerprint" };
      }

      const currentNow = now();
      pruneExpired(currentNow);
      const entry = entries.get(fingerprint.normalizedSessionId);
      if (!entry) {
        return { status: "miss", value: null, reason: "not_found" };
      }

      if (!matchesFingerprint(entry, fingerprint)) {
        return { status: "miss", value: null, reason: "fingerprint_mismatch" };
      }

      entry.lastAccessedAtMs = currentNow;
      return { status: "hit", value: entry.value };
    },

    write(input: SimulationRuntimeCacheLookupInput, value: SimulationRuntimeCacheValue): void {
      const fingerprint = buildFingerprint(input);
      if (!fingerprint) {
        return;
      }

      const currentNow = now();
      pruneExpired(currentNow);
      entries.set(fingerprint.normalizedSessionId, {
        key: fingerprint.normalizedSessionId,
        ...fingerprint,
        value,
        createdAtMs: currentNow,
        lastAccessedAtMs: currentNow,
      });
      pruneOverflow();
    },

    clear(simulationSessionId?: string | null): void {
      const normalizedSessionId = normalizeOptionalId(simulationSessionId);
      if (!normalizedSessionId) {
        entries.clear();
        return;
      }
      entries.delete(normalizedSessionId);
    },

    size(): number {
      return entries.size;
    },
  };
}
