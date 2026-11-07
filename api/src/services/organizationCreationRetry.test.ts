import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiDatabase, EnterpriseOrg } from "@voicepractice/shared";
import {
  fingerprintOrganizationCreationInput, organizationIdForCreationOperation, recordOrganizationCreation,
  requireOrganizationCreationOperationId, resolveOrganizationCreationReplay, restoreOrganizationCreationReceipts,
} from "./organizationCreationRetry.js";

test("operation keys are validated, and fingerprints ignore property order and ignored fields", () => {
  const key = randomUUID();
  assert.equal(requireOrganizationCreationOperationId(key.toUpperCase()), key);
  for (const invalid of [undefined, "", "__proto__", randomUUID() + "," + randomUUID()]) {
    assert.throws(() => requireOrganizationCreationOperationId(invalid));
  }
  assert.equal(fingerprintOrganizationCreationInput({ name: "A", contactName: "B" }),
    fingerprintOrganizationCreationInput({ ignored: true, contactName: "B", name: "A" }));
  assert.notEqual(fingerprintOrganizationCreationInput({ name: "A" }), fingerprintOrganizationCreationInput({ name: "B" }));
  assert.notEqual(fingerprintOrganizationCreationInput({ name: "A" }),
    fingerprintOrganizationCreationInput({ name: "A", activeIndustries: null }));
});

test("receipt metadata round-trips separately from org responses and survives later org edits", () => {
  const key = randomUUID();
  const fingerprint = fingerprintOrganizationCreationInput({ name: "A" });
  const org = { id: organizationIdForCreationOperation(key), name: "A" } as EnterpriseOrg;
  const db = { orgs: [org] } as ApiDatabase;
  recordOrganizationCreation(db, key, fingerprint, org);
  const raw = JSON.parse(JSON.stringify(db));
  const normalized = { orgs: raw.orgs } as ApiDatabase;
  restoreOrganizationCreationReceipts(normalized, raw);
  normalized.orgs[0].name = "Edited";
  assert.equal(resolveOrganizationCreationReplay(normalized, key, fingerprint)?.name, "Edited");
  assert.throws(() => resolveOrganizationCreationReplay(normalized, key, "different"), { code: "organization_creation_key_conflict" });
  assert.equal("organizationCreationReceipts" in org, false);
  normalized.orgs = [];
  assert.throws(() => resolveOrganizationCreationReplay(normalized, key, fingerprint), { code: "organization_creation_result_missing" });
});

test("legacy state is accepted, corrupt receipts and colliding existing IDs fail closed", () => {
  const db = { orgs: [] } as unknown as ApiDatabase;
  restoreOrganizationCreationReceipts(db, { orgs: [] });
  assert.deepEqual(db, { orgs: [] });
  for (const bad of [null, [], { invalid: {} }, { [randomUUID()]: { fingerprint: "bad", orgId: "other" } }]) {
    assert.throws(() => restoreOrganizationCreationReceipts(db, { organizationCreationReceipts: bad }));
  }
  const key = randomUUID();
  db.orgs.push({ id: organizationIdForCreationOperation(key) } as EnterpriseOrg);
  assert.throws(() => resolveOrganizationCreationReplay(db, key, "unused"), { code: "organization_creation_key_conflict" });
});
