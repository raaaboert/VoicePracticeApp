import crypto from "node:crypto";

export interface AppReviewCredential {
  email: string;
  code: string;
}

export function normalizeEmailForExactMatch(email: string): string {
  return email.trim().toLowerCase();
}

export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
