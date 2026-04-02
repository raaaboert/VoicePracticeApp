const FAST_START_MIN_TOTAL_CHARS = 140;
const FAST_START_MIN_FIRST_CHARS = 80;
const FAST_START_MAX_FIRST_CHARS = 190;
const FAST_START_MIN_REMAINDER_CHARS = 40;

export function splitTextForRemoteTtsFastStart(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length < FAST_START_MIN_TOTAL_CHARS) {
    return [text];
  }

  const maxFirstBoundaryIndex = Math.min(
    FAST_START_MAX_FIRST_CHARS - 1,
    trimmed.length - FAST_START_MIN_REMAINDER_CHARS - 1,
  );
  if (maxFirstBoundaryIndex < FAST_START_MIN_FIRST_CHARS - 1) {
    return [text];
  }

  let boundaryIndex = -1;
  for (let index = FAST_START_MIN_FIRST_CHARS - 1; index <= maxFirstBoundaryIndex; index += 1) {
    const char = trimmed[index];
    if (char === "." || char === "!" || char === "?") {
      boundaryIndex = index + 1;
    }
  }

  if (boundaryIndex === -1) {
    return [text];
  }

  const firstChunk = trimmed.slice(0, boundaryIndex).trim();
  const remainderChunk = trimmed.slice(boundaryIndex).trim();
  if (!firstChunk || remainderChunk.length < FAST_START_MIN_REMAINDER_CHARS) {
    return [text];
  }

  return [firstChunk, remainderChunk];
}
