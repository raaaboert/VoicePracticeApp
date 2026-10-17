import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthVerificationStore, type VerificationIdentity } from "./authVerificationStore.js";
import { deliverVerificationChallenge } from "../services/authVerification.js";
import { AuthCodeDeliveryError } from "../services/authCodeDelivery.js";

const secret = "authentication_test_secret_of_at_least_32_characters";
const identity: VerificationIdentity = { userId: "user_1", email: "Test@Example.test", orgId: "org_1", purpose: "email_verification" };
test("durable local challenge is scoped, hashed and consumable once including reviewer exception", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-store-"));
  let now = Date.now();
  const store = new AuthVerificationStore({ provider: "file", dbPath: path.join(dir, "db.json"), databaseUrl: null, secret,
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, clock: () => now });
  try {
    assert.equal(store.accountKey(identity.email), store.accountKey("  test@example.TEST "));
    assert.equal(store.accountKey(identity.email), crypto.createHmac("sha256", secret)
      .update(JSON.stringify(["peritio.auth.account.v1", "test@example.test"])).digest("hex"));
    assert.notEqual(store.accountKey(identity.email), store.accountKey("test+tag@example.test"));
    const c = (await store.issue(identity))!;
    assert.equal(await store.verify(identity, c.code), "invalid", "undelivered code");
    await store.finishDelivery(identity, c.id, true);
    for (const wrong of [{ userId: "other" }, { orgId: "other" }, { email: "other@example.test" }, { purpose: "sign_in" as const }]) {
      assert.equal(await store.verify({ ...identity, ...wrong }, c.code), "invalid");
    }
    const raw = await readFile(path.join(dir, "db.auth-verification.json"), "utf8");
    assert.ok(!raw.includes(identity.email)); assert.ok(!raw.includes(`"${c.code}"`));
    const state = JSON.parse(raw)[store.accountKey(identity.email)];
    assert.match(state.challenges[0].codeHash, /^[a-f0-9]{64}$/);
    assert.equal(state.challenges[0].codeHash, crypto.createHmac("sha256", secret).update(JSON.stringify([
      "peritio.auth.challenge.v1", store.accountKey(identity.email), identity.userId, identity.orgId, identity.purpose, c.id, c.code,
    ])).digest("hex"));
    assert.notEqual(state.challenges[0].codeHash, store.accountKey(identity.email));
    assert.equal(await store.verify(identity, c.code), "ok");
    assert.equal(await store.verify(identity, c.code), "invalid");
    now += 60_001;
    const review = (await store.issue(identity))!; await store.finishDelivery(identity, review.id, true);
    assert.equal(await store.verify(identity, "808080", "808080"), "ok");
    assert.equal(await store.verify(identity, "808080", "808080"), "invalid");
    now += 25 * 60 * 60_000; await store.purgeExpired(); await store.purgeExpired();
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "db.auth-verification.json"), "utf8")), {});
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
test("delivery failure invalidates/refunds only its reservation; recovery preserves cooldown and failure history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "auth-delivery-"));
  let now = Date.now(), sentCode = "", fail = true;
  const store = new AuthVerificationStore({ provider: "file", dbPath: path.join(dir, "db.json"), databaseUrl: null, secret,
    pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, clock: () => now });
  const delivery = { sendEmailVerificationCode: async ({ code }: { code: string }) => { sentCode = code; if (fail) throw new AuthCodeDeliveryError("provider private body"); return "email" as const; }, sendWebSignInCode: async () => "email" as const };
  const user = { id: identity.userId, email: identity.email, orgId: identity.orgId } as any;
  try {
    await assert.rejects(deliverVerificationChallenge({ store, delivery, user, purpose: identity.purpose, experience: "mobile" }),
      (error: Error) => error.message.includes("could not be delivered") && !error.message.includes("private"));
    assert.equal(await store.verify(identity, sentCode), "invalid"); assert.equal(await store.issue(identity), null);
    for (let i = 0; i < 6; i++) {
      now += 60_001;
      await assert.rejects(deliverVerificationChallenge({ store, delivery, user, purpose: identity.purpose, experience: "mobile" }));
    }
    now += 60_001; fail = false;
    await deliverVerificationChallenge({ store, delivery, user, purpose: identity.purpose, experience: "mobile" });
    assert.equal(await store.verify(identity, sentCode), "ok");
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
test("authentication store rejects missing/placeholder secrets and missing PostgreSQL connection", () => {
  const params = { provider: "file" as const, dbPath: "unused.json", databaseUrl: null, pgPoolMax: 1, pgConnectTimeoutMs: 1, pgIdleTimeoutMs: 1 };
  for (const secret of ["", "short", "replace_me_for_production_________________"]) assert.throws(() => new AuthVerificationStore({ ...params, secret }), /WEB_AUTH_TOKEN_SECRET/);
  assert.throws(() => new AuthVerificationStore({ ...params, provider: "postgres", secret }), /DATABASE_URL/);
});

test("database delivery-confirmation failure never refunds an email that was successfully sent", async () => {
  const confirmations: boolean[] = [];
  const store = {
    issue: async () => ({ id: "reservation", code: "123456", expiresAt: new Date().toISOString() }),
    finishDelivery: async (_identity: unknown, _id: string, delivered: boolean) => {
      confirmations.push(delivered); throw new Error("controlled database confirmation failure");
    },
  } as unknown as AuthVerificationStore;
  const delivery = { sendEmailVerificationCode: async () => "email" as const, sendWebSignInCode: async () => "email" as const };
  await assert.rejects(deliverVerificationChallenge({ store, delivery, user: { id: identity.userId, email: identity.email, orgId: identity.orgId } as any, purpose: identity.purpose, experience: "mobile" }), /confirmation failure/);
  assert.deepEqual(confirmations, [true]);
});
