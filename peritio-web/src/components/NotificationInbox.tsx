"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardNotificationRow, DashboardNotificationsResponse } from "@voicepractice/shared";

const POLL_INTERVAL_MS = 60_000;

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function NotificationInbox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<DashboardNotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = async () => {
    try {
      const response = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load notifications.");
      const next = await response.json() as DashboardNotificationsResponse;
      if (mounted.current) {
        setPayload(next);
        setError(null);
      }
    } catch {
      if (mounted.current) setError("Notifications are temporarily unavailable.");
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const openNotification = async (notification: DashboardNotificationRow) => {
    if (!notification.readAt) {
      const response = await fetch(
        `/api/notifications/${encodeURIComponent(notification.id)}/read`,
        { method: "PATCH" },
      );
      if (response.ok) {
        setPayload((current) => current ? {
          ...current,
          unreadCount: notification.resolvedAt ? current.unreadCount : Math.max(0, current.unreadCount - 1),
          notifications: current.notifications.map((row) =>
            row.id === notification.id ? { ...row, readAt: new Date().toISOString() } : row
          ),
        } : current);
      }
    }
    setOpen(false);
    router.push(notification.payload.destination ?? "/app/admin?tab=access");
  };

  const notifications = payload?.notifications ?? [];
  const unreadCount = payload?.unreadCount ?? 0;

  return (
    <div className="notification-inbox">
      <button
        type="button"
        className="notification-bell"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls="dashboard-notification-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell aria-hidden="true" size={20} />
        {unreadCount > 0 ? (
          <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <section id="dashboard-notification-panel" className="notification-panel" aria-label="Notifications">
          <div className="notification-panel-header">
            <div>
              <p className="eyebrow">Inbox</p>
              <h2>Notifications</h2>
            </div>
            {unreadCount > 0 ? <span className="status-badge">{unreadCount} unread</span> : null}
          </div>
          <div className="notification-list" aria-live="polite">
            {error ? <p className="notification-empty">{error}</p> : null}
            {!error && !payload ? <p className="notification-empty">Loading notifications…</p> : null}
            {!error && payload && notifications.length === 0 ? (
              <p className="notification-empty">You’re all caught up.</p>
            ) : null}
            {notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={`notification-row${notification.readAt ? " is-read" : " is-unread"}${notification.resolvedAt ? " is-resolved" : ""}`}
                onClick={() => { void openNotification(notification); }}
              >
                <span className="notification-row-title">
                  {notification.payload.title ?? "Notification"}
                </span>
                <span className="notification-row-body">
                  {notification.payload.body ?? "Open to review."}
                </span>
                <span className="notification-row-meta">
                  {formatNotificationTime(notification.createdAt)}
                  {notification.resolvedAt ? " · Resolved" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
