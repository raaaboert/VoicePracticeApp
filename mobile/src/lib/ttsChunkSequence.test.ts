import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionToCaptureAfterTts,
  runTtsChunkSequence,
  summarizeTtsChunkSequence,
} from "./ttsChunkSequence";

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

test("all intended speech chunks must genuinely complete before the response is complete", () => {
  const completed = summarizeTtsChunkSequence(2, [
    { outcome: "remote_tts_completed" },
    { outcome: "fallback_tts_completed" },
  ]);
  assert.equal(completed.status, "completed");
  assert.equal(canTransitionToCaptureAfterTts(completed), true);
  assert.equal(
    summarizeTtsChunkSequence(2, [{ outcome: "remote_tts_completed" }]).status,
    "incomplete",
  );
  const startedThenFailed = summarizeTtsChunkSequence(1, [
    { outcome: "remote_started_then_failed_unblocked" },
  ]);
  assert.equal(startedThenFailed.status, "incomplete");
  assert.equal(canTransitionToCaptureAfterTts(startedThenFailed), false);
  assert.equal(
    canTransitionToCaptureAfterTts(
      summarizeTtsChunkSequence(1, [{ outcome: "fallback_tts_failed" }]),
    ),
    false,
  );
  assert.equal(
    summarizeTtsChunkSequence(1, [{ outcome: "tts_cancelled" }]).status,
    "cancelled",
  );
});

test("started-then-failed playback stops the sequence before another chunk is requested", async () => {
  const requestedChunks: number[] = [];
  const results = await runTtsChunkSequence({
    chunks: ["chunk 1", "chunk 2"],
    runChunk: async (_chunk, index) => {
      requestedChunks.push(index + 1);
      return {
        outcome: index === 0 ? "remote_started_then_failed_unblocked" : "remote_tts_completed",
      };
    },
  });

  assert.deepEqual(requestedChunks, [1]);
  assert.equal(summarizeTtsChunkSequence(2, results).status, "incomplete");
});
