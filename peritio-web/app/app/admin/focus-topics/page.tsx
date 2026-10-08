import { redirect } from "next/navigation";

import { FocusTopicAdministration } from "@/src/components/FocusTopicAdministration";
import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardAdminUsers,
  getDashboardFocusTopicOrder,
  getDashboardViewer,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function FocusTopicAdminPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const selectedOrgId = (await searchParams).orgId?.trim() || null;
  try {
    const viewer = await getDashboardViewer();
    if (!viewer || !viewer.capabilities.manageFocusTopics) redirect("/app/access-denied");
    if (viewer.accessType !== "super_user" && selectedOrgId && selectedOrgId !== viewer.orgId) {
      redirect("/app/access-denied");
    }
    const usersPayload = viewer.accessType === "super_user" || viewer.capabilities.manageOrganizationContent
      ? await getDashboardAdminUsers(selectedOrgId)
      : null;
    const orgId = usersPayload?.org.id ?? viewer.orgId;
    if (!orgId) redirect("/app/access-denied");
    const topics = await getDashboardFocusTopicOrder(orgId);
    if (topics.authorityMode !== "assignments") redirect(`/app/admin/content-organization${selectedOrgId
      ? `?orgId=${encodeURIComponent(selectedOrgId)}` : ""}`);
    return <>
      <PageHeader eyebrow="Admin" title="Focus Topics"
        description={`Manage Focus Topic access and related learning resources for ${usersPayload?.org.name ?? viewer.orgName}.`} />
      <TrainingContentAdminNav orgId={selectedOrgId} active="focus-topics" capabilities={viewer.capabilities} />
      <FocusTopicAdministration orgId={orgId}
        initialTopics={topics.trainings} users={usersPayload?.users ?? []}
        canManageAllTopics={topics.management.canManageAllTopics}
        learningResourcesEnabled={topics.management.learningResourcesEnabled} />
    </>;
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) redirect(buildDashboardSessionResetPath());
    if (error instanceof DashboardApiError && [400, 403, 404].includes(error.status)) {
      redirect("/app/access-denied");
    }
    throw error;
  }
}
