import { createHash } from "node:crypto";
import type { SimulationSessionRecord, UsageSessionRecord } from "@voicepractice/shared";
import { buildUsageSessionIdFromSimulationSessionId, resolveSimulationConversationDeadlineMs,
  SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES } from "./simulationSessionLifecycle.js";

// Allows completion/recovery through the entire existing grace window, plus the
// existing two-minute timestamp tolerance. This is NOT an inactivity timeout.
export const ABANDONED_SESSION_CLOCK_MARGIN_MS = 2 * 60_000;
export const CONFIRMED_EXCHANGE_GAP_SECONDS = 60;

export function activitySettlementDeadline(session: SimulationSessionRecord, maxMinutes: number | null): number {
  return resolveSimulationConversationDeadlineMs(session, maxMinutes)
    + SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES * 60_000 + ABANDONED_SESSION_CLOCK_MARGIN_MS;
}

/** Semantic input identity survives transport retries/new correlation IDs. No text is stored. */
export function confirmedExchangeKey(kind: "opening" | "turn", history: readonly { role: string; content: string }[] = []): string {
  return kind === "opening" ? "opening" : createHash("sha256")
    .update(JSON.stringify(history.map(({ role, content }) => [role, content.trim()]))).digest("hex");
}

export interface ConfirmedActivityParams {
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  exchangeKey: string;
  confirmedAt: string;
  maxSimulationMinutes: number | null;
}

export function applyConfirmedActivity(session: SimulationSessionRecord, p: ConfirmedActivityParams): SimulationSessionRecord {
  const at = Date.parse(p.confirmedAt);
  const deadline = resolveSimulationConversationDeadlineMs(session, p.maxSimulationMinutes);
  if (session.status !== "started" || session.userId !== p.userId || session.orgId !== p.orgId
    || !/^(opening|[a-f0-9]{64})$/.test(p.exchangeKey) || !Number.isFinite(at)
    || at < Date.parse(session.serverStartedAt) || at >= deadline) return session;
  const previous = session.confirmedActivity;
  if (previous?.exchangeKeys.includes(p.exchangeKey)) return session;
  // Completion timestamps may arrive out of order. Never move the high-water
  // checkpoint backwards or charge the same time interval twice.
  const lastMs = previous ? Date.parse(previous.lastAt) : at;
  const gap = previous ? Math.min(Math.max(0, (at - lastMs) / 1000), CONFIRMED_EXCHANGE_GAP_SECONDS) : 0;
  const maxSeconds = Math.max(0, Math.floor((deadline - Date.parse(session.serverStartedAt)) / 1000));
  return { ...session, confirmedActivity: {
    firstAt: previous?.firstAt ?? p.confirmedAt,
    lastAt: new Date(Math.max(lastMs, at)).toISOString(),
    seconds: Math.min(maxSeconds, (previous?.seconds ?? 0) + gap),
    exchangeKeys: [...(previous?.exchangeKeys ?? []), p.exchangeKey],
    maxSeconds,
    settleAfter: new Date(Math.max(previous ? Date.parse(previous.settleAfter) : 0,
      activitySettlementDeadline(session, p.maxSimulationMinutes))).toISOString(),
  } };
}

export function estimatedSessionUsage(session: SimulationSessionRecord, now: Date): UsageSessionRecord | null {
  const activity = session.confirmedActivity;
  if (!activity || session.status !== "started") return null;
  return {
    usageSource: "server_abandoned",
    id: buildUsageSessionIdFromSimulationSessionId(session.simulationSessionId),
    userId: session.userId, orgId: session.orgId, divisionId: session.divisionId,
    segmentId: session.segmentId, scenarioId: session.scenarioId, scenarioVersionId: session.scenarioVersionId,
    trainingId: session.trainingId, trainingPackId: session.trainingPackId, originTopicId: session.originTopicId,
    startedAt: session.serverStartedAt, endedAt: activity.lastAt,
    rawDurationSeconds: Math.max(0, Math.floor(Math.min(activity.seconds, activity.maxSeconds))),
    createdAt: now.toISOString(),
  };
}
