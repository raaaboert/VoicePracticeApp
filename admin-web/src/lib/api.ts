"use client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL
  ?? process.env.API_BASE_URL
  ?? "http://localhost:4100";
const REQUEST_ATTEMPT_TIMEOUT_MS = 7_000;
const REQUEST_TOTAL_TIMEOUT_MS = 14_000;
const REQUEST_MAX_ATTEMPTS = 2;
const ADMIN_CONTENT_SECTION_STATE_STORAGE_KEY = "vp_admin_content_sections_expanded";

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

export async function logoutAdminSession(): Promise<void> {
  const token = getAdminToken();
  try {
    if (token) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
    }
  } catch {
    // Ignore network/logout errors; local token clear still signs out this browser.
  } finally {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ADMIN_CONTENT_SECTION_STATE_STORAGE_KEY);
    }
    clearAdminToken();
  }
}

export interface AdminFetchRequestInit extends RequestInit {
  requestAttemptTimeoutMs?: number;
  requestTotalTimeoutMs?: number;
  requestMaxAttempts?: number;
}

export async function adminFetch<T>(path: string, init?: AdminFetchRequestInit): Promise<T> {
  const retryableStatusCodes = new Set([429, 502, 503, 504]);
  const requestAttemptTimeoutMs = Math.max(1_500, init?.requestAttemptTimeoutMs ?? REQUEST_ATTEMPT_TIMEOUT_MS);
  const requestTotalTimeoutMs = Math.max(requestAttemptTimeoutMs, init?.requestTotalTimeoutMs ?? REQUEST_TOTAL_TIMEOUT_MS);
  const requestMaxAttempts = Math.max(1, Math.floor(init?.requestMaxAttempts ?? REQUEST_MAX_ATTEMPTS));
  const startedAt = Date.now();

  const {
    requestAttemptTimeoutMs: _requestAttemptTimeoutMs,
    requestTotalTimeoutMs: _requestTotalTimeoutMs,
    requestMaxAttempts: _requestMaxAttempts,
    ...fetchInit
  } = init ?? {};

  for (let attempt = 1; attempt <= requestMaxAttempts; attempt += 1) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = requestTotalTimeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new Error("Request timed out. Please retry.");
    }

    const token = getAdminToken();
    const controller = new AbortController();
    const attemptTimeoutMs = Math.max(1_500, Math.min(requestAttemptTimeoutMs, remainingMs));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeoutMs);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...fetchInit,
        headers: {
          "Content-Type": "application/json",
          ...(fetchInit.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearAdminToken();
          throw new Error("Session expired. Please sign in again.");
        }

        const payload = await safeJson(response);
        const message = payload?.error ?? `Request failed (${response.status})`;
        const shouldRetry = retryableStatusCodes.has(response.status) && attempt < requestMaxAttempts;
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
      const shouldRetry = (isAbort || isNetwork) && attempt < requestMaxAttempts;
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
