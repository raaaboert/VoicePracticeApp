import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { UserProfile } from "@voicepractice/shared";
import type { StorageProvider } from "../runtimeConfig.js";
import { normalizeEmailForExactMatch, timingSafeEqualText } from "../services/emailVerification.js";
import { canVerifyCurrentIdentity, verificationAuthorityMaterial, type VerificationAuthorityState } from "../services/authChallengeAuthority.js";

const WINDOW = 15 * 60_000;
const COOLDOWN = 60_000;
const RETENTION = 24 * 60 * 60_000;
export type VerificationPurpose = "sign_in" | "email_verification";
export interface VerificationIdentity { email: string; userId: string; orgId: string | null; purpose: VerificationPurpose; authorityBinding?: string }
interface Issuance { id: string; at: number; authorityBinding?: string }
export interface VerificationLockoutEvent { challengeId: string; purpose: VerificationPurpose; lockedUntil: string }
interface Account { failures: number[]; issuances: Issuance[]; lockedUntil: number | null; nextIssueAt: number | null; updatedAt: number }
interface Challenge {
  id: string; userId: string; orgId: string | null; purpose: VerificationPurpose; codeHash: string;
  createdAt: number; expiresAt: number; failedAttempts: number;
  deliveredAt: number | null; consumedAt: number | null; invalidatedAt: number | null;
}
interface State { account: Account; challenges: Challenge[] }
export class AuthCodeRequestLimitError extends Error {
  constructor() { super("Please wait before requesting another code."); this.name = "AuthCodeRequestLimitError"; }
}
interface Params {
  provider: StorageProvider; dbPath: string; databaseUrl: string | null; secret: string;
  pgPoolMax: number; pgConnectTimeoutMs: number; pgIdleTimeoutMs: number;
  /** Test-only clock injection. HTTP requests never supply timestamps. PG uses its own clock. */
  clock?: () => number;
  onLockout?: (event: VerificationLockoutEvent) => void;
  normalizeAuthorityState?: (raw: unknown) => VerificationAuthorityState;
}
const fileQueues = new Map<string, Promise<unknown>>();
const emptyAccount = (now: number): Account => ({ failures: [], issuances: [], lockedUntil: null, nextIssueAt: null, updatedAt: now });
const millis = (v: unknown): number | null => v == null ? null : new Date(v as string).getTime();
const iso = (v: number | null) => v == null ? null : new Date(v).toISOString();

/** PostgreSQL is authoritative across instances; file backend is local-development only. */
export class AuthVerificationStore {
  private readonly pool: Pool | null;
  private readonly filePath: string;
  constructor(private readonly params: Params) {
    if (params.secret.trim().length < 32 || /replace_me|changeme/i.test(params.secret)) {
      throw new Error("WEB_AUTH_TOKEN_SECRET must be a stable, strong secret of at least 32 characters.");
    }
    if (params.provider === "postgres" && !params.databaseUrl) throw new Error("Authentication requires DATABASE_URL.");
    this.pool = params.provider === "postgres" ? new Pool({ connectionString: params.databaseUrl!, max: params.pgPoolMax,
      connectionTimeoutMillis: params.pgConnectTimeoutMs, idleTimeoutMillis: params.pgIdleTimeoutMs }) : null;
    const parsed = path.parse(params.dbPath);
    this.filePath = path.join(parsed.dir, `${parsed.name}.auth-verification.json`);
  }
  accountKey(email: string): string {
    // Same trim/lowercase identity model as onboarding and dashboard login; no provider-specific canonicalization.
    return crypto.createHmac("sha256", this.params.secret).update(JSON.stringify(["peritio.auth.account.v1", normalizeEmailForExactMatch(email)])).digest("hex");
  }
  bindIdentity(db: VerificationAuthorityState, user: UserProfile, purpose: VerificationPurpose): VerificationIdentity {
    const authorityBinding = crypto.createHmac("sha256", this.params.secret)
      .update(JSON.stringify(["peritio.auth.authority.v1", verificationAuthorityMaterial(db, user)])).digest("hex");
    return { userId: user.id, email: user.email, orgId: user.orgId, purpose, authorityBinding };
  }
  private async identityIsCurrent(identity: VerificationIdentity | undefined, client?: Pick<PoolClient, "query">): Promise<boolean> {
    if (!identity?.authorityBinding) return true; // Standalone store tests; all HTTP paths supply a binding.
    const raw: VerificationAuthorityState | undefined = client
      ? (await client.query("SELECT state_json FROM app_state WHERE id='primary'")).rows[0]?.state_json
      : JSON.parse(await fs.readFile(this.params.dbPath, "utf8"));
    // Use the API's existing canonical projection on both sides of the binding.
    const db = raw && this.params.normalizeAuthorityState ? this.params.normalizeAuthorityState(raw) : raw;
    const user = db?.users?.find((user) => user.id === identity.userId);
    return Boolean(db && user && canVerifyCurrentIdentity(db, user)
      && normalizeEmailForExactMatch(user.email) === normalizeEmailForExactMatch(identity.email) && user.orgId === identity.orgId
      && timingSafeEqualText(this.bindIdentity(db, user, identity.purpose).authorityBinding!, identity.authorityBinding));
  }
  private codeHash(identity: VerificationIdentity, id: string, code: string): string {
    return crypto.createHmac("sha256", this.params.secret).update(JSON.stringify([
      "peritio.auth.challenge.v1", this.accountKey(identity.email), identity.userId, identity.orgId, identity.purpose, id, code,
    ])).digest("hex");
  }
  async initialize(): Promise<void> {
    if (!this.pool) { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); return; }
    // Deliberately no automatic DDL or fallback: operator must apply migration 024 before deployment.
    await this.pool.query(`SELECT account_key, failure_times, issuances, locked_until, next_issue_at, updated_at FROM auth_verification_accounts LIMIT 0`);
    await this.pool.query(`SELECT id, account_key, user_id, org_id, purpose, code_hash, created_at, expires_at,
      failed_attempts, delivered_at, consumed_at, invalidated_at FROM auth_verification_challenges LIMIT 0`);
  }
  private async fileTransaction<T>(work: (all: Record<string, State>, now: number) => T | Promise<T>): Promise<T> {
    const previous = fileQueues.get(this.filePath) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      await this.initialize();
      let all: Record<string, State>;
      try { all = JSON.parse(await fs.readFile(this.filePath, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; all = {}; }
      const result = await work(all, this.params.clock?.() ?? Date.now());
      const temp = this.filePath + "." + crypto.randomUUID() + ".tmp";
      await fs.writeFile(temp, JSON.stringify(all), { mode: 0o600 });
      await fs.rename(temp, this.filePath);
      return result;
    });
    fileQueues.set(this.filePath, pending);
    try { return await pending; } finally { if (fileQueues.get(this.filePath) === pending) fileQueues.delete(this.filePath); }
  }
  private async transact<T>(key: string, work: (state: State, now: number, authorized: boolean) => T, identity?: VerificationIdentity): Promise<T> {
    if (!this.pool) return this.fileTransaction(async (all, now) => {
      const state = all[key] ?? { account: emptyAccount(now), challenges: [] };
      const result = work(state, now, await this.identityIsCurrent(identity));
      all[key] = state;
      return result;
    });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // One statement creates or locks the row. Cleanup cannot delete it between INSERT and SELECT.
      const row = (await client.query(`INSERT INTO auth_verification_accounts(account_key) VALUES ($1)
        ON CONFLICT (account_key) DO UPDATE SET account_key=EXCLUDED.account_key RETURNING *`, [key])).rows[0];
      const now = this.params.clock?.() ?? millis((await client.query("SELECT clock_timestamp() AS now")).rows[0].now)!;
      // Matches the partial scope index; never load consumed/invalidated history for ordinary auth attempts.
      const rows = (await client.query(`SELECT * FROM auth_verification_challenges WHERE account_key=$1
        AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY created_at, id`, [key])).rows;
      const state: State = { account: { failures: row.failure_times, issuances: row.issuances,
        lockedUntil: millis(row.locked_until), nextIssueAt: millis(row.next_issue_at), updatedAt: millis(row.updated_at)! },
        challenges: rows.map((c) => ({ id: c.id, userId: c.user_id, orgId: c.org_id, purpose: c.purpose, codeHash: c.code_hash,
          createdAt: millis(c.created_at)!, expiresAt: millis(c.expires_at)!, failedAttempts: c.failed_attempts,
          deliveredAt: millis(c.delivered_at), consumedAt: millis(c.consumed_at), invalidatedAt: millis(c.invalidated_at) })) };
      const oldRecords = new Map(state.challenges.map((c) => [c.id, JSON.stringify(c)]));
      const result = work(state, now, await this.identityIsCurrent(identity, client));
      // Invalidate replacements before inserting a new pending row (partial unique index).
      for (const c of state.challenges.filter((c) => oldRecords.has(c.id) && oldRecords.get(c.id) !== JSON.stringify(c))) {
        await client.query(`UPDATE auth_verification_challenges SET failed_attempts=$2, delivered_at=$3, consumed_at=$4, invalidated_at=$5 WHERE id=$1`,
          [c.id, c.failedAttempts, iso(c.deliveredAt), iso(c.consumedAt), iso(c.invalidatedAt)]);
      }
      for (const c of state.challenges.filter((c) => !oldRecords.has(c.id))) {
        await client.query(`INSERT INTO auth_verification_challenges
          (id, account_key, user_id, org_id, purpose, code_hash, created_at, expires_at, failed_attempts, delivered_at, consumed_at, invalidated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [c.id, key, c.userId, c.orgId, c.purpose, c.codeHash, iso(c.createdAt), iso(c.expiresAt), c.failedAttempts, iso(c.deliveredAt), iso(c.consumedAt), iso(c.invalidatedAt)]);
      }
      await client.query(`UPDATE auth_verification_accounts SET failure_times=$2::jsonb, issuances=$3::jsonb,
        locked_until=$4, next_issue_at=$5, updated_at=$6 WHERE account_key=$1`,
        [key, JSON.stringify(state.account.failures), JSON.stringify(state.account.issuances), iso(state.account.lockedUntil), iso(state.account.nextIssueAt), iso(now)]);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  private prune(account: Account, now: number): void {
    account.failures = account.failures.filter((at) => at > now - WINDOW);
    account.issuances = account.issuances.filter((i) => i.at > now - WINDOW);
    if (account.lockedUntil !== null && account.lockedUntil <= now) account.lockedUntil = null;
    account.updatedAt = now;
  }
  async issue(identity: VerificationIdentity): Promise<{ id: string; code: string; expiresAt: string } | null> {
    return this.transact(this.accountKey(identity.email), (state, now, authorized) => {
      const a = state.account; this.prune(a, now);
      if (!authorized || a.lockedUntil || (a.nextIssueAt ?? 0) > now || a.issuances.length >= 5) return null;
      for (const c of state.challenges) {
        const sameScope = c.userId === identity.userId && c.orgId === identity.orgId && c.purpose === identity.purpose;
        if ((sameScope || c.expiresAt <= now) && !c.consumedAt && !c.invalidatedAt) c.invalidatedAt = now;
      }
      const id = crypto.randomUUID();
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      state.challenges.push({ id, userId: identity.userId, orgId: identity.orgId, purpose: identity.purpose,
        codeHash: this.codeHash(identity, id, code), createdAt: now, expiresAt: now + WINDOW,
        failedAttempts: 0, deliveredAt: null, consumedAt: null, invalidatedAt: null });
      a.nextIssueAt = now + COOLDOWN;
      a.issuances.push({ id, at: now, ...(identity.authorityBinding ? { authorityBinding: identity.authorityBinding } : {}) });
      return { id, code, expiresAt: new Date(now + WINDOW).toISOString() };
    }, identity);
  }
  async finishDelivery(identity: VerificationIdentity, id: string, delivered: boolean, refundIssuance = true): Promise<void> {
    await this.transact(this.accountKey(identity.email), (state, now, authorized) => {
      this.prune(state.account, now);
      const c = state.challenges.find((c) => c.id === id);
      if (!delivered && refundIssuance) state.account.issuances = state.account.issuances.filter((i) => i.id !== id);
      if (!c) return;
      if (!delivered) {
        c.invalidatedAt ??= now;
        // Refund only this failed reservation, never later requests or verification failures.
      } else if (!authorized) c.invalidatedAt ??= now;
      else if (!c.invalidatedAt && !c.consumedAt && c.expiresAt > now) c.deliveredAt = now;
    }, identity);
  }
  async verify(identity: VerificationIdentity, code: string, reviewerCode?: string | null): Promise<"ok" | "invalid"> {
    let lockout: VerificationLockoutEvent | undefined;
    const result = await this.transact(this.accountKey(identity.email), (state, now, authorized) => {
      const a = state.account; this.prune(a, now);
      if (a.lockedUntil) return "invalid";
      const c = state.challenges.find((c) => c.userId === identity.userId && c.orgId === identity.orgId && c.purpose === identity.purpose && !c.invalidatedAt && !c.consumedAt);
      const bound = !identity.authorityBinding || a.issuances.some((i) => i.id === c?.id && i.authorityBinding === identity.authorityBinding);
      const eligible = authorized && bound && c && c.deliveredAt !== null && c.expiresAt > now && c.failedAttempts < 5;
      const matches = c ? timingSafeEqualText(c.codeHash, this.codeHash(identity, c.id, code)) : false;
      const reviewerMatches = reviewerCode ? timingSafeEqualText(reviewerCode, code) : false;
      if (eligible && (matches || reviewerMatches)) { c.consumedAt = now; a.failures = []; return "ok"; }
      if (c && c.expiresAt <= now) c.invalidatedAt ??= now;
      if (!eligible) return "invalid" as const;
      if (++c.failedAttempts >= 5) c.invalidatedAt = now;
      a.failures.push(now);
      if (a.failures.length >= 10) {
        a.failures = a.failures.slice(-10); a.lockedUntil = now + WINDOW;
        lockout = { challengeId: c.id, purpose: c.purpose, lockedUntil: new Date(a.lockedUntil).toISOString() };
      }
      return "invalid" as const;
    }, identity);
    if (lockout) { try { this.params.onLockout?.(lockout); } catch { /* Logging must not change a committed auth outcome. */ } }
    return result;
  }
  async invalidateUsers(userIds: string[], transactionClient?: Pick<PoolClient, "query"> | null): Promise<void> {
    if (!userIds.length) return;
    if (!this.pool) {
      await this.fileTransaction((all, now) => {
        for (const state of Object.values(all)) for (const c of state.challenges) {
          if (userIds.includes(c.userId) && c.consumedAt === null && c.invalidatedAt === null) c.invalidatedAt = now;
        }
      });
      return;
    }
    const client = transactionClient ?? await this.pool.connect();
    try {
      if (!transactionClient) await client.query("BEGIN");
      await client.query(`SELECT a.account_key FROM auth_verification_accounts a WHERE EXISTS (
        SELECT 1 FROM auth_verification_challenges c WHERE c.account_key=a.account_key AND c.user_id=ANY($1::text[])
        AND c.consumed_at IS NULL AND c.invalidated_at IS NULL) ORDER BY a.account_key FOR UPDATE OF a`, [userIds]);
      await client.query(`UPDATE auth_verification_challenges SET invalidated_at=clock_timestamp()
        WHERE user_id=ANY($1::text[]) AND consumed_at IS NULL AND invalidated_at IS NULL`, [userIds]);
      if (!transactionClient) await client.query("COMMIT");
    } catch (error) { if (!transactionClient) await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { if (!transactionClient) (client as PoolClient).release(); }
  }
  async purgeExpired(): Promise<void> {
    if (this.pool) {
      // Cleanup uses the same account-row lock order. Do not race consumption or remove live locks.
      await this.pool.query(`DELETE FROM auth_verification_accounts WHERE updated_at < clock_timestamp() - INTERVAL '24 hours'
        AND (locked_until IS NULL OR locked_until < clock_timestamp())`);
      await this.pool.query("DELETE FROM auth_verification_challenges WHERE expires_at < clock_timestamp() - INTERVAL '24 hours'");
    } else {
      // Serialized with all file operations; never touch app_state.
      await this.fileTransaction((all, now) => {
        for (const [key, state] of Object.entries(all)) {
          if (state.account.updatedAt < now - RETENTION && (state.account.lockedUntil ?? 0) <= now) delete all[key];
          else state.challenges = state.challenges.filter((c) => c.expiresAt > now - RETENTION);
        }
      });
    }
  }
  async close(): Promise<void> { await this.pool?.end(); }
}
