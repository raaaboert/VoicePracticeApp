"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";

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
  const token = getAdminToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}
