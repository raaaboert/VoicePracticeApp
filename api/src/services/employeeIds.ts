import { UserProfile } from "@voicepractice/shared";

export const EMPLOYEE_ID_MAX_LENGTH = 64;

export interface NormalizedEmployeeIdResult {
  ok: true;
  value: string | null;
}

export interface InvalidEmployeeIdResult {
  ok: false;
  error: string;
  code: "employee_id_invalid";
}

export type EmployeeIdNormalizationResult = NormalizedEmployeeIdResult | InvalidEmployeeIdResult;

export interface EmployeeIdConflict {
  code: "employee_id_conflict";
  orgId: string;
}

export function normalizeEmployeeIdInput(value: unknown): EmployeeIdNormalizationResult {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: "Employee ID must be a string.",
      code: "employee_id_invalid",
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (trimmed.length > EMPLOYEE_ID_MAX_LENGTH) {
    return {
      ok: false,
      error: `Employee ID must be ${EMPLOYEE_ID_MAX_LENGTH} characters or fewer.`,
      code: "employee_id_invalid",
    };
  }

  return { ok: true, value: trimmed };
}

export function normalizeEmployeeIdForUniqueness(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.toLocaleLowerCase("en-US") : null;
}

export function findEmployeeIdConflict(params: {
  users: readonly UserProfile[];
  orgId: string | null | undefined;
  employeeId: string | null;
  exceptUserId?: string | null;
}): EmployeeIdConflict | null {
  const orgId = typeof params.orgId === "string" ? params.orgId.trim() : "";
  const normalizedEmployeeId = normalizeEmployeeIdForUniqueness(params.employeeId);
  if (!orgId || !normalizedEmployeeId) {
    return null;
  }

  const exceptUserId = params.exceptUserId?.trim() ?? null;
  const duplicate = params.users.find((user) => {
    if (user.id === exceptUserId) {
      return false;
    }
    if (user.accountType !== "enterprise" || user.orgId !== orgId) {
      return false;
    }
    return normalizeEmployeeIdForUniqueness(user.employeeId) === normalizedEmployeeId;
  });

  return duplicate ? { code: "employee_id_conflict", orgId } : null;
}

export function assertNoEmployeeIdConflicts(users: readonly UserProfile[]): void {
  const seen = new Set<string>();
  for (const user of users) {
    if (user.accountType !== "enterprise" || !user.orgId) {
      continue;
    }
    const normalizedEmployeeId = normalizeEmployeeIdForUniqueness(user.employeeId);
    if (!normalizedEmployeeId) {
      continue;
    }
    const key = `${user.orgId}::${normalizedEmployeeId}`;
    if (seen.has(key)) {
      throw new Error("Duplicate Employee ID detected within an organization.");
    }
    seen.add(key);
  }
}
