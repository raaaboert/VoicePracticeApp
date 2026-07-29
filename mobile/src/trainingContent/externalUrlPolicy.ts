export function sanitizeTrainingContentLink(
  rawUrl: string,
  options: { allowMailto?: boolean } = {}
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
      return parsed.toString();
    }
    if (
      options.allowMailto
      && parsed.protocol === "mailto:"
      && !parsed.username
      && !parsed.password
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}
