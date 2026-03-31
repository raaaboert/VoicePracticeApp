import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { DashboardShell } from "@/src/components/DashboardShell";
import { assertDashboardAuthConfig, getWebAuthBearerToken, getWebAuthSession } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { ensureAppHostRequest } from "@/src/lib/serverHostGuards";

export const metadata: Metadata = {
  title: {
    default: "Peritio - Dashboard",
    template: "%s | Peritio - Dashboard",
  },
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await ensureAppHostRequest("/app");
  assertDashboardAuthConfig();

  const token = await getWebAuthBearerToken();
  if (!token) {
    redirect("/login");
  }

  const authSession = await getWebAuthSession();
  if (!authSession || !authSession.dashboardViewer) {
    redirect(buildDashboardSessionResetPath());
  }

  return <DashboardShell viewer={authSession.dashboardViewer}>{children}</DashboardShell>;
}
