import { NextRequest, NextResponse } from "next/server";

import {
  assertDashboardAuthConfig,
  DashboardApiError,
  getWebAuthSessionCookieOptions,
  verifyWebAuthCode,
} from "@/src/lib/auth";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";
import { buildAbsoluteUrlForHost, classifyRequestHost, getConfiguredAppHost } from "@/src/lib/domain";

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();

  const hostKind = classifyRequestHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind === "public") {
    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname: "/api/auth/verify-code",
        protocol: request.nextUrl.protocol.replace(/:$/, "") || "https",
      }),
      { status: 307 }
    );
  }

  if (hostKind === "unknown") {
    return NextResponse.json({ error: "Unknown host." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as { email?: string; code?: string } | null;
  const email = typeof payload?.email === "string" ? payload.email : "";
  const code = typeof payload?.code === "string" ? payload.code : "";

  try {
    const result = await verifyWebAuthCode(email, code);
    const response = NextResponse.json({
      ok: true,
      session: result.session,
      dashboardViewer: result.dashboardViewer,
      expiresAt: result.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(
      WEB_AUTH_SESSION_COOKIE_NAME,
      result.token,
      getWebAuthSessionCookieOptions(result.expiresAt)
    );
    return response;
  } catch (error) {
    if (error instanceof DashboardApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
