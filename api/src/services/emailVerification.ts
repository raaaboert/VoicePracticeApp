import crypto from "node:crypto";

import { ApiDatabase, UserProfile } from "@voicepractice/shared";

export interface AppReviewCredential {
  email: string;
  code: string;
}

export type EmailVerificationResult = "ok" | "missing" | "expired" | "invalid";

export function normalizeEmailForExactMatch(email: string): string {
  return email.trim().toLowerCase();
}

export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashEmailVerificationCode(
  secret: string,
  userId: string,
  email: string,
  code: string
): string {
  return crypto.createHmac("sha256", secret).update(`${userId}:${email}:${code}`).digest("hex");
}

export function verifyLatestEmailVerification(params: {
  db: ApiDatabase;
  user: UserProfile;
  code: string;
  now: Date;
  codeSecret: string;
  appReviewCredential?: AppReviewCredential | null;
}): EmailVerificationResult {
  const pending = params.db.emailVerifications
    .filter(
      (entry) =>
        entry.userId === params.user.id
        && entry.email === params.user.email
        && entry.consumedAt === null
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const latest = pending[0];
  if (!latest) {
    return "missing";
  }

  const expiresAtMs = new Date(latest.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= params.now.getTime()) {
    latest.consumedAt = params.now.toISOString();
    return "expired";
  }

  const credential = params.appReviewCredential ?? null;
  const reviewerEmailMatches = Boolean(
    credential
    && normalizeEmailForExactMatch(params.user.email) === credential.email
  );
  const reviewerCodeMatches = credential
    ? timingSafeEqualText(params.code, credential.code)
    : false;

  const expectedHash = Buffer.from(latest.codeHash, "hex");
  const providedHash = Buffer.from(
    hashEmailVerificationCode(params.codeSecret, params.user.id, params.user.email, params.code),
    "hex"
  );
  const normalCodeMatches =
    expectedHash.length === providedHash.length
    && crypto.timingSafeEqual(expectedHash, providedHash);

  if (!(reviewerEmailMatches && reviewerCodeMatches) && !normalCodeMatches) {
    return "invalid";
  }

  latest.consumedAt = params.now.toISOString();
  return "ok";
}
