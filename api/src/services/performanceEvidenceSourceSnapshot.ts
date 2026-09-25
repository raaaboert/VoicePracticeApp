import type {
  ApiDatabase,
  EnterpriseOrg,
  OrgTrainingRecord,
  SimulationScoreRecord,
  UserProfile,
} from "@voicepractice/shared";

export type PerformanceEvidenceSourceUser = Readonly<Pick<
  UserProfile,
  | "id"
  | "accountType"
  | "status"
  | "orgId"
  | "orgRole"
  | "isSuperUser"
  | "dashboardAccessEnabled"
  | "managerUserId"
  | "performanceAccess"
  | "divisionId"
>>;

export type PerformanceEvidenceSourceOrganization = Readonly<Pick<
  EnterpriseOrg,
  "id" | "status"
>>;

export type PerformanceEvidenceSourceTraining = Readonly<Pick<
  OrgTrainingRecord,
  "id" | "orgId" | "name" | "status" | "divisionId"
>>;

/**
 * A stable, controlled-order source capture for downstream evidence reads.
 * It is not a transactional snapshot across the separate score and app-state
 * stores. Score rows remain historical authority; current projections are only
 * future authorization and presentation context.
 */
export interface PerformanceEvidenceSourceSnapshot {
  readonly scoreRecords: readonly SimulationScoreRecord[];
  readonly users: readonly PerformanceEvidenceSourceUser[];
  readonly organizations: readonly PerformanceEvidenceSourceOrganization[];
  readonly trainings: readonly PerformanceEvidenceSourceTraining[];
}

export interface PerformanceEvidenceSourceSnapshotDependencies {
  refreshScoreRecords(): Promise<void>;
  getScoreSnapshot(): readonly SimulationScoreRecord[];
  withDatabaseLock<T>(runner: () => Promise<T>): Promise<T>;
  loadAppState(): Promise<Pick<ApiDatabase, "users" | "orgs" | "orgTrainings">>;
}

function projectUser(user: UserProfile): PerformanceEvidenceSourceUser {
  return {
    id: user.id,
    accountType: user.accountType,
    status: user.status,
    orgId: user.orgId,
    orgRole: user.orgRole,
    isSuperUser: user.isSuperUser,
    dashboardAccessEnabled: user.dashboardAccessEnabled,
    managerUserId: user.managerUserId,
    performanceAccess: user.performanceAccess,
    divisionId: user.divisionId,
  };
}

function projectOrganization(organization: EnterpriseOrg): PerformanceEvidenceSourceOrganization {
  return {
    id: organization.id,
    status: organization.status,
  };
}

function projectTraining(training: OrgTrainingRecord): PerformanceEvidenceSourceTraining {
  return {
    id: training.id,
    orgId: training.orgId,
    name: training.name,
    status: training.status,
    divisionId: training.divisionId,
  };
}

export async function capturePerformanceEvidenceSourceSnapshot(
  dependencies: PerformanceEvidenceSourceSnapshotDependencies,
): Promise<PerformanceEvidenceSourceSnapshot> {
  // This may be a full file/Postgres read, so it must never run under the
  // process-wide app-state lock.
  await dependencies.refreshScoreRecords();

  return await dependencies.withDatabaseLock(async () => {
    const scoreRecords = dependencies.getScoreSnapshot();
    const appState = await dependencies.loadAppState();

    return {
      scoreRecords,
      users: appState.users.map(projectUser),
      organizations: appState.orgs.map(projectOrganization),
      trainings: appState.orgTrainings.map(projectTraining),
    };
  });
}
