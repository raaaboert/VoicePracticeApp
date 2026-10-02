import type { MobileFocusTopicCatalogResponse } from "@voicepractice/shared";

import { parseFocusTopicCatalogResponse } from "./model";

export type FocusTopicRequest = <T>(
  path: string,
  init?: RequestInit,
  authToken?: string,
  options?: { signal?: AbortSignal }
) => Promise<T>;

export function createFocusTopicCatalogClient(request: FocusTopicRequest) {
  return async function fetchFocusTopicCatalog(
    userId: string,
    authToken: string,
    options?: { signal?: AbortSignal }
  ): Promise<MobileFocusTopicCatalogResponse> {
    const payload = await request<unknown>(
      `/mobile/users/${encodeURIComponent(userId)}/focus-topics`,
      { method: "GET" },
      authToken,
      { signal: options?.signal }
    );
    return parseFocusTopicCatalogResponse(payload);
  };
}
