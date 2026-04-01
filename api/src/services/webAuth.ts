import crypto from "node:crypto";

import {
  ApiDatabase,
  DashboardAccessType,
  UserProfile,
  WebAuthChallengeRecord,
  WebAuthSessionRecord
} from "@voicepractice/shared";
import { v4 as uuid } from "uuid";

export interface WebAuthTokenPayload {
  kind: "web";
  sid: string;
  sub: string;
  exp: number;
}

export interface WebAuthSessionMetadata {
  accessType: DashboardAccessType | null;
  orgId: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

const MAX_WEB_AUTH_USER_AGENT_LENGTH = 255;
const MAX_WEB_AUTH_IP_LENGTH = 64;
const WEB_AUTH_SESSION_ACTIVITY_WRITE_INTERVAL_MS = 15 * 60 * 1000;

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

  function sanitizeUserAgent(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.slice(0, MAX_WEB_AUTH_USER_AGENT_LENGTH);
  }

  function sanitizeIpAddress(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.slice(0, MAX_WEB_AUTH_IP_LENGTH);
  }

  function normalizeSessionMetadata(metadata?: Partial<WebAuthSessionMetadata>) {
    return {
      accessType: metadata?.accessType ?? null,
      orgId: metadata?.orgId ?? null,
      userAgent: sanitizeUserAgent(metadata?.userAgent),
      ipAddress: sanitizeIpAddress(metadata?.ipAddress),
    };
  }

  function issueSession(
    user: UserProfile,
    ttlMinutes: number,
    now: Date,
    metadata?: WebAuthSessionMetadata
  ) {
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const sessionId = `websess_${uuid()}`;
    const normalizedMetadata = normalizeSessionMetadata(metadata);
    const record: WebAuthSessionRecord = {
      sessionId,
      userId: user.id,
      accessType: normalizedMetadata.accessType,
      orgId: normalizedMetadata.orgId,
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      createdUserAgent: normalizedMetadata.userAgent,
      lastSeenUserAgent: normalizedMetadata.userAgent,
      createdIp: normalizedMetadata.ipAddress,
      lastSeenIp: normalizedMetadata.ipAddress,
    };

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
      record,
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

  function touchSession(record: WebAuthSessionRecord, now: Date, metadata?: Omit<WebAuthSessionMetadata, "accessType" | "orgId">): boolean {
    const nowIso = now.toISOString();
    const normalizedMetadata = normalizeSessionMetadata(metadata);
    const previousLastSeenAt = typeof record.lastSeenAt === "string" && record.lastSeenAt.trim()
      ? record.lastSeenAt
      : record.updatedAt;
    const previousUserAgent =
      typeof record.lastSeenUserAgent === "string" && record.lastSeenUserAgent.trim()
        ? record.lastSeenUserAgent
        : (typeof record.createdUserAgent === "string" ? record.createdUserAgent : null);
    const previousIp =
      typeof record.lastSeenIp === "string" && record.lastSeenIp.trim()
        ? record.lastSeenIp
        : (typeof record.createdIp === "string" ? record.createdIp : null);
    const lastSeenMs = new Date(previousLastSeenAt).getTime();
    const shouldPersistByTime =
      Number.isNaN(lastSeenMs) || now.getTime() - lastSeenMs >= WEB_AUTH_SESSION_ACTIVITY_WRITE_INTERVAL_MS;
    const userAgentChanged = normalizedMetadata.userAgent !== previousUserAgent;
    const ipChanged = normalizedMetadata.ipAddress !== previousIp;

    if (!shouldPersistByTime && !userAgentChanged && !ipChanged) {
      return false;
    }

    record.lastSeenAt = nowIso;
    record.updatedAt = nowIso;
    record.lastSeenUserAgent = normalizedMetadata.userAgent;
    record.lastSeenIp = normalizedMetadata.ipAddress;
    if (typeof record.createdUserAgent !== "string") {
      record.createdUserAgent = normalizedMetadata.userAgent;
    }
    if (typeof record.createdIp !== "string") {
      record.createdIp = normalizedMetadata.ipAddress;
    }

    return true;
  }

  return {
    issueSession,
    verifyToken,
    issueSignInChallenge,
    verifyLatestSignInChallenge,
    touchSession,
  };
}
