export interface TtsChunkSequenceResult {
  outcome: string;
  playbackStarted?: boolean;
}

export type TtsChunkSequenceCompletionStatus = "completed" | "cancelled" | "incomplete";

export interface TtsChunkSequenceCompletion {
  status: TtsChunkSequenceCompletionStatus;
  intendedChunkCount: number;
  settledChunkCount: number;
  completedChunkCount: number;
  outcomes: string[];
}

export function isSuccessfulTtsChunkResult(result: TtsChunkSequenceResult): boolean {
  return (
    (result.outcome === "remote_tts_completed" || result.outcome === "fallback_tts_completed")
    && result.playbackStarted === true
  );
}

export function summarizeTtsChunkSequence(
  intendedChunkCount: number,
  results: readonly TtsChunkSequenceResult[],
): TtsChunkSequenceCompletion {
  const safeIntendedCount = Math.max(0, Math.floor(intendedChunkCount));
  const outcomes = results.map((result) => result.outcome);
  const completedChunkCount = results.filter(isSuccessfulTtsChunkResult).length;
  const cancelled = outcomes.includes("tts_cancelled");
  const completed =
    safeIntendedCount > 0
    && results.length === safeIntendedCount
    && completedChunkCount === safeIntendedCount;

  return {
    status: completed ? "completed" : cancelled ? "cancelled" : "incomplete",
    intendedChunkCount: safeIntendedCount,
    settledChunkCount: results.length,
    completedChunkCount,
    outcomes,
  };
}

export function canTransitionToCaptureAfterTts(completion: TtsChunkSequenceCompletion): boolean {
  return completion.status === "completed";
}

export async function runTtsChunkSequence<TChunk, TResult extends TtsChunkSequenceResult>(params: {
  chunks: readonly TChunk[];
  runChunk: (chunk: TChunk, index: number, chunkCount: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const results: TResult[] = [];

  for (let index = 0; index < params.chunks.length; index += 1) {
    const result = await params.runChunk(params.chunks[index], index, params.chunks.length);
    results.push(result);
    if (result.outcome === "tts_cancelled" || !isSuccessfulTtsChunkResult(result)) {
      break;
    }
  }

  return results;
}
