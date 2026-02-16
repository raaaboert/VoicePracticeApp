import crypto from "node:crypto";

interface EncryptedPayloadV1 {
  v: 1;
  alg: "aes-256-gcm";
  ivB64: string;
  tagB64: string;
  dataB64: string;
}

function getTranscriptSecret(): string {
  // For local prototyping, fall back to the admin token secret or a known placeholder.
  // Production must override SUPPORT_TRANSCRIPT_SECRET with a strong, random value.
  return (
    process.env.SUPPORT_TRANSCRIPT_SECRET?.trim() ||
    process.env.ADMIN_TOKEN_SECRET?.trim() ||
    "replace_me_for_production"
  );
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSupportTranscript(plaintext: string): string {
  const secret = getTranscriptSecret();
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayloadV1 = {
    v: 1,
    alg: "aes-256-gcm",
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    dataB64: ciphertext.toString("base64")
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decryptSupportTranscript(encoded: string): string {
  let raw: EncryptedPayloadV1;
  try {
    raw = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as EncryptedPayloadV1;
  } catch {
    throw new Error("Transcript payload is not valid base64 JSON.");
  }

  if (!raw || raw.v !== 1 || raw.alg !== "aes-256-gcm") {
    throw new Error("Transcript payload version is not supported.");
  }

  const secret = getTranscriptSecret();
  const key = deriveKey(secret);
  const iv = Buffer.from(raw.ivB64, "base64");
  const tag = Buffer.from(raw.tagB64, "base64");
  const data = Buffer.from(raw.dataB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

