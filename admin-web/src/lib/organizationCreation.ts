export interface OrganizationCreationInput {
  name: string;
  contactName: string;
  contactEmail: string;
  activeIndustries?: string[];
}

export interface OrganizationCreationOperation {
  id: string;
  payload: OrganizationCreationInput;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function organizationCreationStorageKey(apiBaseUrl: string): string {
  return `vp_admin_org_creation:${apiBaseUrl.replace(/\/+$/, "")}`;
}

export function readOrganizationCreationOperation(
  storage: DraftStorage, key: string,
): OrganizationCreationOperation | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let value: OrganizationCreationOperation;
  try { value = JSON.parse(raw) as OrganizationCreationOperation; }
  catch { throw new Error("The pending account creation could not be restored. Check the account directory before starting a separate creation."); }
  if (!value || typeof value.id !== "string" || !OPERATION_ID.test(value.id)
    || !value.payload || typeof value.payload.name !== "string" || !value.payload.name.trim()
    || typeof value.payload.contactName !== "string" || typeof value.payload.contactEmail !== "string"
    || (value.payload.activeIndustries !== undefined && (!Array.isArray(value.payload.activeIndustries)
      || !value.payload.activeIndustries.every((id) => typeof id === "string")))) {
    throw new Error("The pending account creation could not be restored. Check the account directory before starting a separate creation.");
  }
  return value;
}

export function prepareOrganizationCreation(
  storage: DraftStorage, key: string, input: OrganizationCreationInput, createId: () => string,
): OrganizationCreationOperation {
  const payload: OrganizationCreationInput = {
    name: input.name.trim(), contactName: input.contactName, contactEmail: input.contactEmail,
    ...(input.activeIndustries ? { activeIndustries: [...input.activeIndustries] } : {}),
  };
  if (!payload.name) throw new Error("Company name is required.");
  const pending = readOrganizationCreationOperation(storage, key);
  if (pending) {
    if (pending.payload.name !== payload.name || pending.payload.contactName !== payload.contactName
      || pending.payload.contactEmail !== payload.contactEmail) {
      throw new Error("An account creation is pending. Retry its original details before starting a separate creation.");
    }
    // Freeze the entire payload, including the then-current default industry.
    return pending;
  }
  const id = createId();
  if (!OPERATION_ID.test(id)) throw new Error("A secure account creation identifier could not be generated.");
  const operation = { id, payload };
  // Persistence MUST succeed before dispatch, so a reload/manual retry retains identity.
  storage.setItem(key, JSON.stringify(operation));
  return operation;
}

export async function submitOrganizationCreation<T extends { id: string }>(params: {
  storage: DraftStorage;
  key: string;
  input: OrganizationCreationInput;
  createId: () => string;
  send: (operation: OrganizationCreationOperation) => Promise<T>;
}): Promise<T> {
  const operation = prepareOrganizationCreation(params.storage, params.key, params.input, params.createId);
  const org = await params.send(operation);
  if (!org || typeof org.id !== "string" || !org.id) {
    throw new Error("The account creation response was incomplete. Retry to confirm its result.");
  }
  // Transport, JSON parsing and cleanup failures retain the same operation for retry.
  params.storage.removeItem(params.key);
  return org;
}
