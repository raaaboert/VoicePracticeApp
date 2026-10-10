import { Worker } from "node:worker_threads";

import { TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1 } from "./trainingContentGenerationSourcePolicy.js";

export const TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const TRAINING_CONTENT_EXTRACTION_TIMEOUT_MS = 4_000;
export const TRAINING_CONTENT_EXTRACTION_MAX_CONCURRENCY = Math.max(1, Math.min(4, Number.parseInt(process.env.TRAINING_CONTENT_EXTRACTION_MAX_CONCURRENCY ?? "2", 10) || 2));

let activeWorkers = 0;
const queuedWorkers: Array<() => void> = [];
async function acquireWorkerSlot(): Promise<() => void> {
  if (activeWorkers >= TRAINING_CONTENT_EXTRACTION_MAX_CONCURRENCY) await new Promise<void>((resolve) => queuedWorkers.push(resolve));
  activeWorkers += 1;
  let released = false;
  return () => { if (released) return; released = true; activeWorkers -= 1; queuedWorkers.shift()?.(); };
}

export class TrainingContentTextExtractionError extends Error {
  constructor(message: string) { super(message); this.name = "TrainingContentTextExtractionError"; }
}

function assertBoundedInput(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES) throw new TrainingContentTextExtractionError("The source exceeds safe extraction limits.");
}

/** Parses untrusted files off the API event-loop and always tears down its worker. */
export async function extractInWorker(kind: "pdf" | "docx", bytes: Uint8Array, options: { timeoutMs?: number; workerResourceLimits?: { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number; stackSizeMb: number } } = {}): Promise<string> {
  assertBoundedInput(bytes);
  const release = await acquireWorkerSlot();
  const workerPath = new URL(import.meta.url.endsWith(".ts") ? "./trainingContentTextExtractionWorker.ts" : "./trainingContentTextExtractionWorker.js", import.meta.url);
  try { return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, { resourceLimits: options.workerResourceLimits ?? { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, ...(import.meta.url.endsWith(".ts") ? { execArgv: ["--import", "tsx"] } : {}) });
    const finish = (error?: Error, value?: string) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); error ? reject(error) : resolve(value!); };
    const timer = setTimeout(() => finish(new TrainingContentTextExtractionError("The document could not be safely prepared in time.")), options.timeoutMs ?? TRAINING_CONTENT_EXTRACTION_TIMEOUT_MS);
    worker.once("error", () => finish(new TrainingContentTextExtractionError("The document cannot be safely prepared.")));
    worker.once("message", (message: { ok?: boolean; text?: string }) => message?.ok && typeof message.text === "string" ? finish(undefined, message.text) : finish(new TrainingContentTextExtractionError("The document cannot be safely prepared.")));
    const copy = Uint8Array.from(bytes); worker.postMessage({ kind, bytes: copy }, [copy.buffer]);
  }); } finally { release(); }
}

export async function extractPdfGenerationText(bytes: Uint8Array): Promise<string> { return await extractInWorker("pdf", bytes); }
export async function extractDocxGenerationText(bytes: Uint8Array): Promise<string> { return await extractInWorker("docx", bytes); }

export function getTrainingContentExtractionWorkerStateForTest(): { activeWorkers: number; queuedWorkers: number; maxConcurrency: number } { return { activeWorkers, queuedWorkers: queuedWorkers.length, maxConcurrency: TRAINING_CONTENT_EXTRACTION_MAX_CONCURRENCY }; }
export const TRAINING_CONTENT_TEXT_EXTRACTION_SECURITY_CONTRACT_V2 = Object.freeze({ workerIsolated: true, timeoutMs: TRAINING_CONTENT_EXTRACTION_TIMEOUT_MS, workerMemoryMb: 48, maxConcurrency: TRAINING_CONTENT_EXTRACTION_MAX_CONCURRENCY, maximumInputBytes: TRAINING_CONTENT_GENERATION_MAX_SOURCE_BYTES, maximumExtractedCharacters: TRAINING_CONTENT_EXTRACTION_SECURITY_CONTRACT_V1.maximumExtractedCharacters });
