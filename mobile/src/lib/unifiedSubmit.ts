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

export function isUsableSimulationTranscript(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isUsableAwaitedAssistantReply(value: {
  outcome?: unknown;
  assistantText?: unknown;
}): value is { outcome: "assistant_reply"; assistantText: string } {
  return value.outcome === "assistant_reply" && isUsableSimulationTranscript(value.assistantText);
}
