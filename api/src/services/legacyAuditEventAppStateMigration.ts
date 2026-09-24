import type { ApiDatabase } from "@voicepractice/shared";

import type { AuditEventStore } from "../storage/auditEventStore.js";

export interface LegacyAuditEventAppStateMigrationResult {
  migrated: boolean;
  legacyEventCount: number;
  importedCount: number;
  trimmedCount: number;
}

export async function migrateLegacyAuditEventsFromAppState(params: {
  loadDatabase(): Promise<ApiDatabase>;
  saveDatabase(db: ApiDatabase): Promise<void>;
  auditEventStore: Pick<AuditEventStore, "importLegacyEvents">;
  maxRecords: number;
}): Promise<LegacyAuditEventAppStateMigrationResult> {
  const db = await params.loadDatabase();
  if (!Object.prototype.hasOwnProperty.call(db, "auditEvents")) {
    return {
      migrated: false,
      legacyEventCount: 0,
      importedCount: 0,
      trimmedCount: 0
    };
  }

  const legacyAuditEvents = Array.isArray(db.auditEvents) ? db.auditEvents : [];
  const migration = await params.auditEventStore.importLegacyEvents(legacyAuditEvents, {
    maxRecords: params.maxRecords
  });
  delete (db as Partial<ApiDatabase>).auditEvents;
  await params.saveDatabase(db);

  return {
    migrated: true,
    legacyEventCount: legacyAuditEvents.length,
    importedCount: migration.importedCount,
    trimmedCount: migration.trimmedCount
  };
}
