"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAdminToken } from "../lib/api";
import { ReactNode } from "react";

interface AdminShellProps {
  title: string;
  children: ReactNode;
}

export function AdminShell({ title, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isUsers = pathname.startsWith("/users");
  const isConfig = pathname.startsWith("/config");
  const isUsage = pathname.startsWith("/usage");
  const isStats = pathname.startsWith("/stats");
  const isSupport = pathname.startsWith("/support");
  const navClass = (isActive: boolean): string => (isActive ? "active" : "");

  return (
    <main>
      <div className="shell">
        <div className="topbar">
          <div className="brand">VoicePractice Admin</div>
          <div className="nav">
            <Link href="/users" className={navClass(isUsers)}>
              Accounts
            </Link>
            <Link href="/config" className={navClass(isConfig)}>
              Config
            </Link>
            <Link href="/usage" className={navClass(isUsage)}>
              Usage
            </Link>
            <Link href="/stats" className={navClass(isStats)}>
              Stats
            </Link>
            <Link href="/support" className={navClass(isSupport)}>
              Support
            </Link>
            <button
              onClick={() => {
                clearAdminToken();
                router.push("/login");
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
