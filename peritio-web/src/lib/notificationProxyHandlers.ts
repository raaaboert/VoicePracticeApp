import { NextRequest, NextResponse } from "next/server";
import type {
  DashboardNotificationMutationResponse,
  DashboardNotificationsResponse,
} from "@voicepractice/shared";

import {
  dashboardApiErrorResponse,
  noStore,
  rejectNonAppDashboardApiHost,
} from "./dashboardApiProxy";

export interface NotificationProxyDependencies {
  list(limit: number, offset: number): Promise<DashboardNotificationsResponse>;
  markRead(notificationId: string): Promise<DashboardNotificationMutationResponse>;
}

export async function handleNotificationList(
  request: NextRequest,
  dependencies: NotificationProxyDependencies,
): Promise<NextResponse> {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
  const rawOffset = request.nextUrl.searchParams.get("offset");
  const offset = rawOffset ? Number.parseInt(rawOffset, 10) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return noStore(NextResponse.json({ error: "limit must be an integer from 1 to 50." }, { status: 400 }));
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    return noStore(NextResponse.json({ error: "offset must be an integer from 0 to 10000." }, { status: 400 }));
  }
  try {
    return noStore(NextResponse.json(await dependencies.list(limit, offset)));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleNotificationMarkRead(
  request: NextRequest,
  notificationId: string,
  dependencies: NotificationProxyDependencies,
): Promise<NextResponse> {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    return noStore(NextResponse.json(await dependencies.markRead(notificationId)));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
