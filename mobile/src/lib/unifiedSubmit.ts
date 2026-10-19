import { MobileApiError, isSimulationSessionEndedError } from "./apiError";

const CLEARED_SUBMITTED_TURN_MESSAGE = "Simulation assistant reply is no longer pending for this correlationId.";

export function shouldFallbackToLegacyUnifiedSubmit(error: unknown): boolean {
  if (isSimulationSessionEndedError(error)) return false;
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("request failed (404)") ||
    message.includes("request failed (405)") ||
    message.includes("request failed (501)") ||
    message === "not found" ||
    /\b(route|endpoint)\s+(?:is\s+)?not found\b/.test(message)
  );
}

export function shouldFallbackToLegacyAssistantReply(error: unknown): boolean {
  return shouldFallbackToLegacyUnifiedSubmit(error);
}

export function isExpiredSubmittedTurnAwait(error: unknown): boolean {
  // A closed conversation must finish/recover scoring, never generate a fresh reply.
  if (isSimulationSessionEndedError(error)) return false;
  // Only this user-bound recovery response establishes settled/cleaned work.
  // A generic 410, an expired session, or a gateway timeout cannot do so.
  return error instanceof MobileApiError && error.status === 410
    && error.message.trim() === CLEARED_SUBMITTED_TURN_MESSAGE;
}

export function isTerminalSubmittedTurnRecoveryAwait(error: unknown): boolean {
  // The deployed await route returns the same 504 for no entry and still-running
  // work, without cancelling it. Keep its correlation ID for read-only recovery.
  return isSimulationSessionEndedError(error) || isExpiredSubmittedTurnAwait(error);
}

export function isUsableSimulationTranscript(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length >= 2 && /[A-Za-z0-9]/.test(trimmed);
}

export function isUsableAwaitedAssistantReply(value: {
  outcome?: unknown;
  assistantText?: unknown;
}): value is { outcome: "assistant_reply"; assistantText: string } {
  return value.outcome === "assistant_reply" && isUsableSimulationTranscript(value.assistantText);
}
