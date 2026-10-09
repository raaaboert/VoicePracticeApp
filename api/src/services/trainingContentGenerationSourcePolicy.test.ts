import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeYouTubeUrl,
  evaluateTrainingContentGenerationSource,
  normalizeCustomerTranscript,
  TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1,
} from "./trainingContentGenerationSourcePolicy.js";

test("YouTube URLs are strictly parsed and canonicalized without network access", () => {
  for (const value of [
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ]) assert.equal(canonicalizeYouTubeUrl(value), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  for (const value of [
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://evil.test/?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "data:text/plain,x",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&redirect=evil",
    "https://youtu.be/dQw4w9WgXcQ#fragment",
  ]) assert.throws(() => canonicalizeYouTubeUrl(value), /valid public YouTube URL/);
});

test("customer transcripts are bounded and only conservatively normalized", () => {
  assert.equal(normalizeCustomerTranscript("  first\r\nsecond  "), "first\nsecond");
  assert.throws(() => normalizeCustomerTranscript("   "), /cannot be empty/);
  assert.throws(() => normalizeCustomerTranscript("x".repeat(200_001)), /200,000/);
  assert.throws(() => normalizeCustomerTranscript("bad\u0000text"), /unsupported/);
  assert.throws(() => normalizeCustomerTranscript("bad\uD800text"), /unsupported/);
  assert.equal(normalizeCustomerTranscript("valid \uD83D\uDE00"), "valid \uD83D\uDE00");
});

test("one source evaluator keeps learner publication and generation readiness separate", () => {
  const base = { publicationState: "published" as const, archivedAt: null,
    nativeBody: null, hasReadyPrimaryAsset: true, moduleEnabled: true };
  assert.deepEqual(evaluateTrainingContentGenerationSource({ ...base, contentType: "video",
    hasCurrentTranscript: false }), {
    eligible: false, reasonCode: "missing_transcript", sourceKind: "uploaded_video_transcript",
  });
  assert.deepEqual(evaluateTrainingContentGenerationSource({ ...base, contentType: "video",
    hasCurrentTranscript: true }), {
    eligible: true, reasonCode: "ready", sourceKind: "uploaded_video_transcript",
  });
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "pdf",
    hasCurrentTranscript: false }).reasonCode, "text_not_extractable_yet");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "docx",
    hasCurrentTranscript: false }).reasonCode, "text_not_extractable_yet");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "docx",
    hasReadyPrimaryAsset: false, hasCurrentTranscript: false }).reasonCode, "asset_not_ready");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "external_url",
    externalKind: "youtube", hasCurrentTranscript: false }).reasonCode, "missing_transcript");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "native",
    nativeBody: "Customer text", hasCurrentTranscript: false }).eligible, true);
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "video",
    publicationState: "draft", hasCurrentTranscript: true }).reasonCode, "draft");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "audio",
    hasCurrentTranscript: false }).reasonCode, "unsupported_type");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "native",
    nativeBody: "Customer text", moduleEnabled: false,
    hasCurrentTranscript: false }).reasonCode, "module_disabled");
});

test("future document extraction is explicitly bounded and excludes unsafe expansion and OCR", () => {
  assert.equal(TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters, 200_000);
  assert.deepEqual(TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.pdf, {
    boundedInputRequired: true,
    ocrAllowed: false,
  });
  assert.deepEqual(TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.docx, {
    boundedInputRequired: true,
    boundedArchiveExpansionRequired: true,
    externalRelationshipsAllowed: false,
    dtdOrEntityExpansionAllowed: false,
  });
});
