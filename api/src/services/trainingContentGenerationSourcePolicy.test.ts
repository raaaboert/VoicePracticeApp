import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeYouTubeUrl,
  evaluateTrainingContentGenerationSource,
  normalizeCustomerTranscript,
  trainingContentSourceFingerprint,
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
    currentPrimaryAssetId: "asset_1", currentTranscriptSourceFingerprint: null }), {
    eligible: false, reasonCode: "missing_transcript", sourceKind: "uploaded_video_transcript",
  });
  assert.deepEqual(evaluateTrainingContentGenerationSource({ ...base, contentType: "video",
    currentPrimaryAssetId: "asset_1", currentTranscriptSourceFingerprint: "video_asset:asset_1" }), {
    eligible: true, reasonCode: "ready", sourceKind: "uploaded_video_transcript",
  });
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "pdf",
    currentTranscriptSourceFingerprint: null }).reasonCode, "ready");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "docx",
    currentTranscriptSourceFingerprint: null }).reasonCode, "ready");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "docx",
    hasReadyPrimaryAsset: false, currentTranscriptSourceFingerprint: null }).reasonCode, "asset_not_ready");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "external_url",
    externalKind: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", currentTranscriptSourceFingerprint: null }).reasonCode, "missing_transcript");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "native",
    nativeBody: "Customer text", currentTranscriptSourceFingerprint: null }).eligible, true);
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "video",
    publicationState: "draft", currentPrimaryAssetId: "asset_1", currentTranscriptSourceFingerprint: "video_asset:asset_1" }).reasonCode, "draft");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "audio",
    currentTranscriptSourceFingerprint: null }).reasonCode, "unsupported_type");
  assert.equal(evaluateTrainingContentGenerationSource({ ...base, contentType: "native",
    nativeBody: "Customer text", moduleEnabled: false,
    currentTranscriptSourceFingerprint: null }).reasonCode, "module_disabled");
});

test("transcript source fingerprints bind generation eligibility to the current video or YouTube source", () => {
  assert.equal(trainingContentSourceFingerprint({ contentType: "video", currentPrimaryAssetId: "asset_v1" }), "video_asset:asset_v1");
  assert.equal(trainingContentSourceFingerprint({ contentType: "video", currentPrimaryAssetId: "asset_v2" }), "video_asset:asset_v2");
  assert.equal(trainingContentSourceFingerprint({ contentType: "external_url", externalKind: "youtube", externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), "youtube:https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(trainingContentSourceFingerprint({ contentType: "external_url", externalKind: "youtube", externalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0" }), "youtube:https://www.youtube.com/watch?v=9bZkp7q19f0");
  assert.equal(trainingContentSourceFingerprint({ contentType: "native" }), null);
  const video = { contentType: "video" as const, publicationState: "published" as const,
    archivedAt: null, nativeBody: null, hasReadyPrimaryAsset: true, moduleEnabled: true,
    currentPrimaryAssetId: "asset_v2" };
  assert.equal(evaluateTrainingContentGenerationSource({ ...video,
    currentTranscriptSourceFingerprint: "video_asset:asset_v1" }).eligible, false);
  assert.equal(evaluateTrainingContentGenerationSource({ ...video,
    currentTranscriptSourceFingerprint: "video_asset:asset_v2" }).eligible, true);
  const youtube = { contentType: "external_url" as const, externalKind: "youtube" as const,
    externalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0", publicationState: "published" as const,
    archivedAt: null, nativeBody: null, hasReadyPrimaryAsset: false, moduleEnabled: true };
  assert.equal(evaluateTrainingContentGenerationSource({ ...youtube,
    currentTranscriptSourceFingerprint: "youtube:https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).eligible, false);
  assert.equal(evaluateTrainingContentGenerationSource({ ...youtube,
    currentTranscriptSourceFingerprint: "youtube:https://www.youtube.com/watch?v=9bZkp7q19f0" }).eligible, true);
});

test("document extraction is explicitly bounded and excludes unsafe expansion and OCR", () => {
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
