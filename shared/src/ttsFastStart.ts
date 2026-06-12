const FAST_START_MIN_TOTAL_CHARS = 480;
const FAST_START_FIRST_CHUNK_MIN_CHARS = 240;
const FAST_START_FIRST_CHUNK_TARGET_CHARS = 420;
const FAST_START_LATER_CHUNK_MIN_CHARS = 240;
const FAST_START_LATER_CHUNK_TARGET_CHARS = 520;
const FAST_START_MIN_REMAINDER_CHARS = 180;
const FAST_START_MAX_CHUNKS = 3;
const FAST_START_LONG_SENTENCE_SPLIT_MIN_CHARS = 700;

function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!matches) {
    return [];
  }

  return matches
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitSentenceIntoClauses(sentence: string): string[] {
  const matches = sentence.match(/[^,;:]+[,;:]?|[^,;:]+$/g);
  if (!matches) {
    return [];
  }

  return matches
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function expandSpeechUnits(sentences: string[]): string[] {
  const units: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length < FAST_START_LONG_SENTENCE_SPLIT_MIN_CHARS) {
      units.push(sentence);
      continue;
    }

    const clauses = splitSentenceIntoClauses(sentence);
    if (clauses.length < 2) {
      units.push(sentence);
      continue;
    }

    units.push(...clauses);
  }

  return units;
}

export function splitTextForRemoteTtsFastStart(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length < FAST_START_MIN_TOTAL_CHARS) {
    return [text];
  }

  const sentences = splitIntoSentences(trimmed);
  const speechUnits = expandSpeechUnits(sentences);
  if (speechUnits.length < 2) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = "";

  const pushChunk = () => {
    const normalized = currentChunk.trim();
    if (normalized) {
      chunks.push(normalized);
    }
    currentChunk = "";
  };

  for (let index = 0; index < speechUnits.length; index += 1) {
    const sentence = speechUnits[index];
    const isFirstChunk = chunks.length === 0;
    const chunkMinChars = isFirstChunk ? FAST_START_FIRST_CHUNK_MIN_CHARS : FAST_START_LATER_CHUNK_MIN_CHARS;
    const chunkTargetChars = isFirstChunk ? FAST_START_FIRST_CHUNK_TARGET_CHARS : FAST_START_LATER_CHUNK_TARGET_CHARS;
    const nextChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
    const remainingSentences = speechUnits.slice(index + 1).join(" ").trim();

    currentChunk = nextChunk;

    const hasMinimumChunkSize = currentChunk.length >= chunkMinChars;
    const reachedTargetSize = currentChunk.length >= chunkTargetChars;
    const remainderLongEnough = remainingSentences.length >= FAST_START_MIN_REMAINDER_CHARS;
    const canCreateAnotherChunk = chunks.length < FAST_START_MAX_CHUNKS - 1;

    if (
      hasMinimumChunkSize &&
      remainderLongEnough &&
      canCreateAnotherChunk &&
      (isFirstChunk || reachedTargetSize)
    ) {
      pushChunk();
    }
  }

  pushChunk();

  if (chunks.length < 2) {
    return [text];
  }

  const collapsedChunks = chunks.filter(Boolean);
  if (collapsedChunks.length < 2) {
    return [text];
  }

  return collapsedChunks;
}
