import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  organizationCreationStorageKey, prepareOrganizationCreation, readOrganizationCreationOperation, submitOrganizationCreation,
} from "./organizationCreation";
import { adminFetch } from "./api";

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } };
}
const input = { name: "Company", contactName: "Owner", contactEmail: "owner@example.test", activeIndustries: ["people_management"] };
const key = organizationCreationStorageKey("https://api.example.test");

test("pending creation survives a reload/manual retry and freezes its original payload", async () => {
  const store = storage();
  const first = prepareOrganizationCreation(store, key, input, randomUUID);
  assert.equal(readOrganizationCreationOperation(store, key)?.id, first.id);
  const reloaded = prepareOrganizationCreation(store, key, { ...input, activeIndustries: ["changed_default"] }, randomUUID);
  assert.deepEqual(reloaded, first);
  assert.throws(() => prepareOrganizationCreation(store, key, { ...input, name: "Changed" }, randomUUID));
  await assert.rejects(submitOrganizationCreation({ storage: store, key, input, createId: randomUUID,
    send: async (operation) => { assert.equal(operation.id, first.id); throw new TypeError("lost response"); } }));
  let sentId = "";
  await submitOrganizationCreation({ storage: store, key, input, createId: randomUUID,
    send: async (operation) => { sentId = operation.id; return { id: "original_org" }; } });
  assert.equal(sentId, first.id);
  assert.equal(readOrganizationCreationOperation(store, key), null);
  const independent = prepareOrganizationCreation(store, key, input, randomUUID);
  assert.notEqual(independent.id, first.id, "an independent identical-name creation receives a new ID");
});

test("separate tabs/environments have distinct pending operations", () => {
  const store = storage();
  const first = prepareOrganizationCreation(store, key, input, randomUUID);
  const second = prepareOrganizationCreation(storage(), key, input, randomUUID);
  const otherEnvironment = prepareOrganizationCreation(store, organizationCreationStorageKey("https://staging.example.test"), input, randomUUID);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.id, otherEnvironment.id);
});

test("storage failure prevents dispatch; incomplete responses and cleanup failures retain identity", async () => {
  let dispatched = false;
  const denied = { ...storage(), setItem: () => { throw new Error("storage unavailable"); } };
  await assert.rejects(submitOrganizationCreation({ storage: denied, key, input, createId: randomUUID,
    send: async () => { dispatched = true; return { id: "org" }; } }));
  assert.equal(dispatched, false);
  const store = storage();
  await assert.rejects(submitOrganizationCreation({ storage: store, key, input, createId: randomUUID,
    send: async () => ({ id: "" }) }));
  const pendingId = readOrganizationCreationOperation(store, key)!.id;
  await assert.rejects(submitOrganizationCreation({ storage: { ...store, removeItem: () => { throw new Error("cleanup failed"); } },
    key, input, createId: randomUUID, send: async (operation) => {
      assert.equal(operation.id, pendingId); return { id: "org" };
    } }));
  assert.equal(readOrganizationCreationOperation(store, key)?.id, pendingId);
});

test("malformed pending state is never silently replaced with another operation", () => {
  const store = storage();
  store.setItem(key, "invalid JSON");
  assert.throws(() => prepareOrganizationCreation(store, key, input, randomUUID));
  assert.equal(store.getItem(key), "invalid JSON");
});

test("the real admin fetch retry retains the same creation ID and payload", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) throw new TypeError("response lost after commit");
    return new Response(JSON.stringify({ id: "persisted_org" }), { status: 201 });
  };
  try {
    const store = storage();
    const result = await submitOrganizationCreation({ storage: store, key, input, createId: randomUUID,
      send: (operation) => adminFetch<{ id: string }>("/orgs", { method: "POST",
        headers: { "Idempotency-Key": operation.id }, body: JSON.stringify(operation.payload) }) });
    assert.equal(result.id, "persisted_org");
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].headers, requests[1].headers);
    assert.equal(requests[0].body, requests[1].body);
    assert.equal(readOrganizationCreationOperation(store, key), null);
  } finally { globalThis.fetch = originalFetch; }
});
