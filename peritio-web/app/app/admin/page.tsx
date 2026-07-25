import { redirect } from "next/navigation";

import { AdminWorkspace } from "@/src/components/AdminWorkspace";
import { PageHeader } from "@/src/components/PageHeader";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardAdminAccessRequests,
  getDashboardAdminUsers,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const orgId = params.orgId?.trim() || null;

  let usersPayload;
  let accessRequestsPayload;
  try {
    [usersPayload, accessRequestsPayload] = await Promise.all([
      getDashboardAdminUsers(orgId),
      getDashboardAdminAccessRequests(orgId),
    ]);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    if (error instanceof DashboardApiError && (error.status === 400 || error.status === 403 || error.status === 404)) {
      redirect("/app/access-denied");
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={`${usersPayload.org.name} Admin`}
        description="Manage organization users and membership requests."
      />
      <AdminWorkspace usersPayload={usersPayload} accessRequestsPayload={accessRequestsPayload} orgId={orgId} />
    </>
  );
}
