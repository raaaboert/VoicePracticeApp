export function playbackSecondsToMilliseconds(seconds: number): number {
  return seconds * 1000;
}

export function getKnownPlaybackDurationMilliseconds(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds > 0 ? playbackSecondsToMilliseconds(seconds) : null;
}
