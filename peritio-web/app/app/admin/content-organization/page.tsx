import { redirect } from "next/navigation";

import { ContentOrganizationManager } from "@/src/components/ContentOrganizationManager";
import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardAdminUsers,
  getDashboardFocusTopicOrder,
  getDashboardTrainingPackOrder,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function ContentOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const selectedOrgId = params.orgId?.trim() || null;
  try {
    const usersPayload = await getDashboardAdminUsers(selectedOrgId);
    if (!usersPayload.viewer.capabilities.manageOrganizationContent) {
      redirect("/app/access-denied");
    }
    const orgId = usersPayload.org.id;
    const [focusTopics, trainingPacks] = await Promise.all([
      getDashboardFocusTopicOrder(orgId),
      getDashboardTrainingPackOrder(orgId),
    ]);
    return (
      <>
        <PageHeader
          eyebrow="Admin"
          title="Content Organization"
          description={`Set the presentation order for ${usersPayload.org.name}.`}
        />
        <TrainingContentAdminNav orgId={selectedOrgId} active="content-organization" />
        <ContentOrganizationManager
          orgId={orgId}
          initialFocusTopics={focusTopics.trainings}
          initialFocusTopicOrderRevision={focusTopics.orderRevision}
          initialTrainingPacks={trainingPacks.packs}
          initialTrainingPackOrderRevision={trainingPacks.orderRevision}
        />
      </>
    );
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    if (error instanceof DashboardApiError && [400, 403, 404].includes(error.status)) {
      redirect("/app/access-denied");
    }
    throw error;
  }
}
