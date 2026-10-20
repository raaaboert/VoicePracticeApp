import type { UsageSessionRecord } from "@voicepractice/shared";

/** Usage accounting is not proof of completion. Missing provenance is legacy completion. */
export function isCompletedSimulationUsage(session: Pick<UsageSessionRecord, "usageSource">): boolean {
  return session.usageSource !== "server_abandoned";
}

export function countCompletedSimulationUsage(sessions: readonly UsageSessionRecord[]): number {
  return sessions.filter(isCompletedSimulationUsage).length;
}
