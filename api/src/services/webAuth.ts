import crypto from "node:crypto";

import { ApiDatabase, UserProfile, WebAuthChallengeRecord, WebAuthSessionRecord } from "@voicepractice/shared";
import { v4 as uuid } from "uuid";

export interface WebAuthTokenPayload {
  kind: "web";
  sid: string;
  sub: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createWebAuthService(params: {
  tokenSecret: string;
  codeSecret: string;
}) {
  const tokenSecret = params.tokenSecret.trim();
  const codeSecret = params.codeSecret.trim();
  if (!tokenSecret) {
    throw new Error("WEB_AUTH_TOKEN_SECRET is required.");
  }
  if (!codeSecret) {
    throw new Error("WEB_AUTH_CODE_SECRET is required.");
  }

  function createCode(): string {
    const numeric = crypto.randomInt(0, 1_000_000);
    return String(numeric).padStart(6, "0");
  }

  function hashCode(userId: string, email: string, code: string): string {
    return crypto.createHmac("sha256", codeSecret).update(`${userId}:${email}:${code}`).digest("hex");
  }

  function issueSession(db: ApiDatabase, user: UserProfile, ttlMinutes: number, now: Date) {
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const sessionId = `websess_${uuid()}`;
    const record: WebAuthSessionRecord = {
      sessionId,
      userId: user.id,
      createdAt,
      updatedAt: createdAt,
      expiresAt
    };
    db.webAuthSessions.push(record);

    const payload: WebAuthTokenPayload = {
      kind: "web",
      sid: sessionId,
      sub: user.id,
      exp: new Date(expiresAt).getTime()
    };
    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto.createHmac("sha256", tokenSecret).update(`${header}.${body}`).digest("base64url");

    return {
      token: `${header}.${body}.${signature}`,
      expiresAt,
      sessionId
    };
  }

  function verifyToken(token: string): WebAuthTokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const [header, body, signature] = parts;
    const expectedSignature = crypto.createHmac("sha256", tokenSecret).update(`${header}.${body}`).digest("base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const actualBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      return null;
    }

    let payload: WebAuthTokenPayload;
    try {
      payload = JSON.parse(base64UrlDecode(body)) as WebAuthTokenPayload;
    } catch {
      return null;
    }

    if (payload.kind !== "web" || typeof payload.sid !== "string" || typeof payload.sub !== "string") {
      return null;
    }

    if (!payload.sid.trim() || !payload.sub.trim() || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  }

  function issueSignInChallenge(db: ApiDatabase, user: UserProfile, ttlMinutes: number, now: Date) {
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const code = createCode();
    const record: WebAuthChallengeRecord = {
      id: `wauth_${uuid()}`,
      userId: user.id,
      email: user.email,
      challengeType: "sign_in",
      codeHash: hashCode(user.id, user.email, code),
      createdAt,
      expiresAt,
      consumedAt: null
    };
    db.webAuthChallenges.push(record);
    return { code, expiresAt };
  }

  function verifyLatestSignInChallenge(db: ApiDatabase, user: UserProfile, code: string, now: Date): "ok" | "missing" | "expired" | "invalid" {
    const pending = (db.webAuthChallenges ?? [])
      .filter(
        (entry) =>
          entry.userId === user.id
          && entry.email === user.email
          && entry.challengeType === "sign_in"
          && entry.consumedAt === null
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const latest = pending[0];
    if (!latest) {
      return "missing";
    }

    const expiresAtMs = new Date(latest.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
      latest.consumedAt = now.toISOString();
      return "expired";
    }

    const expectedBuffer = Buffer.from(latest.codeHash, "hex");
    const providedBuffer = Buffer.from(hashCode(user.id, user.email, code), "hex");
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return "invalid";
    }

    latest.consumedAt = now.toISOString();
    return "ok";
  }

  function getActiveSessionRecord(db: ApiDatabase, payload: WebAuthTokenPayload): WebAuthSessionRecord | null {
    const record = (db.webAuthSessions ?? []).find((entry) => entry.sessionId === payload.sid && entry.userId === payload.sub);
    if (!record) {
      return null;
    }

    const expiresAtMs = new Date(record.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
      return null;
    }

    return record;
  }

  function revokeSession(db: ApiDatabase, sessionId: string): void {
    db.webAuthSessions = (db.webAuthSessions ?? []).filter((entry) => entry.sessionId !== sessionId);
  }

  function revokeUserSessions(db: ApiDatabase, userId: string): void {
    db.webAuthSessions = (db.webAuthSessions ?? []).filter((entry) => entry.userId !== userId);
  }

  return {
    issueSession,
    verifyToken,
    issueSignInChallenge,
    verifyLatestSignInChallenge,
    getActiveSessionRecord,
    revokeSession,
    revokeUserSessions
  };
}
