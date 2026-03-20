import "server-only";

import { headers } from "next/headers";

import { normalizeHost } from "@/src/lib/domain";

export async function getRequestHost(): Promise<string> {
  const headerStore = await headers();
  return normalizeHost(headerStore.get("x-forwarded-host") ?? headerStore.get("host"));
}

export async function getRequestProtocol(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-proto")?.trim().toLowerCase();
  if (forwarded === "http" || forwarded === "https") {
    return forwarded;
  }

  const host = normalizeHost(headerStore.get("x-forwarded-host") ?? headerStore.get("host"));
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost") ? "http" : "https";
}
