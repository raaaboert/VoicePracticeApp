import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import type { TrainingContentItem } from "@voicepractice/shared";
import type { TrainingContentAuthorityRecord } from "../storage/trainingContentStore.js";
import { buildCustomerPracticeScenarioGenerationSourceBundle, CustomerPracticeScenarioGenerationSourceError, reauthorizeCustomerPracticeScenarioGenerationSources } from "./customerPracticeScenarioGenerationSources.js";
import { extractDocxGenerationText, extractPdfGenerationText } from "./trainingContentTextExtraction.js";

function item(id: string, patch: Partial<TrainingContentItem> = {}): TrainingContentItem {
  return { id, orgId: "org_1", categoryId: "cat_1", title: `Resource ${id}`, description: "", focusTopicId: "topic_1",
    focusTopicNameSnapshot: "Topic", contentType: "native", publicationState: "published", nativeBody: `body ${id}`,
    externalUrl: null, externalKind: null, displayOrder: 0, contentVersion: 1, createdByActorId: "author", updatedByActorId: "author",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z", archivedAt: null, ...patch };
}
function authority(...content: TrainingContentItem[]): TrainingContentAuthorityRecord[] { return content.map((entry) => ({ content: entry, categoryArchivedAt: null, assignments: [], topicAttachments: [{ topicId: "topic_1", detachedAt: null }] })); }
async function bundle(selectedContentIds: unknown, records: TrainingContentAuthorityRecord[], extras: Partial<Parameters<typeof buildCustomerPracticeScenarioGenerationSourceBundle>[0]> = {}) {
  return buildCustomerPracticeScenarioGenerationSourceBundle({ orgId: "org_1", homeFocusTopicId: "topic_1", selectedContentIds, actorCurrentlyAuthorized: true, moduleEnabled: true,
    contentAuthority: records, getCurrentAsset: async () => null, getCurrentTranscript: async () => null, readAssetBytes: async () => new Uint8Array(), ...extras });
}

test("generation sources bundle native text and current transcript only, without metadata text leakage", async () => {
  const video = item("video", { contentType: "video", nativeBody: null });
  const result = await bundle(["native", "video"], authority(item("native", { nativeBody: "Native source text" }), video), {
    getCurrentAsset: async (id) => id === "video" ? { id: "asset_2", uploadState: "ready", finalObjectKey: null } : null,
    getCurrentTranscript: async (id) => id === "video" ? { body: "Current transcript text", sourceFingerprint: "video_asset:asset_2" } : null,
  });
  assert.match(result.text, /Native source text/); assert.match(result.text, /Current transcript text/);
  assert.equal(JSON.stringify(result.sources).includes("Native source text"), false);
  assert.deepEqual(result.sources.map((source) => source.sourceKind), ["native_text", "uploaded_video_transcript"]);
});

test("stale transcript and unauthorized or detached source fail closed", async () => {
  const video = item("video", { contentType: "video", nativeBody: null });
  await assert.rejects(bundle(["video"], authority(video), { getCurrentAsset: async () => ({ id: "asset_2", uploadState: "ready", finalObjectKey: null }),
    getCurrentTranscript: async () => ({ body: "old", sourceFingerprint: "video_asset:asset_1" }) }), (error: unknown) => error instanceof CustomerPracticeScenarioGenerationSourceError && error.code === "generation_source_not_ready");
  await assert.rejects(bundle(["video"], authority(video), { actorCurrentlyAuthorized: false }), /not authorized/);
  const detached = authority(item("detached")); detached[0]!.topicAttachments[0]!.detachedAt = "2026-01-02T00:00:00.000Z";
  await assert.rejects(bundle(["detached"], detached), /not available/);
});

test("post-model reauthorization rechecks attachment and transcript fingerprints without reading documents", async () => {
  let reads = 0;
  await reauthorizeCustomerPracticeScenarioGenerationSources({ orgId: "org_1", homeFocusTopicId: "topic_1", selectedContentIds: ["native"], actorCurrentlyAuthorized: true, moduleEnabled: true,
    contentAuthority: authority(item("native")), getCurrentAsset: async () => { reads += 1; return null; }, getCurrentTranscript: async () => { reads += 1; return null; } });
  assert.equal(reads, 2);
  const detached = authority(item("native")); detached[0]!.topicAttachments[0]!.detachedAt = "2026-01-02T00:00:00.000Z";
  await assert.rejects(reauthorizeCustomerPracticeScenarioGenerationSources({ orgId: "org_1", homeFocusTopicId: "topic_1", selectedContentIds: ["native"], actorCurrentlyAuthorized: true, moduleEnabled: true,
    contentAuthority: detached, getCurrentAsset: async () => null, getCurrentTranscript: async () => null }), /not available/);
});

test("PDF and DOCX extraction is bounded and rejects unsafe DOCX relationships", async () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj <<>> stream\nBT (PDF source text) Tj ET\nendstream\nendobj\n%%EOF", "latin1");
  assert.match(await extractPdfGenerationText(pdf), /PDF source text/);
  const docx = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document><w:t>DOCX source text</w:t></w:document>" });
  assert.match(await extractDocxGenerationText(docx), /DOCX source text/);
  const external = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>", "word/_rels/document.xml.rels": '<Relationship TargetMode="External" Target="https://example.test" />' });
  await assert.rejects(extractDocxGenerationText(external), /cannot be safely prepared/);
  const entity = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<!DOCTYPE x [<!ENTITY boom 'x'>]><w:document><w:t>&boom;</w:t></w:document>" });
  await assert.rejects(extractDocxGenerationText(entity), /cannot be safely prepared/);
});

test("adversarial PDF and DOCX structures fail in bounded isolated extraction", async () => {
  await assert.rejects(extractPdfGenerationText(Buffer.from("%PDF-1.4\nstream\n".repeat(2_000), "latin1")), /safely prepared/);
  const streams = Array.from({ length: 140 }, () => "stream\nBT (x) Tj ET\nendstream").join("\n");
  await assert.rejects(extractPdfGenerationText(Buffer.from(`%PDF-1.4\n${streams}`, "latin1")), /safely prepared/);
  const unclosed = zip({ "word/document.xml": `<w:document>${"<w:t>text".repeat(10_000)}` });
  await assert.rejects(extractDocxGenerationText(unclosed), /safely prepared/);
  const manyEntries = zip(Object.fromEntries(Array.from({ length: 520 }, (_, index) => [`word/extra-${index}.xml`, "x"])));
  await assert.rejects(extractDocxGenerationText(manyEntries), /safely prepared/);
});

test("mixed document bundles respect the aggregate bound", async () => {
  const pdf = item("pdf", { contentType: "pdf", nativeBody: null }); const native = item("native", { nativeBody: "n".repeat(200_000) });
  const bytes = Buffer.from("%PDF-1.4\nstream\nBT (after limit) Tj ET\nendstream\n%%EOF", "latin1");
  const result = await bundle(["native", "pdf"], authority(native, pdf), { getCurrentAsset: async (id) => id === "pdf" ? { id: "asset_pdf", uploadState: "ready", finalObjectKey: "pdf-key" } : null,
    readAssetBytes: async () => bytes });
  assert.ok(result.text.length <= 200_000); assert.equal(result.sources[0]?.contentId, "native");
});

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) { const data = Buffer.from(text); const compressed = deflateRawSync(data); const filename = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed); const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42); central.push(record, filename); offset += local.length + filename.length + compressed.length;
  }
  const centralBody = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBody.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, centralBody, end]);
}
