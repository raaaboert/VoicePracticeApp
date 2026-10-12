"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardNotificationRow, DashboardNotificationsResponse } from "@voicepractice/shared";

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

export function NotificationHistory() {
  const router = useRouter();
  const [payload, setPayload] = useState<DashboardNotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = async (offset = 0, append = false) => {
    try {
      const response = await fetch(`/api/notifications?limit=30&offset=${offset}&view=all`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load notification history.");
      const next = await response.json() as DashboardNotificationsResponse;
      setPayload((current) => append && current ? {
        ...next,
        notifications: [...current.notifications, ...next.notifications],
      } : next);
      setError(null);
    } catch {
      setError("Notification history is temporarily unavailable.");
    }
  };

  useEffect(() => { void load(); }, []);

  const openNotification = async (notification: DashboardNotificationRow) => {
    if (!notification.readAt) {
      const response = await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
      if (!response.ok) { setError("Could not open this notification. Please try again."); return; }
    }
    router.push(notification.payload.destination ?? "/app/dashboard");
  };

  const loadMore = async () => {
    if (!payload?.hasMore || payload.nextOffset === null) return;
    setLoadingMore(true);
    await load(payload.nextOffset, true);
    setLoadingMore(false);
  };

  return (
    <section className="notification-history" aria-label="Notification history">
      {error ? <p className="notice danger" role="alert">{error}</p> : null}
      {!error && !payload ? <p className="notice">Loading notification history...</p> : null}
      {!error && payload?.notifications.length === 0 ? <p className="notice">No notifications yet.</p> : null}
      <div className="notification-history-list">
        {payload?.notifications.map((notification) => (
          <button type="button" key={notification.id}
            className={`notification-history-row${notification.dismissedAt ? " is-dismissed" : ""}${notification.readAt ? " is-read" : " is-unread"}`}
            onClick={() => { void openNotification(notification); }}>
            <span className="notification-row-title">{notification.payload.title ?? "Notification"}</span>
            <span className="notification-row-body">{notification.payload.body ?? "Open to review."}</span>
            <span className="notification-row-meta">
              {formatTime(notification.createdAt)}
              {notification.dismissedAt ? "  -  Dismissed" : ""}
              {notification.resolvedAt ? "  -  Resolved" : ""}
              {!notification.readAt ? "  -  Unread" : ""}
            </span>
          </button>
        ))}
      </div>
      {payload?.hasMore ? <button type="button" className="secondary-button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading..." : "Load more"}</button> : null}
    </section>
  );
}
