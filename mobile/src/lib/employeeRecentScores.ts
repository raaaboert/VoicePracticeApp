import type { fetchOrgAdminUserDetail } from "./api";

export type EmployeeScoreDetail = Awaited<ReturnType<typeof fetchOrgAdminUserDetail>>;
export type EmployeeScore = EmployeeScoreDetail["scores"]["recent"][number];
export type ScoreDateFilter = "all" | "7" | "30";
export type ScoreSort = "newest" | "oldest";
export const EMPLOYEE_SCORE_PAGE_SIZE = 5;

// This endpoint supplies at most 20 summaries from the requested 30-day window.
// These helpers operate only on that authorized, already-loaded subset.
export function filterEmployeeScores(rows: readonly EmployeeScore[], filters: {
  date: ScoreDateFilter; scenarioId: string; sort: ScoreSort; periodEndAt: string;
}): EmployeeScore[] {
  const end = Date.parse(filters.periodEndAt);
  const start = end - Number(filters.date) * 86_400_000;
  return rows.filter((row) => {
    if (filters.scenarioId && row.scenarioId !== filters.scenarioId) return false;
    if (filters.date === "all") return true;
    const at = Date.parse(row.endedAt);
    return Number.isFinite(at) && Number.isFinite(end) && at >= start && at <= end;
  }).sort((a, b) => {
    const aTime = Date.parse(a.endedAt), bTime = Date.parse(b.endedAt);
    // Undated summaries remain inspectable, consistently after dated records.
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) {
      if (Number.isFinite(aTime)) return -1;
      if (Number.isFinite(bTime)) return 1;
      return a.id.localeCompare(b.id);
    }
    const byTime = filters.sort === "newest" ? bTime - aTime : aTime - bTime;
    return byTime || a.id.localeCompare(b.id);
  });
}

export function employeeScenarioOptions(rows: readonly EmployeeScore[], titles: ReadonlyMap<string, string>) {
  const ids = [...new Set(rows.map((row) => row.scenarioId))];
  return [{ value: "", label: "All scenarios" }, ...ids.map((id) => ({
    value: id, label: titles.get(id) || `Unavailable scenario (${id})`,
  })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))];
}

export function employeeScoreLabel(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Not available";
}

export function employeeScoreDate(value: string): string {
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toLocaleString() : "Date unavailable";
}
