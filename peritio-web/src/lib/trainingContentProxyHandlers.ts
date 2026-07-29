import { NextRequest, NextResponse } from "next/server";
import type {
  CreateDashboardTrainingContentRequest,
  DashboardTrainingContentAssetAccessResponse,
  DashboardTrainingContentAssetFinalizationResponse,
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentFocusTopicsResponse,
  DashboardTrainingContentLifecycleRequest,
  DashboardTrainingContentListResponse,
  DashboardTrainingContentTargetsResponse,
  DashboardTrainingContentUploadInitiationRequest,
  DashboardTrainingContentUploadInitiationResponse,
  UpdateDashboardTrainingContentAssignmentsRequest,
  UpdateDashboardTrainingContentRequest,
} from "@voicepractice/shared";

import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "./dashboardApiProxy";

export interface TrainingContentProxyServices {
  listContent: (options: {
    orgId?: string | null;
    q?: string | null;
    focusTopicId?: string | null;
    contentType?: string | null;
    status?: string | null;
    sort?: string | null;
    page?: string | null;
    pageSize?: string | null;
  }) => Promise<DashboardTrainingContentListResponse>;
  getContent: (
    contentId: string,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentDetailResponse>;
  createContent: (
    input: CreateDashboardTrainingContentRequest,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentDetailResponse>;
  updateContent: (
    contentId: string,
    input: UpdateDashboardTrainingContentRequest,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentDetailResponse>;
  updateAssignments: (
    contentId: string,
    input: UpdateDashboardTrainingContentAssignmentsRequest,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentDetailResponse>;
  transitionContent: (
    contentId: string,
    action: "publish" | "unpublish" | "archive",
    input: DashboardTrainingContentLifecycleRequest,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentDetailResponse>;
  getUserTargets: (
    query: string,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentTargetsResponse>;
  getManagerTargets: (
    query: string,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentTargetsResponse>;
  getFocusTopics: (
    orgId?: string | null
  ) => Promise<DashboardTrainingContentFocusTopicsResponse>;
  initiateUpload: (
    contentId: string,
    input: DashboardTrainingContentUploadInitiationRequest,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentUploadInitiationResponse>;
  finalizeUpload: (
    contentId: string,
    assetId: string,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentAssetFinalizationResponse>;
  getAssetAccess: (
    contentId: string,
    assetId: string,
    orgId?: string | null
  ) => Promise<DashboardTrainingContentAssetAccessResponse>;
}

function requestedOrgId(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("orgId");
}

async function handleJson(operation: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return noStore(NextResponse.json(await operation()));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

function rejectHost(request: NextRequest): NextResponse | null {
  return rejectNonAppDashboardApiHost(request);
}

export async function handleTrainingContentListGet(
  request: NextRequest,
  services: Pick<TrainingContentProxyServices, "listContent">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  return handleJson(() => services.listContent({
    orgId: requestedOrgId(request),
    q: request.nextUrl.searchParams.get("q"),
    focusTopicId: request.nextUrl.searchParams.get("focusTopicId"),
    contentType: request.nextUrl.searchParams.get("contentType"),
    status: request.nextUrl.searchParams.get("status"),
    sort: request.nextUrl.searchParams.get("sort"),
    page: request.nextUrl.searchParams.get("page"),
    pageSize: request.nextUrl.searchParams.get("pageSize"),
  }));
}

export async function handleTrainingContentCreate(
  request: NextRequest,
  services: Pick<TrainingContentProxyServices, "createContent">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  try {
    const input = await readDashboardJsonBody(request) as CreateDashboardTrainingContentRequest;
    const payload = await services.createContent(input, requestedOrgId(request));
    return noStore(NextResponse.json(payload, { status: 201 }));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingContentDetailGet(
  request: NextRequest,
  contentId: string,
  services: Pick<TrainingContentProxyServices, "getContent">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  return handleJson(() => services.getContent(contentId, requestedOrgId(request)));
}

export async function handleTrainingContentUpdate(
  request: NextRequest,
  contentId: string,
  services: Pick<TrainingContentProxyServices, "updateContent">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  try {
    const input = await readDashboardJsonBody(request) as UpdateDashboardTrainingContentRequest;
    return noStore(NextResponse.json(
      await services.updateContent(contentId, input, requestedOrgId(request))
    ));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingContentAssignmentsUpdate(
  request: NextRequest,
  contentId: string,
  services: Pick<TrainingContentProxyServices, "updateAssignments">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  try {
    const input = await readDashboardJsonBody(request) as
      UpdateDashboardTrainingContentAssignmentsRequest;
    return noStore(NextResponse.json(
      await services.updateAssignments(contentId, input, requestedOrgId(request))
    ));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingContentTransition(
  request: NextRequest,
  contentId: string,
  action: "publish" | "unpublish" | "archive",
  services: Pick<TrainingContentProxyServices, "transitionContent">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  try {
    const input = await readDashboardJsonBody(request) as DashboardTrainingContentLifecycleRequest;
    return noStore(NextResponse.json(
      await services.transitionContent(contentId, action, input, requestedOrgId(request))
    ));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingContentTargetsGet(
  request: NextRequest,
  targetType: "users" | "managers",
  services: Pick<TrainingContentProxyServices, "getUserTargets" | "getManagerTargets">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return handleJson(() =>
    targetType === "users"
      ? services.getUserTargets(query, requestedOrgId(request))
      : services.getManagerTargets(query, requestedOrgId(request))
  );
}

export async function handleTrainingContentFocusTopicsGet(
  request: NextRequest,
  services: Pick<TrainingContentProxyServices, "getFocusTopics">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  return handleJson(() => services.getFocusTopics(requestedOrgId(request)));
}

export async function handleTrainingContentUploadInitiate(
  request: NextRequest,
  contentId: string,
  services: Pick<TrainingContentProxyServices, "initiateUpload">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  try {
    const input = await readDashboardJsonBody(request) as
      DashboardTrainingContentUploadInitiationRequest;
    const payload = await services.initiateUpload(contentId, input, requestedOrgId(request));
    return noStore(NextResponse.json(payload, { status: 201 }));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingContentUploadFinalize(
  request: NextRequest,
  contentId: string,
  assetId: string,
  services: Pick<TrainingContentProxyServices, "finalizeUpload">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  return handleJson(() =>
    services.finalizeUpload(contentId, assetId, requestedOrgId(request))
  );
}

export async function handleTrainingContentAssetAccess(
  request: NextRequest,
  contentId: string,
  assetId: string,
  services: Pick<TrainingContentProxyServices, "getAssetAccess">
): Promise<NextResponse> {
  const hostResponse = rejectHost(request);
  if (hostResponse) {
    return hostResponse;
  }
  return handleJson(() =>
    services.getAssetAccess(contentId, assetId, requestedOrgId(request))
  );
}
