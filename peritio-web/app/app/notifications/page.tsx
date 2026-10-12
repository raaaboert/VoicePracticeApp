import { NotificationHistory } from "@/src/components/NotificationHistory";
import { PageHeader } from "@/src/components/PageHeader";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notification history" description="Review active and dismissed notifications that you are still authorized to access." />
      <NotificationHistory />
    </>
  );
}
