import { createHash } from "node:crypto";
import type { ApiDatabase, EnterpriseOrg } from "@voicepractice/shared";

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREATE_FIELDS = [
  "name", "contactName", "contactEmail", "joinCode", "dailySecondsQuota", "perUserDailySecondsCap",
  "activeIndustries", "contractSignedAt", "monthlyMinutesAllotted", "renewalTotalUsd",
  "softLimitPercentTriggers", "maxSimulationMinutes",
] as const;

interface OrganizationCreationReceipt {
  fingerprint: string;
  orgId: string;
}

// Private API persistence metadata: committed with the organization in the existing
// app_state JSON document, never included in an organization response. No SQL DDL.
type OrganizationCreationState = ApiDatabase & {
  organizationCreationReceipts?: Record<string, OrganizationCreationReceipt>;
};

export class OrganizationCreationRetryError extends Error {
  constructor(readonly status: 400 | 409, readonly code: string, message: string) {
    super(message);
    this.name = "OrganizationCreationRetryError";
  }
}

export function requireOrganizationCreationOperationId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!OPERATION_ID.test(id)) {
    throw new OrganizationCreationRetryError(400, "organization_creation_key_required",
      "Organization creation requires a UUID Idempotency-Key. Refresh the admin page before creating an account.");
  }
  return id;
}

export function organizationIdForCreationOperation(operationId: string): string {
  return `org_${operationId}`;
}

export function fingerprintOrganizationCreationInput(body: Record<string, unknown>): string {
  // Fixed field order makes JSON property order irrelevant; omit ignored fields.
  // Fingerprint the original request, not time-dependent defaults or mutable org data.
  const input = CREATE_FIELDS.map((field) => Object.prototype.hasOwnProperty.call(body, field)
    ? [field, body[field]] : [field]);
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function restoreOrganizationCreationReceipts(normalized: ApiDatabase, raw: unknown): void {
  const receipts = (raw as OrganizationCreationState | null)?.organizationCreationReceipts;
  if (receipts === undefined) return; // Existing databases need no conversion.
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
    throw new Error("Invalid organization creation receipt state.");
  }
  const restored: Record<string, OrganizationCreationReceipt> = {};
  for (const [id, receipt] of Object.entries(receipts)) {
    if (!OPERATION_ID.test(id) || !receipt || typeof receipt !== "object"
      || typeof receipt.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(receipt.fingerprint)
      || receipt.orgId !== organizationIdForCreationOperation(id)) {
      // Never silently drop a receipt and make a used operation eligible again.
      throw new Error("Invalid organization creation receipt state.");
    }
    restored[id] = { fingerprint: receipt.fingerprint, orgId: receipt.orgId };
  }
  (normalized as OrganizationCreationState).organizationCreationReceipts = restored;
}

/** Call only inside the existing serialized app-state mutation/commit boundary. */
export function resolveOrganizationCreationReplay(
  db: ApiDatabase, operationId: string, fingerprint: string,
): EnterpriseOrg | null {
  const receipt = (db as OrganizationCreationState).organizationCreationReceipts?.[operationId];
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) {
      throw new OrganizationCreationRetryError(409, "organization_creation_key_conflict",
        "This creation operation was already used with different account details.");
    }
    const org = db.orgs.find((entry) => entry.id === receipt.orgId);
    if (!org) {
      throw new OrganizationCreationRetryError(409, "organization_creation_result_missing",
        "This creation operation already completed, but its account is no longer available.");
    }
    return org;
  }
  if (db.orgs.some((entry) => entry.id === organizationIdForCreationOperation(operationId))) {
    throw new OrganizationCreationRetryError(409, "organization_creation_key_conflict",
      "This creation operation is already in use. Check the account directory before starting another creation.");
  }
  return null;
}

/** Receipt and org must be saved in the SAME app-state commit; never expire receipts. */
export function recordOrganizationCreation(
  db: ApiDatabase, operationId: string, fingerprint: string, org: EnterpriseOrg,
): void {
  const state = db as OrganizationCreationState;
  state.organizationCreationReceipts ??= {};
  state.organizationCreationReceipts[operationId] = { fingerprint, orgId: org.id };
}
