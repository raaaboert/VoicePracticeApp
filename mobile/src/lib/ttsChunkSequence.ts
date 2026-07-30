export interface TtsChunkSequenceResult {
  outcome: string;
}

export async function runTtsChunkSequence<TChunk, TResult extends TtsChunkSequenceResult>(params: {
  chunks: readonly TChunk[];
  runChunk: (chunk: TChunk, index: number, chunkCount: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const results: TResult[] = [];

  for (let index = 0; index < params.chunks.length; index += 1) {
    const result = await params.runChunk(params.chunks[index], index, params.chunks.length);
    results.push(result);
    if (result.outcome === "tts_cancelled") {
      break;
    }
  }

  return results;
}
