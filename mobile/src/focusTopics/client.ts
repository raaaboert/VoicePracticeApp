import type {
  MobileFocusTopicCatalogResponse,
  MobileFocusTopicDetailResponse,
} from "@voicepractice/shared";

import {
  parseFocusTopicCatalogResponse,
  parseFocusTopicDetailResponse,
} from "./model";

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

export function createFocusTopicDetailClient(request: FocusTopicRequest) {
  return async function fetchFocusTopicDetail(
    userId: string,
    topicId: string,
    authToken: string,
    options?: { signal?: AbortSignal }
  ): Promise<MobileFocusTopicDetailResponse> {
    const payload = await request<unknown>(
      `/mobile/users/${encodeURIComponent(userId)}/focus-topics/${encodeURIComponent(topicId)}`,
      { method: "GET" },
      authToken,
      { signal: options?.signal }
    );
    return parseFocusTopicDetailResponse(payload);
  };
}
