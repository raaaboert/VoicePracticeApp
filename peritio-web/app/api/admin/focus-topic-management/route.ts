import { NextRequest, NextResponse } from "next/server";

import {
  assertDashboardAuthConfig,
  createDashboardFocusTopic,
  createDashboardFocusTopicAssignment,
  listDashboardFocusTopicAssignments,
  revokeDashboardFocusTopicAssignment,
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
  | { action: "revoke_assignment"; orgId: string; topicId: string; assignmentId: string };

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
      case "revoke_assignment":
        return noStore(NextResponse.json(await revokeDashboardFocusTopicAssignment(body.orgId, body.topicId, body.assignmentId)));
      default:
        return noStore(NextResponse.json({ error: "Unknown Focus Topic action." }, { status: 400 }));
    }
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
