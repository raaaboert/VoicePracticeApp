import assert from "node:assert/strict";
import test from "node:test";
import { AuthVerificationStore, type VerificationIdentity } from "./authVerificationStore.js";
import { createLocalAuthDatabase } from "./authVerificationTestDatabase.js";
import { deliverVerificationChallenge } from "../services/authVerification.js";
import { AuthCodeDeliveryError } from "../services/authCodeDelivery.js";

const url = process.env.AUTH_VERIFICATION_INTEGRATION_DATABASE_URL?.trim() || process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
test("PostgreSQL authentication migration, rolling limits and cross-instance concurrency", { skip: !url }, async (t) => {
  const db = await createLocalAuthDatabase(url!);
  let now = Date.now();
  const params = { provider: "postgres" as const, dbPath: "unused.json", databaseUrl: db.url, secret: "auth_integration_secret_of_at_least_32_chars",
    pgPoolMax: 4, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100, clock: () => now };
  const lockouts: unknown[] = [];
  const a = new AuthVerificationStore({ ...params, onLockout: (event) => lockouts.push(event) });
  const b = new AuthVerificationStore({ ...params, onLockout: (event) => lockouts.push(event) });
  const who = (tag: string): VerificationIdentity => ({ email: `${tag}@auth.test`, userId: tag, orgId: "org_a", purpose: "email_verification" });
  const send = async (identity: VerificationIdentity) => { const c = (await a.issue(identity))!; assert.ok(c); await a.finishDelivery(identity, c.id, true); return c; };
  const wrong = (code: string) => code === "999999" ? "999998" : "999999";
  try {
    await t.test("missing schema fails closed; fresh migration and repeated initialization succeed", async () => {
      await assert.rejects(a.initialize(), /auth_verification_accounts/);
      await db.migrate(); await a.initialize(); await db.migrate(); await b.initialize();
    });
    await t.test("valid code concurrently succeeds once across independent instances and cannot replay", async () => {
      const id = who("consume"), c = await send(id);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).verify(id, c.code)));
      assert.equal(results.filter((r) => r === "ok").length, 1);
      assert.equal(await b.verify(id, c.code), "invalid");
      const record = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE id=$1", [c.id])).rows[0];
      assert.ok(record.consumed_at); assert.equal(record.failed_attempts, 0);
      assert.notEqual(record.code_hash, c.code); assert.equal(JSON.stringify(record).includes(id.email), false);
    });
    await t.test("missing, undelivered, consumed, invalidated and expired challenges never accumulate lockout failures", async () => {
      const id = who("no_live");
      const assertNoFailures = async () => {
        const row = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [a.accountKey(id.email)])).rows[0];
        assert.deepEqual(row.failure_times, []); assert.equal(row.locked_until, null);
      };
      for (let i = 0; i < 10; i++) assert.equal(await (i % 2 ? a : b).verify(id, "999999"), "invalid");
      await assertNoFailures();
      const undelivered = (await a.issue(id))!;
      for (let i = 0; i < 10; i++) assert.equal(await b.verify(id, undelivered.code), "invalid");
      await assertNoFailures(); await a.finishDelivery(id, undelivered.id, true);
      assert.equal(await a.verify(id, undelivered.code), "ok");
      for (let i = 0; i < 10; i++) assert.equal(await b.verify(id, undelivered.code), "invalid");
      await assertNoFailures(); now += 60_001;
      const invalidated = await send(id); await a.invalidateUsers([id.userId]);
      for (let i = 0; i < 10; i++) assert.equal(await b.verify(id, invalidated.code), "invalid");
      await assertNoFailures(); now += 60_001;
      const expired = await send(id); now += 15 * 60_000;
      for (let i = 0; i < 10; i++) assert.equal(await b.verify(id, expired.code), "invalid");
      await assertNoFailures();
    });
    await t.test("four wrong guesses still permit the correct code once before the fifth-failure boundary", async () => {
      const id = who("before_lock"), c = await send(id);
      for (let i = 0; i < 4; i++) assert.equal(await a.verify(id, wrong(c.code)), "invalid");
      assert.equal(await b.verify(id, c.code), "ok"); assert.equal(await a.verify(id, c.code), "invalid");
    });
    await t.test("production store timestamps come from PostgreSQL, with a fixed fifteen-minute lifetime", async () => {
      const live = new AuthVerificationStore({ ...params, clock: undefined });
      try {
        const before = (await db.pool.query("SELECT clock_timestamp() AS now")).rows[0].now;
        const c = (await live.issue(who("db_clock")))!; assert.ok(c);
        const after = (await db.pool.query("SELECT clock_timestamp() AS now")).rows[0].now;
        const row = (await db.pool.query("SELECT created_at, expires_at FROM auth_verification_challenges WHERE id=$1", [c.id])).rows[0];
        assert.ok(row.created_at.getTime() >= before.getTime() && row.created_at.getTime() <= after.getTime());
        assert.equal(row.expires_at.getTime() - row.created_at.getTime(), 15 * 60_000);
      } finally { await live.close(); }
    });
    await t.test("five concurrent incorrect guesses invalidate challenge and cap counter at five", async () => {
      const id = who("guesses"), c = await send(id);
      const results = await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? a : b).verify(id, wrong(c.code))));
      assert.ok(results.every((r) => r === "invalid"));
      const r = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE id=$1", [c.id])).rows[0];
      assert.equal(r.failed_attempts, 5); assert.ok(r.invalidated_at); assert.equal(await a.verify(id, c.code), "invalid");
    });
    await t.test("concurrent first issuance shares one account state and respects cooldown", async () => {
      const id = who("first");
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).issue(id)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM auth_verification_accounts WHERE account_key=$1", [a.accountKey(id.email)])).rows[0].n, 1);
    });
    await t.test("replacement invalidates old challenge and consumption cannot reactivate it", async () => {
      const id = who("replace"), first = await send(id); now += 60_001; const next = await send(id);
      const rows = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE account_key=$1 ORDER BY created_at", [a.accountKey(id.email)])).rows;
      assert.ok(rows[0].invalidated_at);
      if (first.code !== next.code) assert.equal(await a.verify(id, first.code), "invalid");
      assert.equal(await b.verify(id, next.code), "ok"); assert.equal(await a.verify(id, first.code), "invalid");
    });
    await t.test("replacement preserves rolling failures; ten lock for fifteen minutes without extension; login recovers", async () => {
      const id = who("rolling"), first = await send(id);
      for (let i = 0; i < 5; i++) assert.equal(await a.verify(id, wrong(first.code)), "invalid");
      now += 60_001; const signIn = { ...id }, next = await send(signIn);
      for (let i = 0; i < 5; i++) assert.equal(await b.verify(signIn, wrong(next.code)), "invalid");
      const key = a.accountKey(id.email);
      const locked = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [key])).rows[0];
      assert.equal(new Date(locked.locked_until).getTime(), now + 15 * 60_000);
      for (let i = 0; i < 3; i++) { now += 60_000; assert.equal(await a.issue(id), null); assert.equal(await b.verify(signIn, next.code), "invalid"); }
      const after = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [key])).rows[0];
      assert.equal(new Date(after.locked_until).getTime(), new Date(locked.locked_until).getTime());
      assert.equal(lockouts.length, 1);
      const log = JSON.stringify(lockouts[0]);
      assert.ok(!log.includes(id.email) && !log.includes(key));
      assert.ok(Object.values(lockouts[0] as object).every((value) => value !== next.code));
      assert.deepEqual(Object.keys(lockouts[0] as object).sort(), ["challengeId", "lockedUntil", "purpose"]);
      now = new Date(locked.locked_until).getTime(); const recovered = await send(id);
      assert.equal(await b.verify(id, recovered.code), "ok");
      assert.deepEqual((await db.pool.query("SELECT failure_times FROM auth_verification_accounts WHERE account_key=$1", [key])).rows[0].failure_times, []);
    });
    await t.test("five rolling issuances, shared cooldown and fifteen-minute expiry", async () => {
      const id = who("issuance"), first = await send(id);
      assert.equal(await a.issue({ ...id, purpose: "sign_in" }), null);
      for (let i = 0; i < 4; i++) { now += 60_001; await send(id); }
      now += 60_001; assert.equal(await b.issue(id), null);
      now += 15 * 60_000; assert.equal(await a.verify(id, first.code), "invalid");
      const next = await send(id); now += 15 * 60_000; assert.equal(await b.verify(id, next.code), "invalid");
    });
    await t.test("wrong account, user, organization and purpose never authenticate", async () => {
      const id = who("bindings"), c = await send(id);
      for (const patch of [{ email: "other@auth.test" }, { userId: "other" }, { orgId: "org_b" }, { purpose: "sign_in" as const }]) assert.equal(await b.verify({ ...id, ...patch }, c.code), "invalid");
      assert.equal(await a.verify(id, c.code), "ok");
    });
    await t.test("replacement racing consumption has serial outcome and one pending challenge", async () => {
      const id = who("race"), first = await send(id); now += 60_001;
      const [replacement, consumed] = await Promise.all([a.issue(id), b.verify(id, first.code)]);
      assert.ok(replacement); assert.ok(["ok", "invalid"].includes(consumed));
      const rows = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE account_key=$1", [a.accountKey(id.email)])).rows;
      assert.equal(rows.filter((r) => !r.invalidated_at && !r.consumed_at).length, 1);
      assert.ok(rows.find((r) => r.id === first.id).invalidated_at || rows.find((r) => r.id === first.id).consumed_at);
    });
    await t.test("delivery holds no transaction; delayed failure cannot invalidate or refund a later code", async () => {
      const id = who("delivery");
      let began!: () => void, fail!: (error: Error) => void;
      const started = new Promise<void>((resolve) => { began = resolve; });
      const deliveryResult = new Promise<never>((_resolve, reject) => { fail = reject; });
      const delivery = { sendEmailVerificationCode: async () => { began(); return deliveryResult; }, sendWebSignInCode: async () => "email" as const };
      const pending = deliverVerificationChallenge({ store: a, delivery, user: { id: id.userId, email: id.email, orgId: id.orgId } as any, purpose: id.purpose, experience: "mobile" });
      const failed = assert.rejects(pending, /could not be delivered/);
      await started;
      now += 60_001;
      const next = (await b.issue(id))!; assert.ok(next); await b.finishDelivery(id, next.id, true);
      fail(new AuthCodeDeliveryError("private provider response")); await failed;
      const state = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [a.accountKey(id.email)])).rows[0];
      assert.deepEqual(state.issuances.map((i: { id: string }) => i.id), [next.id]);
      assert.equal(await a.issue(id), null);
      assert.equal(await a.verify(id, next.code), "ok");
    });
    await t.test("cleanup racing atomic account creation and verification across stores preserves live counters", { timeout: 10_000 }, async () => {
      const id = who("cleanup_race");
      await a.verify(id, "999999");
      for (let i = 0; i < 20; i++) {
        await db.pool.query("UPDATE auth_verification_accounts SET updated_at=clock_timestamp()-INTERVAL '25 hours' WHERE account_key=$1", [a.accountKey(id.email)]);
        await Promise.all([a.verify(id, "999999"), b.purgeExpired()]);
      }
      const c = await send(id);
      const results = await Promise.all([...Array.from({ length: 4 }, () => b.verify(id, wrong(c.code))), a.purgeExpired()]);
      assert.equal(results.filter((r) => r === "invalid").length, 4);
      const row = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [a.accountKey(id.email)])).rows[0];
      assert.equal(row.failure_times.length, 4);
      assert.equal(await a.verify(id, c.code), "ok");
    });
    await t.test("repeated cleanup removes stale accounts while retaining current challenges", async () => {
      const id = who("cleanup"), c = await send(id);
      await db.pool.query("UPDATE auth_verification_accounts SET updated_at=clock_timestamp()-INTERVAL '25 hours' WHERE account_key=$1", [a.accountKey(id.email)]);
      await a.purgeExpired(); await b.purgeExpired();
      assert.equal((await db.pool.query("SELECT id FROM auth_verification_challenges WHERE id=$1", [c.id])).rows.length, 0);
      assert.ok((await db.pool.query("SELECT count(*)::int AS n FROM auth_verification_challenges")).rows[0].n > 0);
    });
  } finally { await a.close(); await b.close(); await db.close(); }
});
