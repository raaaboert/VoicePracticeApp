import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  buildAbsoluteUrlForHost,
  classifyRequestHost,
  getConfiguredAppHost,
  getConfiguredPublicHost,
} from "@/src/lib/domain";
import { getRequestHost, getRequestProtocol } from "@/src/lib/requestContext";

export async function ensurePublicHostRequest(pathname = "/"): Promise<void> {
  const host = await getRequestHost();
  const hostKind = classifyRequestHost(host);

  if (hostKind === "local" || hostKind === "preview" || hostKind === "public") {
    return;
  }

  if (hostKind === "app") {
    const protocol = await getRequestProtocol();
    redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredPublicHost(),
        pathname,
        protocol,
      })
    );
  }

  notFound();
}

export async function ensureAppHostRequest(pathname: string): Promise<void> {
  const host = await getRequestHost();
  const hostKind = classifyRequestHost(host);

  if (hostKind === "local" || hostKind === "preview" || hostKind === "app") {
    return;
  }

  if (hostKind === "public") {
    const protocol = await getRequestProtocol();
    redirect(
      buildAbsoluteUrlForHost({
        host: getConfiguredAppHost(),
        pathname,
        protocol,
      })
    );
  }

  notFound();
}
