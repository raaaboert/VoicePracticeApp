import { redirect } from "next/navigation";

import { FocusTopicAdministration } from "@/src/components/FocusTopicAdministration";
import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardAdminUsers,
  getDashboardFocusTopicOrder,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function FocusTopicAdminPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const selectedOrgId = (await searchParams).orgId?.trim() || null;
  try {
    const usersPayload = await getDashboardAdminUsers(selectedOrgId);
    if (!usersPayload.viewer.capabilities.manageOrganizationContent) redirect("/app/access-denied");
    const topics = await getDashboardFocusTopicOrder(usersPayload.org.id);
    if (topics.authorityMode !== "assignments") redirect(`/app/admin/content-organization${selectedOrgId
      ? `?orgId=${encodeURIComponent(selectedOrgId)}` : ""}`);
    return <>
      <PageHeader eyebrow="Admin" title="Focus Topics"
        description={`Manage learner assignments for ${usersPayload.org.name}.`} />
      <TrainingContentAdminNav orgId={selectedOrgId} active="focus-topics" />
      <FocusTopicAdministration orgId={usersPayload.org.id}
        initialTopics={topics.trainings} users={usersPayload.users} />
    </>;
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) redirect(buildDashboardSessionResetPath());
    if (error instanceof DashboardApiError && [400, 403, 404].includes(error.status)) {
      redirect("/app/access-denied");
    }
    throw error;
  }
}
