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

runTest("keeps normal live replies under the fast-start threshold in one request", () => {
  const text =
    "I understand why you are hesitant about changing vendors right now, and your concerns are reasonable. What would make this feel safer for you is a phased rollout with measurable checkpoints, so we can prove value before expanding further.";
  assertDeepEqual(
    splitTextForRemoteTtsFastStart(text),
    [text],
    "normal live replies under the single-request threshold should not split",
  );
});

runTest("splits a long multi-sentence reply at the first suitable sentence boundary", () => {
  const text =
    "I understand why you are hesitant about changing vendors right now, and your concerns are reasonable, especially when your team has already invested time and trust in the current process and cannot afford a disruptive rollout during a busy quarter. A safer path is to run a narrow pilot with clear checkpoints, prove the outcome with your own team, and only expand if the evidence supports it, so you have practical proof before asking anyone to change their workflow or adjust priorities.";
  const chunks = splitTextForRemoteTtsFastStart(text);

  assert(chunks.length === 2, "expected the helper to split a long two-sentence reply");
  assert(chunks[0].endsWith("."), "first chunk should end cleanly at a sentence boundary");
  assert(chunks[0].length < text.length, "first chunk should be shorter than the full reply");
  assert(chunks[1].startsWith("A safer path"), "second chunk should carry the remainder of the reply");
});

runTest("keeps longer replies split into natural sentence-bounded chunks without over-fragmenting", () => {
  const text =
    "I hear the hesitation, and I do not expect you to change course blindly because the change has to make sense for your team, your customers, and the results you are already responsible for delivering. We can start with one narrow pilot so your team sees the workflow in action before committing more broadly. If the pilot misses your standards, you keep full control over what happens next and we stop before it creates operational drag. That gives you evidence from your own environment instead of asking you to trust a generic promise.";
  const chunks = splitTextForRemoteTtsFastStart(text);

  assert(chunks.length >= 2, "expected a longer reply to split into multiple chunks");
  assert(chunks.length <= 3, "longer replies should not fragment into too many requests");
  assert(chunks.every((chunk) => /[.!?]$/.test(chunk)), "each chunk should end at a sentence boundary");
  assert(chunks[0].length < chunks.join(" ").length, "the first chunk should stay smaller than the full reply");
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

runTest("does not split a long single-sentence reply with no natural pause", () => {
  const text =
    "I understand the concern and I want to help you evaluate the risk carefully while we work through the decision step by step without forcing an artificial break in the middle of the thought";
  assertDeepEqual(
    splitTextForRemoteTtsFastStart(text),
    [text],
    "single-sentence replies should stay intact",
  );
});

runTest("does not split normal single-sentence replies at clause boundaries", () => {
  const text =
    "I understand the concern, and I do not want to rush you into a decision, but we can start with a narrow pilot that gives your team real evidence before you commit more broadly.";
  assertDeepEqual(
    splitTextForRemoteTtsFastStart(text),
    [text],
    "normal single-sentence replies should stay intact even with clause punctuation",
  );
});

runTest("splits a very long single-sentence reply at a natural clause boundary when needed", () => {
  const text =
    "I understand the concern, and I do not want to rush you into a decision, but we can start with a narrow pilot that gives your team real evidence before you commit more broadly, and we can define success in operational terms your leaders already care about, including adoption, cycle time, handoff quality, and customer follow-through, while keeping the scope small enough that your team can evaluate the change without disrupting current commitments, and if the pilot does not meet the standard we agree on up front, we stop there and you keep full control over the next step, because the goal is not to force a switch, but to make the decision easier and safer with real proof from your environment.";
  const chunks = splitTextForRemoteTtsFastStart(text);

  assert(chunks.length >= 2, "expected a long clause-heavy sentence to split");
  assert(/[,;:]$/.test(chunks[0]), "the first chunk should end on a natural clause boundary");
  assert(chunks.join(" ") === text, "chunking should preserve the original reply text");
});
