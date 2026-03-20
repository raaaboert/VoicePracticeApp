import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, DashboardApiError, requestWebAuthCode } from "@/src/lib/auth";
import { buildAbsoluteUrlForHost, classifyRequestHost, getConfiguredAppHost } from "@/src/lib/domain";

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();

  const hostKind = classifyRequestHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind === "public") {
    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname: "/api/auth/request-code",
        protocol: request.nextUrl.protocol.replace(/:$/, "") || "https",
      }),
      { status: 307 }
    );
  }

  if (hostKind === "unknown") {
    return NextResponse.json({ error: "Unknown host." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = typeof payload?.email === "string" ? payload.email : "";

  try {
    const result = await requestWebAuthCode(email);
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof DashboardApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}

