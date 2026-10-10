import { inflateRawSync, inflateSync } from "node:zlib";

import yauzl from "yauzl";

import { TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1 } from "./trainingContentGenerationSourcePolicy.js";

export const TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export class TrainingContentTextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingContentTextExtractionError";
  }
}

function boundedText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  if (!normalized) throw new TrainingContentTextExtractionError("The source contains no extractable text.");
  return normalized.slice(0, TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters);
}

function assertBoundedInput(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES) {
    throw new TrainingContentTextExtractionError("The source exceeds safe extraction limits.");
  }
}

/** Conservative text-only PDF extraction. It deliberately rejects encrypted PDFs and never OCRs. */
export function extractPdfGenerationText(bytes: Uint8Array): string {
  assertBoundedInput(bytes);
  const document = Buffer.from(bytes).toString("latin1");
  if (!document.startsWith("%PDF-") || /\/Encrypt\b/.test(document)) {
    throw new TrainingContentTextExtractionError("The PDF cannot be safely read.");
  }
  const chunks: string[] = [];
  const streams = document.matchAll(/(?:<<[\s\S]{0,2048}?>>\s*)?stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const match of streams) {
    const header = match[0].slice(0, match[0].indexOf("stream"));
    let body = Buffer.from(match[1] ?? "", "latin1");
    if (/\/FlateDecode\b/.test(header)) {
      try { body = inflateSync(body, { maxOutputLength: TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters * 4 }); }
      catch { try { body = inflateRawSync(body, { maxOutputLength: TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters * 4 }); }
      catch { throw new TrainingContentTextExtractionError("The PDF contains an invalid compressed text stream."); } }
    }
    const text = body.toString("latin1");
    for (const literal of text.matchAll(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g)) {
      chunks.push(decodePdfLiteral(literal[0].replace(/\s*(?:Tj|'|")$/, "").slice(1, -1)));
    }
  }
  return boundedText(chunks.join(" "));
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_all, escaped: string) => {
    if (/^[0-7]/.test(escaped)) return String.fromCharCode(Number.parseInt(escaped, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[escaped] ?? escaped;
  });
}

/** Reads only word/document.xml from a bounded DOCX archive; external relationships and XML entities are rejected. */
export async function extractDocxGenerationText(bytes: Uint8Array): Promise<string> {
  assertBoundedInput(bytes);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new TrainingContentTextExtractionError("The DOCX is not a ZIP archive.");
  const entries = await readDocxEntries(Buffer.from(bytes));
  const relationship = entries.get("word/_rels/document.xml.rels");
  if (relationship && /TargetMode\s*=\s*["']External["']/i.test(relationship)) {
    throw new TrainingContentTextExtractionError("External DOCX relationships are not allowed.");
  }
  const xml = entries.get("word/document.xml");
  if (!xml) throw new TrainingContentTextExtractionError("The DOCX does not contain a document body.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new TrainingContentTextExtractionError("DOCX XML entities are not allowed.");
  const text: string[] = [];
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi)) {
    text.push(decodeXmlText(match[1] ?? ""));
  }
  return boundedText(text.join(" "));
}

function decodeXmlText(value: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(value)) {
    throw new TrainingContentTextExtractionError("The DOCX contains unsupported XML entities.");
  }
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([\da-fA-F]+);/g, (entity, decimal, hex) => {
    if (entity === "&amp;") return "&"; if (entity === "&lt;") return "<"; if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"'; if (entity === "&apos;") return "'";
    return String.fromCodePoint(Number.parseInt(decimal || hex, decimal ? 10 : 16));
  });
}

async function readDocxEntries(bytes: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true,
    decodeStrings: true, strictFileNames: true }, (error, zip) => {
    if (error || !zip) return reject(new TrainingContentTextExtractionError("The DOCX archive is invalid."));
    const wanted = new Set(["word/document.xml", "word/_rels/document.xml.rels"]); const entries = new Map<string, string>();
    let count = 0; let total = 0; let settled = false;
    const fail = (message: string) => { if (!settled) { settled = true; zip.close(); reject(new TrainingContentTextExtractionError(message)); } };
    zip.on("error", () => fail("The DOCX archive is invalid."));
    zip.on("entry", (entry) => {
      count += 1; total += entry.uncompressedSize;
      const name = entry.fileName.replace(/\\/g, "/");
      if (count > 2048 || total > TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES * 4 || entry.uncompressedSize > TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES || (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 200) || name.startsWith("/") || name.split("/").includes("..")) return fail("The DOCX exceeds safe archive limits.");
      if (!wanted.has(name)) return zip.readEntry();
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) return fail("The DOCX document cannot be read.");
        const parts: Buffer[] = []; let length = 0;
        stream.on("data", (part: Buffer) => { length += part.length; if (length > TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES) { stream.destroy(); fail("The DOCX entry exceeds safe limits."); } else parts.push(part); });
        stream.on("error", () => fail("The DOCX document cannot be read."));
        stream.on("end", () => { if (!settled) { entries.set(name, Buffer.concat(parts).toString("utf8")); zip.readEntry(); } });
      });
    });
    zip.on("end", () => { if (!settled) { settled = true; zip.close(); resolve(entries); } }); zip.readEntry();
  }));
}
