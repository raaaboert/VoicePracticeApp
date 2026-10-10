import type { CustomerPracticeScenario, CustomerPracticeScenarioGeneratedDraft, OrgCustomScenarioProvenance } from "@voicepractice/shared";

import type { ChatMessage } from "../openaiClient.js";
import type { OpenAiScoringModelConfig } from "../openaiModelConfig.js";
import type { CustomerPracticeScenarioGenerationSourceBundle } from "./customerPracticeScenarioGenerationSources.js";

export const CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION = "customer-practice-scenario-generation-v1";
export const CUSTOMER_PRACTICE_SCENARIO_GENERATION_MAX_GUIDANCE_CHARACTERS = 2_000;

export class CustomerPracticeScenarioGenerationError extends Error {
  constructor(message: string, readonly code: "generation_invalid_response" | "generation_failed") {
    super(message);
    this.name = "CustomerPracticeScenarioGenerationError";
  }
}

export interface CustomerPracticeScenarioGenerationResult {
  draft: Omit<CustomerPracticeScenarioGeneratedDraft, "generationToken">;
  serverProvenance: OrgCustomScenarioProvenance;
}

export function buildCustomerPracticeScenarioGenerationMessages(input: {
  sourceText: string;
  practiceGuidance: string | null;
}): ChatMessage[] {
  return [{ role: "system", content: [
    `You create one editable customer practice scenario. Prompt version: ${CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION}.`,
    "Use only the supplied source material and optional author guidance. Do not invent company policies, procedures, claims, or facts.",
    "Return only valid JSON with exactly title, description, desiredOutcome, and aiRole. desiredOutcome may be null.",
    "Keep all fields concise and suitable for an author to review before saving. Do not mention source documents or this instruction.",
  ].join("\n") }, { role: "user", content: `SOURCE MATERIAL:\n${input.sourceText}\n\nOPTIONAL AUTHOR GUIDANCE:\n${input.practiceGuidance ?? "None"}` }];
}

export async function generateCustomerPracticeScenarioDraft(input: {
  sourceBundle: CustomerPracticeScenarioGenerationSourceBundle;
  practiceGuidance: unknown;
  existingScenarios: readonly CustomerPracticeScenario[];
  modelConfig: OpenAiScoringModelConfig;
    complete: (params: { model: string; apiFamily: "chat_completions" | "responses"; messages: ChatMessage[];
    maxOutputTokens: number; reasoningEffort: OpenAiScoringModelConfig["reasoningEffort"]; route: string }) => Promise<{ text: string; model?: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
}): Promise<CustomerPracticeScenarioGenerationResult> {
  const practiceGuidance = normalizeGuidance(input.practiceGuidance);
  let completion: { text: string; model?: string };
  try {
    completion = await input.complete({ model: input.modelConfig.model, apiFamily: input.modelConfig.apiFamily,
      messages: buildCustomerPracticeScenarioGenerationMessages({ sourceText: input.sourceBundle.text, practiceGuidance }),
      maxOutputTokens: input.modelConfig.maxOutputTokens, reasoningEffort: input.modelConfig.reasoningEffort,
      route: "customer_practice_scenario_generation" });
  } catch {
    throw new CustomerPracticeScenarioGenerationError("Scenario generation is unavailable. No draft was created.", "generation_failed");
  }
  const generated = parseGeneratedDraft(completion.text);
  const similarity = findSimilarScenarios(generated, input.existingScenarios);
  return { draft: { ...generated, sourceContentIds: input.sourceBundle.sources.map((source) => source.contentId), similarity,
    promptVersion: CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION },
  serverProvenance: { sourceMode: "scratch", creationMethod: "ai", modelUsed: completion.model?.trim() || input.modelConfig.model,
    generatedPrompt: CUSTOMER_PRACTICE_SCENARIO_GENERATION_PROMPT_VERSION, generatedAt: new Date().toISOString(),
    baseScenarioId: null, baseScenarioTitle: null, baseScenarioSegmentId: null, baseScenarioVersion: null, customizationParams: null } };
}

function normalizeGuidance(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new CustomerPracticeScenarioGenerationError("Practice guidance must be text.", "generation_invalid_response");
  const normalized = value.trim();
  if (normalized.length > CUSTOMER_PRACTICE_SCENARIO_GENERATION_MAX_GUIDANCE_CHARACTERS) {
    throw new CustomerPracticeScenarioGenerationError("Practice guidance is too long.", "generation_invalid_response");
  }
  return normalized || null;
}

function parseGeneratedDraft(text: string): Pick<CustomerPracticeScenarioGeneratedDraft, "title" | "description" | "desiredOutcome" | "aiRole"> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new CustomerPracticeScenarioGenerationError("Scenario generation returned an invalid draft.", "generation_invalid_response"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const record = parsed as Record<string, unknown>;
  const expected = new Set(["title", "description", "desiredOutcome", "aiRole"]);
  if (Object.keys(record).some((key) => !expected.has(key))) throw invalid();
  const title = field(record.title, "Title", 300); const description = field(record.description, "Description", 12_000);
  const aiRole = field(record.aiRole, "AI role", 2_000);
  const desiredOutcome = record.desiredOutcome == null ? null : field(record.desiredOutcome, "Desired outcome", 4_000);
  return { title, description, desiredOutcome, aiRole };
}
function field(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw invalid(`${label} is invalid.`);
  return value.trim();
}
function invalid(message = "Scenario generation returned an invalid draft."): CustomerPracticeScenarioGenerationError {
  return new CustomerPracticeScenarioGenerationError(message, "generation_invalid_response");
}

function findSimilarScenarios(draft: { title: string; description: string }, scenarios: readonly CustomerPracticeScenario[]) {
  const candidate = tokens(`${draft.title} ${draft.description}`);
  const matchingScenarioIds = scenarios.filter((scenario) => jaccard(candidate,
    tokens(`${scenario.currentVersion.title} ${scenario.currentVersion.description}`)) >= 0.72).map((scenario) => scenario.id);
  return { flagged: matchingScenarioIds.length > 0, matchingScenarioIds };
}
function tokens(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []); }
function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0; let overlap = 0; for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / new Set([...left, ...right]).size;
}
