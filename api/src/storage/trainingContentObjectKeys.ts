import { createHash, randomBytes } from "node:crypto";

import type { TrainingContentAssetRole } from "@voicepractice/shared";

function keySegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Object-key identifiers cannot be blank.");
  }
  const readable = trimmed.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 10);
  return `${readable || "id"}-${digest}`;
}

function nonce(): string {
  return randomBytes(18).toString("base64url");
}

export function createTrainingContentTemporaryObjectKey(params: {
  orgId: string;
  contentId: string;
  assetId: string;
}): string {
  return [
    "tmp",
    keySegment(params.orgId),
    keySegment(params.contentId),
    keySegment(params.assetId),
    nonce(),
  ].join("/");
}

export function createTrainingContentFinalizationNonce(): string {
  return nonce();
}

export function createTrainingContentFinalObjectKey(params: {
  orgId: string;
  contentId: string;
  assetRole: TrainingContentAssetRole;
  version: number;
  finalizationNonce: string;
}): string {
  if (!Number.isSafeInteger(params.version) || params.version <= 0) {
    throw new Error("Asset version must be a positive integer.");
  }
  if (!/^[a-zA-Z0-9_-]{16,}$/.test(params.finalizationNonce)) {
    throw new Error("Finalization nonce is invalid.");
  }
  return [
    "objects",
    keySegment(params.orgId),
    keySegment(params.contentId),
    params.assetRole,
    String(params.version),
    params.finalizationNonce,
  ].join("/");
}
