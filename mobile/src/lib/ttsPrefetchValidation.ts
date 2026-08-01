export interface TtsPrefetchMetadata {
  preset?: string | null;
  chunkCount?: number | null;
  firstChunkChars?: number | null;
}

export interface TtsPrefetchPlan {
  preset: string;
  chunkCount: number;
  firstChunkChars: number;
}

export interface TtsPrefetchValidation {
  status: "match" | "mismatch" | "insufficient_metadata";
  mismatchFields: Array<"preset" | "chunkCount" | "firstChunkChars">;
}

export function validateTtsPrefetchMetadata(
  metadata: TtsPrefetchMetadata,
  plan: TtsPrefetchPlan,
): TtsPrefetchValidation {
  if (
    !metadata.preset
    || typeof metadata.chunkCount !== "number"
    || typeof metadata.firstChunkChars !== "number"
  ) {
    return { status: "insufficient_metadata", mismatchFields: [] };
  }

  const mismatchFields: TtsPrefetchValidation["mismatchFields"] = [];
  if (metadata.preset !== plan.preset) {
    mismatchFields.push("preset");
  }
  if (metadata.chunkCount !== plan.chunkCount) {
    mismatchFields.push("chunkCount");
  }
  if (metadata.firstChunkChars !== plan.firstChunkChars) {
    mismatchFields.push("firstChunkChars");
  }

  return {
    status: mismatchFields.length > 0 ? "mismatch" : "match",
    mismatchFields,
  };
}
