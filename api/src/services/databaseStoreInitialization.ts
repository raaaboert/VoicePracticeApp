interface InitializableStore {
  initialize(): Promise<void>;
}

export interface OperationalStoreSet {
  auditEventStore: InitializableStore;
  aiUsageEventStore: InitializableStore;
  simulationSessionStore: InitializableStore;
  usageSessionStore: InitializableStore;
  scoreRecordStore: InitializableStore;
  supportCaseStore: InitializableStore;
  webAuthSessionStore: InitializableStore;
  performancePlanStore: InitializableStore;
}

export interface StartupStoreSet extends OperationalStoreSet {
  trainingPackStore: InitializableStore;
}

export interface StartupStoreMaintenance {
  migrateLegacyAuditEventsFromAppState(): Promise<void>;
  migrateLegacyAiUsageEventsFromAppState(): Promise<void>;
  migrateLegacyUsageSessionsFromAppState(): Promise<void>;
  migrateLegacyScoreRecordsFromAppState(): Promise<void>;
  migrateLegacySupportCasesFromAppState(): Promise<void>;
  migrateLegacyWebAuthSessionsFromAppState(): Promise<void>;
  runStartupUsageIntegrityMaintenance(): Promise<void>;
}

export async function initializeDatabaseStoresForReadiness(params: {
  stores: OperationalStoreSet;
  loadDatabase: () => Promise<void>;
}): Promise<void> {
  await params.stores.auditEventStore.initialize();
  await params.stores.aiUsageEventStore.initialize();
  await params.stores.simulationSessionStore.initialize();
  await params.stores.usageSessionStore.initialize();
  await params.stores.scoreRecordStore.initialize();
  await params.stores.supportCaseStore.initialize();
  await params.stores.webAuthSessionStore.initialize();
  await params.stores.performancePlanStore.initialize();
  await params.loadDatabase();
}

export async function initializeDatabaseStoresForStartup(params: {
  stores: StartupStoreSet;
  maintenance: StartupStoreMaintenance;
}): Promise<void> {
  await params.stores.auditEventStore.initialize();
  await params.maintenance.migrateLegacyAuditEventsFromAppState();
  await params.stores.aiUsageEventStore.initialize();
  await params.maintenance.migrateLegacyAiUsageEventsFromAppState();
  await params.stores.simulationSessionStore.initialize();
  await params.stores.usageSessionStore.initialize();
  await params.maintenance.migrateLegacyUsageSessionsFromAppState();
  await params.stores.scoreRecordStore.initialize();
  await params.maintenance.migrateLegacyScoreRecordsFromAppState();
  await params.stores.supportCaseStore.initialize();
  await params.maintenance.migrateLegacySupportCasesFromAppState();
  await params.stores.webAuthSessionStore.initialize();
  await params.maintenance.migrateLegacyWebAuthSessionsFromAppState();
  await params.stores.performancePlanStore.initialize();
  await params.stores.trainingPackStore.initialize();
  await params.maintenance.runStartupUsageIntegrityMaintenance();
}
