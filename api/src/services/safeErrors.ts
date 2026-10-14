import { randomUUID } from "node:crypto";
import type { Response } from "express";

export class AiBudgetLimitError extends Error {
  constructor(message: string) { super(message); this.name = "AiBudgetLimitError"; }
}

export interface SafeAiFailure { status: number; code: string; error: string }

export class SafeAiRouteError extends Error {
  constructor(readonly failure: SafeAiFailure) { super(failure.error); }
}

export function isAiTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["OpenAiChatRequestTimeoutError", "OpenAiTranscriptionRequestTimeoutError", "AbortError"].includes(error.name)) return true;
  const detail = error as Error & { statusCode?: unknown; errorCode?: unknown };
  return ["OpenAiResponsesRequestError", "OpenAiSpeechRequestError"].includes(error.name)
    && detail.statusCode === undefined && detail.errorCode === "timeout";
}

// Deliberately omit messages, stacks, arbitrary names/codes and provider bodies.
export function safeErrorDiagnostics(error: unknown) {
  const detail = error && typeof error === "object" ? error as { code?: unknown; statusCode?: unknown } : {};
  return {
    errorCategory: isAiTimeoutError(error) ? "timeout"
      : error instanceof SyntaxError ? "syntax_error"
      : error instanceof TypeError ? "type_error" : "unexpected_error",
    ...(typeof detail.code === "string" && /^[0-9]{2}[A-Z0-9]{3}$/.test(detail.code) ? { databaseCode: detail.code } : {}),
    ...(typeof detail.statusCode === "number" && Number.isInteger(detail.statusCode)
      && detail.statusCode >= 100 && detail.statusCode <= 599 ? { upstreamStatus: detail.statusCode } : {}),
  };
}

export function classifyAiRouteError(error: unknown, invalidScorePayload = false): SafeAiFailure {
  if (error instanceof SafeAiRouteError) return error.failure;
  if (error instanceof AiBudgetLimitError) return { status: 429, code: "ai_budget_limit", error: error.message };
  if (isAiTimeoutError(error)) return { status: 504, code: "ai_timeout", error: "AI request timed out. Please try again." };
  if (invalidScorePayload) return { status: 502, code: "score_generation_failed", error: "Could not generate your scorecard. Please try again." };
  return { status: 503, code: "ai_unavailable", error: "AI is temporarily unavailable. Please try again." };
}

function errorCorrelationId(response: Response, supplied?: string): string {
  const candidate = supplied ?? response.getHeader("X-Correlation-Id");
  return typeof candidate === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(candidate) && !/^sk[-_]/i.test(candidate)
    ? candidate : `cid_${randomUUID()}`;
}

export function respondWithAiRouteError(response: Response, error: unknown,
  options: { route: string; correlationId?: string; invalidScorePayload?: boolean }) {
  const failure = classifyAiRouteError(error, options.invalidScorePayload);
  const correlationId = errorCorrelationId(response, options.correlationId);
  // eslint-disable-next-line no-console
  console.error("[api-error]", { route: options.route, correlationId, status: failure.status,
    code: failure.code, ...safeErrorDiagnostics(error) });
  response.setHeader("X-Correlation-Id", correlationId);
  response.status(failure.status).json({ error: failure.error, code: failure.code, correlationId });
}

export function respondWithUnexpectedError(response: Response, error: unknown,
  options: { route: string; correlationId?: string; status?: number }) {
  const correlationId = errorCorrelationId(response, options.correlationId);
  const status = options.status ?? 500;
  // eslint-disable-next-line no-console
  console.error("[api-error]", { route: options.route, correlationId, status, code: "internal_error", ...safeErrorDiagnostics(error) });
  response.setHeader("X-Correlation-Id", correlationId);
  response.status(status).json({ error: "Something went wrong. Please try again.", code: "internal_error", correlationId });
}
