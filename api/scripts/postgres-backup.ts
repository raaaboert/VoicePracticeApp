import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkIndependentPostgresBackup, createIndependentBackupStorage, createRenderBackupSource, loadPostgresBackupConfig, runIndependentPostgresBackup, type BackupManifest } from "../src/services/postgresBackup.js";
import { assertScratchRestoreTarget, decryptBackup, PostgresBackupError, postgresBackupFailureCode, requireBackup } from "../src/services/postgresBackupArchive.js";

export function parsePostgresBackupArgs(args: string[]): { mode: "run" | "check" | "verify" | "decrypt"; target: string; archive?: string; manifest?: string; output?: string } {
  const values: Record<string, string> = {};
  const modes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (["--run", "--check", "--verify", "--decrypt"].includes(flag)) modes.push(flag.slice(2));
    else {
      requireBackup(["--target", "--archive", "--manifest", "--output"].includes(flag)
        && !values[flag] && args[i + 1] && !args[i + 1]!.startsWith("--"), "invalid_backup_arguments");
      values[flag] = args[++i]!;
    }
  }
  requireBackup(modes.length === 1 && values["--target"], "explicit_backup_mode_and_target_required");
  const mode = modes[0] as "run" | "check" | "verify" | "decrypt";
  requireBackup(mode === "decrypt" ? values["--target"] === "scratch" : values["--target"] === "staging", "invalid_backup_target");
  if (mode === "decrypt") requireBackup(values["--archive"] && values["--manifest"] && values["--output"], "restore_files_required");
  else requireBackup(!values["--archive"] && !values["--manifest"] && !values["--output"], "invalid_backup_arguments");
  return { mode, target: values["--target"]!, archive: values["--archive"], manifest: values["--manifest"], output: values["--output"] };
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
async function outsideRepository(file: string, output = false): Promise<string> {
  const absolute = path.resolve(file);
  const physical = output ? path.join(await realpath(path.dirname(absolute)), path.basename(absolute)) : await realpath(absolute);
  const relative = path.relative(await realpath(repository), physical);
  requireBackup(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), "backup_artifacts_must_be_outside_repository");
  return physical;
}
export async function postgresBackupMain(args: string[], env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const parsed = parsePostgresBackupArgs(args);
  if (parsed.mode === "decrypt") {
    // Offline preparation only: this tool never connects to a restore database or runs pg_restore.
    requireBackup(env.PERITIO_ENV === "development" && !env.RENDER_SERVICE_ID, "offline_restore_preparation_only");
    const target = env.PG_BACKUP_RESTORE_URL ?? "";
    assertScratchRestoreTarget(target);
    const keyFile = env.PG_BACKUP_PRIVATE_KEY_FILE;
    requireBackup(keyFile, "recovery_key_file_required");
    const archive = await outsideRepository(parsed.archive!), output = await outsideRepository(parsed.output!, true);
    const manifestFile = await outsideRepository(parsed.manifest!);
    requireBackup((await stat(manifestFile)).size <= 32_768 && (await stat(keyFile)).size <= 65_536, "restore_input_limit");
    let manifest: BackupManifest;
    try { manifest = JSON.parse(await readFile(manifestFile, "utf8")) as BackupManifest; }
    catch { throw new PostgresBackupError("invalid_backup_manifest"); }
    requireBackup(manifest && typeof manifest === "object" && manifest.format === "peritio-postgres-complete-v1" && manifest.header && typeof manifest.header === "object", "invalid_backup_manifest");
    const deadline = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(900_000)]);
    const header = await decryptBackup(archive, output, await readFile(keyFile, "utf8"), manifest, target, { signal: deadline });
    return { outcome: "decrypted_and_archive_validated", target: "scratch", databaseRestoreExecuted: false, postgresVersion: header.postgresVersion };
  }
  const config = loadPostgresBackupConfig(parsed.target, env);
  const storage = createIndependentBackupStorage(config);
  try {
    const deadline = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(parsed.mode === "run" ? 900_000 : 300_000)]);
    if (parsed.mode === "run") return { ...await runIndependentPostgresBackup(config, { storage, source: createRenderBackupSource(config) }, deadline) };
    return { ...await checkIndependentPostgresBackup(config, storage, parsed.mode === "verify", new Date(), deadline) };
  } finally { storage.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new PostgresBackupError("backup_cancelled"));
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  postgresBackupMain(process.argv.slice(2), process.env, cancellation.signal).then(report => console.log(JSON.stringify(report))).catch(error => {
    // Provider errors may embed signed URLs, credentials, paths or data. Never print them.
    const code = postgresBackupFailureCode(error);
    console.error(JSON.stringify({ outcome: "failed", code })); process.exitCode = 1;
  }).finally(() => { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); });
}
