import type { ApiDatabase, AuditEvent, WebAuthSessionRecord } from "@voicepractice/shared";
import type { DatabaseStorage } from "../storage.js";
import type { AppStateTransactionClient } from "../storage.js";
import type { AuditEventStore } from "../storage/auditEventStore.js";
import type { UserEmployeeIdClaimStore } from "../storage/userEmployeeIdClaimStore.js";
import type { WebAuthSessionStore } from "../storage/webAuthSessionStore.js";
import { collectWebSessionInvalidations } from "./webSessionInvalidation.js";

export interface AuthoritativeAppStateCommitInput {
  storage: DatabaseStorage;
  claimStore: UserEmployeeIdClaimStore;
  sessionStore: WebAuthSessionStore;
  auditStore: AuditEventStore;
  before: ApiDatabase;
  working: ApiDatabase;
  auditEvents: AuditEvent[];
  newWebSessions?: WebAuthSessionRecord[];
  buildPersistedSnapshot: (db: ApiDatabase) => ApiDatabase;
  beforeSessionRevocation?: () => Promise<void>;
  requiredTransactionSideWrites?: Array<(client: AppStateTransactionClient | null) => Promise<void>>;
  beforeAppStateSave?: () => Promise<void>;
  onCommitted: (db: ApiDatabase) => void;
}

/** Commit governance and credential effects with app_state on one PG client. */
export async function commitAuthoritativeAppState(input: AuthoritativeAppStateCommitInput): Promise<void> {
  const revokeUserIds = collectWebSessionInvalidations(input.before, input.working);
  await input.storage.runTransaction(async (client) => {
    await input.claimStore.syncFromUsers(input.working.users, client);
    if (revokeUserIds.length > 0) {
      await input.beforeSessionRevocation?.();
      await input.sessionStore.revokeSessionsForUsers(revokeUserIds, client);
    }
    for (const session of input.newWebSessions ?? []) {
      await input.sessionStore.saveSession(session, client);
    }
    if (input.auditEvents.length > 0) {
      await input.auditStore.appendEvents(input.auditEvents, { client });
    }
    for (const sideWrite of input.requiredTransactionSideWrites ?? []) {
      await sideWrite(client);
    }
    await input.beforeAppStateSave?.();
    await input.storage.save(input.buildPersistedSnapshot(input.working), client);
  });
  // COMMIT has returned. Publishing before this line would expose rollback state.
  input.onCommitted(input.working);
}
