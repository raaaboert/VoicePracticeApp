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
  list(limit: number, offset: number, includeDismissed: boolean): Promise<DashboardNotificationsResponse>;
  markRead(notificationId: string): Promise<DashboardNotificationMutationResponse>;
  dismiss(notificationId: string): Promise<DashboardNotificationMutationResponse>;
  markAllRead(): Promise<{ ok: true; markedCount: number }>;
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
  const includeDismissed = request.nextUrl.searchParams.get("view") === "all";
  const rawView = request.nextUrl.searchParams.get("view");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return noStore(NextResponse.json({ error: "limit must be an integer from 1 to 50." }, { status: 400 }));
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    return noStore(NextResponse.json({ error: "offset must be an integer from 0 to 10000." }, { status: 400 }));
  }
  if (rawView && rawView !== "all") {
    return noStore(NextResponse.json({ error: "view must be all when provided." }, { status: 400 }));
  }
  try {
    return noStore(NextResponse.json(await dependencies.list(limit, offset, includeDismissed)));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleNotificationDismiss(
  request: NextRequest,
  notificationId: string,
  dependencies: NotificationProxyDependencies,
): Promise<NextResponse> {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    return noStore(NextResponse.json(await dependencies.dismiss(notificationId)));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleNotificationMarkAllRead(
  request: NextRequest,
  dependencies: NotificationProxyDependencies,
): Promise<NextResponse> {
  const rejected = rejectNonAppDashboardApiHost(request);
  if (rejected) return rejected;
  try {
    return noStore(NextResponse.json(await dependencies.markAllRead()));
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
