import assert from "node:assert/strict";
import test from "node:test";
import { trustedTranscriptionText } from "./transcriptionEvidence.js";

test("ASR no-speech evidence suppresses a fabricated sentence, never a phrase blacklist", () => {
  for (const text of ["Thank you for watching", "Have a nice day", "Any fabricated words"]) {
    assert.equal(trustedTranscriptionText({ text, segments: [{ no_speech_prob: .99, avg_logprob: -1.2 }] }), "");
    assert.equal(trustedTranscriptionText({ text, segments: [{ no_speech_prob: .02, avg_logprob: -.1 }] }), text);
  }
});
test("quiet/ordinary speech and mixed speech segments remain available", () => {
  assert.equal(trustedTranscriptionText({ text: "  A quiet answer.  ", segments: [
    { no_speech_prob: .99, avg_logprob: -1.2 }, { no_speech_prob: .1, avg_logprob: -.3 },
  ] }), "A quiet answer.");
  assert.equal(trustedTranscriptionText({ text: "Yes.", languages: [] }), "Yes.", "unknown language is not evidence of silence");
  assert.equal(trustedTranscriptionText({ text: "" }), "");
  assert.equal(trustedTranscriptionText({ text: "Yes.", segments: [{ no_speech_prob: 2, avg_logprob: -.9 }] }), "Yes.");
  assert.throws(() => trustedTranscriptionText({ text: null }), /Invalid/);
});
