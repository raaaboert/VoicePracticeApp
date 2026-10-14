"use client";

import Link from "next/link";
import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardNotificationRow, DashboardNotificationsResponse } from "@voicepractice/shared";
import { startNotificationPolling } from "../lib/notificationPolling";

const POLL_INTERVAL_MS = 60_000;

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(parsed);
}

export function NotificationInbox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<DashboardNotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const mounted = useRef(true);
  const polling = useRef<ReturnType<typeof startNotificationPolling> | null>(null);

  const load = async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/notifications?limit=20", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Could not load notifications.");
      const next = await response.json() as DashboardNotificationsResponse;
      if (mounted.current && !signal.aborted) { setPayload(next); setError(null); }
    } catch {
      if (mounted.current && !signal.aborted) setError("Notifications are temporarily unavailable.");
    }
  };

  useEffect(() => {
    mounted.current = true;
    const controller = startNotificationPolling({
      visibility: document, scheduler: window, intervalMs: POLL_INTERVAL_MS, load,
    });
    polling.current = controller;
    return () => { mounted.current = false; controller.stop(); polling.current = null; };
  }, []);

  const openNotification = async (notification: DashboardNotificationRow) => {
    if (!notification.readAt) {
      const response = await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
      if (response.ok) {
        setPayload((current) => current ? {
          ...current,
          unreadCount: notification.resolvedAt ? current.unreadCount : Math.max(0, current.unreadCount - 1),
          notifications: current.notifications.map((row) => row.id === notification.id ? { ...row, readAt: new Date().toISOString() } : row),
        } : current);
      }
    }
    setOpen(false);
    router.push(notification.payload.destination ?? "/app/admin?tab=access");
  };

  const dismissNotification = async (notification: DashboardNotificationRow) => {
    setActing(notification.id); setActionError(null);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/dismiss`, { method: "PATCH" });
      if (!response.ok) throw new Error("Could not dismiss notification.");
      setPayload((current) => current ? {
        ...current,
        unreadCount: !notification.readAt && !notification.resolvedAt ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
        notifications: current.notifications.filter((row) => row.id !== notification.id),
      } : current);
    } catch {
      setActionError("Could not dismiss this notification. Please try again.");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const markAllRead = async () => {
    setActing("all"); setActionError(null);
    try {
      const response = await fetch("/api/notifications", { method: "PATCH" });
      if (!response.ok) throw new Error("Could not mark notifications read.");
      const readAt = new Date().toISOString();
      setPayload((current) => current ? {
        ...current, unreadCount: 0,
        notifications: current.notifications.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })),
      } : current);
    } catch {
      setActionError("Could not mark notifications read. Please try again.");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const notifications = payload?.notifications ?? [];
  const unreadCount = payload?.unreadCount ?? 0;

  return (
    <div className="notification-inbox">
      <button type="button" className="notification-bell"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open} aria-controls="dashboard-notification-panel"
        onClick={() => { if (!open) polling.current?.refresh(); setOpen(!open); }}>
        <Bell aria-hidden="true" size={20} />
        {unreadCount > 0 ? <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {open ? (
        <section id="dashboard-notification-panel" className="notification-panel" aria-label="Notifications">
          <div className="notification-panel-header">
            <div><p className="eyebrow">Inbox</p><h2>Notifications</h2></div>
            <div className="notification-panel-actions">
              {unreadCount > 0 ? <button type="button" className="inline-link notification-action" onClick={() => { void markAllRead(); }} disabled={acting !== null}>Mark all read</button> : null}
              {unreadCount > 0 ? <span className="status-badge">{unreadCount} unread</span> : null}
            </div>
          </div>
          <div className="notification-list" aria-live="polite">
            {error ? <p className="notification-empty" role="alert">{error}</p> : null}
            {actionError ? <p className="notification-empty" role="alert">{actionError}</p> : null}
            {!error && !payload ? <p className="notification-empty">Loading notifications...</p> : null}
            {!error && payload && notifications.length === 0 ? <p className="notification-empty">You&apos;re all caught up.</p> : null}
            {notifications.map((notification) => (
              <div key={notification.id} className={`notification-row${notification.readAt ? " is-read" : " is-unread"}${notification.resolvedAt ? " is-resolved" : ""}`}>
                <button type="button" className="notification-row-open" onClick={() => { void openNotification(notification); }}>
                  <span className="notification-row-title">{notification.payload.title ?? "Notification"}</span>
                  <span className="notification-row-body">{notification.payload.body ?? "Open to review."}</span>
                  <span className="notification-row-meta">{formatNotificationTime(notification.createdAt)}{notification.resolvedAt ? " \u00b7 Resolved" : ""}</span>
                </button>
                <button type="button" className="notification-dismiss" aria-label={`Dismiss ${notification.payload.title ?? "notification"}`} title="Dismiss notification" disabled={acting !== null}
                  onClick={(event) => { event.stopPropagation(); void dismissNotification(notification); }}>
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            ))}
          </div>
          <Link className="notification-history-link" href="/app/notifications" onClick={() => setOpen(false)}>View all notifications</Link>
        </section>
      ) : null}
    </div>
  );
}
