import { Difficulty, PersonaStyle, Scenario } from "../types";

interface LocalReplyParams {
  scenario: Scenario;
  difficulty: Difficulty;
  personaStyle: PersonaStyle;
  turnIndex: number;
  userText: string;
  recentAssistantMessages: string[];
  turnDurationSeconds: number;
}

const OPENING_BY_DIFFICULTY: Record<Difficulty, string> = {
  easy: "I am open to talking this through, but I still have concerns.",
  medium: "I have concerns and I am not convinced yet. You will need to be clear.",
  hard: "I strongly disagree right now. You will need very strong points to change my mind.",
};

const RESISTANCE_LINES: Record<Difficulty, string[]> = {
  easy: [
    "I hear what you are saying. I can work with that.",
    "That helps. I am willing to cooperate if we keep this practical.",
    "I still have questions, but your point makes sense.",
  ],
  medium: [
    "I am not fully convinced. Why is this the best approach?",
    "I understand your point, but I need stronger reasoning.",
    "I can see part of that, though I still have objections.",
  ],
  hard: [
    "That is not enough for me. I need concrete evidence.",
    "I do not agree. You need a stronger argument than that.",
    "I am still unconvinced. Prove this will actually work.",
  ],
};

function scenarioTag(scenario: Scenario): string {
  if (scenario.id.includes("discount")) {
    return "discount";
  }

  if (scenario.id.includes("rumor")) {
    return "rumor";
  }

  if (scenario.id.includes("scope") || scenario.id.includes("client")) {
    return "client";
  }

  if (scenario.id.includes("conflict")) {
    return "conflict";
  }

  if (scenario.id.includes("undermining")) {
    return "authority";
  }

  return "motivation";
}

function scenarioFollowup(tag: string): string[] {
  switch (tag) {
    case "discount":
      return [
        "What additional value are you offering beyond price?",
        "Why should I commit right now instead of waiting?",
        "How are you making this offer worth it for me?",
      ];
    case "rumor":
      return [
        "How can I trust your company after what I heard?",
        "What proof do you have that these rumors are false?",
        "How do I know this will not become my problem later?",
      ];
    case "client":
      return [
        "What is your concrete recovery plan and timeline?",
        "How will you prevent more delays from happening again?",
        "What can you commit to today that is measurable?",
      ];
    case "conflict":
      return [
        "Why should I coordinate with someone I do not trust?",
        "What would fair coordination actually look like to you?",
        "How do you want to handle future disagreements?",
      ];
    case "authority":
      return [
        "Why should I follow your direction when I disagree?",
        "How does your decision help the team outcome?",
        "What changes if I align with your plan now?",
      ];
    default:
      return [
        "What specific steps do you want from me now?",
        "How will this improve the situation immediately?",
        "What support are you asking me to commit to?",
      ];
  }
}

const KEYWORD_GROUPS: Array<{ keywords: string[]; line: string }> = [
  {
    keywords: ["timeline", "deadline", "date", "schedule", "week", "month"],
    line: "Your timeline sounds optimistic. What makes it realistic this time?",
  },
  {
    keywords: ["budget", "cost", "price", "discount", "value"],
    line: "Talk me through the business value, not just the number.",
  },
  {
    keywords: ["trust", "proof", "evidence", "data", "fact"],
    line: "What evidence can you share right now that supports your claim?",
  },
  {
    keywords: ["risk", "concern", "issue", "problem", "delay"],
    line: "How are you reducing risk from this point forward?",
  },
  {
    keywords: ["plan", "step", "action", "next", "commit"],
    line: "Be specific. What are the next two actions and who owns them?",
  },
];

const EASING_LINES: Record<Difficulty, string[]> = {
  easy: [
    "That is clearer. I am more open if you can confirm ownership and next steps.",
    "Okay, I can work with that approach.",
    "I am starting to see your point.",
  ],
  medium: [
    "That helps, but I still need stronger commitment details.",
    "I can accept parts of this if your follow-through is strong.",
    "You are making progress, but I still need confidence in execution.",
  ],
  hard: [
    "I still have major doubts, but your argument is more structured now.",
    "That is better, but I am far from fully convinced.",
    "You improved your case, but I need even stronger proof.",
  ],
};

const AGREEMENT_THRESHOLDS: Record<Difficulty, number> = {
  easy: 3,
  medium: 5,
  hard: 8,
};

const PERSONA_STYLE_ADJUSTMENT: Record<PersonaStyle, number> = {
  defensive: 1,
  frustrated: -1,
  skeptical: 1,
};

const PERSONA_TONE_LEADS: Record<PersonaStyle, string[]> = {
  defensive: [
    "From my side, this has felt unfair.",
    "I need to protect my position here.",
    "I am not comfortable taking all the blame for this.",
  ],
  frustrated: [
    "We have been stuck on this too long.",
    "I need this solved quickly, not discussed forever.",
    "I am frustrated with where this stands right now.",
  ],
  skeptical: [
    "I still see gaps in what you are saying.",
    "I am listening, but I am not convinced yet.",
    "I need to believe this with evidence, not promises.",
  ],
};

function chooseNonRepeatingLine(
  candidates: string[],
  recentAssistantMessages: string[],
  seed = 0,
): string {
  const recent = recentAssistantMessages.slice(-4).join(" ").toLowerCase();
  const size = candidates.length;
  if (size === 0) {
    return "";
  }

  const rotated: string[] = [];
  for (let offset = 0; offset < size; offset += 1) {
    rotated.push(candidates[(seed + offset) % size]);
  }

  const nonRepeated = rotated.filter((line) => !recent.includes(line.toLowerCase()));
  return nonRepeated.length > 0 ? nonRepeated[0] : rotated[0];
}

function inferKeywordLine(userText: string): string | null {
  const normalized = userText.toLowerCase();

  for (const group of KEYWORD_GROUPS) {
    if (group.keywords.some((keyword) => normalized.includes(keyword))) {
      return group.line;
    }
  }

  return null;
}

function shouldEaseUp(difficulty: Difficulty, turnIndex: number): boolean {
  if (difficulty === "easy") {
    return turnIndex >= 1;
  }

  if (difficulty === "medium") {
    return turnIndex >= 3;
  }

  return turnIndex >= 5;
}

function confidenceBonusFromDuration(turnDurationSeconds: number): number {
  if (turnDurationSeconds >= 8) {
    return 2;
  }

  if (turnDurationSeconds >= 5) {
    return 1;
  }

  if (turnDurationSeconds <= 2) {
    return -1;
  }

  return 0;
}

function shortResponsePrompt(tag: string, personaStyle: PersonaStyle): string {
  const personaNudge =
    personaStyle === "frustrated"
      ? "I need an answer that is direct and actionable."
      : personaStyle === "skeptical"
        ? "Give me something concrete I can believe."
        : "I need specifics before I can move on.";

  switch (tag) {
    case "discount":
      return `That was brief. Explain exactly why this discount is fair. ${personaNudge}`;
    case "rumor":
      return `That was vague. Give me a concrete fact I can trust. ${personaNudge}`;
    case "client":
      return `That was not specific. I need dates, owners, and milestones. ${personaNudge}`;
    case "conflict":
      return `That felt generic. Tell me the exact behavior change you expect. ${personaNudge}`;
    case "authority":
      return `That was broad. Be specific about what direction I should follow. ${personaNudge}`;
    default:
      return `That was not specific enough. What exact action do you need from me? ${personaNudge}`;
  }
}

function agreementLine(tag: string, personaStyle: PersonaStyle): string {
  let base = "";
  switch (tag) {
    case "discount":
      base = "All right, I can move forward if the offer details are confirmed in writing today.";
      break;
    case "rumor":
      base = "Okay, that clears up most concerns. I am willing to continue.";
      break;
    case "client":
      base = "I can work with that plan if we hold to those commitments.";
      break;
    case "conflict":
      base = "Fine. I am willing to reset and coordinate constructively.";
      break;
    case "authority":
      base = "Understood. I can align with that direction going forward.";
      break;
    default:
      base = "That is fair. I can commit to this plan.";
      break;
  }

  if (personaStyle === "defensive") {
    return `If we are clear on expectations, ${base.toLowerCase()}`;
  }

  if (personaStyle === "frustrated") {
    return `${base} Let us lock this in and move.`;
  }

  return base;
}

function closingQuestion(tag: string): string {
  switch (tag) {
    case "discount":
      return "What are the final next steps to close this today?";
    case "rumor":
      return "What do you need from me to proceed confidently?";
    case "client":
      return "What is the first checkpoint and when will it happen?";
    case "conflict":
      return "How do we keep this working over the next few weeks?";
    case "authority":
      return "What are the first priorities you want me to execute?";
    default:
      return "What is the first action we should lock in right now?";
  }
}

function scenarioContextLine(tag: string): string {
  switch (tag) {
    case "discount":
      return "You already gave me your best discount, and I still feel this is not enough.";
    case "rumor":
      return "I heard negative things about your company and I am not comfortable moving forward yet.";
    case "client":
      return "Delivery keeps slipping, and I am frustrated with the constant scope confusion.";
    case "conflict":
      return "Working with the other team member has been frustrating, and I do not want to keep compromising.";
    case "authority":
      return "I have not agreed with your direction, and I have been pushing back on your decisions.";
    default:
      return "I have been struggling to stay motivated and keep up with what is expected.";
  }
}

function personaKickoffLead(personaStyle: PersonaStyle): string {
  if (personaStyle === "defensive") {
    return "I feel like I have had to defend myself in every conversation.";
  }

  if (personaStyle === "frustrated") {
    return "I am frustrated and I need this resolved now.";
  }

  return "I am skeptical and need proof before I shift my position.";
}

function applyPersonaTone(
  response: string,
  personaStyle: PersonaStyle,
  turnIndex: number,
  recentAssistantMessages: string[],
): string {
  const lead = chooseNonRepeatingLine(
    PERSONA_TONE_LEADS[personaStyle],
    recentAssistantMessages,
    turnIndex + 11,
  );
  return `${lead} ${response}`;
}

export function createLocalOpeningLine(
  scenario: Scenario,
  difficulty: Difficulty,
  personaStyle: PersonaStyle,
): string {
  return `${OPENING_BY_DIFFICULTY[difficulty]} ${personaKickoffLead(personaStyle)} ${scenario.description}`;
}

export function createLocalSessionKickoffLine(
  scenario: Scenario,
  personaStyle: PersonaStyle,
): string {
  const tag = scenarioTag(scenario);
  return `Before we continue, here is where I am at: ${personaKickoffLead(personaStyle)} ${scenarioContextLine(tag)} What are you going to do about it?`;
}

export function createLocalAssistantReply(params: LocalReplyParams): string {
  const lines = RESISTANCE_LINES[params.difficulty];
  const tag = scenarioTag(params.scenario);
  const followupChoices = scenarioFollowup(tag);
  const confidenceBonus = confidenceBonusFromDuration(params.turnDurationSeconds);
  const personaAdjustment = PERSONA_STYLE_ADJUSTMENT[params.personaStyle];
  const effectiveTurnIndex = Math.max(0, params.turnIndex + confidenceBonus + personaAdjustment);
  const seed = params.turnIndex * 7 + Math.max(0, confidenceBonus);

  const resistanceLine = chooseNonRepeatingLine(lines, params.recentAssistantMessages, seed);
  const followupLine = chooseNonRepeatingLine(
    followupChoices,
    params.recentAssistantMessages,
    seed + 1,
  );
  const keywordLine = inferKeywordLine(params.userText);

  if (params.turnDurationSeconds <= 2) {
    return applyPersonaTone(
      shortResponsePrompt(tag, params.personaStyle),
      params.personaStyle,
      params.turnIndex,
      params.recentAssistantMessages,
    );
  }

  if (effectiveTurnIndex >= AGREEMENT_THRESHOLDS[params.difficulty]) {
    return applyPersonaTone(
      `${agreementLine(tag, params.personaStyle)} ${closingQuestion(tag)}`,
      params.personaStyle,
      params.turnIndex,
      params.recentAssistantMessages,
    );
  }

  if (keywordLine) {
    const nonRepeatingKeywordLine = chooseNonRepeatingLine(
      [keywordLine, followupLine],
      params.recentAssistantMessages,
      seed + 2,
    );
    return applyPersonaTone(
      `${resistanceLine} ${nonRepeatingKeywordLine}`,
      params.personaStyle,
      params.turnIndex,
      params.recentAssistantMessages,
    );
  }

  if (shouldEaseUp(params.difficulty, effectiveTurnIndex)) {
    const easing = chooseNonRepeatingLine(
      EASING_LINES[params.difficulty],
      params.recentAssistantMessages,
      seed + 3,
    );
    return applyPersonaTone(
      `${easing} ${followupLine}`,
      params.personaStyle,
      params.turnIndex,
      params.recentAssistantMessages,
    );
  }

  return applyPersonaTone(
    `${resistanceLine} ${followupLine}`,
    params.personaStyle,
    params.turnIndex,
    params.recentAssistantMessages,
  );
}
