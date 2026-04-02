import crypto from "node:crypto";

import { calculateBilledSecondsFromRaw, getDayKey } from "@voicepractice/shared";

import type { UserUsageSnapshot } from "./usageSessionAccess.js";

export interface UsageSessionIdentityParams {
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId: string | null;
  submittedTrainingPackId: string | null;
  startedAt: string;
  endedAt: string;
  requestedRawDurationSeconds: number;
}

/**
 * Billing/access truth for usage sessions must be idempotent under retries once persistence is
 * split. The session id is therefore derived from the semantic request payload rather than a
 * per-attempt UUID so a replay can resolve to the same authoritative usage record.
 *
 * `requestedRawDurationSeconds` deliberately uses the caller-submitted value, not the clamped
 * stored duration, so retry identity stays stable even if max-simulation limits change between
 * the first accepted write and a later replay. The tradeoff is that two truly distinct sessions
 * with identical semantic payloads will dedupe to one record until the product has a durable
 * client-generated event id.
 */
export function buildUsageSessionDeterministicId(params: UsageSessionIdentityParams): string {
  const payload = [
    params.userId.trim(),
    params.orgId?.trim() ?? "",
    params.segmentId.trim(),
    params.scenarioId.trim(),
    params.trainingId?.trim() ?? "",
    params.submittedTrainingPackId?.trim() ?? "",
    params.startedAt.trim(),
    params.endedAt.trim(),
    String(Math.max(0, Math.floor(params.requestedRawDurationSeconds)))
  ].join("|");

  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return `sess_${digest}`;
}

export function computeUsageSessionBilledSecondsAdded(params: {
  beforeUsage: UserUsageSnapshot;
  sessionEndedAt: string;
  sessionRawDurationSeconds: number;
  timeZone: string;
}): number {
  const endedAt = new Date(params.sessionEndedAt);
  if (Number.isNaN(endedAt.getTime())) {
    return 0;
  }

  const endedDayKey = getDayKey(endedAt, params.timeZone);
  if (endedDayKey !== params.beforeUsage.dayKey) {
    return 0;
  }

  const nextRawSecondsToday = params.beforeUsage.rawSecondsToday + Math.max(0, Math.floor(params.sessionRawDurationSeconds));
  return Math.max(0, calculateBilledSecondsFromRaw(nextRawSecondsToday) - params.beforeUsage.billedSecondsToday);
}
