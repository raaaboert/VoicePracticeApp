import type { DashboardPerformancePlanRow, DashboardPerformanceUserOption } from "@voicepractice/shared";

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function buildPerformanceUserDisplayName(user: DashboardPerformanceUserOption): string {
  return user.displayName.trim() || "Not provided";
}

export function sortPerformanceUsersByDisplayName(
  users: DashboardPerformanceUserOption[]
): DashboardPerformanceUserOption[] {
  return [...users].sort((left, right) => {
    const leftName = buildPerformanceUserDisplayName(left);
    const rightName = buildPerformanceUserDisplayName(right);
    return (
      leftName.localeCompare(rightName, undefined, { sensitivity: "base" }) ||
      left.email.localeCompare(right.email, undefined, { sensitivity: "base" }) ||
      left.userId.localeCompare(right.userId)
    );
  });
}

export function filterPerformanceUsers(
  users: DashboardPerformanceUserOption[],
  searchTerm: string
): DashboardPerformanceUserOption[] {
  const sortedUsers = sortPerformanceUsersByDisplayName(users);
  const query = normalizeSearch(searchTerm);
  if (!query) {
    return sortedUsers;
  }
  return sortedUsers.filter((user) => {
    const displayName = buildPerformanceUserDisplayName(user);
    return `${displayName} ${user.email}`.toLowerCase().includes(query);
  });
}

export function resolveSelectedPerformanceUser(
  users: DashboardPerformanceUserOption[],
  selectedUserId: string
): DashboardPerformanceUserOption | null {
  if (!selectedUserId.trim()) {
    return null;
  }
  return users.find((user) => user.userId === selectedUserId) ?? null;
}

export function filterPerformanceRowsForUser(
  rows: DashboardPerformancePlanRow[],
  userId: string | null
): DashboardPerformancePlanRow[] {
  if (!userId) {
    return [];
  }
  return rows.filter((row) => row.plan.userId === userId);
}

export function getVisiblePerformanceHistoryRows(
  rows: DashboardPerformancePlanRow[],
  isExpanded: boolean
): DashboardPerformancePlanRow[] {
  return isExpanded ? rows : [];
}

export function shouldClosePerformanceDetailWhenHistoryCollapses(
  detailPlanId: string | null,
  historyRows: DashboardPerformancePlanRow[]
): boolean {
  if (!detailPlanId) {
    return false;
  }
  return historyRows.some((row) => row.plan.id === detailPlanId);
}
