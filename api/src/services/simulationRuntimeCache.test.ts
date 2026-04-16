import { Difficulty, PersonaStyle, Scenario, SegmentDefinition } from "@voicepractice/shared";

import { createSimulationRuntimeCache } from "./simulationRuntimeCache.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-runtime-cache.test] PASS ${name}`);
}

const segment: SegmentDefinition = {
  id: "sales",
  label: "Sales",
  summary: "Sales summary",
  enabled: true,
  scenarios: [],
};

const scenario: Scenario = {
  id: "scenario_sales_1",
  segmentId: "sales",
  title: "Sales call",
  summary: "summary",
  description: "description",
  aiRole: "buyer",
  enabled: true,
};

function createLookupInput(overrides?: Partial<{
  simulationSessionId: string | null;
  userId: string;
  actingOrgId: string | null;
  scenarioId: string;
  trainingId: string | null;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  requestedIndustryId: string | null;
  submittedTrainingPackId: string | null;
  useModularPromptArchitecture: boolean;
}>) {
  return {
    simulationSessionId: overrides && "simulationSessionId" in overrides ? overrides.simulationSessionId ?? null : "sim_1",
    userId: overrides && "userId" in overrides ? overrides.userId ?? "user_1" : "user_1",
    actingOrgId: overrides && "actingOrgId" in overrides ? overrides.actingOrgId ?? null : "org_1",
    scenarioId: overrides && "scenarioId" in overrides ? overrides.scenarioId ?? scenario.id : scenario.id,
    trainingId: overrides && "trainingId" in overrides ? overrides.trainingId ?? null : null,
    difficulty: overrides && "difficulty" in overrides ? overrides.difficulty ?? "medium" : "medium",
    personaStyle: overrides && "personaStyle" in overrides ? overrides.personaStyle ?? "skeptical" : "skeptical",
    requestedIndustryId:
      overrides && "requestedIndustryId" in overrides ? overrides.requestedIndustryId ?? null : "sales",
    submittedTrainingPackId:
      overrides && "submittedTrainingPackId" in overrides ? overrides.submittedTrainingPackId ?? null : "pack_1",
    useModularPromptArchitecture:
      overrides && "useModularPromptArchitecture" in overrides
        ? overrides.useModularPromptArchitecture ?? true
        : true,
  };
}

function createValue() {
  return {
    source: "standard" as const,
    segment,
    scenario,
    difficulty: "medium" as Difficulty,
    personaStyle: "skeptical" as PersonaStyle,
    industryId: "sales",
    industryLabel: "Sales",
    industryBaseline: "baseline",
    divisionId: null,
    counterpartBehaviorGuidance: "counterpart guidance",
    useModularPromptArchitecture: true,
    activeTrainingPack: null,
    systemPrompt: "system prompt",
    openingPrompt: "opening prompt",
  };
}

runTest("returns a hit for the same session fingerprint", () => {
  const cache = createSimulationRuntimeCache();
  const input = createLookupInput();
  cache.write(input, createValue());

  const result = cache.read(input);
  assert(result.status === "hit", "expected a cache hit");
  assert(result.value?.systemPrompt === "system prompt", "expected cached prompt to round-trip");
});

runTest("misses when the fingerprint changes within the same session id", () => {
  const cache = createSimulationRuntimeCache();
  const input = createLookupInput();
  cache.write(input, createValue());

  const result = cache.read(createLookupInput({ submittedTrainingPackId: "pack_2" }));
  assert(result.status === "miss", "training-pack mismatch should miss");
  assert(result.reason === "fingerprint_mismatch", "miss reason should explain the mismatch");
});

runTest("expires stale entries", () => {
  let currentNow = 1_000;
  const cache = createSimulationRuntimeCache({
    ttlMs: 200,
    now: () => currentNow,
  });
  const input = createLookupInput();
  cache.write(input, createValue());

  currentNow = 1_100;
  assert(cache.read(input).status === "hit", "entry should still be live before ttl");

  currentNow = 1_310;
  const result = cache.read(input);
  assert(result.status === "miss", "entry should expire after ttl");
  assert(result.reason === "not_found", "expired entry should be pruned before read");
});

runTest("bypasses cache when a recognized simulation session id is missing", () => {
  const cache = createSimulationRuntimeCache();
  const result = cache.read(createLookupInput({ simulationSessionId: null }));
  assert(result.status === "bypass", "missing session id should bypass the cache");
});
