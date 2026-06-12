export function shouldFallbackToLegacyUnifiedSubmit(error: unknown): boolean {
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
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("request failed (410)") ||
    message.includes("no longer pending") ||
    message.includes("already cleaned") ||
    message.includes("expired")
  );
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
