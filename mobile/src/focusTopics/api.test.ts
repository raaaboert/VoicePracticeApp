import assert from "node:assert/strict";
import test from "node:test";

import { createMobileApiError } from "../lib/apiError";
import { createFocusTopicCatalogClient } from "./client";

test("client requests the authenticated user catalog and forwards cancellation", async () => {
  const controller = new AbortController();
  const calls: Array<{ path: string; method: string | undefined; token: string | undefined; signal: AbortSignal | undefined }> = [];
  const fetchFocusTopicCatalog = createFocusTopicCatalogClient(
    async <T>(path: string, init?: RequestInit, token?: string, options?: { signal?: AbortSignal }) => {
      calls.push({ path, method: init?.method, token, signal: options?.signal });
      return {
        topics: [{ id: "topic_1", name: "Discovery", description: "Ask better questions.", scenarioCount: 1, resourceCount: 2 }],
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
