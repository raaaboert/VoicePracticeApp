import assert from "node:assert/strict";
import test from "node:test";
import { runTtsChunkSequence } from "./ttsChunkSequence";

test("multi-chunk assistant speech stops immediately when the active chunk is cancelled", async () => {
  const requestedChunks: number[] = [];
  const sequenceStartedAtMs = Date.now();
  const results = await runTtsChunkSequence({
    chunks: ["chunk 1", "chunk 2", "chunk 3"],
    runChunk: async (_chunk, index) => {
      requestedChunks.push(index + 1);
      await Promise.resolve();
      return {
        outcome: index === 0 ? "tts_cancelled" : "remote_tts_completed",
      };
    },
  });

  assert.deepEqual(requestedChunks, [1], "chunks 2 and 3 must never be requested after chunk 1 cancellation");
  assert.deepEqual(results, [{ outcome: "tts_cancelled" }]);
  assert.ok(Date.now() - sequenceStartedAtMs < 500, "the cancelled aggregate sequence should settle promptly");
});
