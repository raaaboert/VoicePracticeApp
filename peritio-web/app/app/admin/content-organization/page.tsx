import { redirect } from "next/navigation";

import { ContentOrganizationManager } from "@/src/components/ContentOrganizationManager";
import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardAdminUsers,
  getDashboardFocusTopicOrder,
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
    const focusTopics = await getDashboardFocusTopicOrder(orgId);
    return (
      <>
        <PageHeader
          eyebrow="Admin"
          title="Focus Topic Order"
          description="Set the order learners see Focus Topics."
        />
        <TrainingContentAdminNav orgId={selectedOrgId} active="focus-topic-order" />
        <ContentOrganizationManager
          orgId={orgId}
          initialFocusTopics={focusTopics.trainings}
          initialFocusTopicOrderRevision={focusTopics.orderRevision}
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
