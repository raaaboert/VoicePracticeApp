import { redirect } from "next/navigation";

import { buildLegacyDashboardRedirect } from "@/src/components/dashboardDivisionFilterState";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ divisionId?: string | string[] }>;
}) {
  const params = await searchParams;
  redirect(buildLegacyDashboardRedirect("users", params.divisionId));
}
