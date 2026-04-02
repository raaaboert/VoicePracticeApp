import { splitTextForRemoteTtsFastStart } from "./ttsFastStart";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected=${expectedJson}\nactual=${actualJson}`);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[tts-fast-start.test] PASS ${name}`);
}

runTest("keeps short assistant replies in a single TTS request", () => {
  assertDeepEqual(
    splitTextForRemoteTtsFastStart("Short reply. Still single chunk."),
    ["Short reply. Still single chunk."],
    "short replies should not split",
  );
});

runTest("splits a long multi-sentence reply at the first suitable sentence boundary", () => {
  const text =
    "I understand why you are hesitant about changing vendors right now, and your concerns are reasonable. What would make this feel safer for you is a phased rollout with measurable checkpoints, so we can prove value before expanding further.";
  const chunks = splitTextForRemoteTtsFastStart(text);

  assert(chunks.length === 2, "expected the helper to split a long two-sentence reply");
  assert(chunks[0].endsWith("."), "first chunk should end cleanly at a sentence boundary");
  assert(chunks[0].length < text.length, "first chunk should be shorter than the full reply");
  assert(chunks[1].startsWith("What would make"), "second chunk should carry the remainder of the reply");
});

runTest("does not split when the remainder would be too short to justify a second request", () => {
  const text =
    "I hear your concern, and I want to address it carefully. Brief tail.";
  assertDeepEqual(
    splitTextForRemoteTtsFastStart(text),
    [text],
    "very short remainders should stay in one request",
  );
});
