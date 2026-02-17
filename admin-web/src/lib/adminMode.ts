"use client";

import { useEffect, useState } from "react";

export type AdminMode = "personal" | "enterprise";

const ADMIN_MODE_STORAGE_KEY = "vp_admin_mode";
const ADMIN_MODE_EVENT_NAME = "vp-admin-mode-changed";

export function normalizeAdminMode(value: string | null | undefined): AdminMode {
  return value === "personal" ? "personal" : "enterprise";
}

export function getStoredAdminMode(): AdminMode {
  if (typeof window === "undefined") {
    return "enterprise";
  }

  const raw = window.localStorage.getItem(ADMIN_MODE_STORAGE_KEY);
  return normalizeAdminMode(raw);
}

export function setStoredAdminMode(mode: AdminMode): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ADMIN_MODE_STORAGE_KEY, mode);
}

export function emitAdminModeChanged(mode: AdminMode): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<AdminMode>(ADMIN_MODE_EVENT_NAME, { detail: mode }));
}

export function withAdminMode(path: string, mode: AdminMode): string {
  const [base, queryString = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  params.set("mode", mode);
  const nextQuery = params.toString();
  return nextQuery ? `${base}?${nextQuery}` : base;
}

function getModeFromLocationOrStorage(): AdminMode {
  if (typeof window === "undefined") {
    return "enterprise";
  }

  const params = new URLSearchParams(window.location.search);
  const queryMode = params.get("mode");
  if (queryMode === "personal" || queryMode === "enterprise") {
    return normalizeAdminMode(queryMode);
  }

  return getStoredAdminMode();
}

export function useAdminMode(): AdminMode {
  const [mode, setMode] = useState<AdminMode>("enterprise");

  useEffect(() => {
    const syncFromLocation = () => {
      setMode(getModeFromLocationOrStorage());
    };
    const onModeChanged = (event: Event) => {
      const custom = event as CustomEvent<AdminMode>;
      setMode(normalizeAdminMode(custom.detail));
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener(ADMIN_MODE_EVENT_NAME, onModeChanged as EventListener);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener(ADMIN_MODE_EVENT_NAME, onModeChanged as EventListener);
    };
  }, []);

  return mode;
}
