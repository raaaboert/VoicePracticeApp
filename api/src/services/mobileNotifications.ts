import type { ApiDatabase, MobileNotificationRow, MobileNotificationsResponse, PerformancePlan, UserProfile } from "@voicepractice/shared";
import type { UserNotificationRecord, UserNotificationStore } from "../storage/userNotificationStore.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import { canViewTopicAssignedNotification } from "./topicAssignedNotifications.js";
import { canViewPerformanceGoalNotification } from "./performanceGoalNotifications.js";

export interface MobileNotificationContext {
  db: ApiDatabase;
  recipient: UserProfile;
  orgId: string | null;
  store: UserNotificationStore;
  authority: FocusTopicAuthoritySnapshot | null;
  plans: ReadonlyArray<Pick<PerformancePlan, "id" | "orgId" | "userId">>;
}

function visible(context: MobileNotificationContext, row: UserNotificationRecord): MobileNotificationRow | null {
  const { recipient, orgId } = context;
  if (!orgId || row.orgId !== orgId || row.recipientUserId !== recipient.id
    || recipient.orgId !== orgId || recipient.status !== "active" || !recipient.emailVerifiedAt
    || context.db.orgs.find((org) => org.id === orgId)?.status !== "active") return null;
  if (row.kind === "topic_assigned" && canViewTopicAssignedNotification({
    db: context.db, recipient, notification: row, authority: context.authority,
  })) {
    const topic = context.db.orgTrainings.find((item) => item.id === row.subjectId && item.orgId === orgId)!;
    return { id: row.id, kind: row.kind, title: `New Focus Topic: ${topic.name}`, createdAt: row.createdAt,
      readAt: row.readAt, dismissedAt: row.dismissedAt ?? null, resolvedAt: row.resolvedAt,
      destination: { type: "focus_topic", topicId: row.subjectId } };
  }
  // The learner inbox exposes only the learner's own goal, never managerial
  // notifications or author/reviewer destinations that require dashboard access.
  const plan = context.plans.find((item) => item.id === row.subjectId && item.userId === recipient.id) ?? null;
  if ((row.kind === "goal_updated" || row.kind === "goal_commented") && canViewPerformanceGoalNotification({
    db: context.db, recipient, notification: row, plan,
  })) {
    return { id: row.id, kind: row.kind, title: row.kind === "goal_commented" ? "New Performance goal comment" : "Performance goal assigned or updated",
      createdAt: row.createdAt, readAt: row.readAt, dismissedAt: row.dismissedAt ?? null, resolvedAt: row.resolvedAt,
      destination: { type: "performance_goal", planId: row.subjectId } };
  }
  return null;
}

export async function listMobileNotifications(context: MobileNotificationContext, options: {
  limit: number; offset: number; history: boolean;
}): Promise<MobileNotificationsResponse> {
  const notifications: MobileNotificationRow[] = [];
  let offset = options.offset;
  let nextOffset: number | null = null;
  // Bound scanning through hidden/admin-only history without fetching narratives.
  for (let batch = 0; batch < 10; batch++) {
    nextOffset = null;
    const candidates = await context.store.listForRecipient({ recipientUserId: context.recipient.id,
      limit: 100, offset, includeDismissed: options.history });
    let exhausted = true;
    for (const row of candidates) {
      const item = visible(context, row);
      if (item && notifications.length === options.limit) { nextOffset = offset; exhausted = false; break; }
      offset++;
      if (item) notifications.push(item);
    }
    if (!exhausted || candidates.length < 100) break;
    nextOffset = offset;
  }
  const accessibleTopics = context.db.orgTrainings.filter((topic) => visible(context, {
    id: "", orgId: topic.orgId, recipientUserId: context.recipient.id, kind: "topic_assigned",
    subjectType: "focus_topic", subjectId: topic.id, dedupKey: "", payload: {}, createdAt: "",
    readAt: null, resolvedAt: null, resolution: null,
  })).map((topic) => topic.id);
  const ownPlans = context.plans.filter((plan) => visible(context, {
    id: "", orgId: plan.orgId, recipientUserId: context.recipient.id, kind: "goal_updated",
    subjectType: "performance_plan", subjectId: plan.id, dedupKey: "", payload: {}, createdAt: "",
    readAt: null, resolvedAt: null, resolution: null,
  })).map((plan) => plan.id);
  const count = async (kinds: ("topic_assigned" | "goal_updated" | "goal_commented")[], subjectType: string, subjectIds: string[]) =>
    context.orgId && subjectIds.length ? context.store.countActionableUnread({
      recipientUserId: context.recipient.id, orgId: context.orgId, kinds, subjectType, subjectIds,
    }) : 0;
  const unreadCount = await count(["topic_assigned"], "focus_topic", accessibleTopics)
    + await count(["goal_updated", "goal_commented"], "performance_plan", ownPlans);
  return { notifications, unreadCount, nextOffset };
}

export async function mutateMobileNotification(context: MobileNotificationContext, id: string, action: "open" | "dismiss") {
  const record = await context.store.getForRecipient({ id, recipientUserId: context.recipient.id });
  if (!record || !visible(context, record)) return null;
  const changed = await (action === "dismiss" ? context.store.dismiss({ id, recipientUserId: context.recipient.id })
    : context.store.markRead({ id, recipientUserId: context.recipient.id }));
  return changed ? visible(context, changed) : null;
}

export async function markAllMobileNotificationsRead(context: MobileNotificationContext): Promise<void> {
  let offset = 0;
  do {
    const page = await listMobileNotifications(context, { limit: 50, offset, history: false });
    await context.store.markReadIds({ recipientUserId: context.recipient.id,
      ids: page.notifications.filter((row) => !row.readAt).map((row) => row.id) });
    if (page.nextOffset === null || page.nextOffset <= offset) break;
    offset = page.nextOffset;
  } while (offset <= 10_000);
}
