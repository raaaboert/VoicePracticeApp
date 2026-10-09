import { NextRequest, NextResponse } from "next/server";

import {
  assertDashboardAuthConfig,
  attachDashboardFocusTopicContent,
  createDashboardFocusTopic,
  createDashboardFocusTopicAssignment,
  createDashboardFocusTopicManagementGrant,
  detachDashboardFocusTopicContent,
  getDashboardFocusTopicRelatedContent,
  listDashboardFocusTopicAssignments,
  revokeDashboardFocusTopicAssignment,
  revokeDashboardFocusTopicManagementGrant,
  updateDashboardFocusTopic,
  type DashboardFocusTopicAssignment,
} from "@/src/lib/auth";
import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "@/src/lib/dashboardApiProxy";

type Action =
  | { action: "create_topic"; orgId: string; name: string; description: string; status: string }
  | { action: "update_topic"; orgId: string; topicId: string; name?: string; description?: string; status?: string }
  | { action: "list_assignments"; orgId: string; topicId: string }
  | { action: "create_assignment"; orgId: string; topicId: string;
      audience: DashboardFocusTopicAssignment["audience"]; subjectUserId: string | null }
  | { action: "create_management_grant"; orgId: string; topicId: string;
      audience: "individual" | "manager_only"; subjectUserId: string }
  | { action: "revoke_assignment"; orgId: string; topicId: string; assignmentId: string }
  | { action: "revoke_management_grant"; orgId: string; topicId: string; assignmentId: string }
  | { action: "list_related_content"; orgId: string; topicId: string }
  | { action: "attach_content"; orgId: string; topicId: string; contentId: string }
  | { action: "detach_content"; orgId: string; topicId: string; attachmentId: string };

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    const body = await readDashboardJsonBody(request) as Action;
    if (!body || typeof body.orgId !== "string" || !body.orgId.trim()) {
      return noStore(NextResponse.json({ error: "Organization is required." }, { status: 400 }));
    }
    switch (body.action) {
      case "create_topic":
        return noStore(NextResponse.json(await createDashboardFocusTopic(body.orgId, body), { status: 201 }));
      case "update_topic":
        return noStore(NextResponse.json(await updateDashboardFocusTopic(body.orgId, body.topicId, body)));
      case "list_assignments":
        return noStore(NextResponse.json(await listDashboardFocusTopicAssignments(body.orgId, body.topicId)));
      case "create_assignment":
        return noStore(NextResponse.json(await createDashboardFocusTopicAssignment(body.orgId, body.topicId, body), { status: 201 }));
      case "create_management_grant":
        return noStore(NextResponse.json(await createDashboardFocusTopicManagementGrant(body.orgId, body.topicId, body), { status: 201 }));
      case "revoke_assignment":
        return noStore(NextResponse.json(await revokeDashboardFocusTopicAssignment(body.orgId, body.topicId, body.assignmentId)));
      case "revoke_management_grant":
        return noStore(NextResponse.json(await revokeDashboardFocusTopicManagementGrant(body.orgId, body.topicId, body.assignmentId)));
      case "list_related_content":
        return noStore(NextResponse.json(await getDashboardFocusTopicRelatedContent(body.orgId, body.topicId)));
      case "attach_content":
        return noStore(NextResponse.json(await attachDashboardFocusTopicContent(body.orgId, body.topicId, body.contentId), { status: 201 }));
      case "detach_content":
        return noStore(NextResponse.json(await detachDashboardFocusTopicContent(body.orgId, body.topicId, body.attachmentId)));
      default:
        return noStore(NextResponse.json({ error: "Unknown Focus Topic action." }, { status: 400 }));
    }
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
