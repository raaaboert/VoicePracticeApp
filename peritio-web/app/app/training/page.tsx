import { redirect } from "next/navigation";

import { buildLegacyDashboardRedirect } from "@/src/components/dashboardDivisionFilterState";

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ divisionId?: string | string[] }>;
}) {
  const params = await searchParams;
  redirect(buildLegacyDashboardRedirect("training", params.divisionId));
}
