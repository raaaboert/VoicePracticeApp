"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_MAX_ATTEMPTS = 3;

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

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const token = getAdminToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
          await sleep(attempt * 600);
          continue;
        }

        throw new Error(message);
      }

      return (await response.json()) as T;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const isNetwork = error instanceof TypeError;
      const shouldRetry = (isAbort || isNetwork) && attempt < REQUEST_MAX_ATTEMPTS;
      if (shouldRetry) {
        await sleep(attempt * 600);
        continue;
      }

      if (isAbort) {
        throw new Error(
          `Request timed out after ${Math.floor(REQUEST_TIMEOUT_MS / 1000)} seconds. ` +
            "If the API is on Render Free, it may be waking up. Try again."
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
