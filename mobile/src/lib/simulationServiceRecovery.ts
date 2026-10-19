import { MobileApiError } from "./apiError";

export function isDevelopmentSimulationMockEnabled(development: boolean, optIn: string | undefined, apiConfigured: boolean): boolean {
  return development && optIn === "true" && !apiConfigured;
}

export function describeSimulationServiceFailure(error: unknown): { kind: "auth" | "allowance" | "budget" | "throttled" | "unavailable" | "denied"; message: string } {
  if (error instanceof MobileApiError) {
    if (error.status === 401) return { kind: "auth", message: "Your sign-in session has expired. Sign in again to continue." };
    // These are established safe entitlement explanations, including older APIs without codes.
    if ([403, 429].includes(error.status) && /^(Daily plan limit reached\.|User daily time allotment reached\.|Organization monthly allotment reached\.)$/.test(error.message)) {
      return { kind: "allowance", message: `${error.message} Check your allowance in Setup or contact your organization admin.` };
    }
    if (error.code === "ai_budget_limit" || (error.status === 429 && /^Daily AI (request|token) limit reached for this (account|environment)\.$/.test(error.message))) {
      return { kind: "budget", message: "The AI service's daily request or token limit has been reached. Please try again later." };
    }
    if (error.status === 429) return { kind: "throttled", message: "The service is temporarily limiting requests. Please wait before trying again." };
    if (error.status >= 400 && error.status < 500 && error.status !== 408) return { kind: "denied", message: "This session cannot continue. Return to Setup to check your access and scenario." };
  }
  return { kind: "unavailable", message: "The AI service is temporarily unavailable. Your last response may not have been confirmed." };
}

/** One session's recovery decision; never retries a POST or manufactures dialogue. */
export function createSimulationServiceRecovery() {
  return {
    failure: null as (ReturnType<typeof describeSimulationServiceFailure> & { retry: "start" | "submitted" | "recording" | "record_again" | "none" }) | null,
    scoringBlocked: false,
    interrupt(error: unknown, phase: "start" | "transcription" | "turn", pendingSubmittedTurn: boolean) {
      const description = describeSimulationServiceFailure(error);
      const recoverable = description.kind === "unavailable" || description.kind === "throttled";
      const retry = !recoverable ? "none" : phase === "start" ? "start"
        : pendingSubmittedTurn ? "submitted" : phase === "transcription" ? "recording" : "none";
      if (phase === "turn" && !pendingSubmittedTurn) this.scoringBlocked = true;
      this.failure = { ...description, retry };
      return this.failure;
    },
    discardedSubmittedTurn() {
      // Do not clear a separate, earlier ambiguity that legitimately blocks scoring.
      this.failure = { kind: "unavailable", retry: "record_again",
        message: "Your interrupted response could not be recovered. Tap Record Again to record a new response." };
      return this.failure;
    },
    recovered() { this.failure = null; },
  };
}

export function getSimulationCompletionPolicy(input: { conversationStarted: boolean; usedMockMode: boolean; scoringBlocked?: boolean }) {
  return { recordUsage: input.conversationStarted && !input.usedMockMode,
    requestScore: input.conversationStarted && !input.usedMockMode && !input.scoringBlocked };
}
