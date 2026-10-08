"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardViewer } from "@voicepractice/shared";

import { DashboardSessionGuard } from "@/src/components/DashboardSessionGuard";
import { isDashboardSidebarItemActive } from "@/src/components/dashboardSidebarState";
import { ThemeSwitchButton } from "@/src/components/ThemeSwitchButton";
import { NotificationInbox } from "@/src/components/NotificationInbox";

const BASE_NAV_ITEMS = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/app/performance", label: "Performance" },
  { href: "/app/settings", label: "Settings" },
] as const;

export function DashboardShell({
  children,
  viewer,
}: {
  children: ReactNode;
  viewer: DashboardViewer;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasCrossAccountAccess = viewer.accessType === "super_user";
  const hasDemoDashAccess = viewer.accessType === "super_user" && viewer.isSuperUser === true;
  const hasAdminAccess = !hasCrossAccountAccess && (
    viewer.capabilities.viewOrganizationUsers
    || viewer.capabilities.approveRejectAccessRequests
    || viewer.capabilities.manageFocusTopics
  );
  const adminPath = viewer.capabilities.viewOrganizationUsers
    ? "/app/admin"
    : "/app/admin/focus-topics";
  const sessionLabel = hasCrossAccountAccess ? "Super User" : viewer.orgName ?? "Customer";
  const navItems = hasCrossAccountAccess
    ? [
        BASE_NAV_ITEMS[0],
        BASE_NAV_ITEMS[1],
        ...(hasAdminAccess ? [{ href: adminPath, label: "Admin" }] : []),
        { href: "/app/customers", label: "Customers" },
        BASE_NAV_ITEMS[2],
        ...(hasDemoDashAccess ? [{ href: "/app/demo-dash", label: "Demo Dash" }] : []),
      ]
    : [
        BASE_NAV_ITEMS[0],
        BASE_NAV_ITEMS[1],
        ...(hasAdminAccess ? [{ href: adminPath, label: "Admin" }] : []),
        BASE_NAV_ITEMS[2],
      ];

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <main className="app-shell">
      <DashboardSessionGuard />
      <aside className="app-sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <img src="/brand/peritio-mark.jpg" alt="" className="brand-mark-image" aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Peritio</p>
            <h1 className="sidebar-title">Dashboard</h1>
            <p className="sidebar-copy">Training-first reporting for customer managers and account review work.</p>
          </div>
        </div>

        <nav className="app-nav" aria-label="Dashboard navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isDashboardSidebarItemActive(pathname, item.href, searchParams.get("performanceOrigin")) ? "active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div className="pill-row">
            <span className="pill accent">{sessionLabel}</span>
            <span className="pill">{viewer.email}</span>
          </div>
          <div className="topbar-actions">
            {!hasCrossAccountAccess ? <NotificationInbox /> : null}
            <ThemeSwitchButton />
            <button type="button" className="ghost-button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <div className="page-stack">{children}</div>
      </section>
    </main>
  );
}
