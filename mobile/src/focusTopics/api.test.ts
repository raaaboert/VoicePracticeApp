import assert from "node:assert/strict";
import test from "node:test";

import { createMobileApiError } from "../lib/apiError";
import {
  createFocusTopicCatalogClient,
  createFocusTopicDetailClient,
} from "./client";

test("client requests the authenticated user catalog and forwards cancellation", async () => {
  const controller = new AbortController();
  const calls: Array<{ path: string; method: string | undefined; token: string | undefined; signal: AbortSignal | undefined }> = [];
  const fetchFocusTopicCatalog = createFocusTopicCatalogClient(
    async <T>(path: string, init?: RequestInit, token?: string, options?: { signal?: AbortSignal }) => {
      calls.push({ path, method: init?.method, token, signal: options?.signal });
      return {
        topics: [{ id: "topic_1", name: "Discovery", description: "Ask better questions.", createdAt: "2026-01-01T00:00:00.000Z", scenarioCount: 1, resourceCount: 2 }],
      } as T;
    }
  );
  const response = await fetchFocusTopicCatalog("user / one", "mobile-token", {
    signal: controller.signal,
  });

  assert.equal(response.topics[0]?.id, "topic_1");
  assert.deepEqual(calls, [{
    path: "/mobile/users/user%20%2F%20one/focus-topics",
    method: "GET",
    token: "mobile-token",
    signal: controller.signal,
  }]);
});

test("client returns an empty catalog", async () => {
  const fetchFocusTopicCatalog = createFocusTopicCatalogClient(
    async <T>() => ({ topics: [] }) as T
  );
  const response = await fetchFocusTopicCatalog("user", "token");
  assert.deepEqual(response, { topics: [] });
});

test("client preserves auth and server failures", async () => {
  for (const expected of [
    createMobileApiError(401, { error: "Invalid mobile token." }),
    createMobileApiError(503, { error: "Temporarily unavailable." }),
  ]) {
    const fetchFocusTopicCatalog = createFocusTopicCatalogClient(
      async <T>() => { throw expected; }
    );
    await assert.rejects(
      fetchFocusTopicCatalog("user", "token"),
      (caught: unknown) => caught === expected
    );
  }
});

test("client preserves request cancellation and rejects malformed responses", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = new Error("Aborted");
  aborted.name = "AbortError";
  const fetchAbortedCatalog = createFocusTopicCatalogClient(
    async <T>(
      _path: string,
      _init?: RequestInit,
      _token?: string,
      options?: { signal?: AbortSignal }
    ) => {
        assert.equal(options?.signal?.aborted, true);
        throw aborted;
    }
  );
  await assert.rejects(
    fetchAbortedCatalog("user", "token", { signal: controller.signal }),
    (caught: unknown) => caught === aborted
  );

  const fetchMalformedCatalog = createFocusTopicCatalogClient(
    async <T>() => ({ topics: [{ id: "topic_1" }] }) as T
  );
  await assert.rejects(
    fetchMalformedCatalog("user", "token"),
    /catalog response was invalid/
  );
});

test("detail client requests the encoded topic and preserves server ordering", async () => {
  const controller = new AbortController();
  const calls: Array<{ path: string; token: string | undefined; signal: AbortSignal | undefined }> = [];
  const fetchFocusTopicDetail = createFocusTopicDetailClient(
    async <T>(path: string, _init?: RequestInit, token?: string, options?: { signal?: AbortSignal }) => {
      calls.push({ path, token, signal: options?.signal });
      return {
        topic: { id: "topic / one", name: "Discovery", description: "Practice discovery." },
        scenarios: [
          {
            id: "scenario_b", title: "Second", description: "B", source: "standard",
            segmentId: "role", segmentLabel: "Role", industryId: "industry",
            industryLabel: "Industry", trainingId: null,
          },
          {
            id: "scenario_a", title: "First", description: "A", source: "custom",
            segmentId: "role", segmentLabel: "Role", industryId: "industry",
            industryLabel: "Industry", trainingId: "topic / one",
          },
        ],
        resources: [{
          id: "resource", contentType: "native", title: "Guide", description: "Read this.",
          category: { id: "category", name: "Guides" }, relatedFocusTopic: "Discovery",
        }],
      } as T;
    }
  );

  const response = await fetchFocusTopicDetail(
    "user / one",
    "topic / one",
    "mobile-token",
    { signal: controller.signal }
  );
  assert.deepEqual(response.scenarios.map((scenario) => scenario.id), ["scenario_b", "scenario_a"]);
  assert.deepEqual(calls, [{
    path: "/mobile/users/user%20%2F%20one/focus-topics/topic%20%2F%20one",
    token: "mobile-token",
    signal: controller.signal,
  }]);
});

test("detail client preserves unavailable, transient, and cancellation errors", async () => {
  const unavailable = createMobileApiError(404, {
    error: "Focus Topic is not available.",
    code: "focus_topic_not_available",
  });
  const transient = createMobileApiError(503, {
    error: "Focus Topic is temporarily unavailable.",
    code: "focus_topic_detail_unavailable",
  });
  const aborted = new Error("Aborted");
  aborted.name = "AbortError";
  for (const expected of [unavailable, transient, aborted]) {
    const fetchFocusTopicDetail = createFocusTopicDetailClient(
      async <T>() => { throw expected; }
    );
    await assert.rejects(
      fetchFocusTopicDetail("user", "topic", "token"),
      (caught: unknown) => caught === expected
    );
  }
});
