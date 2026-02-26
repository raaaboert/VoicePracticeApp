import { Difficulty, PersonaStyle, Scenario } from "@voicepractice/shared";

export const AI_PROMPT_VERSION = "2026-02-23.v2";
export const AI_RUBRIC_VERSION = "2026-02-16.v1";

const DIFFICULTY_BEHAVIOR: Record<Difficulty, string> = {
  easy:
    "Show only light resistance. If the user communicates clearly and confidently, become cooperative within a few turns.",
  medium:
    "Raise meaningful objections and counterpoints. Stay challenging but be willing to compromise after solid reasoning.",
  hard:
    "Be highly resistant and skeptical. Do not concede unless the user provides very strong logic, evidence, and emotional control."
};

const PERSONA_BEHAVIOR: Record<PersonaStyle, string> = {
  defensive:
    "Tone style: defensive. Protect your position, deflect blame, and require reassurance before shifting.",
  frustrated:
    "Tone style: frustrated. Sound impatient and stressed, insist on concrete actions and timelines.",
  skeptical:
    "Tone style: skeptical. Stay calm but doubtful, ask for proof and challenge vague claims."
};

export function buildRoleplaySystemPrompt(params: {
  scenario: Scenario;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  industryLabel?: string | null;
  industryBaseline?: string | null;
}): string {
  const { scenario, difficulty, segmentLabel, personaStyle } = params;
  const industryBaseline = params.industryBaseline?.trim() ?? "";
  const lines = [
    "You are a role-play opponent in a voice-based professional simulation.",
    `The user is acting as a ${segmentLabel}.`,
  ];

  if (params.industryLabel?.trim()) {
    lines.push(`Selected industry: ${params.industryLabel.trim()}`);
  }

  if (industryBaseline) {
    lines.push(`Industry baseline guidance for this conversation:\n${industryBaseline}`);
  }

  lines.push(
    `You are playing the role of ${scenario.aiRole}.`,
    `Scenario context: ${scenario.description}`,
    `Difficulty behavior: ${DIFFICULTY_BEHAVIOR[difficulty]}`,
    `Persona behavior: ${PERSONA_BEHAVIOR[personaStyle]}`,
    "Stay in character and do not mention being an AI model.",
    "Respond in 1-3 concise spoken sentences each turn.",
    "Keep the conversation realistic, emotionally believable, and professional.",
    "Only become convinced when the user's reasoning and communication quality deserve it for the selected difficulty."
  );

  return lines.join("\n");
}

export function buildOpeningPrompt(scenario: Scenario): string {
  return [
    "Start the role-play now with your first line.",
    `Set the scene for this scenario in natural dialogue: ${scenario.title}.`,
    "Keep the opening to 1-2 short sentences."
  ].join(" ");
}

export function buildEvaluationSystemPrompt(params: {
  scenario: Scenario;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  industryLabel?: string | null;
  industryBaseline?: string | null;
  scoringGuidance?: string | null;
}): string {
  const lines = [
    "You are an expert communication coach evaluating a role-play simulation.",
    `Segment: ${params.segmentLabel}`,
  ];

  if (params.industryLabel?.trim()) {
    lines.push(`Industry: ${params.industryLabel.trim()}`);
  }

  if ((params.industryBaseline?.trim() ?? "").length > 0) {
    lines.push(
      `Industry baseline guidance (soft reference only; prioritize communication quality over domain specifics):\n${params.industryBaseline?.trim()}`
    );
  }

  lines.push(
    `Scenario: ${params.scenario.title}`,
    `Difficulty: ${params.difficulty}`,
    `Persona style: ${params.personaStyle}`,
  );

  if ((params.scoringGuidance?.trim() ?? "").length > 0) {
    lines.push(
      `Scenario-specific scoring guidance (prioritize when evaluating the USER):\n${params.scoringGuidance?.trim()}`
    );
  }

  lines.push(
    "Grade only the USER performance.",
    "Return ONLY strict JSON with this exact schema:",
    '{"overallScore":number(0-100),"persuasion":number(1-10),"clarity":number(1-10),"empathy":number(1-10),"assertiveness":number(1-10),"strengths":[string,string,string],"improvements":[string,string,string],"summary":string}',
    "Use higher standards for hard difficulty.",
    "Keep strengths and improvements concrete and actionable."
  );

  return lines.join("\n");
}

export function formatDialogueForEvaluation(history: Array<{ role: "user" | "assistant"; content: string }>): string {
  return history
    .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content}`)
    .join("\n");
}
