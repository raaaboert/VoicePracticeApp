import type {
  ApiDatabase,
  TrainingPackAssignmentRecord,
  UserProfile,
} from "@voicepractice/shared";

export function isTrainingPackAssignmentEligibleUser(
  user: Pick<UserProfile, "accountType" | "orgId" | "status">,
  orgId: string
): boolean {
  return user.accountType === "enterprise" && user.orgId === orgId && user.status === "active";
}

export function listTrainingPackAssignmentEligibleUsers(
  users: readonly UserProfile[],
  orgId: string
): UserProfile[] {
  return users.filter((user) => isTrainingPackAssignmentEligibleUser(user, orgId));
}

export function isTrainingPackAssignmentValidForUser(
  assignment: Pick<TrainingPackAssignmentRecord, "orgId">,
  user: Pick<UserProfile, "accountType" | "orgId" | "status"> | null | undefined
): boolean {
  if (!user) {
    return false;
  }

  return isTrainingPackAssignmentEligibleUser(user, assignment.orgId);
}

export function deactivateTrainingPackAssignmentsForUser(
  assignments: TrainingPackAssignmentRecord[] | undefined,
  userId: string,
  nowIso: string
): number {
  if (!Array.isArray(assignments) || !userId.trim()) {
    return 0;
  }

  let changedCount = 0;
  for (const assignment of assignments) {
    if (assignment.userId !== userId || assignment.active !== true) {
      continue;
    }

    assignment.active = false;
    assignment.updatedAt = nowIso;
    changedCount += 1;
  }

  return changedCount;
}

export function deactivateInvalidTrainingPackAssignmentsForUser(params: {
  assignments: TrainingPackAssignmentRecord[] | undefined;
  userId: string;
  user: Pick<UserProfile, "accountType" | "orgId" | "status"> | null | undefined;
  nowIso: string;
}): number {
  if (!Array.isArray(params.assignments) || !params.userId.trim()) {
    return 0;
  }

  let changedCount = 0;
  for (const assignment of params.assignments) {
    if (assignment.userId !== params.userId || assignment.active !== true) {
      continue;
    }

    if (isTrainingPackAssignmentValidForUser(assignment, params.user)) {
      continue;
    }

    assignment.active = false;
    assignment.updatedAt = params.nowIso;
    changedCount += 1;
  }

  return changedCount;
}

export function deactivateInvalidTrainingPackAssignments(params: {
  db: Pick<ApiDatabase, "users" | "trainingPackAssignments">;
  nowIso: string;
  orgId?: string;
  trainingPackId?: string;
}): number {
  const userById = new Map(
    (Array.isArray(params.db.users) ? params.db.users : [])
      .map((user) => [user.id.trim(), user] as const)
      .filter(([userId]) => Boolean(userId))
  );

  let changedCount = 0;
  for (const assignment of Array.isArray(params.db.trainingPackAssignments) ? params.db.trainingPackAssignments : []) {
    if (assignment.active !== true) {
      continue;
    }
    if (params.orgId && assignment.orgId !== params.orgId) {
      continue;
    }
    if (params.trainingPackId && assignment.trainingPackId !== params.trainingPackId) {
      continue;
    }

    changedCount += deactivateInvalidTrainingPackAssignmentsForUser({
      assignments: [assignment],
      userId: assignment.userId,
      user: userById.get(assignment.userId),
      nowIso: params.nowIso,
    });
  }

  return changedCount;
}
