import type { ApiDatabase, OrgTrainingRecord, UserProfile } from "@voicepractice/shared";

import { addDaysToDateKey, getDateKeyInTimeZone, isValidIanaTimeZone, localDateTimeToUtc } from "./performanceDateWindows.js";
import { canFutureLearnerAccessFocusTopic, type FocusTopicAssignment } from "./focusTopicAuthority.js";
import type { FocusTopicAuthoritySnapshot } from "../storage/focusTopicAuthorityStore.js";
import type { EnqueueUserNotificationInput, UserNotificationStore } from "../storage/userNotificationStore.js";

export const FOCUS_TOPIC_REMINDER_SUBJECT_TYPE = "focus_topic";
export type FocusTopicReminderMilestone = "due_7d" | "due_1d" | "overdue";

export function buildFocusTopicReminderInputs(params: {
  db: ApiDatabase;
  authority: FocusTopicAuthoritySnapshot;
  now: Date;
}): EnqueueUserNotificationInput[] {
  const inputs: EnqueueUserNotificationInput[] = [];
  for (const assignment of params.authority.assignments) {
    if (assignment.grantsManagement || assignment.revokedAt || !assignment.dueDate) continue;
    const org = params.db.orgs.find((candidate) => candidate.id === assignment.orgId);
    const topic = params.db.orgTrainings.find((candidate) => candidate.id === assignment.topicId && candidate.orgId === assignment.orgId);
    if (!org || !topic || org.status !== "active" || topic.status !== "active") continue;
    for (const recipient of params.db.users) {
      // A reminder belongs to one dated assignment.  Resolve that assignment's
      // audience first; another assignment for the same Topic must never widen
      // its recipient set.  The second check keeps delivery subject to current
      // effective learner access across the Topic's current assignments.
      if (!canFutureLearnerAccessFocusTopic({
        user: recipient, users: params.db.users, organization: org, topic,
        assignments: [assignment],
      })) continue;
      if (!canFutureLearnerAccessFocusTopic({
        user: recipient, users: params.db.users, organization: org, topic,
        assignments: params.authority.assignments,
      })) continue;
      const timeZone = effectiveTimeZone(recipient);
      const milestone = dueMilestone(assignment.dueDate, params.now, timeZone);
      if (!milestone) continue;
      inputs.push(toInput({ assignment, topic, recipient, milestone, now: params.now }));
    }
  }
  return inputs;
}

export async function runFocusTopicReminderSweep(params: {
  db: ApiDatabase;
  authority: FocusTopicAuthoritySnapshot;
  store: UserNotificationStore;
  now?: Date;
}): Promise<{ considered: number; inserted: number }> {
  const inputs = buildFocusTopicReminderInputs({ db: params.db, authority: params.authority, now: params.now ?? new Date() });
  const inserted = await params.store.enqueueMany(inputs);
  return { considered: inputs.length, inserted: inserted.length };
}

export function dueMilestone(dueDate: string, now: Date, timeZone: string): FocusTopicReminderMilestone | null {
  const today = getDateKeyInTimeZone(now, timeZone);
  const candidates: Array<[FocusTopicReminderMilestone, string]> = [
    ["overdue", addDaysToDateKey(dueDate, 1)],
    ["due_1d", addDaysToDateKey(dueDate, -1)],
    ["due_7d", addDaysToDateKey(dueDate, -7)],
  ];
  for (const [milestone, date] of candidates) {
    // A scheduler may miss 08:00.  Deliver a not-yet-emitted pre-due reminder
    // on a later sweep before its due date; durable deduplication prevents a
    // second delivery.  Overdue begins the day after the due date and remains
    // eligible until the assignment no longer applies.
    if (milestone === "overdue" ? today < date : today < date || today >= dueDate) continue;
    const scheduledAt = localDateTimeToUtc({ ...dateParts(date), hour: 8, minute: 0, second: 0, millisecond: 0 }, timeZone);
    if (now.getTime() >= scheduledAt.getTime()) return milestone;
  }
  return null;
}

function toInput(params: { assignment: FocusTopicAssignment; topic: OrgTrainingRecord; recipient: UserProfile; milestone: FocusTopicReminderMilestone; now: Date }): EnqueueUserNotificationInput {
  const labels: Record<FocusTopicReminderMilestone, { title: string; body: string }> = {
    due_7d: { title: "Focus Topic due in 7 days", body: `${params.topic.name} is due ${params.assignment.dueDate}.` },
    due_1d: { title: "Focus Topic due tomorrow", body: `${params.topic.name} is due ${params.assignment.dueDate}.` },
    overdue: { title: "Focus Topic overdue", body: `${params.topic.name} was due ${params.assignment.dueDate}.` },
  };
  const label = labels[params.milestone];
  return {
    orgId: params.assignment.orgId, recipientUserId: params.recipient.id,
    kind: `topic_${params.milestone}` as "topic_due_7d" | "topic_due_1d" | "topic_overdue",
    subjectType: FOCUS_TOPIC_REMINDER_SUBJECT_TYPE, subjectId: params.topic.id,
    dedupKey: `focus-topic-reminder:${params.assignment.id}:${params.milestone}:${params.assignment.dueDate}:${params.recipient.id}`,
    payload: { title: label.title, body: label.body, destination: "/app/training" }, createdAt: params.now,
  };
}

function effectiveTimeZone(user: UserProfile): string {
  return user.timezone && isValidIanaTimeZone(user.timezone) ? user.timezone : "UTC";
}
function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}
