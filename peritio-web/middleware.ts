import { NextRequest, NextResponse } from "next/server";

import {
  buildAbsoluteUrlForHost,
  classifyRequestHost,
  getConfiguredAppHost,
  getConfiguredPublicHost,
  isAppExperiencePath,
  isAuthApiPath,
  isSystemPath,
} from "@/src/lib/domain";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";

function hasUnexpiredWebAuthCookie(request: NextRequest): boolean {
  const token = request.cookies.get(WEB_AUTH_SESSION_COOKIE_NAME)?.value ?? "";
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  try {
    const encodedPayload = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = encodedPayload.padEnd(encodedPayload.length + ((4 - (encodedPayload.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(paddedPayload)) as {
      exp?: number;
    };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isSystemPath(pathname)) {
    return NextResponse.next();
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const hostKind = classifyRequestHost(host);
  if (hostKind === "local" || hostKind === "preview") {
    return NextResponse.next();
  }

  const protocol = request.nextUrl.protocol.replace(/:$/, "") || "https";
  const search = request.nextUrl.search;

  if (hostKind === "unknown") {
    return new NextResponse("Not found.", { status: 404 });
  }

  if (hostKind === "public") {
    if (pathname === "/") {
      return NextResponse.next();
    }

    if (isAppExperiencePath(pathname) || isAuthApiPath(pathname)) {
      return NextResponse.redirect(
        buildAbsoluteUrlForHost({
          host: getConfiguredAppHost(),
          pathname,
          search,
          protocol,
        })
      );
    }

    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredPublicHost(),
        pathname: "/",
        protocol,
      })
    );
  }

  if (hostKind === "app") {
    if (pathname === "/") {
      const hasSessionCookie = hasUnexpiredWebAuthCookie(request);
      return NextResponse.redirect(
        buildAbsoluteUrlForHost({
          host: getConfiguredAppHost(),
          pathname: hasSessionCookie ? "/app/dashboard" : "/login",
          protocol,
        })
      );
    }

    if (pathname === "/login" || pathname === "/app" || pathname.startsWith("/app/") || isAuthApiPath(pathname)) {
      return NextResponse.next();
    }

    return NextResponse.redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredPublicHost(),
        pathname: "/",
        protocol,
      })
    );
  }

  return new NextResponse("Not found.", { status: 404 });
}

export const config = {
  matcher: ["/:path*"],
};
