import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test, { type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import {
  backupPrefix, checkIndependentPostgresBackup, createIndependentBackupStorage, createRenderBackupSource,
  loadPostgresBackupConfig, runIndependentPostgresBackup, validateBackupManifest,
  type BackupManifest, type IndependentBackupStorage, type PostgresBackupConfig, type RenderBackupSource,
} from "./postgresBackup.js";
import { assertScratchRestoreTarget, backupKeyId, byteLimit, DAY_MS, decryptBackup, digestArchive, encryptBackup, postgresBackupFailureCode, postgresProviderFailure,
  PostgresBackupError, privateBackupDirectory, readBackupHeader, removeBackupDirectory, validateRenderArchive } from "./postgresBackupArchive.js";

const KEY = generateKeyPairSync("rsa", { modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const NOW = new Date("2026-11-03T08:00:00.000Z");
const TARGET = "postgresql://localhost:55432/peritio_restore_a22";
const ENV: NodeJS.ProcessEnv = { PERITIO_ENV: "staging", PG_BACKUP_RENDER_POSTGRES_ID: "dpg-c1234567890123456789-a",
  PG_BACKUP_RENDER_OWNER_ID: "tea-c1234567890123456789", PG_BACKUP_R2_BUCKET: "peritio-postgres-backups-staging",
  PG_BACKUP_R2_ACCOUNT_ID: "a".repeat(32), PG_BACKUP_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  PG_BACKUP_R2_ACCESS_KEY_ID: "synthetic-only", PG_BACKUP_R2_SECRET_ACCESS_KEY: "synthetic-only",
  PG_BACKUP_RENDER_API_KEY: "synthetic-render-token", PG_BACKUP_DOWNLOAD_HOSTS: "exports.example.com" };
function fixtureArchive(): Buffer {
  const contents = Buffer.from("PGDMP synthetic fixture; not a database dump");
  const header = Buffer.alloc(512);
  header.write("synthetic.dir/toc.dat");
  for (const [offset, size, value] of [[100, 8, 384], [108, 8, 0], [116, 8, 0], [124, 12, contents.length], [136, 12, 0]] as const)
    header.write(value.toString(8).padStart(size - 1, "0") + "\0", offset);
  header.fill(32, 148, 156); header[156] = 48;
  header.write("ustar\0", 257); header.write("00", 263);
  header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(Buffer.concat([header, contents, Buffer.alloc(512 - contents.length), Buffer.alloc(1024)]));
}
class MemoryStorage implements IndependentBackupStorage {
  objects = new Map<string, { body: Buffer; sha256: string | null }>();
  failManifest = false;
  failUploadAfterCommit = false;
  corruptReadback = false;
  async head(key: string) { const object = this.objects.get(key); return object ? { bytes: object.body.length, sha256: object.sha256 } : null; }
  async download(key: string, file: string, maximum: number) {
    const object = this.objects.get(key); assert.ok(object); assert.ok(object.body.length <= maximum);
    const body = Buffer.from(object.body);
    if (this.corruptReadback && key.endsWith("archive.pgbak")) body[body.length - 1]! ^= 1;
    await writeFile(file, body, { flag: "wx", mode: 0o600 });
  }
  async putFile(key: string, file: string, digest: { sha256: string }) {
    const body = await readFile(file);
    // R2 evaluates If-None-Match atomically at commit, after reading the body.
    if (!this.objects.has(key)) this.objects.set(key, { body, sha256: digest.sha256 });
    if (this.failUploadAfterCommit) { this.failUploadAfterCommit = false; throw Error("synthetic interrupted upload"); }
  }
  async putManifest(key: string, manifest: BackupManifest) {
    if (this.failManifest) { this.failManifest = false; throw Error("synthetic manifest interruption"); }
    if (!this.objects.has(key)) this.objects.set(key, { body: Buffer.from(JSON.stringify(manifest)), sha256: null });
  }
  async manifests(prefix: string) { return [...this.objects.keys()].filter(key => key.startsWith(prefix) && key.endsWith("complete.json")); }
}
async function harness(t: TestContext, overrides: NodeJS.ProcessEnv = {}) {
  const directory = await privateBackupDirectory(); t.after(() => removeBackupDirectory(directory));
  const publicFile = path.join(directory, "public.pem"); await writeFile(publicFile, KEY.publicKey);
  const config = loadPostgresBackupConfig("staging", { ...ENV, ...overrides, PG_BACKUP_PUBLIC_KEY_FILE: publicFile });
  const storage = new MemoryStorage(); let posts = 0, downloads = 0;
  let identityValid = true, downloadFails = false, ready = true;
  const source: RenderBackupSource = {
    async identity() { return { id: config.postgresId, ownerId: config.renderOwnerId, name: "voicepractice_db",
      databaseName: identityValid ? "voicepractice_db" : "peritio_db_prod", version: "17", available: true }; },
    async exports() { return posts ? [{ id: "export-synthetic", createdAt: NOW.toISOString(), ...(ready ? { url: "https://exports.example.com/synthetic" } : {}) }] : []; },
    async create() { posts++; },
    async download(_url, file) { downloads++; await writeFile(file, fixtureArchive(), { flag: "wx", mode: 0o600 });
      if (downloadFails) throw Error("synthetic download interrupted"); },
  };
  const run = () => runIndependentPostgresBackup(config, { storage, source, now: () => NOW, wait: async () => {} });
  const manifestKey = `${backupPrefix(config)}2026-11-03/complete.json`;
  const manifest = () => JSON.parse(storage.objects.get(manifestKey)!.body.toString()) as BackupManifest;
  return { directory, config, storage, source, run, manifestKey, manifest,
    posts: () => posts, downloads: () => downloads, invalidIdentity() { identityValid = false; },
    interruptDownload() { downloadFails = true; }, notReady() { ready = false; } };
}

test("staging-only config rejects production, mixed buckets, endpoints and invalid retention", () => {
  assert.equal(loadPostgresBackupConfig("staging", ENV).bucket, "peritio-postgres-backups-staging");
  for (const changes of [{ PERITIO_ENV: "production" }, { PG_BACKUP_R2_BUCKET: "peritio-postgres-backups-production" },
    { PG_BACKUP_R2_BUCKET: "peritio-postgres-backup-staging" },
    { PG_BACKUP_R2_ENDPOINT: "https://example.com" }, { PG_BACKUP_DOWNLOAD_HOSTS: "127.0.0.1" },
    { PG_BACKUP_RETENTION_DAYS: "0" }, { PG_BACKUP_RETENTION_DAYS: "91" }])
    assert.throws(() => loadPostgresBackupConfig("staging", { ...ENV, ...changes }));
  assert.throws(() => loadPostgresBackupConfig("production", ENV));
});
test("freshness configuration preserves the default and accepts 144 hours only within staging guards", () => {
  assert.equal(loadPostgresBackupConfig("staging", ENV).maxAgeHours, 36);
  for (const hours of [25, 72, 120, 144])
    assert.equal(loadPostgresBackupConfig("staging", { ...ENV, PG_BACKUP_MAX_AGE_HOURS: String(hours) }).maxAgeHours, hours);
  for (const value of ["", "-1", "0", "24", "145", "144.5", "NaN", "Infinity"])
    assert.throws(() => loadPostgresBackupConfig("staging", { ...ENV, PG_BACKUP_MAX_AGE_HOURS: value }), /invalid_backup_limit/);
  const extended = { ...ENV, PG_BACKUP_MAX_AGE_HOURS: "144" };
  assert.throws(() => loadPostgresBackupConfig("production", extended), /staging_backup_target_required/);
  assert.throws(() => loadPostgresBackupConfig("staging", { ...extended, PERITIO_ENV: "production" }), /staging_backup_target_required/);
});

test("actual configuration loader accepts Render base, primary and replica ID formats", () => {
  for (const id of ["dpg-12345678901234567890", "dpg-c1234567890123456789-a", "dpg-12345678901234567890-bd"])
    assert.equal(loadPostgresBackupConfig("staging", { ...ENV, PG_BACKUP_RENDER_POSTGRES_ID: id }).postgresId, id);
});
test("actual configuration loader rejects malformed, empty, unrelated and URL-like Render IDs", () => {
  for (const id of ["", "dpg-", "dpg-short-a", "dpg-123456789012345678901-a", "dpg-12345678901234567890-",
    "dpg-12345678901234567890-1", "dpg-12345678901234567890-A", "dpg-12345678901234567890-a-b",
    "xdpg-12345678901234567890-a", "srv-12345678901234567890", "dpg-12345678901234567890-a/../other",
    "https://example.com/dpg-12345678901234567890-a"])
    assert.throws(() => loadPostgresBackupConfig("staging", { ...ENV, PG_BACKUP_RENDER_POSTGRES_ID: id }));
});
test("successful whole-export archive encrypts, reads back, completes last and retries without another export", async t => {
  const h = await harness(t); const result = await h.run();
  assert.equal(result.outcome, "archived"); assert.equal(h.posts(), 1); assert.equal(h.downloads(), 1);
  assert.equal((await h.run()).outcome, "already_complete"); assert.equal(h.posts(), 1); assert.equal(h.downloads(), 1);
  assert.equal(h.manifest().header.databaseName, "voicepractice_db");
  assert.equal((await checkIndependentPostgresBackup(h.config, h.storage, true, NOW)).checksumVerified, true);
  const encrypted = path.join(h.directory, "download.pgbak"), output = path.join(h.directory, "restore.dir.tar.gz");
  await writeFile(encrypted, h.storage.objects.get(h.manifestKey.replace("complete.json", "archive.pgbak"))!.body);
  await decryptBackup(encrypted, output, KEY.privateKey, h.manifest(), TARGET);
  assert.deepEqual(await readFile(output), fixtureArchive()); await validateRenderArchive(output);
});
test("database identity mismatch stops before export creation", async t => {
  const h = await harness(t); h.invalidIdentity(); await assert.rejects(h.run(), /render_database_identity_mismatch/); assert.equal(h.posts(), 0);
});
test("failed export creation and a never-ready export cannot create completion", async t => {
  const h = await harness(t); h.source.create = async () => { throw new PostgresBackupError("render_export_request_failed"); };
  await assert.rejects(h.run(), /render_export_request_failed/); assert.equal(h.storage.objects.size, 0);
  const pending = await harness(t); pending.notReady(); await assert.rejects(pending.run(), /render_export_timeout/);
  assert.equal(pending.posts(), 1); assert.equal(pending.storage.objects.size, 0);
});
test("ambiguous POST acceptance is polled without another POST", async t => {
  const h = await harness(t); const create = h.source.create;
  h.source.create = async signal => { await create(signal); throw new PostgresBackupError("render_export_create_uncertain"); };
  assert.equal((await h.run()).outcome, "archived"); assert.equal(h.posts(), 1);
});
test("interrupted downloads leave no successful archive", async t => {
  const h = await harness(t); h.interruptDownload(); await assert.rejects(h.run()); assert.equal(h.storage.objects.size, 0);
});
for (const failure of ["failManifest", "failUploadAfterCommit"] as const) test(`${failure}: interrupted committed upload recovers without a duplicate transfer`, async t => {
  const h = await harness(t); h.storage[failure] = true; await assert.rejects(h.run());
  assert.equal(h.storage.objects.has(h.manifestKey), false);
  assert.equal((await h.run()).outcome, "archived"); assert.equal(h.downloads(), 1); assert.equal(h.posts(), 1);
});
test("read-back corruption prevents completion and verification fails on later loss", async t => {
  const h = await harness(t); h.storage.corruptReadback = true; await assert.rejects(h.run(), /archive_checksum_mismatch/);
  assert.equal(h.storage.objects.has(h.manifestKey), false);
  h.storage.corruptReadback = false; await h.run(); h.storage.corruptReadback = true;
  await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, true, NOW), /archive_checksum_mismatch/);
  h.storage.objects.delete(h.manifestKey.replace("complete.json", "archive.pgbak"));
  await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, false, NOW), /stored_archive_metadata_mismatch/);
});
test("missing and stale success detection uses export age, with exact retention boundaries", async t => {
  const h = await harness(t); await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, false, NOW), /backup_missing/);
  await h.run();
  await checkIndependentPostgresBackup(h.config, h.storage, false, new Date(NOW.getTime() + 36 * 3_600_000));
  await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, false, new Date(NOW.getTime() + 36 * 3_600_000 + 1)), /backup_stale/);
  const m = h.manifest(); const expires = new Date(m.expiresAt).getTime();
  validateBackupManifest(m, h.config, "2026-11-03", new Date(expires - 1));
  assert.throws(() => validateBackupManifest(m, h.config, "2026-11-03", new Date(expires)), /backup_retention_expired/);
  assert.equal(expires - NOW.getTime(), 30 * DAY_MS);
});
test("144-hour configuration archives and supports five-day checks and verification with an exact stale boundary", async t => {
  const h = await harness(t, { PG_BACKUP_MAX_AGE_HOURS: "144" });
  assert.equal((await h.run()).outcome, "archived");
  assert.equal((await h.run()).outcome, "already_complete");
  h.storage.putFile = async () => { throw Error("check attempted write"); };
  h.storage.putManifest = async () => { throw Error("check attempted write"); };
  for (const verify of [false, true]) {
    for (const hours of [120, 144]) {
      const report = await checkIndependentPostgresBackup(h.config, h.storage, verify, new Date(NOW.getTime() + hours * 3_600_000));
      assert.equal(report.outcome, "healthy"); assert.equal(report.ageHours, hours);
      assert.equal(report.checksumVerified, verify);
    }
    await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, verify,
      new Date(NOW.getTime() + 144 * 3_600_000 + 1)), /backup_stale/);
  }
  assert.equal(h.posts(), 1); assert.equal(h.downloads(), 1);
});

test("metadata and manifest target corruption fail closed", async t => {
  const h = await harness(t); await h.run(); const m = h.manifest(); m.header.postgresId = "dpg-other";
  h.storage.objects.set(h.manifestKey, { body: Buffer.from(JSON.stringify(m)), sha256: null });
  await assert.rejects(checkIndependentPostgresBackup(h.config, h.storage, false, NOW), /backup_identity_mismatch/);
});
test("simultaneous daily runs converge on one immutable artifact and matching completion", async t => {
  const h = await harness(t);
  const results = await Promise.all([h.run(), h.run()]);
  assert.equal(results.length, 2); assert.equal(h.storage.objects.size, 2);
  await checkIndependentPostgresBackup(h.config, h.storage, true, NOW);
});
test("freshness and full verification use only reads after completion", async t => {
  const h = await harness(t); await h.run();
  h.storage.putFile = async () => { throw Error("check attempted write"); };
  h.storage.putManifest = async () => { throw Error("check attempted write"); };
  await checkIndependentPostgresBackup(h.config, h.storage, false, NOW);
  await checkIndependentPostgresBackup(h.config, h.storage, true, NOW);
});
test("encryption uses random keys/IVs; tampered authentication never publishes plaintext", async t => {
  const h = await harness(t); await h.run(); const m = h.manifest();
  const plain = path.join(h.directory, "plain.tar.gz"); await writeFile(plain, fixtureArchive());
  const first = path.join(h.directory, "first.pgbak"), second = path.join(h.directory, "second.pgbak");
  const { keyId: _keyId, iv: _iv, wrappedKey: _wrappedKey, ...metadata } = m.header;
  await encryptBackup(plain, first, metadata, KEY.publicKey); await encryptBackup(plain, second, metadata, KEY.publicKey);
  assert.notDeepEqual(await readFile(first), await readFile(second));
  const damaged = await readFile(first); damaged[damaged.length - 1]! ^= 1; await writeFile(first, damaged);
  const output = path.join(h.directory, "not-published.tar.gz");
  await assert.rejects(decryptBackup(first, output, KEY.privateKey, await digestArchive(first, 1_000_000), TARGET));
  await assert.rejects(stat(output), { code: "ENOENT" });
  assert.equal((await readdir(h.directory)).some(file => file.endsWith(".partial")), false);
  assert.throws(() => backupKeyId(generateKeyPairSync("rsa", { modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }).publicKey), /rsa_key/);
  assert.throws(() => backupKeyId(KEY.privateKey), /public_key_file_required/);
});
test("restore preparation rejects real database names, remote hosts, alternate ports and URI options before file/key access", async () => {
  for (const url of ["postgres://localhost:55432/voicepractice_db", "postgres://localhost:55432/peritio_db_prod",
    "postgres://remote.example:55432/peritio_restore_x", "postgres://localhost:5432/peritio_restore_x",
    "postgres://localhost:55432/peritio_restore_x?host=production", "postgres://localhost:55432/peritio_restore_x#x"])
    assert.throws(() => assertScratchRestoreTarget(url));
  assertScratchRestoreTarget(TARGET);
});
test("wrong recovery key, checksum, oversized/truncated headers and existing output all fail safely", async t => {
  const h = await harness(t); await h.run(); const m = h.manifest();
  const input = path.join(h.directory, "recovery.pgbak"), output = path.join(h.directory, "out.tar.gz");
  const artifact = h.storage.objects.get(h.manifestKey.replace("complete.json", "archive.pgbak"))!.body;
  await writeFile(input, artifact);
  const otherKey = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  await assert.rejects(decryptBackup(input, output, otherKey.privateKey, m, TARGET), /wrong_recovery_key/);
  await assert.rejects(decryptBackup(input, output, KEY.privateKey, { ...m, sha256: "0".repeat(64) }, TARGET), /archive_checksum_mismatch/);
  await writeFile(output, "keep this fixture");
  await assert.rejects(decryptBackup(input, output, KEY.privateKey, m, TARGET), /restore_output_exists/);
  assert.equal(await readFile(output, "utf8"), "keep this fixture");
  await writeFile(input, Buffer.from("PERITIO-PG-1\n\xff\xff\xff\xff"));
  await assert.rejects(readBackupHeader(input), /invalid_archive_header/);
  await writeFile(input, Buffer.from("short")); await assert.rejects(readBackupHeader(input), /invalid_archive_header/);
});
test("size-limited streams and invalid tar exports fail rather than marking completion", async t => {
  const h = await harness(t);
  await assert.rejects(pipeline(Readable.from([Buffer.alloc(11)]), byteLimit(10), async (stream) => { for await (const _chunk of stream) { /* discard fixture */ } }), /archive_size_limit/);
  const file = path.join(h.directory, "not-an-archive"); await writeFile(file, "synthetic HTML response");
  await assert.rejects(validateRenderArchive(file), /export_archive_validation_failed/);
  h.source.download = async (_url, target) => { await writeFile(target, "invalid"); };
  await assert.rejects(h.run(), /export_archive_validation_failed/); assert.equal(h.storage.objects.size, 0);
});
test("aborted jobs and an incomplete R2 download never emit completion", async t => {
  const h = await harness(t); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(runIndependentPostgresBackup(h.config, { storage: h.storage, source: h.source, now: () => NOW }, aborted.signal));
  assert.equal(h.storage.objects.has(h.manifestKey), false);
  const other = await harness(t); await other.run();
  other.storage.download = async (_key, file) => { await writeFile(file, "partial"); throw Error("synthetic interrupted readback"); };
  await assert.rejects(checkIndependentPostgresBackup(other.config, other.storage, true, NOW));
});
test("Render API uses documented empty 202 + array response and never forwards authorization to downloads", async t => {
  const h = await harness(t); const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    if (url.includes("exports.example.com")) return new Response(new Uint8Array(fixtureArchive()), { headers: { "content-length": String(fixtureArchive().length) } });
    if (init?.method === "POST") return new Response(null, { status: 202 });
    if (url.endsWith("/export")) return Response.json([{ id: "exp", createdAt: NOW.toISOString(), url: "https://exports.example.com/download?synthetic=secret" }]);
    return Response.json({ id: h.config.postgresId, owner: { id: h.config.renderOwnerId }, name: "voicepractice_db", databaseName: "voicepractice_db", version: "17", status: "available", suspended: "not_suspended" });
  };
  const source = createRenderBackupSource(h.config, fetcher); const signal = AbortSignal.timeout(5000);
  assert.equal((await source.identity(signal)).available, true); await source.create(signal);
  const exports = await source.exports(signal);
  await source.download(exports[0]!.url!, path.join(h.directory, "download.tar.gz"), 1_000_000, signal);
  assert.equal(requests.at(-1)!.init?.headers, undefined); assert.equal(requests.at(-1)!.init?.redirect, "error");
  await assert.rejects(source.download("http://exports.example.com/x", "unused", 100, signal), /unapproved_export_download_host/);
  await assert.rejects(source.download("https://other.example.com/x", "unused", 100, signal), /unapproved_export_download_host/);
});
test("actual R2 adapter is bucket-scoped, create-only, bounded, and exposes no delete operation", async t => {
  const h = await harness(t); const commands: any[] = [];
  const storage = createIndependentBackupStorage(h.config, { async send(command: any) {
    commands.push(command); const name = command.constructor.name;
    if (name === "HeadObjectCommand") throw { $metadata: { httpStatusCode: 404 } };
    if (name === "ListObjectsV2Command") return { IsTruncated: false, Contents: [] };
    if (name === "PutObjectCommand") {
      assert.equal(command.input.IfNoneMatch, "*");
      if (command.input.Body instanceof Readable) for await (const _chunk of command.input.Body) { /* consume fixture */ }
      return {};
    }
    throw Error("Unexpected provider operation");
  } } as any);
  const key = `${backupPrefix(h.config)}2026-11-03/archive.pgbak`, signal = AbortSignal.timeout(5000);
  const file = path.join(h.directory, "bytes"); await writeFile(file, "synthetic");
  await storage.putFile(key, file, await digestArchive(file, 100), signal);
  assert.equal(await storage.head(key, signal), null); assert.deepEqual(await storage.manifests(backupPrefix(h.config), signal), []);
  await assert.rejects(storage.head("postgres/production/not-permitted", signal), /invalid_backup_key/);
  assert.equal("delete" in storage, false); assert.equal(commands.every(c => c.input.Bucket === h.config.bucket), true); storage.close();
});
for (const [httpStatus, code] of [[401, "render_authentication_failed"], [403, "render_authorization_failed"],
  [429, "render_rate_limited"], [503, "render_server_error"]] as const) {
  test(`Render ${httpStatus} is safely classified for GET and POST`, async t => {
    const h = await harness(t); const sensitive = "synthetic-token https://exports.example.com/?signed=secret";
    const fetcher: typeof fetch = async () => new Response(sensitive, { status: httpStatus });
    const source = createRenderBackupSource(h.config, fetcher);
    for (const action of [() => source.identity(AbortSignal.timeout(5000)), () => source.create(AbortSignal.timeout(5000))])
      await assert.rejects(action, error => {
        assert.equal(postgresBackupFailureCode(error), code);
        assert.equal(JSON.stringify(error).includes(sensitive), false); return true;
      });
  });
}
for (const [httpStatus, code] of [[401, "r2_permission_denied"], [403, "r2_permission_denied"],
  [429, "r2_rate_limited"], [503, "r2_server_error"]] as const) {
  test(`R2 ${httpStatus} is safely classified by the actual storage adapter`, async t => {
    const h = await harness(t);
    const storage = createIndependentBackupStorage(h.config, { async send() {
      throw { $metadata: { httpStatusCode: httpStatus }, message: "synthetic-secret signed-url customer-data" };
    } } as any);
    await assert.rejects(storage.head(`${backupPrefix(h.config)}2026-11-03/archive.pgbak`, AbortSignal.timeout(5000)),
      error => { assert.equal(postgresBackupFailureCode(error), code); assert.equal(JSON.stringify(error).includes("synthetic-secret"), false); return true; });
  });
}
test("timeouts, cancellation and unknown failures have fixed diagnostics without raw messages", async t => {
  const h = await harness(t);
  const fetcher: typeof fetch = async () => { throw { name: "TimeoutError", message: "synthetic-secret https://signed.example/" }; };
  const source = createRenderBackupSource(h.config, fetcher);
  await assert.rejects(source.exports(AbortSignal.timeout(5000)), error => postgresBackupFailureCode(error) === "render_timeout");
  await assert.rejects(source.download("https://exports.example.com/export", "unused", 1000, AbortSignal.timeout(5000)),
    error => postgresBackupFailureCode(error) === "render_timeout");
  assert.equal(postgresProviderFailure("r2", { name: "AccessDenied", message: "synthetic-secret" }).code, "r2_permission_denied");
  assert.equal(postgresProviderFailure("r2", { code: "ETIMEDOUT", message: "synthetic-secret" }).code, "r2_timeout");
  assert.equal(postgresBackupFailureCode(new Error("synthetic-secret https://signed.example/")), "postgres_backup_failed");
  assert.equal(postgresBackupFailureCode(new PostgresBackupError("https://signed.example/secret")), "postgres_backup_failed");
  const controller = new AbortController(); controller.abort(new PostgresBackupError("backup_cancelled"));
  assert.equal(postgresProviderFailure("render", Error("synthetic-secret"), controller.signal).code, "backup_cancelled");
});
