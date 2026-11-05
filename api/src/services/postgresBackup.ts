import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  backupKeyId, byteLimit, DAY_MS, digestArchive, encryptBackup, PostgresBackupError, postgresProviderFailure,
  privateBackupDirectory, readBackupHeader, removeBackupDirectory, requireBackup, validateRenderArchive,
  type ArchiveDigest, type BackupHeader,
} from "./postgresBackupArchive.js";

export interface PostgresBackupConfig {
  environment: "staging";
  postgresId: string;
  renderOwnerId: string;
  renderDatabaseName: string;
  renderApiKey: string;
  downloadHosts: string[];
  bucket: "peritio-postgres-backups-staging";
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicKeyFile: string;
  retentionDays: number;
  maxAgeHours: number;
  maxBytes: number;
  toolRevision: string;
}
export interface BackupManifest extends ArchiveDigest {
  format: "peritio-postgres-complete-v1";
  header: BackupHeader;
  completedAt: string;
  expiresAt: string;
}
export interface BackupHead { bytes: number; sha256: string | null }
export interface IndependentBackupStorage {
  head(key: string, signal: AbortSignal): Promise<BackupHead | null>;
  download(key: string, file: string, maximum: number, signal: AbortSignal): Promise<void>;
  putFile(key: string, file: string, digest: ArchiveDigest, signal: AbortSignal): Promise<void>;
  putManifest(key: string, manifest: BackupManifest, signal: AbortSignal): Promise<void>;
  manifests(prefix: string, signal: AbortSignal): Promise<string[]>;
}
export interface RenderExport { id: string; createdAt: string; url?: string }
export interface RenderBackupSource {
  identity(signal: AbortSignal): Promise<{ id: string; ownerId: string; name: string; databaseName: string; version: string; available: boolean }>;
  exports(signal: AbortSignal): Promise<RenderExport[]>;
  create(signal: AbortSignal): Promise<void>;
  download(url: string, file: string, maximum: number, signal: AbortSignal): Promise<void>;
}
export interface PostgresBackupDependencies {
  storage: IndependentBackupStorage;
  source: RenderBackupSource;
  now?: () => Date;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  inspectArchive?: typeof validateRenderArchive;
}

function value(env: NodeJS.ProcessEnv, name: string): string {
  const result = env[name]?.trim();
  requireBackup(result, `missing_${name.toLowerCase()}`);
  return result;
}
function integer(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = raw === undefined ? fallback : Number(raw);
  requireBackup(Number.isSafeInteger(result) && result >= minimum && result <= maximum, "invalid_backup_limit");
  return result;
}
export function loadPostgresBackupConfig(target: string | undefined, env: NodeJS.ProcessEnv = process.env): PostgresBackupConfig {
  // Production is intentionally unavailable in A2.2, even with production confirmation flags.
  requireBackup(target === "staging" && env.PERITIO_ENV === "staging", "staging_backup_target_required");
  const postgresId = value(env, "PG_BACKUP_RENDER_POSTGRES_ID");
  const ownerId = value(env, "PG_BACKUP_RENDER_OWNER_ID");
  // Matches Render's official CLI IsPostgresID (primary/replica suffixes included).
  // https://github.com/render-oss/cli/blob/main/pkg/validate/id.go
  requireBackup(/^dpg-[a-z0-9]{20}(?:-[a-z]+)?$/.test(postgresId) && /^(tea|usr)-[a-z0-9]+$/.test(ownerId), "invalid_render_identity");
  const bucket = value(env, "PG_BACKUP_R2_BUCKET");
  requireBackup(bucket === "peritio-postgres-backups-staging", "staging_backup_bucket_required");
  const account = value(env, "PG_BACKUP_R2_ACCOUNT_ID");
  requireBackup(/^[a-f0-9]{32}$/i.test(account), "invalid_r2_account");
  const endpoint = new URL(value(env, "PG_BACKUP_R2_ENDPOINT"));
  requireBackup(endpoint.origin === `https://${account.toLowerCase()}.r2.cloudflarestorage.com`
    && endpoint.pathname === "/" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "invalid_r2_endpoint");
  const hosts = (env.PG_BACKUP_DOWNLOAD_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  requireBackup(hosts.every(host => /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)
    && !/^[\d.]+$/.test(host) && !host.endsWith(".local") && !host.endsWith(".localhost") && !host.endsWith(".internal")), "invalid_export_download_host");
  return { environment: "staging", postgresId, renderOwnerId: ownerId,
    renderDatabaseName: env.PG_BACKUP_RENDER_DATABASE_NAME?.trim() || "voicepractice_db",
    renderApiKey: env.PG_BACKUP_RENDER_API_KEY?.trim() || "", downloadHosts: hosts,
    bucket, endpoint: endpoint.origin,
    accessKeyId: value(env, "PG_BACKUP_R2_ACCESS_KEY_ID"), secretAccessKey: value(env, "PG_BACKUP_R2_SECRET_ACCESS_KEY"),
    publicKeyFile: env.PG_BACKUP_PUBLIC_KEY_FILE?.trim() || "",
    retentionDays: integer(env.PG_BACKUP_RETENTION_DAYS, 30, 7, 90),
    maxAgeHours: integer(env.PG_BACKUP_MAX_AGE_HOURS, 36, 25, 72),
    maxBytes: integer(env.PG_BACKUP_MAX_BYTES, 536_870_912, 1024, 4_294_967_296),
    toolRevision: /^[a-f0-9]{40}$/i.test(env.RENDER_GIT_COMMIT ?? "") ? env.RENDER_GIT_COMMIT! : "uncommitted_or_unknown" };
}
export function backupPrefix(config: PostgresBackupConfig): string { return `postgres/staging/${config.postgresId}/`; }
function timestamp(raw: string): number { const result = Date.parse(raw); requireBackup(Number.isFinite(result), "invalid_backup_timestamp"); return result; }
function keyDay(key: string, config: PostgresBackupConfig): string {
  const suffix = key.slice(backupPrefix(config).length);
  requireBackup(key.startsWith(backupPrefix(config)) && /^\d{4}-\d{2}-\d{2}\/complete\.json$/.test(suffix), "invalid_manifest_key");
  return suffix.slice(0, 10);
}
export function validateBackupHeader(header: BackupHeader, config: PostgresBackupConfig, day: string, now: Date): void {
  requireBackup(header.format === "peritio-postgres-v1" && header.environment === "staging"
    && header.databaseName === "voicepractice_db" && header.postgresId === config.postgresId && header.day === day
    && /^\d{4}-\d{2}-\d{2}$/.test(day) && typeof header.exportId === "string" && header.exportId.length > 0
    && /^1[1-8]$/.test(header.postgresVersion) && /^[a-f0-9]{64}$/.test(header.keyId)
    && Number.isInteger(header.retentionDays) && header.retentionDays >= 7 && header.retentionDays <= 90,
  "backup_identity_mismatch");
  const created = timestamp(header.exportCreatedAt), archived = timestamp(header.archivedAt);
  requireBackup(created >= timestamp(`${day}T00:00:00.000Z`) && created < timestamp(`${day}T00:00:00.000Z`) + DAY_MS
    && created <= archived && archived <= now.getTime() + 300_000, "invalid_backup_timestamp");
}
export function validateBackupManifest(manifest: BackupManifest, config: PostgresBackupConfig, day: string, now: Date): void {
  requireBackup(manifest && typeof manifest === "object" && manifest.format === "peritio-postgres-complete-v1" && /^[a-f0-9]{64}$/.test(manifest.sha256)
    && Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && manifest.bytes <= config.maxBytes + 32_768, "invalid_backup_manifest");
  validateBackupHeader(manifest.header, config, day, now);
  requireBackup(timestamp(manifest.completedAt) >= timestamp(manifest.header.archivedAt)
    && timestamp(manifest.completedAt) <= now.getTime() + 300_000
    && timestamp(manifest.expiresAt) === timestamp(manifest.header.archivedAt) + manifest.header.retentionDays * DAY_MS,
  "invalid_backup_timestamp");
  requireBackup(now.getTime() < timestamp(manifest.expiresAt), "backup_retention_expired");
}
async function readManifest(storage: IndependentBackupStorage, key: string, file: string, config: PostgresBackupConfig,
  now: Date, signal: AbortSignal): Promise<BackupManifest> {
  await storage.download(key, file, 32_768, signal);
  let manifest: BackupManifest;
  try { manifest = JSON.parse(await readFile(file, "utf8")) as BackupManifest; }
  catch { throw new PostgresBackupError("invalid_backup_manifest"); }
  validateBackupManifest(manifest, config, keyDay(key, config), now);
  return manifest;
}
async function verifyStoredArchive(storage: IndependentBackupStorage, key: string, file: string, expected: ArchiveDigest,
  config: PostgresBackupConfig, day: string, now: Date, signal: AbortSignal): Promise<BackupHeader> {
  await storage.download(key, file, config.maxBytes + 32_768, signal);
  const actual = await digestArchive(file, config.maxBytes + 32_768, signal);
  requireBackup(actual.bytes === expected.bytes && actual.sha256 === expected.sha256, "archive_checksum_mismatch");
  const { header } = await readBackupHeader(file);
  validateBackupHeader(header, config, day, now);
  return header;
}
function assertHead(head: BackupHead | null, expected: ArchiveDigest): void {
  requireBackup(head && head.bytes === expected.bytes && head.sha256 === expected.sha256, "stored_archive_metadata_mismatch");
}

/** Per-day immutable artifact + last-written completion. No application/DB initialization. */
export async function runIndependentPostgresBackup(config: PostgresBackupConfig, deps: PostgresBackupDependencies,
  signal = AbortSignal.timeout(900_000)): Promise<{ outcome: "archived" | "already_complete"; bytes: number; environment: "staging" }> {
  signal.throwIfAborted();
  const now = deps.now ?? (() => new Date());
  const started = now(); const day = started.toISOString().slice(0, 10);
  const prefix = `${backupPrefix(config)}${day}/`;
  const archiveKey = `${prefix}archive.pgbak`, manifestKey = `${prefix}complete.json`;
  const directory = await privateBackupDirectory();
  try {
    if (await deps.storage.head(manifestKey, signal)) {
      const manifest = await readManifest(deps.storage, manifestKey, path.join(directory, "existing.json"), config, now(), signal);
      assertHead(await deps.storage.head(archiveKey, signal), manifest);
      const header = await verifyStoredArchive(deps.storage, archiveKey, path.join(directory, "existing.pgbak"), manifest, config, day, now(), signal);
      requireBackup(JSON.stringify(header) === JSON.stringify(manifest.header), "manifest_header_mismatch");
      return { outcome: "already_complete", bytes: manifest.bytes, environment: "staging" };
    }
    let stored = await deps.storage.head(archiveKey, signal);
    let header: BackupHeader, digest: ArchiveDigest;
    if (!stored) {
      requireBackup(config.renderApiKey && config.publicKeyFile && config.downloadHosts.length, "export_credentials_or_public_key_missing");
      const identity = await deps.source.identity(signal);
      requireBackup(identity.id === config.postgresId && identity.ownerId === config.renderOwnerId
        && identity.name === config.renderDatabaseName && identity.databaseName === "voicepractice_db" && identity.available
        && /^1[1-8]$/.test(identity.version), "render_database_identity_mismatch");
      const publicKey = await readFile(config.publicKeyFile, "utf8"); backupKeyId(publicKey);
      const select = (exports: RenderExport[]) => {
        requireBackup(exports.length <= 100, "render_export_list_limit");
        for (const item of exports) requireBackup(typeof item.id === "string" && item.id.length > 0
          && typeof item.createdAt === "string" && timestamp(item.createdAt) <= now().getTime() + 300_000, "invalid_render_export_response");
        return exports.filter(item => new Date(timestamp(item.createdAt)).toISOString().slice(0, 10) === day)
          .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))[0];
      };
      let exported = select(await deps.source.exports(signal));
      if (!exported) {
        // A network failure might mean POST was accepted. Never retry POST within this run.
        try { await deps.source.create(signal); } catch (error) {
          if (!(error instanceof PostgresBackupError) || error.code !== "render_export_create_uncertain") throw error;
        }
      }
      const wait = deps.wait ?? ((ms, abort) => new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(abort.reason ?? new PostgresBackupError("backup_aborted")); };
        const timer = setTimeout(() => { abort.removeEventListener("abort", stop); resolve(); }, ms);
        if (abort.aborted) stop(); else abort.addEventListener("abort", stop, { once: true });
      }));
      for (let poll = 0; !exported?.url && poll < 60; poll++) {
        signal.throwIfAborted();
        if (poll > 0) await wait(10_000, signal);
        exported = select(await deps.source.exports(signal));
      }
      requireBackup(exported?.url, "render_export_timeout");
      const plain = path.join(directory, "export.dir.tar.gz"), encrypted = path.join(directory, "archive.pgbak");
      await deps.source.download(exported.url, plain, config.maxBytes, signal);
      await (deps.inspectArchive ?? validateRenderArchive)(plain, signal);
      header = await encryptBackup(plain, encrypted, { format: "peritio-postgres-v1", environment: "staging",
        postgresId: config.postgresId, databaseName: "voicepractice_db", day, exportId: exported.id,
        exportCreatedAt: exported.createdAt, postgresVersion: identity.version, archivedAt: now().toISOString(),
        retentionDays: config.retentionDays, toolRevision: config.toolRevision }, publicKey, signal);
      digest = await digestArchive(encrypted, config.maxBytes + 32_768, signal);
      await deps.storage.putFile(archiveKey, encrypted, digest, signal);
      stored = await deps.storage.head(archiveKey, signal);
      requireBackup(stored && stored.sha256, "stored_archive_missing");
      // A simultaneous create-only writer may have won. Verify its actual immutable bytes.
    }
    requireBackup(stored.sha256, "stored_archive_checksum_missing");
    digest = { bytes: stored.bytes, sha256: stored.sha256 };
    header = await verifyStoredArchive(deps.storage, archiveKey, path.join(directory, "readback.pgbak"), digest, config, day, now(), signal);
    const manifest: BackupManifest = { format: "peritio-postgres-complete-v1", header, ...digest,
      completedAt: now().toISOString(), expiresAt: new Date(timestamp(header.archivedAt) + header.retentionDays * DAY_MS).toISOString() };
    validateBackupManifest(manifest, config, day, now());
    await deps.storage.putManifest(manifestKey, manifest, signal);
    const committed = await readManifest(deps.storage, manifestKey, path.join(directory, "committed.json"), config, now(), signal);
    requireBackup(committed.sha256 === digest.sha256 && committed.bytes === digest.bytes
      && JSON.stringify(committed.header) === JSON.stringify(header), "completion_conflict");
    return { outcome: "archived", bytes: digest.bytes, environment: "staging" };
  } finally { await removeBackupDirectory(directory); }
}

export async function checkIndependentPostgresBackup(config: PostgresBackupConfig, storage: IndependentBackupStorage,
  fullVerification: boolean, now = new Date(), signal = AbortSignal.timeout(300_000)):
  Promise<{ outcome: "healthy"; environment: "staging"; ageHours: number; bytes: number; checksumVerified: boolean }> {
  const keys = await storage.manifests(backupPrefix(config), signal);
  requireBackup(keys.length <= 100, "manifest_list_limit");
  keys.forEach(key => keyDay(key, config)); keys.sort().reverse();
  requireBackup(keys[0], "backup_missing");
  const directory = await privateBackupDirectory();
  try {
    const key = keys[0], day = keyDay(key, config);
    const manifest = await readManifest(storage, key, path.join(directory, "manifest.json"), config, now, signal);
    const ageHours = (now.getTime() - timestamp(manifest.header.exportCreatedAt)) / 3_600_000;
    requireBackup(ageHours >= 0 && ageHours <= config.maxAgeHours, "backup_stale");
    const archiveKey = `${backupPrefix(config)}${day}/archive.pgbak`;
    assertHead(await storage.head(archiveKey, signal), manifest);
    if (fullVerification) {
      const header = await verifyStoredArchive(storage, archiveKey, path.join(directory, "verified.pgbak"), manifest, config, day, now, signal);
      requireBackup(JSON.stringify(header) === JSON.stringify(manifest.header), "manifest_header_mismatch");
    }
    return { outcome: "healthy", environment: "staging", ageHours: Math.round(ageHours * 100) / 100,
      bytes: manifest.bytes, checksumVerified: fullVerification };
  } finally { await removeBackupDirectory(directory); }
}

function status(error: unknown): number | undefined { return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode; }
function destinationConflict(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string };
  return status(error) === 412 || (status(error) === 409 &&
    (candidate.name === "ObjectLockedByBucketPolicy" || candidate.Code === "ObjectLockedByBucketPolicy"));
}
export function createIndependentBackupStorage(config: PostgresBackupConfig, suppliedClient?: Pick<S3Client, "send">): IndependentBackupStorage & { close(): void } {
  const client = suppliedClient ?? new S3Client({ endpoint: config.endpoint, region: "auto", forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED" });
  const checked = (key: string) => { requireBackup(key.startsWith(backupPrefix(config))
    && /^\d{4}-\d{2}-\d{2}\/(archive\.pgbak|complete\.json)$/.test(key.slice(backupPrefix(config).length)), "invalid_backup_key"); return key; };
  const send = async (command: any, signal: AbortSignal): Promise<any> => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    try { return await client.send(command, { abortSignal: deadline }); }
    catch (error) {
      // Preserve absence and conditional/lock-conflict handling at the caller.
      if ([404, 409, 412].includes(status(error) ?? 0)) throw error;
      throw postgresProviderFailure("r2", error, deadline);
    }
  };
  return {
    async head(key, signal) {
      try { const result = await send(new HeadObjectCommand({ Bucket: config.bucket, Key: checked(key) }), signal);
        requireBackup(Number.isSafeInteger(result.ContentLength) && result.ContentLength > 0, "invalid_stored_size");
        return { bytes: result.ContentLength, sha256: result.Metadata?.sha256 ?? null };
      } catch (error) { if (status(error) === 404) return null; throw error; }
    },
    async download(key, file, maximum, signal) {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const result = await send(new GetObjectCommand({ Bucket: config.bucket, Key: checked(key) }), deadline);
      requireBackup(result.Body instanceof Readable, "invalid_r2_download_body");
      try { await pipeline(result.Body, byteLimit(maximum), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal: deadline }); }
      catch (error) { throw postgresProviderFailure("r2", error, deadline, "r2_download_interrupted"); }
    },
    async putFile(key, file, digest, signal) {
      const body = createReadStream(file);
      try { await send(new PutObjectCommand({ Bucket: config.bucket, Key: checked(key), Body: body, ContentLength: digest.bytes,
        ContentType: "application/octet-stream", IfNoneMatch: "*", Metadata: { sha256: digest.sha256 } }), signal); }
      catch (error) { if (!destinationConflict(error)) throw error; }
      finally { body.destroy(); }
    },
    async putManifest(key, manifest, signal) {
      try { await send(new PutObjectCommand({ Bucket: config.bucket, Key: checked(key), Body: JSON.stringify(manifest),
        ContentType: "application/json", IfNoneMatch: "*" }), signal); }
      catch (error) { if (!destinationConflict(error)) throw error; }
    },
    async manifests(prefix, signal) {
      requireBackup(prefix === backupPrefix(config), "invalid_backup_prefix");
      const result = await send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1000 }), signal);
      requireBackup(!result.IsTruncated, "backup_listing_truncated");
      return (result.Contents ?? []).map((item: { Key?: string }) => item.Key).filter((key: string | undefined) => key?.endsWith("/complete.json"));
    },
    close() { if (!suppliedClient) (client as S3Client).destroy(); },
  };
}

export function assertExportDownloadUrl(raw: string, hosts: string[]): URL {
  const url = new URL(raw);
  requireBackup(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
    && hosts.includes(url.hostname.toLowerCase()), "unapproved_export_download_host");
  return url;
}
export function createRenderBackupSource(config: PostgresBackupConfig, fetcher: typeof fetch = fetch): RenderBackupSource {
  const api = async (suffix: string, method: "GET" | "POST", signal: AbortSignal) => {
    requireBackup(config.renderApiKey, "render_api_key_missing");
    let response: Response;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    try { response = await fetcher(`https://api.render.com/v1/postgres/${encodeURIComponent(config.postgresId)}${suffix}`, {
      method, redirect: "error", headers: { Authorization: `Bearer ${config.renderApiKey}`, Accept: "application/json" },
      signal: deadline }); }
    catch (error) {
      if (method === "POST" && !signal.aborted) throw new PostgresBackupError("render_export_create_uncertain");
      throw postgresProviderFailure("render", error, deadline, "render_api_unavailable");
    }
    if (method === "POST" || !response.ok) {
      await response.body?.cancel().catch(() => {});
      if (method === "POST" && response.status === 202) return null;
      throw postgresProviderFailure("render", { $metadata: { httpStatusCode: response.status } }, undefined,
        method === "POST" ? "render_export_request_failed" : "render_api_request_failed");
    }
    requireBackup(response.body, "render_api_empty_response");
    const chunks: Buffer[] = []; let bytes = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body as any)) { bytes += chunk.length; requireBackup(bytes <= 262_144, "render_api_response_limit"); chunks.push(chunk); }
    } catch (error) { throw postgresProviderFailure("render", error, deadline, "render_api_read_failed"); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new PostgresBackupError("render_api_invalid_response"); }
  };
  return {
    async identity(signal) { const item = await api("", "GET", signal);
      return { id: item.id, ownerId: item.owner?.id, name: item.name, databaseName: item.databaseName,
        version: item.version, available: item.status === "available" && item.suspended === "not_suspended" }; },
    async exports(signal) { const items = await api("/export", "GET", signal); requireBackup(Array.isArray(items), "invalid_render_export_response"); return items; },
    async create(signal) { await api("/export", "POST", signal); },
    async download(raw, file, maximum, signal) {
      // Never forward the Render bearer token to signed download URLs. Never follow redirects.
      const url = assertExportDownloadUrl(raw, config.downloadHosts);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      let response: Response;
      try { response = await fetcher(url, { redirect: "error", signal: deadline }); }
      catch (error) { throw postgresProviderFailure("render", error, deadline, "export_download_failed"); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw postgresProviderFailure("render", { $metadata: { httpStatusCode: response.status } }, undefined, "export_download_failed");
      }
      requireBackup(response.body && !response.headers.get("content-type")?.includes("text/html"), "export_download_failed");
      const length = response.headers.get("content-length");
      requireBackup(length === null || (Number.isSafeInteger(Number(length)) && Number(length) > 0 && Number(length) <= maximum), "archive_size_limit");
      try { await pipeline(Readable.fromWeb(response.body as any), byteLimit(maximum), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal: deadline }); }
      catch (error) { throw postgresProviderFailure("render", error, deadline, "export_download_interrupted"); }
      const actual = (await stat(file)).size;
      requireBackup(actual > 0 && (length === null || actual === Number(length)), "export_download_incomplete");
    },
  };
}
