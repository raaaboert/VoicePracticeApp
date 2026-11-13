import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { TestContext } from "node:test";
import { parsePostgresBackupArgs, postgresBackupMain } from "./postgres-backup.js";
import { decryptBackup, digestArchive, encryptBackup, PostgresBackupError, privateBackupDirectory, removeBackupDirectory,
  validateRenderArchive, type BackupHeader } from "../src/services/postgresBackupArchive.js";
import type { BackupManifest } from "../src/services/postgresBackup.js";

const RECOVERY = generateKeyPairSync("rsa", { modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const SCRATCH = "postgresql://localhost:55432/peritio_restore_a22";
function syntheticTar(): Buffer {
  const body = Buffer.from("PGDMP synthetic-only, not a real database export");
  const header = Buffer.alloc(512); header.write("fixture.dir/toc.dat");
  for (const [offset, width, value] of [[100, 8, 384], [108, 8, 0], [116, 8, 0], [124, 12, body.length], [136, 12, 0]] as const)
    header.write(value.toString(8).padStart(width - 1, "0") + "\0", offset);
  header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
  header.write([...header].reduce((total, value) => total + value, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]));
}
async function restoreFixture(t: TestContext, plaintext = syntheticTar(), environment: "staging" | "production" = "staging") {
  const root = await privateBackupDirectory(); t.after(() => removeBackupDirectory(root));
  const directory = path.join(root, "Windows paths with spaces"); await mkdir(directory, { mode: 0o700 });
  const input = path.join(directory, "archive.pgbak"), output = path.join(directory, "restored export.dir.tar.gz");
  const manifestFile = path.join(directory, "complete.json"), keyFile = path.join(directory, "synthetic.key");
  const source = path.join(directory, "source.dir.tar.gz"); await writeFile(source, plaintext, { mode: 0o600 });
  const header = await encryptBackup(source, input, { format: "peritio-postgres-v1", environment,
    postgresId: "dpg-c1234567890123456789-a", databaseName: environment === "production" ? "peritio_db_prod" : "voicepractice_db", day: "2026-11-04",
    exportId: "synthetic-export", exportCreatedAt: "2026-11-04T08:00:00.000Z", archivedAt: "2026-11-04T08:00:00.000Z",
    postgresVersion: "17", retentionDays: 30, toolRevision: "synthetic-fixture" }, RECOVERY.publicKey);
  await rm(source); // No original plaintext remains to obscure cleanup assertions.
  const manifest: BackupManifest = { format: "peritio-postgres-complete-v1", header, ...await digestArchive(input, 1_000_000),
    completedAt: "2026-11-04T08:00:00.000Z", expiresAt: "2026-12-04T08:00:00.000Z" };
  await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(keyFile, RECOVERY.privateKey, { mode: 0o600 });
  const baseline = (await readdir(directory)).sort();
  const env: NodeJS.ProcessEnv = { PERITIO_ENV: "development", PG_BACKUP_RESTORE_URL: SCRATCH, PG_BACKUP_PRIVATE_KEY_FILE: keyFile };
  const args = ["--decrypt", "--target", "scratch", "--archive", input, "--manifest", manifestFile, "--output", output];
  const noPlaintext = async () => {
    await assert.rejects(stat(output), { code: "ENOENT" });
    assert.deepEqual((await readdir(directory)).sort(), baseline, "failure left plaintext or a staging directory");
  };
  return { directory, input, output, manifestFile, manifest, env, args, baseline, noPlaintext, plaintext };
}

test("backup CLI requires exactly one operation, an explicit environment target and no additional write flags", () => {
  for (const args of [[], ["--run"], ["--run", "--target", "prod"], ["--run", "--target", "staging", "--apply"],
    ["--run", "--check", "--target", "staging"], ["--run", "--target", "staging", "--target", "production"]])
    assert.throws(() => parsePostgresBackupArgs(args));
  assert.equal(parsePostgresBackupArgs(["--check", "--target", "staging"]).mode, "check");
  for (const target of ["staging", "production"]) for (const mode of ["run", "check", "verify", "dry-run"])
    assert.equal(parsePostgresBackupArgs([`--${mode}`, "--target", target]).target, target);
});
test("restore preparation rejects hosted contexts and remote targets before reading any files or keys", async () => {
  const args = ["--decrypt", "--target", "scratch", "--archive", "unused", "--manifest", "unused", "--output", "unused"];
  await assert.rejects(postgresBackupMain(args, { PERITIO_ENV: "production" }), /offline_restore_preparation_only/);
  await assert.rejects(postgresBackupMain(args, { PERITIO_ENV: "development", RENDER_SERVICE_ID: "synthetic" }), /offline_restore_preparation_only/);
  await assert.rejects(postgresBackupMain(args, { PERITIO_ENV: "development", PG_BACKUP_RESTORE_URL: "postgres://remote:55432/peritio_restore_x" }), /unsafe_restore_target/);
});
test("CLI failure exits nonzero without echoing credential-like values or provider details", () => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "PATH", "TEMP", "TMP", "ComSpec", "PATHEXT", "NODE_OPTIONS"]) if (process.env[key]) env[key] = process.env[key];
  env.PERITIO_ENV = "production"; env.PG_BACKUP_RENDER_API_KEY = "synthetic-secret-never-log";
  env.PG_BACKUP_RENDER_POSTGRES_ID = "dpg-c1234567890123456789-a"; env.PG_BACKUP_RENDER_OWNER_ID = "tea-c1234567890123456789";
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./postgres-backup.ts", import.meta.url)), "--run", "--target", "production"],
    { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes("synthetic-secret-never-log"), false);
  assert.equal(JSON.parse(result.stderr.trim()).code, "production_backup_authorization_required");
});

test("production CLI modes reject cross-environment context and missing authorization before provider access", async () => {
  for (const mode of ["run", "check", "verify", "dry-run"]) {
    await assert.rejects(postgresBackupMain([`--${mode}`, "--target", "production"], { PERITIO_ENV: "staging" }), /backup_target_environment_mismatch/);
    await assert.rejects(postgresBackupMain([`--${mode}`, "--target", "staging"], { PERITIO_ENV: "production" }), /backup_target_environment_mismatch/);
  }
});

test("production offline recovery requires independently pinned source environment and ID", async t => {
  const h = await restoreFixture(t, syntheticTar(), "production");
  await assert.rejects(postgresBackupMain(h.args, h.env), /restore_source_environment_mismatch/); await h.noPlaintext();
  const production = { ...h.env, PG_BACKUP_RESTORE_ENVIRONMENT: "production" };
  await assert.rejects(postgresBackupMain(h.args, production), /restore_source_identity_required/); await h.noPlaintext();
  await assert.rejects(postgresBackupMain(h.args, { ...production, PG_BACKUP_RESTORE_POSTGRES_ID: "dpg-wrong" }), /restore_source_identity_mismatch/); await h.noPlaintext();
  const report = await postgresBackupMain(h.args, { ...production, PG_BACKUP_RESTORE_POSTGRES_ID: h.manifest.header.postgresId });
  assert.equal(report.sourceEnvironment, "production"); assert.equal(report.databaseRestoreExecuted, false);
  assert.deepEqual(await readFile(h.output), h.plaintext);
});
test("complete CLI decryption validates manifest and tar before publishing; Windows drive/space paths work", async t => {
  const h = await restoreFixture(t);
  const report = await postgresBackupMain(h.args, h.env);
  assert.equal(report.outcome, "decrypted_and_archive_validated"); assert.equal(report.databaseRestoreExecuted, false);
  assert.deepEqual(await readFile(h.output), h.plaintext);
  assert.equal((await readdir(h.directory)).some(name => name.startsWith(".peritio-pg-restore-")), false);
  await validateRenderArchive(h.output);
});
test("authenticated but invalid tar fails CLI validation without publishing any plaintext", async t => {
  const h = await restoreFixture(t, Buffer.from("not a gzip/tar archive"));
  await assert.rejects(postgresBackupMain(h.args, h.env), /export_archive_validation_failed/);
  await h.noPlaintext();
});
for (const corruption of ["json", "null", "header", "checksum"] as const) test(`corrupt ${corruption} manifest leaves no plaintext`, async t => {
  const h = await restoreFixture(t);
  if (corruption === "header") h.manifest.header.exportId = "mismatched";
  if (corruption === "checksum") h.manifest.sha256 = "0".repeat(64);
  await writeFile(h.manifestFile, corruption === "json" ? "{" : corruption === "null" ? "null" : JSON.stringify(h.manifest));
  await assert.rejects(postgresBackupMain(h.args, h.env), corruption === "json" || corruption === "null" ? /invalid_backup_manifest/
    : corruption === "header" ? /manifest_header_mismatch/ : /archive_checksum_mismatch/);
  await h.noPlaintext();
});
for (const adjustManifest of [false, true]) test(`truncated ciphertext leaves no plaintext (updated checksum=${adjustManifest})`, async t => {
  const h = await restoreFixture(t); const bytes = await readFile(h.input); await writeFile(h.input, bytes.subarray(0, bytes.length - 8));
  if (adjustManifest) { Object.assign(h.manifest, await digestArchive(h.input, 1_000_000)); await writeFile(h.manifestFile, JSON.stringify(h.manifest)); }
  await assert.rejects(postgresBackupMain(h.args, h.env), adjustManifest ? /archive_authentication_or_decryption_failed/ : /archive_checksum_mismatch/);
  await h.noPlaintext();
});
test("post-decryption validation failure removes private plaintext and never exposes the final path", async t => {
  const h = await restoreFixture(t); let inspected = false;
  await assert.rejects(decryptBackup(h.input, h.output, RECOVERY.privateKey, h.manifest, SCRATCH, {
    validatePlaintext: async file => {
      inspected = true; await assert.rejects(stat(h.output), { code: "ENOENT" });
      assert.equal(path.basename(path.dirname(file)).startsWith(".peritio-pg-restore-"), true);
      assert.ok((await stat(file)).size > 0); throw new PostgresBackupError("synthetic_tar_failure");
    },
  }), /synthetic_tar_failure/);
  assert.equal(inspected, true); await h.noPlaintext();
});
test("cooperative interruption immediately before publication cleans plaintext", async t => {
  const h = await restoreFixture(t); const cancellation = new AbortController();
  await assert.rejects(decryptBackup(h.input, h.output, RECOVERY.privateKey, h.manifest, SCRATCH, {
    signal: cancellation.signal, validatePlaintext: async () => { cancellation.abort(new PostgresBackupError("backup_cancelled")); },
  }), /backup_cancelled/);
  await h.noPlaintext();
});
test("publication race never overwrites another output and cleans its private plaintext", async t => {
  const h = await restoreFixture(t);
  await assert.rejects(decryptBackup(h.input, h.output, RECOVERY.privateKey, h.manifest, SCRATCH, {
    validatePlaintext: async () => { await writeFile(h.output, "preserve operator output", { flag: "wx" }); },
  }), /restore_output_exists/);
  assert.equal(await readFile(h.output, "utf8"), "preserve operator output");
  assert.deepEqual((await readdir(h.directory)).sort(), [...h.baseline, path.basename(h.output)].sort());
});
