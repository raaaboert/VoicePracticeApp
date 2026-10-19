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

export function isSimulationSessionEndedError(error: unknown): boolean {
  return error instanceof MobileApiError && error.status === 409
    && (error.code === "session_expired" || error.code === "session_completed");
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
