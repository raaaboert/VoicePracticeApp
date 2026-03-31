import { NextRequest, NextResponse } from "next/server";

import { getExpiredWebAuthSessionCookieOptions, revokeWebAuthSession } from "@/src/lib/auth";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";
import { buildDashboardLoginPath, parseDashboardLoginReason } from "@/src/lib/dashboardSession";
import { buildAbsoluteUrlForHost, classifyRequestHost, getConfiguredAppHost } from "@/src/lib/domain";

async function revokeDashboardSessionIfPresent(request: NextRequest): Promise<void> {
  const token = request.cookies.get(WEB_AUTH_SESSION_COOKIE_NAME)?.value ?? null;
  if (token) {
    await revokeWebAuthSession(token);
  }
}

function applyExpiredDashboardCookie(response: NextResponse): NextResponse {
  response.cookies.set(WEB_AUTH_SESSION_COOKIE_NAME, "", getExpiredWebAuthSessionCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function getLogoutRedirectResponse(request: NextRequest): NextResponse {
  const reason = parseDashboardLoginReason(request.nextUrl.searchParams.get("reason"));
  return applyExpiredDashboardCookie(
    NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname: reason ? buildDashboardLoginPath(reason) : "/login",
        protocol: request.nextUrl.protocol.replace(/:$/, "") || "https",
      }),
      { status: 307 }
    )
  );
}

export async function GET(request: NextRequest) {
  const hostKind = classifyRequestHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind === "public") {
    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname: "/api/auth/logout",
        search: request.nextUrl.search,
        protocol: request.nextUrl.protocol.replace(/:$/, "") || "https",
      }),
      { status: 307 }
    );
  }

  if (hostKind === "unknown") {
    return NextResponse.json({ error: "Unknown host." }, { status: 404 });
  }

  await revokeDashboardSessionIfPresent(request);
  return getLogoutRedirectResponse(request);
}

export async function POST(request: NextRequest) {
  const hostKind = classifyRequestHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind === "public") {
    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname: "/api/auth/logout",
        protocol: request.nextUrl.protocol.replace(/:$/, "") || "https",
      }),
      { status: 307 }
    );
  }

  if (hostKind === "unknown") {
    return NextResponse.json({ error: "Unknown host." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  await revokeDashboardSessionIfPresent(request);
  return applyExpiredDashboardCookie(response);
}
