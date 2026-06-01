export function shouldFallbackToLegacyUnifiedSubmit(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("request failed (404)") ||
    message.includes("request failed (405)") ||
    message.includes("request failed (501)") ||
    message.includes("not found")
  );
}

export function shouldFallbackToLegacyAssistantReply(error: unknown): boolean {
  return shouldFallbackToLegacyUnifiedSubmit(error);
}

export function isUsableSimulationTranscript(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
