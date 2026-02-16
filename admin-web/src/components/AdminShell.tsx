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

  return (
    <main>
      <div className="shell">
        <div className="topbar">
          <div className="brand">VoicePractice Admin</div>
          <div className="nav">
            <Link href="/users" style={isUsers ? { outline: "2px solid #39b8f6" } : undefined}>
              Accounts
            </Link>
            <Link href="/config" style={isConfig ? { outline: "2px solid #39b8f6" } : undefined}>
              Config
            </Link>
            <Link href="/usage" style={isUsage ? { outline: "2px solid #39b8f6" } : undefined}>
              Usage
            </Link>
            <Link href="/stats" style={isStats ? { outline: "2px solid #39b8f6" } : undefined}>
              Stats
            </Link>
            <Link href="/support" style={isSupport ? { outline: "2px solid #39b8f6" } : undefined}>
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
