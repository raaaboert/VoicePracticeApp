import { Difficulty, PersonaStyle, Scenario } from "../types";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: "Mild resistance. Assertive communication should move things forward.",
  medium: "Noticeable pushback and counterpoints, but still open to reason.",
  hard: "Strong resistance. Only excellent arguments and evidence should persuade.",
};

export const PERSONA_LABELS: Record<PersonaStyle, string> = {
  defensive: "Defensive",
  frustrated: "Frustrated",
  skeptical: "Skeptical",
};

export const PERSONA_HINTS: Record<PersonaStyle, string> = {
  defensive: "Protective posture. Pushes back quickly and justifies prior behavior.",
  frustrated: "Emotionally tense. Wants fast solutions and clear accountability.",
  skeptical: "Calm but doubtful. Demands evidence and challenges assumptions.",
};

const DIFFICULTY_BEHAVIOR: Record<Difficulty, string> = {
  easy:
    "Show only light resistance. If the user communicates clearly and confidently, become cooperative within a few turns.",
  medium:
    "Raise meaningful objections and counterpoints. Stay challenging but be willing to compromise after solid reasoning.",
  hard:
    "Be highly resistant and skeptical. Do not concede unless the user provides very strong logic, evidence, and emotional control.",
};

const PERSONA_BEHAVIOR: Record<PersonaStyle, string> = {
  defensive:
    "Tone style: defensive. Protect your position, deflect blame, and require reassurance before shifting.",
  frustrated:
    "Tone style: frustrated. Sound impatient and stressed, insist on concrete actions and timelines.",
  skeptical:
    "Tone style: skeptical. Stay calm but doubtful, ask for proof and challenge vague claims.",
};

export function buildRoleplaySystemPrompt(
  scenario: Scenario,
  difficulty: Difficulty,
  segmentLabel: string,
  personaStyle: PersonaStyle,
): string {
  return [
    "You are a role-play opponent in a voice-based professional simulation.",
    `The user is acting as a ${segmentLabel}.`,
    `You are playing the role of ${scenario.aiRole}.`,
    `Scenario context: ${scenario.description}`,
    `Difficulty behavior: ${DIFFICULTY_BEHAVIOR[difficulty]}`,
    `Persona behavior: ${PERSONA_BEHAVIOR[personaStyle]}`,
    "Stay in character and do not mention being an AI model.",
    "Respond in 1-3 concise spoken sentences each turn.",
    "Keep the conversation realistic, emotionally believable, and professional.",
    "Only become convinced when the user's reasoning and communication quality deserve it for the selected difficulty.",
  ].join("\n");
}

export function buildOpeningPrompt(scenario: Scenario): string {
  return [
    "Start the role-play now with your first line.",
    `Set the scene for this scenario in natural dialogue: ${scenario.title}.`,
    "Keep the opening to 1-2 short sentences.",
  ].join(" ");
}
