const BREAK_RESISTANT_SPACES = /[\u00a0\u2007\u202f]/g;
const INVISIBLE_JOIN_CONTROLS = /[\u200b\u2060]/g;

export function normalizeTranscriptText(value: string): string {
  return value
    .replace(BREAK_RESISTANT_SPACES, " ")
    .replace(INVISIBLE_JOIN_CONTROLS, "");
}
