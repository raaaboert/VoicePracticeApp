import type { DashboardAdminUsersExportResponse } from "@voicepractice/shared";

import { buildCsv } from "./csv";

export function buildDashboardAdminUsersCsv(payload: DashboardAdminUsersExportResponse): string {
  const header = ["Employee ID", "Name", "Email", "Role", "Status"];
  const rows = payload.rows.map((row) => [
    row.employeeId,
    row.name,
    row.email,
    row.role,
    row.status,
  ]);
  return buildCsv([header, ...rows]);
}

export function buildAdminUsersCsvFilename(orgName: string): string {
  const slug = orgName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${slug || "organization"}-users.csv`;
}
