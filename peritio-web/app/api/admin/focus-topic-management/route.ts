import { NextRequest, NextResponse } from "next/server";

import {
  assertDashboardAuthConfig,
  createDashboardCustomerPracticeScenario,
  attachDashboardFocusTopicContent,
  createDashboardFocusTopicContent,
  createDashboardFocusTopic,
  createDashboardFocusTopicAssignment,
  createDashboardFocusTopicManagementGrant,
  detachDashboardFocusTopicContent,
  finalizeDashboardFocusTopicContentUpload,
  getDashboardFocusTopicContentTranscript,
  getDashboardFocusTopicRelatedContent,
  listDashboardCustomerPracticeScenarios,
  listDashboardFocusTopicAssignments,
  initiateDashboardFocusTopicContentUpload,
  putDashboardFocusTopicContentTranscript,
  removeDashboardFocusTopicContentTranscript,
  reviseDashboardCustomerPracticeScenario,
  revokeDashboardFocusTopicAssignment,
  revokeDashboardFocusTopicManagementGrant,
  updateDashboardFocusTopic,
  transitionDashboardFocusTopicContent,
  transitionDashboardCustomerPracticeScenario,
  updateDashboardFocusTopicContent,
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
  | { action: "detach_content"; orgId: string; topicId: string; attachmentId: string }
  | { action: "create_content"; orgId: string; topicId: string;
      contentType: "external_url" | "video" | "audio" | "pdf" | "docx" | "image";
      title: string; description: string; externalUrl?: string; externalKind?: "youtube" }
  | { action: "update_content"; orgId: string; topicId: string; contentId: string;
      expectedUpdatedAt: string; title?: string; description?: string }
  | { action: "publish_content" | "unpublish_content"; orgId: string; topicId: string;
      contentId: string; expectedUpdatedAt: string }
  | { action: "initiate_content_upload"; orgId: string; topicId: string; contentId: string;
      assetRole: "primary" | "thumbnail" | "inline";
      originalFilename: string; declaredMimeType: string; declaredByteSize: number;
      replacementAssetId?: string | null }
  | { action: "finalize_content_upload"; orgId: string; topicId: string;
      contentId: string; assetId: string }
  | { action: "get_content_transcript"; orgId: string; topicId: string; contentId: string }
  | { action: "put_content_transcript"; orgId: string; topicId: string; contentId: string; text: string }
  | { action: "remove_content_transcript"; orgId: string; topicId: string; contentId: string }
  | { action: "list_practice_scenarios"; orgId: string; topicId: string }
  | { action: "create_practice_scenario" | "revise_practice_scenario"; orgId: string; topicId: string;
      scenarioId?: string; title: string; description: string; desiredOutcome?: string | null;
      aiRole: string; scoringGuidance: string; segmentId: string; applicableIndustryIds: string[];
      sourceReferences?: Array<{ kind: "manual" | "training_content" | "external";
        referenceId: string | null; label: string }> }
  | { action: "submit_practice_scenario" | "approve_practice_scenario" | "reject_practice_scenario"
      | "publish_practice_scenario" | "archive_practice_scenario";
      orgId: string; topicId: string; scenarioId: string; reviewNote?: string };

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
      case "create_content":
        return noStore(NextResponse.json(await createDashboardFocusTopicContent(
          body.orgId, body.topicId, {
            contentType: body.contentType, title: body.title, description: body.description,
            ...(body.externalUrl === undefined ? {} : { externalUrl: body.externalUrl }),
            ...(body.externalKind === undefined ? {} : { externalKind: body.externalKind }),
          },
        ), { status: 201 }));
      case "update_content":
        return noStore(NextResponse.json(await updateDashboardFocusTopicContent(
          body.orgId, body.topicId, body.contentId, {
            expectedUpdatedAt: body.expectedUpdatedAt,
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.description === undefined ? {} : { description: body.description }),
          },
        )));
      case "publish_content":
      case "unpublish_content":
        return noStore(NextResponse.json(await transitionDashboardFocusTopicContent(
          body.orgId,
          body.topicId,
          body.contentId,
          body.action === "publish_content" ? "publish" : "unpublish",
          body.expectedUpdatedAt,
        )));
      case "initiate_content_upload":
        return noStore(NextResponse.json(await initiateDashboardFocusTopicContentUpload(
          body.orgId, body.topicId, body.contentId, {
            assetRole: body.assetRole,
            originalFilename: body.originalFilename,
            declaredMimeType: body.declaredMimeType,
            declaredByteSize: body.declaredByteSize,
            replacementAssetId: body.replacementAssetId,
          },
        ), { status: 201 }));
      case "finalize_content_upload":
        return noStore(NextResponse.json(await finalizeDashboardFocusTopicContentUpload(
          body.orgId, body.topicId, body.contentId, body.assetId,
        )));
      case "get_content_transcript":
        return noStore(NextResponse.json(await getDashboardFocusTopicContentTranscript(
          body.orgId, body.topicId, body.contentId,
        )));
      case "put_content_transcript":
        return noStore(NextResponse.json(await putDashboardFocusTopicContentTranscript(
          body.orgId, body.topicId, body.contentId, body.text,
        )));
      case "remove_content_transcript":
        return noStore(NextResponse.json(await removeDashboardFocusTopicContentTranscript(
          body.orgId, body.topicId, body.contentId,
        )));
      case "list_practice_scenarios":
        return noStore(NextResponse.json(await listDashboardCustomerPracticeScenarios(
          body.orgId, body.topicId,
        )));
      case "create_practice_scenario":
        return noStore(NextResponse.json(await createDashboardCustomerPracticeScenario(
          body.orgId, body.topicId, body,
        ), { status: 201 }));
      case "revise_practice_scenario":
        if (!body.scenarioId) {
          return noStore(NextResponse.json({ error: "Practice Scenario is required." }, { status: 400 }));
        }
        return noStore(NextResponse.json(await reviseDashboardCustomerPracticeScenario(
          body.orgId, body.topicId, body.scenarioId, body,
        )));
      case "submit_practice_scenario":
      case "approve_practice_scenario":
      case "reject_practice_scenario":
      case "publish_practice_scenario":
      case "archive_practice_scenario":
        return noStore(NextResponse.json(await transitionDashboardCustomerPracticeScenario(
          body.orgId, body.topicId, body.scenarioId,
          body.action.replace("_practice_scenario", "") as "submit" | "approve" | "reject" | "publish" | "archive",
          body.reviewNote,
        )));
      default:
        return noStore(NextResponse.json({ error: "Unknown Focus Topic action." }, { status: 400 }));
    }
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
