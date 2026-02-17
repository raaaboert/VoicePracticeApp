"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";
const REQUEST_ATTEMPT_TIMEOUT_MS = 7_000;
const REQUEST_TOTAL_TIMEOUT_MS = 14_000;
const REQUEST_MAX_ATTEMPTS = 2;

export function getApiBaseUrl(): string {
  return API_BASE;
}

export function getAdminToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return localStorage.getItem("vp_admin_token") ?? "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem("vp_admin_token", token);
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem("vp_admin_token");
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const retryableStatusCodes = new Set([429, 502, 503, 504]);
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = REQUEST_TOTAL_TIMEOUT_MS - elapsedMs;
    if (remainingMs <= 0) {
      throw new Error("Request timed out. Please retry.");
    }

    const token = getAdminToken();
    const controller = new AbortController();
    const attemptTimeoutMs = Math.max(1_500, Math.min(REQUEST_ATTEMPT_TIMEOUT_MS, remainingMs));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeoutMs);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = await safeJson(response);
        const message = payload?.error ?? `Request failed (${response.status})`;
        const shouldRetry = retryableStatusCodes.has(response.status) && attempt < REQUEST_MAX_ATTEMPTS;
        if (shouldRetry) {
          await sleep(attempt * 400);
          continue;
        }

        throw new Error(message);
      }

      return (await response.json()) as T;
    } catch (error) {
      const isAbort = error instanceof Error && (error.name === "AbortError" || timedOut);
      const isNetwork = error instanceof TypeError;
      const shouldRetry = (isAbort || isNetwork) && attempt < REQUEST_MAX_ATTEMPTS;
      if (shouldRetry) {
        await sleep(attempt * 400);
        continue;
      }

      if (isAbort) {
        throw new Error(
          "Request timed out. If this repeats, refresh once and retry."
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Request failed after multiple attempts. Please retry.");
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
