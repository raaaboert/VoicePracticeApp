"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DashboardViewer } from "@voicepractice/shared";

import { DashboardSessionGuard } from "@/src/components/DashboardSessionGuard";
import { ThemeSwitchButton } from "@/src/components/ThemeSwitchButton";

const BASE_NAV_ITEMS = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/app/settings", label: "Settings" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({
  children,
  viewer,
}: {
  children: ReactNode;
  viewer: DashboardViewer;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const hasCrossAccountAccess = viewer.accessType === "super_user";
  const hasDemoDashAccess = viewer.accessType === "super_user" && viewer.isSuperUser === true;
  const sessionLabel = hasCrossAccountAccess ? "Super User" : viewer.orgName ?? "Customer";
  const navItems = hasCrossAccountAccess
    ? [
        BASE_NAV_ITEMS[0],
        { href: "/app/customers", label: "Customers" },
        BASE_NAV_ITEMS[1],
        ...(hasDemoDashAccess ? [{ href: "/app/demo-dash", label: "Demo Dash" }] : []),
      ]
    : BASE_NAV_ITEMS;

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
            <img src="/peritio-logo-061526.png" alt="" className="brand-mark-image" aria-hidden="true" />
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
              className={isActivePath(pathname, item.href) ? "active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-note">
          <p className="eyebrow">Access</p>
          <p>
            {hasCrossAccountAccess
              ? "You can review every customer account currently in your reporting scope."
              : "You are limited to your own customer account and its reporting views."}
          </p>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div className="pill-row">
            <span className="pill accent">{sessionLabel}</span>
            <span className="pill">{viewer.email}</span>
          </div>
          <div className="topbar-actions">
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
