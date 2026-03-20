import { NextRequest, NextResponse } from "next/server";

import { getExpiredWebAuthSessionCookieOptions, revokeWebAuthSession } from "@/src/lib/auth";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";
import { buildAbsoluteUrlForHost, classifyRequestHost, getConfiguredAppHost } from "@/src/lib/domain";

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

  const token = request.cookies.get(WEB_AUTH_SESSION_COOKIE_NAME)?.value ?? null;
  if (token) {
    await revokeWebAuthSession(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(WEB_AUTH_SESSION_COOKIE_NAME, "", getExpiredWebAuthSessionCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
