import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { DashboardShell } from "@/src/components/DashboardShell";
import { assertDashboardAuthConfig, getWebAuthSession } from "@/src/lib/auth";
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

  const authSession = await getWebAuthSession();
  if (!authSession) {
    redirect("/login");
  }

  if (!authSession.dashboardViewer) {
    redirect("/login?reason=no-dashboard-access");
  }

  return <DashboardShell viewer={authSession.dashboardViewer}>{children}</DashboardShell>;
}
