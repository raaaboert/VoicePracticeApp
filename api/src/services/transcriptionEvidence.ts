/** Whisper's verbose segment evidence is provider metadata, not a phrase ban.
 * New file transcription uses server VAD; never infer silence from the words. */
export function trustedTranscriptionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("Invalid transcription response.");
  const response = payload as { text?: unknown; segments?: unknown };
  if (typeof response.text !== "string") throw new Error("Invalid transcription text.");
  if (Array.isArray(response.segments) && response.segments.length) {
    const allNoSpeech = response.segments.every(segment => {
      if (!segment || typeof segment !== "object") return false;
      const s = segment as { no_speech_prob?: unknown; avg_logprob?: unknown };
      return typeof s.no_speech_prob === "number" && Number.isFinite(s.no_speech_prob) && s.no_speech_prob >= 0.9
        && s.no_speech_prob <= 1 && typeof s.avg_logprob === "number" && Number.isFinite(s.avg_logprob) && s.avg_logprob < -0.5;
    });
    if (allNoSpeech) return "";
  }
  return response.text.trim();
}
