import { NextRequest, NextResponse } from "next/server";
import type {
  CustomerTrainingPackOrderListResponse,
  OrgTrainingListResponse,
  ReorderOrgTrainingsRequest,
  ReorderTrainingPacksRequest,
} from "@voicepractice/shared";

import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "./dashboardApiProxy";
import { minimizeCustomerTrainingPackOrderResponse } from "./contentOrganizationTrainingPackProjection";

function requireOrgId(request: NextRequest): string {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) throw new Error("orgId is required.");
  return orgId;
}

export async function handleFocusTopicOrderUpdate(
  request: NextRequest,
  reorder: (orgId: string, input: ReorderOrgTrainingsRequest) => Promise<OrgTrainingListResponse>
) {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    const orgId = requireOrgId(request);
    const body = await readDashboardJsonBody(request) as ReorderOrgTrainingsRequest;
    return noStore(NextResponse.json(await reorder(orgId, body)));
  } catch (error) {
    if (error instanceof Error && error.message === "orgId is required.") {
      return noStore(NextResponse.json({ error: error.message }, { status: 400 }));
    }
    return dashboardApiErrorResponse(error);
  }
}

export async function handleTrainingPackOrderUpdate(
  request: NextRequest,
  reorder: (
    orgId: string,
    input: ReorderTrainingPacksRequest
  ) => Promise<CustomerTrainingPackOrderListResponse>
) {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    const orgId = requireOrgId(request);
    const body = await readDashboardJsonBody(request) as ReorderTrainingPacksRequest;
    const response = await reorder(orgId, body);
    return noStore(NextResponse.json(minimizeCustomerTrainingPackOrderResponse(response)));
  } catch (error) {
    if (error instanceof Error && error.message === "orgId is required.") {
      return noStore(NextResponse.json({ error: error.message }, { status: 400 }));
    }
    return dashboardApiErrorResponse(error);
  }
}
