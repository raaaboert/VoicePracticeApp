"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { logoutAdminSession } from "../lib/api";
import {
  AdminMode,
  emitAdminModeChanged,
  getStoredAdminMode,
  normalizeAdminMode,
  setStoredAdminMode,
  withAdminMode,
} from "../lib/adminMode";

interface AdminShellProps {
  title: string;
  children: ReactNode;
}

const ADMIN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

function isPathAllowedForMode(pathname: string, mode: AdminMode): boolean {
  if (mode === "personal") {
    if (pathname.startsWith("/users/enterprise/")) {
      return false;
    }

    return (
      pathname.startsWith("/users")
      || pathname.startsWith("/usage")
      || pathname.startsWith("/support")
      || pathname.startsWith("/content")
      || pathname.startsWith("/config")
      || pathname.startsWith("/logs")
    );
  }

  return (
    pathname.startsWith("/users")
    || pathname.startsWith("/usage")
    || pathname.startsWith("/support")
    || pathname.startsWith("/content")
    || pathname.startsWith("/stats")
    || pathname.startsWith("/logs")
  );
}

function getFallbackPathForMode(mode: AdminMode): string {
  return mode === "personal" ? "/users" : "/users";
}

export function AdminShell({ title, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<AdminMode>("enterprise");

  const isUsers = pathname.startsWith("/users");
  const isConfig = pathname.startsWith("/config");
  const isUsage = pathname.startsWith("/usage");
  const isStats = pathname.startsWith("/stats");
  const isSupport = pathname.startsWith("/support");
  const isContent = pathname.startsWith("/content");
  const isLogs = pathname.startsWith("/logs");
  const navClass = (isActive: boolean): string => (isActive ? "active" : "");

  useEffect(() => {
    const rawMode = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("mode");
    const hasExplicitMode = rawMode === "personal" || rawMode === "enterprise";
    const nextMode = hasExplicitMode ? normalizeAdminMode(rawMode) : getStoredAdminMode();
    const currentPathWithQuery = (() => {
      if (typeof window === "undefined") {
        return pathname;
      }

      return `${pathname}${window.location.search}`;
    })();

    setMode(nextMode);
    setStoredAdminMode(nextMode);
    emitAdminModeChanged(nextMode);

    const targetPath = isPathAllowedForMode(pathname, nextMode)
      ? currentPathWithQuery
      : getFallbackPathForMode(nextMode);
    const canonicalPath = withAdminMode(targetPath, nextMode);
    if (canonicalPath !== currentPathWithQuery) {
      router.replace(canonicalPath);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncFromLocation = () => {
      const rawMode = new URLSearchParams(window.location.search).get("mode");
      const hasExplicitMode = rawMode === "personal" || rawMode === "enterprise";
      const nextMode = hasExplicitMode ? normalizeAdminMode(rawMode) : getStoredAdminMode();
      setMode(nextMode);
      setStoredAdminMode(nextMode);
      emitAdminModeChanged(nextMode);
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"];
    const resetInactivityTimer = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      timeoutHandle = setTimeout(() => {
        void (async () => {
          await logoutAdminSession();
          router.replace("/login");
        })();
      }, ADMIN_INACTIVITY_TIMEOUT_MS);
    };

    events.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();

    return () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
    };
  }, [router]);

  const navItems = useMemo(() => {
    if (mode === "personal") {
      return [
        { href: "/users", label: "Accounts", active: isUsers },
        { href: "/usage", label: "Usage", active: isUsage },
        { href: "/content", label: "Content", active: isContent },
        { href: "/support", label: "Support", active: isSupport },
        { href: "/config", label: "Config", active: isConfig },
        { href: "/logs", label: "Logs", active: isLogs },
      ];
    }

    return [
      { href: "/users", label: "Accounts", active: isUsers },
      { href: "/usage", label: "Usage", active: isUsage },
      { href: "/content", label: "Content", active: isContent },
      { href: "/stats", label: "Stats", active: isStats },
      { href: "/support", label: "Support", active: isSupport },
      { href: "/logs", label: "Logs", active: isLogs },
    ];
  }, [isConfig, isContent, isLogs, isStats, isSupport, isUsage, isUsers, mode]);

  const switchMode = (nextMode: AdminMode) => {
    setMode(nextMode);
    setStoredAdminMode(nextMode);
    emitAdminModeChanged(nextMode);
    const targetPath = isPathAllowedForMode(pathname, nextMode)
      ? pathname
      : getFallbackPathForMode(nextMode);
    router.push(withAdminMode(targetPath, nextMode));
  };

  return (
    <main>
      <div className="shell">
        <div className="topbar">
          <div className="brand">VoicePractice Admin</div>
          <div className="mode-toggle" role="tablist" aria-label="Admin mode">
            <button type="button" className={mode === "personal" ? "active" : ""} onClick={() => switchMode("personal")}>
              Personal
            </button>
            <button
              type="button"
              className={mode === "enterprise" ? "active" : ""}
              onClick={() => switchMode("enterprise")}
            >
              Enterprise
            </button>
          </div>
          <div className="nav">
            {navItems.map((item) => (
              <Link key={item.href} href={withAdminMode(item.href, mode)} className={navClass(item.active)}>
                {item.label}
              </Link>
            ))}
            <button
              onClick={() => {
                void (async () => {
                  await logoutAdminSession();
                  router.push("/login");
                })();
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="card">
          <h2>{title}</h2>
        </div>

        {children}
      </div>
    </main>
  );
}
