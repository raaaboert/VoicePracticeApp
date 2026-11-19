export type LegacyAppStateRecordField =
  | "auditEvents"
  | "aiUsageEvents"
  | "usageSessions"
  | "scoreRecords"
  | "supportCases"
  | "webAuthSessions";

/**
 * Whether a loaded app_state document still holds legacy records under `field`
 * that a startup migration must move to dedicated storage and strip from
 * app_state with a whole-document save.
 *
 * Key presence alone is not pending work: ensureDatabaseShape adds some of
 * these keys on every load even when the stored document has none
 * (`usageSessions` as `[]`, `auditEvents` and `webAuthSessions` as
 * `undefined`). Treating those as pending made every API start rewrite the
 * whole app_state document. An empty or non-array legacy value needs no
 * save: the next ordinary commit drops it (buildPersistedDatabaseSnapshot).
 */
export function hasLegacyAppStateRecords(db: object, field: LegacyAppStateRecordField): boolean {
  const value = (db as Record<string, unknown>)[field];
  return Array.isArray(value) && value.length > 0;
}
