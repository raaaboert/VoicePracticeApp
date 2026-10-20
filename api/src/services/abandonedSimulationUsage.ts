import type { ApiDatabase, SimulationSessionRecord, UsageSessionRecord } from "@voicepractice/shared";
import type { SimulationSessionStore } from "../storage/simulationSessionStore.js";
import { createUsageSessionAccess, type UsageSessionAccess } from "./usageSessionAccess.js";
import { activitySettlementDeadline, estimatedSessionUsage } from "./simulationActivity.js";
import { computeUsageSessionBilledSecondsAdded } from "./usageSessionWriteModel.js";
import type { EventEmitter } from "node:events";
import { safeErrorDiagnostics } from "./safeErrors.js";

export function scheduleAbandonedSimulationSettlement(
  run: () => Promise<void>, server: Pick<EventEmitter, "once">, intervalMs = 60_000,
): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await run(); }
    catch (error) { console.warn("[simulation-usage]", { stage: "settlement_failed", ...safeErrorDiagnostics(error) }); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void sweep(); }, intervalMs);
  timer.unref();
  const stop = () => clearInterval(timer);
  server.once("close", stop);
  void sweep(); // Bounded startup catch-up; durable state also survives skipped sweeps.
  return stop;
}

export async function settleAbandonedSimulationBatch(p: {
  store: SimulationSessionStore; usage: UsageSessionAccess; db: Pick<ApiDatabase, "usageSessions">;
  now: Date; userId?: string; limit?: number;
  maxMinutes(session: SimulationSessionRecord): number | null;
  timeZone(userId: string): string;
}): Promise<number> {
  const candidates = await p.store.listAccountableSessions({ userId: p.userId, expiredBefore: p.now, limit: p.limit ?? 50 });
  if (!candidates.length) return 0;
  await p.usage.refresh?.();
  const records = new Map(p.usage.list(p.db).map(record => [record.id, record]));
  let settled = 0;
  let changed = false;
  for (const candidate of candidates) {
    const result = await p.store.settleUsage({
      simulationSessionId: candidate.simulationSessionId, userId: candidate.userId, orgId: candidate.orgId,
      now: p.now, source: "server_abandoned",
      notBefore: new Date(activitySettlementDeadline(candidate, p.maxMinutes(candidate))),
      buildRecord: session => {
        if (!session.confirmedActivity || p.now.getTime() < Math.max(Date.parse(session.confirmedActivity.settleAfter),
          activitySettlementDeadline(session, p.maxMinutes(session)))) return null;
        const record = estimatedSessionUsage(session, p.now);
        if (!record) return null;
        const timeZone = p.timeZone(session.userId);
        // Delayed reconciliation belongs to the actual activity end day, not today.
        const beforeUsage = usageAccessSnapshot([...records.values()]).computeUserUsageSnapshot(p.db, {
          userId: session.userId, now: new Date(record.endedAt), timeZone,
        });
        return { ...record, billedSecondsAdded: computeUsageSessionBilledSecondsAdded({
          beforeUsage, sessionEndedAt: record.endedAt, sessionRawDurationSeconds: record.rawDurationSeconds, timeZone,
        }) };
      },
      appendFile: record => p.usage.append(p.db, record),
    });
    if (result?.created) settled++;
    if (result) { changed = true; records.set(result.record.id, result.record); }
  }
  if (changed) await p.usage.refresh?.();
  return settled;
}

/** Admission-only projection. Never feed estimates into a running simulation. */
export async function newSessionUsageAccess(p: {
  store: Pick<SimulationSessionStore, "listAccountableSessions">; usage: UsageSessionAccess; db: Pick<ApiDatabase, "usageSessions">;
  userId: string; orgId: string | null; now: Date;
}): Promise<UsageSessionAccess> {
  const pending = await p.store.listAccountableSessions(p.orgId ? { orgId: p.orgId } : { userId: p.userId });
  const own = p.orgId ? await p.store.listAccountableSessions({ userId: p.userId }) : [];
  // Read pending first, then finalized usage. If settlement commits between
  // reads, its record is either still represented by the estimate or included
  // here; deterministic IDs remove overlap. The opposite order can miss both.
  await p.usage.refresh?.();
  const records = new Map(p.usage.list(p.db).map(r => [r.id, r]));
  for (const session of [...pending, ...own]) {
    const record = estimatedSessionUsage(session, p.now);
    if (record && !records.has(record.id)) records.set(record.id, record);
  }
  return usageAccessSnapshot([...records.values()]);
}

export function usageAccessSnapshot(records: UsageSessionRecord[]): UsageSessionAccess {
  const access = createUsageSessionAccess();
  const snapshot = { usageSessions: records };
  return {
    ...access,
    list: (_db, query) => access.list(snapshot, query),
    computeUserUsageSnapshot: (_db, query) => access.computeUserUsageSnapshot(snapshot, query),
    buildOrgUsageSnapshot: (_db, query) => access.buildOrgUsageSnapshot(snapshot, query),
  };
}
