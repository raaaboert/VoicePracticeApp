import type { DashboardAdminAccessRequestRow } from "@voicepractice/shared";

export function partitionAdminAccessRequests(
  requests: readonly DashboardAdminAccessRequestRow[]
): {
  pendingRequests: DashboardAdminAccessRequestRow[];
  requestHistory: DashboardAdminAccessRequestRow[];
} {
  return {
    pendingRequests: requests.filter((request) => request.status === "pending"),
    requestHistory: requests.filter((request) => request.status !== "pending"),
  };
}
