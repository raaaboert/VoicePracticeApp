"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export function DashboardSessionGuard() {
  const pathname = usePathname();
  const redirectingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const validateSession = async () => {
      if (disposed || redirectingRef.current) {
        return;
      }

      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });

        if ((response.status === 401 || response.status === 403) && !disposed && !redirectingRef.current) {
          redirectingRef.current = true;
          window.location.replace(buildDashboardSessionResetPath());
        }
      } catch {
        // Ignore transient network failures and keep the current session state.
      }
    };

    const handleFocus = () => {
      void validateSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void validateSession();
      }
    };

    void validateSession();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname]);

  return null;
}
