import type {
  ApiDatabase,
  CustomerPracticeScenario,
  DashboardNotificationRow,
  DashboardNotificationsResponse,
  EnterpriseJoinRequestRecord,
  PerformancePlan,
  UserProfile,
} from "@voicepractice/shared";

import { canDecideCustomerAccessRequests } from "./customerUserAdministrationPolicy.js";
import type {
  EnqueueUserNotificationInput,
  NotificationTransactionClient,
  UserNotificationRecord,
  UserNotificationStore,
} from "../storage/userNotificationStore.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import {
  canViewTopicAssignedNotification,
  shouldPreserveTopicAssignedNotificationInLegacyMode,
  TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE,
} from "./topicAssignedNotifications.js";
import {
  canViewFocusTopicContentAttachedNotification,
  FOCUS_TOPIC_CONTENT_NOTIFICATION_SUBJECT_TYPE,
} from "./focusTopicContentNotifications.js";
import {
  canViewCustomerPracticeScenarioNotification,
  CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE,
} from "./customerPracticeScenarioNotifications.js";
import {
  canViewPerformanceGoalNotification,
} from "./performanceGoalNotifications.js";
import type { PerformancePlanStore } from "../storage/performancePlanStore.js";

export const ACCESS_REQUEST_NOTIFICATION_SUBJECT_TYPE = "organization_access_request";

export function buildAccessRequestNotificationInputs(params: {
  db: ApiDatabase;
  request: EnterpriseJoinRequestRecord;
  createdAt?: Date;
}): EnqueueUserNotificationInput[] {
  const org = params.db.orgs.find((candidate) => candidate.id === params.request.orgId);
  if (!org || org.status !== "active" || params.request.status !== "pending") return [];
  const createdAt = params.createdAt ?? new Date(params.request.createdAt);
  return params.db.users
    .filter((user) =>
      user.orgId === org.id
      && user.status === "active"
      && canDecideCustomerAccessRequests(user)
    )
    .map((recipient) => ({
      orgId: org.id,
      recipientUserId: recipient.id,
      kind: "access_request" as const,
      subjectType: ACCESS_REQUEST_NOTIFICATION_SUBJECT_TYPE,
      subjectId: params.request.id,
      dedupKey: `access-request:${params.request.id}`,
      payload: {
        title: "New access request",
        body: "Review a pending organization access request.",
        destination: "/app/admin?tab=access",
      },
      createdAt,
    }));
}

export async function enqueueAccessRequestNotifications(params: {
  store: UserNotificationStore;
  db: ApiDatabase;
  request: EnterpriseJoinRequestRecord;
  client?: NotificationTransactionClient | null;
}): Promise<number> {
  const inserted = await params.store.enqueueMany(
    buildAccessRequestNotificationInputs({ db: params.db, request: params.request }),
    { client: params.client },
  );
  return inserted.length;
}

export async function resolveAccessRequestNotifications(params: {
  store: UserNotificationStore;
  requestIds: readonly string[];
  resolution: string;
  resolvedAt?: Date;
  client?: NotificationTransactionClient | null;
}): Promise<number> {
  return await params.store.resolveMatching({
    kind: "access_request",
    subjectType: ACCESS_REQUEST_NOTIFICATION_SUBJECT_TYPE,
    subjectIds: [...new Set(params.requestIds)],
    resolution: params.resolution,
    resolvedAt: params.resolvedAt,
    client: params.client,
  });
}

export function canViewAccessRequestNotification(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  notification: UserNotificationRecord;
}): boolean {
  if (
    params.notification.kind !== "access_request"
    || params.notification.subjectType !== ACCESS_REQUEST_NOTIFICATION_SUBJECT_TYPE
    || params.notification.recipientUserId !== params.recipient.id
    || params.recipient.status !== "active"
    || !canDecideCustomerAccessRequests(params.recipient)
    || !params.recipient.orgId
    || params.notification.orgId !== params.recipient.orgId
  ) {
    return false;
  }
  const org = params.db.orgs.find((candidate) => candidate.id === params.recipient.orgId);
  if (!org || org.status !== "active") return false;
  const request = params.db.enterpriseJoinRequests.find((candidate) => candidate.id === params.notification.subjectId);
  return Boolean(request && request.orgId === org.id);
}

export async function listAuthorizedDashboardNotifications(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  store: UserNotificationStore;
  topicAuthority?: FocusTopicAuthoritySnapshot | null;
  topicAuthorityMode?: "legacy" | "assignments";
  practiceScenarios?: readonly CustomerPracticeScenario[];
  performancePlanStore?: PerformancePlanStore;
  limit: number;
  offset?: number;
}): Promise<DashboardNotificationsResponse> {
  const limit = Math.min(Math.max(Math.trunc(params.limit), 1), 50);
  const offset = params.offset ?? 0;
  const queryLimit = Math.min(limit * 4 + 1, 101);
  const candidates = await params.store.listForRecipient({
    recipientUserId: params.recipient.id,
    limit: queryLimit,
    offset,
  });
  const visible: UserNotificationRecord[] = [];
  const hiddenIds: string[] = [];
  const closedIdsByResolution = new Map<string, string[]>();
  const readTimeResolutionAt = new Date();
  const performancePlanById = new Map<string, PerformancePlan | null>();
  let offsetAfterLastPageRow: number | null = null;
  for (const [candidateIndex, notification] of candidates.entries()) {
    const accessRequestVisible = canViewAccessRequestNotification({
      db: params.db, recipient: params.recipient, notification,
    });
    const topicVisible = canViewTopicAssignedNotification({
      db: params.db, recipient: params.recipient, notification,
      authority: params.topicAuthority ?? null,
    });
    const contentAttachedVisible = canViewFocusTopicContentAttachedNotification({
      db: params.db, recipient: params.recipient, notification,
    });
    const scenarioVisible = canViewCustomerPracticeScenarioNotification({
      db: params.db, recipient: params.recipient, notification,
      scenarios: params.practiceScenarios ?? [],
    });
    let goalVisible = false;
    if ((notification.kind === "goal_updated" || notification.kind === "goal_commented")
      && params.performancePlanStore) {
      if (!performancePlanById.has(notification.subjectId)) {
        performancePlanById.set(notification.subjectId,
          (await params.performancePlanStore.getPlanById(notification.subjectId))?.plan ?? null);
      }
      goalVisible = canViewPerformanceGoalNotification({
        db: params.db,
        recipient: params.recipient,
        notification,
        plan: performancePlanById.get(notification.subjectId) ?? null,
      });
    }
    if (accessRequestVisible || topicVisible || contentAttachedVisible || scenarioVisible || goalVisible) {
      const accessRequest = accessRequestVisible
        ? params.db.enterpriseJoinRequests.find((candidate) => candidate.id === notification.subjectId)!
        : null;
      if (!notification.resolvedAt && accessRequest && accessRequest.status !== "pending") {
        const resolution = accessRequest.status;
        const ids = closedIdsByResolution.get(resolution) ?? [];
        ids.push(notification.id);
        closedIdsByResolution.set(resolution, ids);
        visible.push({ ...notification, resolvedAt: readTimeResolutionAt.toISOString(), resolution });
      } else visible.push(notification);
      if (visible.length === limit) {
        offsetAfterLastPageRow = offset + candidateIndex + 1;
      }
    } else if (!notification.resolvedAt && !(params.topicAuthorityMode === "legacy"
      && shouldPreserveTopicAssignedNotificationInLegacyMode({
        db: params.db, recipient: params.recipient, notification,
      }))) {
      hiddenIds.push(notification.id);
    }
  }
  for (const [resolution, ids] of closedIdsByResolution) {
    await params.store.resolveIds({ ids, resolution, resolvedAt: readTimeResolutionAt });
  }
  if (hiddenIds.length > 0) {
    await params.store.resolveIds({ ids: hiddenIds, resolution: "authorization_revoked" });
  }
  const page = visible.slice(0, limit);
  const orgId = params.recipient.orgId;
  const actionableRequestIds = orgId
    ? params.db.enterpriseJoinRequests
        .filter((request) => request.orgId === orgId && request.status === "pending")
        .map((request) => request.id)
    : [];
  const accessRequestUnreadCount = orgId && canDecideCustomerAccessRequests(params.recipient)
    ? await params.store.countActionableUnread({
        recipientUserId: params.recipient.id,
        orgId,
        kinds: ["access_request"],
        subjectType: ACCESS_REQUEST_NOTIFICATION_SUBJECT_TYPE,
        subjectIds: actionableRequestIds,
      })
    : 0;
  const accessibleTopicIds = (params.db.orgTrainings ?? [])
    .filter((topic) => topic.orgId === orgId && canViewTopicAssignedNotification({
      db: params.db, recipient: params.recipient,
      notification: {
        id: "", orgId: topic.orgId, recipientUserId: params.recipient.id,
        kind: "topic_assigned", subjectType: TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE,
        subjectId: topic.id, dedupKey: "", payload: {}, createdAt: "",
        readAt: null, resolvedAt: null, resolution: null,
      },
      authority: params.topicAuthority ?? null,
    }))
    .map((topic) => topic.id);
  const topicUnreadCount = orgId && accessibleTopicIds.length > 0
    ? await params.store.countActionableUnread({
        recipientUserId: params.recipient.id, orgId, kinds: ["topic_assigned", "topic_due_7d", "topic_due_1d", "topic_overdue"],
        subjectType: TOPIC_ASSIGNED_NOTIFICATION_SUBJECT_TYPE, subjectIds: accessibleTopicIds,
      })
    : 0;
  const contentAttachedTopicIds = orgId
    && params.recipient.orgRole === "org_admin"
    && params.recipient.status === "active"
    && Boolean(params.recipient.emailVerifiedAt)
    ? (params.db.orgTrainings ?? [])
        .filter((topic) => topic.orgId === orgId)
        .map((topic) => topic.id)
    : [];
  const contentAttachedUnreadCount = orgId && contentAttachedTopicIds.length > 0
    ? await params.store.countActionableUnread({
        recipientUserId: params.recipient.id, orgId, kinds: ["content_added"],
        subjectType: FOCUS_TOPIC_CONTENT_NOTIFICATION_SUBJECT_TYPE, subjectIds: contentAttachedTopicIds,
      })
    : 0;
  const visibleScenarioIds = (params.practiceScenarios ?? []).filter((scenario) =>
    scenario.orgId === orgId && (
      (scenario.status === "in_review" && params.recipient.orgRole === "org_admin")
      || scenario.createdByActorId === params.recipient.id
    )).map((scenario) => scenario.id);
  const scenarioUnreadCount = orgId && visibleScenarioIds.length > 0
    ? await params.store.countActionableUnread({
        recipientUserId: params.recipient.id, orgId,
        kinds: ["scenario_submitted", "scenario_reviewed"],
        subjectType: CUSTOMER_PRACTICE_SCENARIO_NOTIFICATION_SUBJECT_TYPE,
        subjectIds: visibleScenarioIds,
      })
    : 0;
  // Goal notifications are reauthorized against the current Performance-plan
  // relationship above. Count only rows that passed that check so a revoked
  // manager never retains a stale badge for protected goal activity.
  const goalUnreadCount = visible.filter((notification) =>
    (notification.kind === "goal_updated" || notification.kind === "goal_commented")
    && notification.readAt === null
    && notification.resolvedAt === null,
  ).length;
  const unreadCount = accessRequestUnreadCount + topicUnreadCount + contentAttachedUnreadCount
    + scenarioUnreadCount + goalUnreadCount;
  const hasMore = visible.length > limit || candidates.length === queryLimit;
  return {
    generatedAt: new Date().toISOString(),
    unreadCount,
    notifications: page.map(toDashboardRow),
    hasMore,
    nextOffset: hasMore ? offsetAfterLastPageRow ?? offset + candidates.length : null,
  };
}

export async function markAuthorizedDashboardNotificationRead(params: {
  db: ApiDatabase;
  recipient: UserProfile;
  store: UserNotificationStore;
  topicAuthority?: FocusTopicAuthoritySnapshot | null;
  topicAuthorityMode?: "legacy" | "assignments";
  practiceScenarios?: readonly CustomerPracticeScenario[];
  performancePlanStore?: PerformancePlanStore;
  notificationId: string;
  readAt?: Date;
}): Promise<DashboardNotificationRow | null> {
  const notification = await params.store.getForRecipient({
    id: params.notificationId,
    recipientUserId: params.recipient.id,
  });
  if (!notification) return null;
  const accessRequestVisible = canViewAccessRequestNotification({
    db: params.db, recipient: params.recipient, notification,
  });
  const topicVisible = canViewTopicAssignedNotification({
    db: params.db, recipient: params.recipient, notification,
    authority: params.topicAuthority ?? null,
  });
  const contentAttachedVisible = canViewFocusTopicContentAttachedNotification({
    db: params.db, recipient: params.recipient, notification,
  });
  const scenarioVisible = canViewCustomerPracticeScenarioNotification({
    db: params.db, recipient: params.recipient, notification,
    scenarios: params.practiceScenarios ?? [],
  });
  const goalPlan = (notification.kind === "goal_updated" || notification.kind === "goal_commented")
    && params.performancePlanStore
    ? (await params.performancePlanStore.getPlanById(notification.subjectId))?.plan ?? null
    : null;
  const goalVisible = canViewPerformanceGoalNotification({
    db: params.db, recipient: params.recipient, notification, plan: goalPlan,
  });
  if (!accessRequestVisible && !topicVisible && !contentAttachedVisible && !scenarioVisible && !goalVisible) {
    if (!notification.resolvedAt && !(params.topicAuthorityMode === "legacy"
      && shouldPreserveTopicAssignedNotificationInLegacyMode({
        db: params.db, recipient: params.recipient, notification,
      }))) {
      await params.store.resolveOne({
        id: notification.id,
        recipientUserId: params.recipient.id,
        resolution: "authorization_revoked",
      });
    }
    return null;
  }
  const request = accessRequestVisible
    ? params.db.enterpriseJoinRequests.find((candidate) => candidate.id === notification.subjectId)!
    : null;
  if (!notification.resolvedAt && request && request.status !== "pending") {
    await params.store.resolveOne({
      id: notification.id,
      recipientUserId: params.recipient.id,
      resolution: request.status,
      resolvedAt: params.readAt,
    });
  }
  const updated = await params.store.markRead({
    id: notification.id,
    recipientUserId: params.recipient.id,
    readAt: params.readAt,
  });
  return updated ? toDashboardRow(updated) : null;
}

function toDashboardRow(notification: UserNotificationRecord): DashboardNotificationRow {
  if (notification.kind !== "access_request"
    && notification.kind !== "topic_assigned"
    && notification.kind !== "topic_due_7d"
    && notification.kind !== "topic_due_1d"
    && notification.kind !== "topic_overdue"
    && notification.kind !== "content_added"
    && notification.kind !== "scenario_submitted"
    && notification.kind !== "scenario_reviewed"
    && notification.kind !== "goal_updated"
    && notification.kind !== "goal_commented") {
    throw new Error("Unsupported notification kind reached dashboard serialization.");
  }
  return {
    id: notification.id,
    orgId: notification.orgId,
    kind: notification.kind,
    subjectType: notification.subjectType,
    subjectId: notification.subjectId,
    payload: { ...notification.payload },
    createdAt: notification.createdAt,
    readAt: notification.readAt,
    resolvedAt: notification.resolvedAt,
    resolution: notification.resolution,
  };
}
