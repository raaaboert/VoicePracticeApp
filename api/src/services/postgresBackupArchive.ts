import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, link, lstat, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAGIC = Buffer.from("PERITIO-PG-1\n");
export const HEADER_LIMIT = 16_384;
export const DAY_MS = 86_400_000;

export class PostgresBackupError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PostgresBackupError"; }
}
export function requireBackup(condition: unknown, code: string): asserts condition {
  if (!condition) throw new PostgresBackupError(code);
}
export function postgresBackupFailureCode(error: unknown): string {
  if (error instanceof PostgresBackupError && /^[a-z0-9_]{1,100}$/.test(error.code)) return error.code;
  const candidate = error as { name?: string; cause?: unknown } | null;
  if (candidate?.name === "TimeoutError") return "backup_timeout";
  if (candidate?.name === "AbortError") {
    const cause = candidate.cause;
    if (cause instanceof PostgresBackupError && cause.code === "backup_cancelled") return "backup_cancelled";
    return (cause as { name?: string } | null)?.name === "TimeoutError" ? "backup_timeout" : "backup_aborted";
  }
  return "postgres_backup_failed";
}
/** Classify fixed status/name tokens only; never include provider messages or URLs. */
export function postgresProviderFailure(provider: "render" | "r2", error: unknown, signal?: AbortSignal,
  fallback = `${provider}_request_failed`): PostgresBackupError {
  if (error instanceof PostgresBackupError) return error;
  if (signal?.aborted && signal.reason instanceof PostgresBackupError) return signal.reason;
  const candidate = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (signal?.aborted || ["TimeoutError", "AbortError"].includes(candidate?.name ?? "")
    || ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(candidate?.code ?? "")) return new PostgresBackupError(`${provider}_timeout`);
  const status = candidate?.$metadata?.httpStatusCode;
  if (provider === "render" && status === 401) return new PostgresBackupError("render_authentication_failed");
  if (provider === "render" && status === 403) return new PostgresBackupError("render_authorization_failed");
  if (provider === "r2" && (status === 401 || status === 403
    || candidate?.name === "AccessDenied" || candidate?.Code === "AccessDenied")) return new PostgresBackupError("r2_permission_denied");
  if (status === 429 || candidate?.name === "SlowDown") return new PostgresBackupError(`${provider}_rate_limited`);
  if (typeof status === "number" && status >= 500 && status <= 599) return new PostgresBackupError(`${provider}_server_error`);
  return new PostgresBackupError(fallback);
}
export interface BackupHeader {
  format: "peritio-postgres-v1";
  environment: "staging";
  postgresId: string;
  databaseName: "voicepractice_db";
  day: string;
  exportId: string;
  exportCreatedAt: string;
  postgresVersion: string;
  archivedAt: string;
  retentionDays: number;
  toolRevision: string;
  keyId: string;
  iv: string;
  wrappedKey: string;
}
export interface ArchiveDigest { sha256: string; bytes: number }

export async function privateBackupDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "peritio-pg-"));
  await chmod(directory, 0o700);
  return directory;
}
export async function removeBackupDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  requireBackup(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith("peritio-pg-"), "unsafe_temp_directory");
  await rm(resolved, { recursive: true, force: true });
}
export function byteLimit(maximum: number): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    done(bytes > maximum ? new PostgresBackupError("archive_size_limit") : null, chunk);
  } });
}
export async function digestArchive(file: string, maximum: number, signal?: AbortSignal): Promise<ArchiveDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file, { signal })) {
    bytes += chunk.length;
    requireBackup(bytes <= maximum, "archive_size_limit");
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}
export function backupKeyId(publicKeyPem: string): string {
  requireBackup(publicKeyPem.trimStart().startsWith("-----BEGIN PUBLIC KEY-----") && !publicKeyPem.includes("PRIVATE KEY"), "public_key_file_required");
  const key = createPublicKey(publicKeyPem);
  requireBackup(key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 3072, "rsa_key_too_small_or_invalid");
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export async function encryptBackup(input: string, output: string, metadata: Omit<BackupHeader, "keyId" | "iv" | "wrappedKey">,
  publicKeyPem: string, signal?: AbortSignal): Promise<BackupHeader> {
  const key = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const header: BackupHeader = { ...metadata, keyId: backupKeyId(publicKeyPem), iv: iv.toString("base64"),
      wrappedKey: publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64") };
    const json = Buffer.from(JSON.stringify(header));
    requireBackup(json.length <= HEADER_LIMIT, "archive_header_limit");
    const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
    const prefix = Buffer.concat([MAGIC, length, json]);
    const file = await open(output, "wx", 0o600);
    try { await file.writeFile(prefix); } finally { await file.close(); }
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(prefix);
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }), { signal });
    await appendFile(output, cipher.getAuthTag());
    return header;
  } finally { key.fill(0); }
}

export async function readBackupHeader(file: string): Promise<{ header: BackupHeader; prefix: Buffer }> {
  const handle = await open(file, "r");
  try {
    const fixed = Buffer.alloc(MAGIC.length + 4);
    requireBackup((await handle.read(fixed, 0, fixed.length, 0)).bytesRead === fixed.length && fixed.subarray(0, MAGIC.length).equals(MAGIC), "invalid_archive_header");
    const length = fixed.readUInt32BE(MAGIC.length);
    requireBackup(length > 0 && length <= HEADER_LIMIT, "invalid_archive_header");
    const json = Buffer.alloc(length);
    requireBackup((await handle.read(json, 0, length, fixed.length)).bytesRead === length, "invalid_archive_header");
    let header: BackupHeader;
    try { header = JSON.parse(json.toString("utf8")) as BackupHeader; }
    catch { throw new PostgresBackupError("invalid_archive_header"); }
    requireBackup(header && typeof header === "object" && header.format === "peritio-postgres-v1" && header.environment === "staging" && header.databaseName === "voicepractice_db"
      && /^[0-9a-f]{64}$/.test(header.keyId) && typeof header.iv === "string" && Buffer.from(header.iv, "base64").length === 12
      && typeof header.wrappedKey === "string", "invalid_archive_header");
    return { header, prefix: Buffer.concat([fixed, json]) };
  } finally { await handle.close(); }
}

export function assertScratchRestoreTarget(raw: string): void {
  const target = new URL(raw);
  requireBackup(["postgres:", "postgresql:"].includes(target.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    && /^\/peritio_restore_[a-z0-9_]+$/.test(target.pathname)
    && target.port === "55432" && !target.search && !target.hash, "unsafe_restore_target");
}
export async function decryptBackup(input: string, output: string, privateKeyPem: string,
  expected: ArchiveDigest & { header?: BackupHeader }, restoreTarget: string,
  options: { signal?: AbortSignal; validatePlaintext?: typeof validateRenderArchive } = {}): Promise<BackupHeader> {
  assertScratchRestoreTarget(restoreTarget);
  options.signal?.throwIfAborted();
  requireBackup(Number.isSafeInteger(expected.bytes) && expected.bytes > 0 && expected.bytes <= 4_295_000_064
    && /^[0-9a-f]{64}$/.test(expected.sha256), "invalid_archive_digest");
  const digest = await digestArchive(input, expected.bytes, options.signal);
  requireBackup(digest.bytes === expected.bytes && digest.sha256 === expected.sha256, "archive_checksum_mismatch");
  const { header, prefix } = await readBackupHeader(input);
  if (expected.header !== undefined) requireBackup(JSON.stringify(header) === JSON.stringify(expected.header), "manifest_header_mismatch");
  let publicKey: ReturnType<typeof createPublicKey>;
  try { publicKey = createPublicKey(createPrivateKey(privateKeyPem)); }
  catch { throw new PostgresBackupError("invalid_recovery_key"); }
  requireBackup(createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex") === header.keyId, "wrong_recovery_key");
  let key: Buffer;
  try { key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(header.wrappedKey, "base64")); }
  catch { throw new PostgresBackupError("archive_key_unwrap_failed"); }
  const parent = path.dirname(path.resolve(output));
  let staging: string | undefined;
  try {
    requireBackup(key.length === 32 && (await stat(input)).size > prefix.length + 16, "invalid_archive_payload");
    // lstat also refuses dangling symlinks. link() below closes the publication race.
    try { await lstat(output); throw new PostgresBackupError("restore_output_exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const handle = await open(input, "r"); const tag = Buffer.alloc(16);
    try { requireBackup((await handle.read(tag, 0, 16, digest.bytes - 16)).bytesRead === 16, "invalid_archive_payload"); }
    finally { await handle.close(); }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAAD(prefix); decipher.setAuthTag(tag);
    // Same filesystem as output permits atomic, create-only publication after ALL checks.
    staging = await mkdtemp(path.join(parent, ".peritio-pg-restore-"));
    await chmod(staging, 0o700);
    const partial = path.join(staging, "plaintext.dir.tar.gz");
    const partialFile = await open(partial, "wx", 0o600);
    const writer = partialFile.createWriteStream();
    try { await pipeline(createReadStream(input, { start: prefix.length, end: digest.bytes - 17 }), decipher, writer, { signal: options.signal }); }
    catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new PostgresBackupError("archive_authentication_or_decryption_failed");
    }
    await validateRenderArchive(partial, options.signal);
    // Optional additional validation is an offline test boundary, never a bypass.
    if (options.validatePlaintext) await options.validatePlaintext(partial, options.signal);
    options.signal?.throwIfAborted();
    // No plaintext is published for GCM, manifest, tar or cooperative-abort failure.
    try { await link(partial, output); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new PostgresBackupError("restore_output_exists");
      throw error;
    }
    return header;
  } finally {
    key.fill(0);
    if (staging) {
      const resolved = path.resolve(staging);
      requireBackup(path.dirname(resolved) === parent && path.basename(resolved).startsWith(".peritio-pg-restore-"), "unsafe_temp_directory");
      try { await rm(resolved, { recursive: true, force: true }); }
      catch { throw new PostgresBackupError("plaintext_cleanup_failed"); }
    }
  }
}

/** Checks gzip/tar readability and a PostgreSQL directory TOC; not a restore rehearsal. */
export async function validateRenderArchive(file: string, signal?: AbortSignal): Promise<void> {
  try {
    const cwd = path.dirname(path.resolve(file)), archive = `./${path.basename(file)}`;
    // GNU tar interprets C:\\... as a remote host. Never pass a drive-qualified path.
    const { stdout } = await exec("tar", ["-tzf", archive], { cwd, timeout: 30_000, maxBuffer: 2_097_152, signal });
    const names = stdout.trim().split(/\r?\n/);
    requireBackup(names.length > 0 && names.every(name => !name.startsWith("/") && !name.includes("\\")
      && !name.split("/").includes("..") && !/^[a-z]:/i.test(name)), "unsafe_export_archive");
    const toc = names.filter(name => /(^|\/)toc\.dat$/.test(name));
    requireBackup(toc.length === 1, "invalid_export_archive");
    const result = await exec("tar", ["-xOzf", archive, "--", toc[0]!], { cwd, timeout: 30_000, maxBuffer: 8_388_608, encoding: "buffer", signal });
    requireBackup(result.stdout.subarray(0, 5).equals(Buffer.from("PGDMP")), "invalid_export_archive");
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new PostgresBackupError("export_archive_validation_failed");
  }
}
