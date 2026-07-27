import type { DashboardAdminUsersExportResponse } from "@voicepractice/shared";

import { buildCsv } from "./csv";

export function buildDashboardAdminUsersCsv(payload: DashboardAdminUsersExportResponse): string {
  const header = ["First Name", "Last Name", "Email", "Employee ID", "Role", "Manager", "Status"];
  const rows = payload.rows.map((row) => [
    row.firstName,
    row.lastName,
    row.email,
    row.employeeId,
    row.role,
    row.manager,
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
