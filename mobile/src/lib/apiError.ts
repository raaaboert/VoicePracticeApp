export interface MobileApiErrorPayload {
  error?: unknown;
  code?: unknown;
}

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export function createMobileApiError(
  status: number,
  payload: MobileApiErrorPayload | null
): MobileApiError {
  const message =
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : `Request failed (${status})`;
  const code =
    typeof payload?.code === "string" && payload.code.trim()
      ? payload.code.trim()
      : null;
  return new MobileApiError(message, status, code);
}

export function isOrganizationAccessRequiredError(error: unknown): boolean {
  return error instanceof MobileApiError && error.code === "ORG_ACCESS_REQUIRED";
}

export function isTransientRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof MobileApiError) {
    if (["ai_timeout", "ai_budget_limit", "ai_unavailable", "score_generation_failed"].includes(error.code ?? "")) {
      return true;
    }
    return [408, 429, 502, 503, 504].includes(error.status);
  }
  const message = error.message.toLowerCase();
  return ["request timed out", "request failed (429)", "request failed (502)",
    "request failed (503)", "request failed (504)", "network request failed",
    "failed to fetch", "networkerror"].some((pattern) => message.includes(pattern));
}

/** Recognize the existing provider-unavailable fallback, without adding timeout fallback. */
export function isSimulationApiFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof MobileApiError) {
    if (error.code === "ai_unavailable" || error.code === "ai_budget_limit") return true;
    if (error.code === "ai_timeout" || error.code === "score_generation_failed") return false;
    if ([401, 429, 503].includes(error.status)) return true;
    // Explicit authorization/validation codes are not provider failures.
    if (error.code) return false;
  }
  const message = error.message.toLowerCase();
  return ["openai", "api key", "unauthorized", "incorrect", "401", "429", "quota",
    "billing", "remote ai", "503"].some((pattern) => message.includes(pattern))
    || (message.includes("ai") && message.includes("disabled"));
}
