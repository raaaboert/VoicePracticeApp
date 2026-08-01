import assert from "node:assert/strict";
import test from "node:test";

import { validateTtsPrefetchMetadata } from "./ttsPrefetchValidation";

const PLAN = { preset: "female-balanced", chunkCount: 3, firstChunkChars: 240 };

test("matching authoritative prefetch metadata is accepted", () => {
  assert.deepEqual(validateTtsPrefetchMetadata(PLAN, PLAN), {
    status: "match",
    mismatchFields: [],
  });
});

test("mismatched authoritative prefetch metadata is rejected", () => {
  assert.deepEqual(
    validateTtsPrefetchMetadata(
      { preset: "male-balanced", chunkCount: 2, firstChunkChars: 120 },
      PLAN,
    ),
    {
      status: "mismatch",
      mismatchFields: ["preset", "chunkCount", "firstChunkChars"],
    },
  );
});

test("legacy prefetches without complete metadata remain diagnostically insufficient", () => {
  assert.deepEqual(validateTtsPrefetchMetadata({ preset: "female-balanced" }, PLAN), {
    status: "insufficient_metadata",
    mismatchFields: [],
  });
});
