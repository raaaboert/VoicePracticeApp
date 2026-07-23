import assert from "node:assert/strict";
import test from "node:test";

import { createPerformancePlanStore } from "../storage/performancePlanStore.js";
import {
  initializeDatabaseStoresForReadiness,
  initializeDatabaseStoresForStartup
} from "./databaseStoreInitialization.js";

function fakeStore(calls: string[], label: string) {
  return {
    async initialize(): Promise<void> {
      calls.push(`${label}.initialize`);
    }
  };
}

function fakeStartupMaintenance(calls: string[]) {
  return {
    async migrateLegacyAuditEventsFromAppState(): Promise<void> {
      calls.push("migrateLegacyAuditEventsFromAppState");
    },
    async migrateLegacyAiUsageEventsFromAppState(): Promise<void> {
      calls.push("migrateLegacyAiUsageEventsFromAppState");
    },
    async migrateLegacyUsageSessionsFromAppState(): Promise<void> {
      calls.push("migrateLegacyUsageSessionsFromAppState");
    },
    async migrateLegacyScoreRecordsFromAppState(): Promise<void> {
      calls.push("migrateLegacyScoreRecordsFromAppState");
    },
    async migrateLegacySupportCasesFromAppState(): Promise<void> {
      calls.push("migrateLegacySupportCasesFromAppState");
    },
    async migrateLegacyWebAuthSessionsFromAppState(): Promise<void> {
      calls.push("migrateLegacyWebAuthSessionsFromAppState");
    },
    async runStartupUsageIntegrityMaintenance(): Promise<void> {
      calls.push("runStartupUsageIntegrityMaintenance");
    }
  };
}

test("database startup initializes Performance tables through the normal extracted-store setup", async () => {
  const calls: string[] = [];
  const queries: string[] = [];
  let performanceStoreInitialized = false;
  const performancePlanStore = createPerformancePlanStore({
    provider: "postgres",
    dbPath: "unused.json",
    databaseUrl: "postgres://user:pass@localhost:5432/peritio_test",
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
    queryPool: {
      async query(text: string) {
        if (!performanceStoreInitialized) {
          calls.push("performancePlanStore.initialize");
          performanceStoreInitialized = true;
        }
        queries.push(text);
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        throw new Error("connect should not be used during startup initialization.");
      }
    } as any
  });

  await initializeDatabaseStoresForStartup({
    stores: {
      auditEventStore: fakeStore(calls, "auditEventStore"),
      aiUsageEventStore: fakeStore(calls, "aiUsageEventStore"),
      simulationSessionStore: fakeStore(calls, "simulationSessionStore"),
      usageSessionStore: fakeStore(calls, "usageSessionStore"),
      scoreRecordStore: fakeStore(calls, "scoreRecordStore"),
      supportCaseStore: fakeStore(calls, "supportCaseStore"),
      webAuthSessionStore: fakeStore(calls, "webAuthSessionStore"),
      performancePlanStore,
      trainingPackStore: fakeStore(calls, "trainingPackStore")
    },
    maintenance: fakeStartupMaintenance(calls)
  });

  assert.deepEqual(calls, [
    "auditEventStore.initialize",
    "migrateLegacyAuditEventsFromAppState",
    "aiUsageEventStore.initialize",
    "migrateLegacyAiUsageEventsFromAppState",
    "simulationSessionStore.initialize",
    "usageSessionStore.initialize",
    "migrateLegacyUsageSessionsFromAppState",
    "scoreRecordStore.initialize",
    "migrateLegacyScoreRecordsFromAppState",
    "supportCaseStore.initialize",
    "migrateLegacySupportCasesFromAppState",
    "webAuthSessionStore.initialize",
    "migrateLegacyWebAuthSessionsFromAppState",
    "performancePlanStore.initialize",
    "trainingPackStore.initialize",
    "runStartupUsageIntegrityMaintenance"
  ]);

  const initializationSql = queries.join("\n");
  assert.match(initializationSql, /CREATE TABLE IF NOT EXISTS performance_plans/);
  assert.match(initializationSql, /CREATE TABLE IF NOT EXISTS performance_plan_scope_items/);
  assert.match(initializationSql, /CREATE TABLE IF NOT EXISTS performance_plan_audit_events/);
  assert.match(initializationSql, /REFERENCES performance_plans\(id\) ON DELETE CASCADE/);
});

test("database readiness refresh initializes the Performance store before loading app state", async () => {
  const calls: string[] = [];

  await initializeDatabaseStoresForReadiness({
    stores: {
      auditEventStore: fakeStore(calls, "auditEventStore"),
      aiUsageEventStore: fakeStore(calls, "aiUsageEventStore"),
      simulationSessionStore: fakeStore(calls, "simulationSessionStore"),
      usageSessionStore: fakeStore(calls, "usageSessionStore"),
      scoreRecordStore: fakeStore(calls, "scoreRecordStore"),
      supportCaseStore: fakeStore(calls, "supportCaseStore"),
      webAuthSessionStore: fakeStore(calls, "webAuthSessionStore"),
      performancePlanStore: fakeStore(calls, "performancePlanStore")
    },
    async loadDatabase(): Promise<void> {
      calls.push("loadDatabase");
    }
  });

  assert.deepEqual(calls, [
    "auditEventStore.initialize",
    "aiUsageEventStore.initialize",
    "simulationSessionStore.initialize",
    "usageSessionStore.initialize",
    "scoreRecordStore.initialize",
    "supportCaseStore.initialize",
    "webAuthSessionStore.initialize",
    "performancePlanStore.initialize",
    "loadDatabase"
  ]);
});
