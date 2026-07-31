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
