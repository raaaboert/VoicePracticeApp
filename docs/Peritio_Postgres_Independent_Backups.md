# Independent PostgreSQL backups — staging and explicit production mode

Production parity is implemented for staging delivery; no production resources are configured by this work. The owner reports the earlier staging system was reviewed and restore-tested. The initial A2.2 checkpoint below is historical. Final release policy and staging-finalization checks are recorded at the end of this guide.

Initial A2.2 status: local implementation, not activated. No hosted export/download, R2 change,
schedule, restore or production operation was performed. Six prior reports are
preserved. Source baseline: staging `1bf27f24ffffef6742d1465771aebe251b34dba9`.
The owner confirms both paid databases have 3-day PITR and logical exports, and
one staging `.dir.tar.gz` export has completed. Those are owner observations;
this batch does not inspect that export or private provider settings.

## Decision: Render logical export API, not a second pg_dump implementation

Public documentation and the official OpenAPI spec were inspected November 3–4, 2026:

- [Create export](https://api-docs.render.com/reference/create-postgres-export):
  `POST /v1/postgres/{postgresId}/export` returns **202 without a documented body**.
- [List exports](https://api-docs.render.com/reference/list-postgres-export):
  GET on the same path returns an array of `{id, createdAt, url?}`. There is no
  assumed status field, separate download endpoint or export ID in the POST response.
- [Official schema](https://api-docs.render.com/openapi/render-public-api-1.json)
  also defines GET instance metadata (ID, owner, name, databaseName, version, status).
- [Recovery documentation](https://render.com/docs/postgresql-backups) describes
  compressed directory-format logical exports and seven-day Render retention.

| Consideration | A: Render API, selected | B: scheduled pg_dump, not implemented |
| --- | --- | --- |
| Consistency | Provider-generated whole-database logical export | Consistent pg_dump snapshot if configured correctly |
| Credentials | Render API key; no direct DB login | Restricted DB role, future-table privileges, direct connection |
| Maintenance | Poll documented export list; validate response and archive | Pin/upgrade compatible pg_dump, handle roles, TLS and DB load |
| Restore | Untar directory archive; compatible pg_restore | Format selected by the exporter; compatible pg_restore |
| Main risks | Render API availability, key breadth, export/download latency | Client/version drift, grants, connection routing, dump contention |
| Retention/security/monitoring | Same independent encrypted R2 design | Same destination, encryption and monitoring would be required |
| Cost | One short scheduled job plus archive storage/transfer | Similar job/storage cost; more client and role maintenance |

This choice is verified against public contracts, not private-account execution.
The first authorized staging run still must confirm permissions, download hostname,
tar compatibility, runtime, free disk, R2 conditionals/locks and notification delivery.
Native PITR remains in place. The five-day staging export schedule has a fallback
RPO of up to roughly 120 hours plus processing delay; it is not zero-data-loss
replication.

## Implemented behavior and boundaries

- Every network mode requires an explicit `--target staging` or `--target production`, matching `PERITIO_ENV`, a specific Render database/owner ID and its dedicated bucket. Staging retains `voicepractice_db` / `peritio-postgres-backups-staging`; production is bound to `peritio-db-prod` / `peritio_db_prod` / `peritio-postgres-backups-production`. These names follow the existing staging/production runbook; an unexpected provider rename fails and must be reviewed, never guessed. Production additionally requires ID-bound confirmation and separate credential variables (see production setup below). New exports validate actual instance name, owner, ID, databaseName and availability before requesting an export.
  Render ID validation follows the [official CLI validator](https://github.com/render-oss/cli/blob/main/pkg/validate/id.go):
  `dpg-` plus 20 lowercase alphanumeric characters and an optional lowercase-letter
  suffix, such as synthetic `dpg-c1234567890123456789-a`. Do not strip the suffix.
- The job does not import API startup, use `DATABASE_URL`, execute SQL, migrate,
  change rows, call cleanup or alter provider settings. Dedicated credentials must
  not be shared with the API/media backup lane. No packages were added.
- One UTC-day slot per database. Reuse an export created that UTC day; otherwise
  request one. Poll for its URL, up to 60 times with 10-second waits. A POST with an
  ambiguous transport failure is not repeated in that run. A subsequent retry
  re-lists exports. Render has no documented idempotency key: rare concurrent or
  ambiguous creation can still start redundant provider work; it cannot overwrite
  a completed independent archive. Keep one scheduled job per database.
- Download only from exact owner-approved HTTPS hostnames, without the Render
  bearer token and without redirects. Unexpected redirect/host means failure,
  not permission to weaken the allowlist. API JSON is capped at 256 KiB, exports
  at 100 entries, archive listing at 2 MiB and TOC at 8 MiB. Larger legitimate
  installations require a reviewed limit change, not a silent partial backup.
- Default export cap: 512 MiB compressed; configurable up to 4 GiB. Private 0700
  temporary directory, 0600 files, bounded streams, 15-minute job deadline,
  20-second API request deadline, 120-second R2 request deadline, five-minute export
  download deadline, bounded tar
  subprocesses. Allow about 3x the configured archive cap in ephemeral free disk.
- The compressed export temporarily exists as plaintext in private scratch storage.
  Normal exit removes scratch; SIGKILL relies on disposable job storage. This is
  not secure erasure. Never add a persistent/shared disk to the backup job.
- `tar` checks gzip/tar readability, safe relative names and one PostgreSQL `PGDMP`
  directory TOC. This is not proof of a successful database restore.
- Encryption uses Node's crypto implementation: a fresh AES-256-GCM key and 96-bit
  IV per artifact; RSA-OAEP/SHA-256 wraps that key. RSA keys must be >=3072 bits;
  generate 4096 bits. Only the public key is supplied to the scheduled job.
- Container format: `PERITIO-PG-1\n`, 4-byte big-endian JSON-header length,
  <=16 KiB UTF-8 header, AES-GCM ciphertext, 16-byte tag. Prefix/header are GCM
  additional authenticated data. The header records environment, source ID/name,
  export creation time/ID, PostgreSQL server major, UTC slot, retention, public-key
  SHA-256 ID and backup-tool revision. The server major is not a claimed pg_dump
  binary version; inspect the actual TOC with compatible pg_restore during recovery.
- Create-only R2 PUTs use `If-None-Match: *`. Re-read and SHA-256-check the encrypted
  archive before writing a separate immutable completion manifest **last**. The
  manifest records ciphertext size/checksum, header, completion and expiry times.
- Retry after upload but before completion verifies the retained artifact and
  finishes its receipt without downloading another Render export or replacing bytes.
  Matching duplicate runs converge. Mismatched/corrupt existing bytes fail closed;
  no delete/overwrite/lock-removal operation exists in this tool.
- SHA-256/read-back proves stored ciphertext consistency, not origin authenticity
  against an attacker who can rewrite both bytes and metadata. GCM validates the
  recovered plaintext/header during offline decryption. Use bucket locks and
  restricted accounts; do not give the writer bucket-administration permission.

### Encryption does not establish who produced an archive (F4)

| Mechanism | What it establishes | What it does not establish |
| --- | --- | --- |
| SHA-256 | Ciphertext agrees with an independently trusted expected digest | Producer identity; an attacker able to replace both archive and manifest can replace the checksum |
| AES-GCM | Ciphertext and authenticated header validate under the supplied data-encryption key | That Peritio chose the data key or created the archive |
| RSA public-key envelope encryption | Confidentiality: the corresponding private key is required to unwrap the data key | Producer authenticity: anyone with the public key can encrypt their own payload and generate a valid GCM tag and manifest |
| Digital signature with a separately trusted producer verification key | Producer authenticity, if correctly implemented and the signing key remains trusted | Confidentiality or proof of a successful restore |

A fabricated archive created with only the public encryption key can pass
decryption and integrity checks. This is expected, and no signature verifier is
implemented here. The selected recommendation for this release is unsigned
archives with the access, immutability and independent provenance controls in
the final policy below. This does not establish cryptographic producer identity.
Those operational controls must be established before production activation.
No signing system or second storage provider is added by this correction batch.

### Retention and monitoring

`PG_BACKUP_RETENTION_DAYS` defaults to 30 (7–90 supported). It defines manifest
expiry; physical retention depends on the owner-configured R2 lifecycle/lock policy.
The job never installs or modifies that policy and never deletes archives. Actual automatic
expiration is **not active until the owner configures the bucket**. Changing the
variable alone does not change physical retention. Keep lifecycle and lock values
aligned; do not shorten retention below business/legal requirements.

A bucket lock is an operational security recommendation, not a runtime prerequisite
for either environment's `--run`, `--check` or `--verify`. The code does not query or require a
lock setting; it uses create-only conditional writes and read-back validation.
Those safeguards do not prevent a credential holder from deleting objects outside
this tool. Lifecycle expiry alone does not provide protection against early deletion;
the recommended minimum lock remains a separate owner configuration control.

`--check` reads completion metadata and HEADs the latest archive. `--verify` also
downloads and hashes that encrypted archive and compares its header with the
manifest. Both fail for missing, stale, expired, malformed or inconsistent backups.
Only completed slots count. Default maximum age is 36 hours (staging range 25–144; production range 25–48),
measured from export creation, not a later retry/completion. Use 144 for the five-day
staging schedule on both the job and its independent checker. Exactly 144 hours is
accepted; any older export fails freshness validation. This threshold affects
`--check`/`--verify`, not the backup cadence or the 30-day retention policy.
The newest malformed slot fails closed rather than silently accepting an older one.
A truncated or oversized listing
also fails. Neither check imports application schema initialization.

Any CLI error exits 1 with a fixed error code and, where known, a fixed failure
phase (`configuration`, `public_key`, `source_identity` or `destination`); provider error messages, URLs,
credentials, paths, object keys and records are excluded. Render execution/build
failure notifications must be enabled and tested. A stopped scheduler cannot
alert through itself: activate the separately scheduled read-only freshness check
below, or an existing independent owner scheduler. Until then automatic stale
alerting is **not established**. Checksums do not replace a restore rehearsal.

Safe operator error categories (F6), without raw provider messages:

| Code / family | Operator interpretation |
| --- | --- |
| `public_key_file_unreadable` | The configured public PEM file is missing, unreadable or not a regular file; phase `public_key`. Privately verify the Cron secret-file mount and exact configured path. No filename or filesystem exception is logged. |
| `invalid_public_key` | Public PEM parsing failed; phase `public_key`. Check the mounted public-only SPKI PEM, not the private recovery key. Existing public-only and RSA minimum-strength rejections remain distinct and use the same phase. |
| `invalid_r2_endpoint` | Malformed URL or endpoint/account mismatch; phase `configuration`. Use the documented HTTPS account endpoint; no URL is logged. |
| `r2_destination_bucket_not_found` | Explicit `NoSuchBucket`, or a 404 from bucket listing; phase `destination`. Check the configured account/bucket and scoped token privately. Ordinary missing-object HEAD responses still mean object absence, not missing bucket. |
| `postgres_backup_failed` with a phase | An unclassified dry-run exception is limited to a fixed `source_identity` or `destination` phase, without raw exception details. Unknown failures outside a known phase remain generic. |
| `render_authentication_failed`, `render_authorization_failed` | Check API credential validity and permission, or download-link access/expiry if downloading |
| `render_rate_limited` | Provider throttling; automatic backoff is deferred |
| `render_server_error`, `render_api_unavailable` | Render service or transport failure; preserve the previous archive |
| `render_timeout`, `render_export_timeout` | Request/download deadline or export did not become ready within the bounded polling window |
| `render_export_create_uncertain` | POST may have been accepted; existing logic re-lists without another POST in that run |
| `r2_permission_denied`, `r2_rate_limited`, `r2_server_error`, `r2_timeout` | Check the selected environment's dedicated bucket permission, provider health or transfer deadline |
| `archive_checksum_mismatch`, `manifest_header_mismatch`, `invalid_backup_manifest`, `archive_authentication_or_decryption_failed`, `export_archive_validation_failed` | Verification failed; no final plaintext output is published |
| `wrong_recovery_key`, `invalid_recovery_key`, `archive_key_unwrap_failed` | Recover the correct historical keyId/format; do not replace old archives or generate a substitute key |
| `backup_cancelled`, `backup_timeout`, `plaintext_cleanup_failed` | Cancellation/deadline or unsuccessful scratch cleanup; privately inspect the protected workspace |

No new retry/backoff policy is implied by these classifications.
For example, a missing public-key mount now reports
`{"outcome":"failed","code":"public_key_file_unreadable","phase":"public_key"}`.
Public-key file checks are shared by dry-run and a new archive run, capped at
64 KiB, and preserve cancellation. No raw error messages/stacks, PEM contents,
credentials, object keys or URLs are added to logs. The diagnostics patch was
validated with 59/59 focused offline tests plus API/CLI TypeScript checks on
Node 24.22.2; no hosted dry-run or backup was executed for that validation.

## Owner setup — after independent review and separate staging-run authorization

Do not paste any credential, signed URL or key into chat. Nothing below was run
against a provider in this implementation batch.

1. **Record the staging identity.** In Render, confirm the actual `voicepractice_db`
   instance ID (`dpg-...`), exact display name, workspace owner ID (`tea-...` or
   `usr-...`), and PostgreSQL major. Do not use `peritio-db-prod` or a replica.
2. **Render API credential.** Required operations are GET the selected instance,
   GET its `/export` list and POST its `/export` endpoint. Prefer a staging-resource
   scoped key where supported; scoped keys are currently early access. The public
   reference does not give stable scope identifiers for these endpoints: do not
   invent them. The provider's `insufficient_token_scope` response identifies its
   current required scopes. Otherwise use a dedicated trusted principal with the
   smallest available staging workspace access. An ordinary account key can be
   broader than this job; software guards do not reduce the key's actual authority.
3. **Download allowlist.** Inspect the hostname of the staging export download link
   privately in Render. Put only that hostname in `PG_BACKUP_DOWNLOAD_HOSTS` (comma
   separated if genuinely necessary). Do not copy the full signed URL or download
   the existing export for this task. No wildcard/private/internal hostnames.
4. **Dedicated R2 bucket.** Create `peritio-postgres-backups-staging`, Standard storage,
   private, public development URL disabled, no public custom domain/Worker binding.
   Add lifecycle expiry of 30 days for all objects and a recommended 30-day minimum bucket lock.
   Confirm both apply to archive **and completion** objects. R2 expiration can lag
   the nominal time. Never apply these age-expiry rules to the existing media backup
   buckets; old current media can be required by today's database snapshot.
5. **R2 permissions.** Writer needs List, Head, Get and create-only Put in this bucket
   only. It needs no media-bucket access, object deletion or bucket administration.
   Where R2's available Object Read & Write token also grants deletion, document
   that limitation and rely on the bucket lock against premature deletion; do not
   claim the token is write-only. Give the independent monitor a separate Object
   Read-only token for this bucket. No provider configuration is written by code.
6. **Generate/escrow recovery keys outside Git and both cloud accounts.** On a trusted
   local machine with Node 24, this creates a new private directory and refuses to
   overwrite it. Run only after deciding the secure escrow location:

   ```bash
   node --input-type=module <<'NODE'
   import { generateKeyPairSync } from 'node:crypto';
   import { mkdir, writeFile } from 'node:fs/promises';
   import { homedir } from 'node:os';
   import path from 'node:path';
   const dir = path.join(homedir(), 'peritio-postgres-staging-recovery');
   await mkdir(dir, { mode: 0o700 });
   const keys = generateKeyPairSync('rsa', { modulusLength: 4096,
     publicKeyEncoding: { type: 'spki', format: 'pem' },
     privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
   await writeFile(path.join(dir, 'public.pem'), keys.publicKey, { flag: 'wx', mode: 0o644 });
   await writeFile(path.join(dir, 'private.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 });
   console.log('recovery_key_pair_created');
   NODE
   ```

   Keep the private key in an encrypted owner-controlled vault plus a separate
   recoverable offline copy. Verify recovery access, including a second trusted
   recovery route. On Windows secure the directory ACL; POSIX mode bits alone do
   not establish Windows access restrictions. Upload **only public.pem** as a Render
   secret file. Keep every historical private key until all archives using its key
   ID have expired and any legal/recovery holds end. Loss of a private key makes
   those archives unrecoverable. A new key does not repair old archives. No owner
   recovery key is generated, read from owner storage or uploaded by this task;
   encryption tests use disposable synthetic keys only.

   Key generation above leaves a temporary **unencrypted** `private.pem`. Do not
   leave it there after escrow. First independently recover both protected escrow
   copies and verify that they produce the public key's fingerprint on the trusted
   local machine. Then remove only the generated working private-key file:

   ```bash
   # LOCAL ONLY, after verified encrypted escrow; this does not delete the vault copies.
   node --input-type=module <<'NODE'
   import { unlink } from 'node:fs/promises';
   import { homedir } from 'node:os';
   import path from 'node:path';
   await unlink(path.join(homedir(), 'peritio-postgres-staging-recovery', 'private.pem'));
   console.log('temporary_private_key_removed');
   NODE
   ```

   File deletion is not guaranteed secure erasure on SSDs or copy-on-write storage.
   Generate and use recovery keys on an encrypted, access-controlled local volume;
   use its approved cryptographic-erasure/disposal procedure when required. Keep
   `public.pem` for the job. Never attach the working private key to Render or Git.
7. **Create one staging Render Cron Job later.** Git repo root, branch `staging`,
   Node `24.22.2`, same region as staging DB, no persistent disk. Start with the
   smallest compute plan and measure memory/disk. Build:

   ```bash
   tar --version && npm ci --include=dev
   ```

   Staging UTC schedule `0 9 */5 * *`: 09:00 on days 1, 6, 11, 16, 21, 26 and
   31 where present, resetting each month. Gaps are at most five days (120 hours),
   rather than a fixed interval across month boundaries. Set
   `PG_BACKUP_MAX_AGE_HOURS=144` on the job and independent freshness checker for
   24 hours of grace beyond that gap. The default remains 36 hours for daily
   schedules; accepted integer values are 25–144. Command:

   ```bash
   npm run backup:postgres -- --target staging --run
   ```

   Keep its automatic deployment behavior intentional. Creating a scheduled job
   activates future runs; do not create it until authorization to export/archive
   staging is granted. Do not attach shared application environment groups or any
   production credentials. This job does not require `DATABASE_URL`, OpenAI, email,
   application auth secrets, media R2 credentials or the private recovery key.

   | Variable | Staging-only value / owner action |
   | --- | --- |
   | `NODE_VERSION` | `24.22.2` |
   | `PERITIO_ENV` | `staging` |
   | `PG_BACKUP_RENDER_POSTGRES_ID` | Recorded staging `dpg-...` |
   | `PG_BACKUP_RENDER_OWNER_ID` | Recorded staging workspace/principal ID |
   | `PG_BACKUP_RENDER_DATABASE_NAME` | Exact staging display name; default `voicepractice_db` |
   | `PG_BACKUP_RENDER_API_KEY` | Protected credential, never printed |
   | `PG_BACKUP_DOWNLOAD_HOSTS` | Verified signed-download hostname(s), no URL |
   | `PG_BACKUP_R2_ACCOUNT_ID` | Owner's Cloudflare account ID |
   | `PG_BACKUP_R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `PG_BACKUP_R2_BUCKET` | `peritio-postgres-backups-staging` |
   | `PG_BACKUP_R2_ACCESS_KEY_ID`, `PG_BACKUP_R2_SECRET_ACCESS_KEY` | Dedicated protected writer credentials |
   | `PG_BACKUP_PUBLIC_KEY_FILE` | Render path to uploaded public.pem secret file |
   | `PG_BACKUP_RETENTION_DAYS` | `30`, matching bucket lifecycle/lock |
   | `PG_BACKUP_MAX_AGE_HOURS` | `144` for the five-day schedule; unchanged default is `36` |
   | `PG_BACKUP_MAX_BYTES` | `536870912` initially; measure actual export size and free disk |

8. **Notifications.** Enable service-level **Only failure notifications**, with
   owner email delivery. Render documents failed cron execution notifications.
   Test notification delivery using a deliberately failing **check** against an
   empty staging backup bucket, not by damaging an archive. Verify a failed run's
   nonzero status is visible. Do not assume workspace defaults are enabled.
9. **First authorized staging run.** Trigger only this cron job, never the API's
   worker or a production job. Expect sanitized `outcome: archived` and positive
   byte count. Re-running the same UTC day should return `already_complete`.
   Keep the API/worker operating normally; measure the export's impact.
10. **Verify independently archived bytes:** from the configured staging job shell
    or a separately configured trusted machine (no credentials in command text):

    ```bash
    npm run backup:postgres -- --target staging --check
    npm run backup:postgres -- --target staging --verify
    ```

    Verify bucket privacy, lock, lifecycle, manifest and archive count privately.
    Complete an explicitly authorized isolated restore before claiming recovery
    readiness. A green encrypted-archive upload alone is insufficient.

### Independent stale check without a new paid monitoring service

Use existing GitHub Actions capacity, after separate owner setup. Do not install
this workflow or add secrets as part of this batch. The scheduled workflow must
exist on the repository's default branch; it explicitly checks out staging code.
Copy this template into an owner-reviewed workflow later. Set the four nonsecret
repository variables and two **read-only staging bucket** secrets referenced below.
No Render API token or encryption key is needed by the monitor.

```yaml
name: Staging database backup freshness
on:
  schedule:
    - cron: '0 10 * * *'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      PERITIO_ENV: staging
      PG_BACKUP_RENDER_POSTGRES_ID: ${{ vars.PG_BACKUP_STAGING_POSTGRES_ID }}
      PG_BACKUP_RENDER_OWNER_ID: ${{ vars.PG_BACKUP_STAGING_OWNER_ID }}
      PG_BACKUP_R2_ACCOUNT_ID: ${{ vars.PG_BACKUP_R2_ACCOUNT_ID }}
      PG_BACKUP_R2_ENDPOINT: ${{ vars.PG_BACKUP_R2_ENDPOINT }}
      PG_BACKUP_R2_BUCKET: peritio-postgres-backups-staging
      PG_BACKUP_MAX_AGE_HOURS: '144'
      PG_BACKUP_R2_ACCESS_KEY_ID: ${{ secrets.PG_BACKUP_STAGING_READ_ACCESS_KEY_ID }}
      PG_BACKUP_R2_SECRET_ACCESS_KEY: ${{ secrets.PG_BACKUP_STAGING_READ_SECRET_ACCESS_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: staging
      - uses: actions/setup-node@v4
        with:
          node-version: 24.22.2
          cache: npm
      - run: npm ci --include=dev
      - run: npm run backup:postgres -- --target staging --check
```

Configure the owner's GitHub notification preferences for failed runs and test
delivery. Confirm private-repository Actions allowances and scheduled-workflow
availability. Scheduled Actions can be delayed/disabled; the owner must still
review both schedules and last-success age weekly. Until that independent check
is configured and its alert delivery is demonstrated, stopped-scheduler detection
remains an owner responsibility, not an implemented notification guarantee.

## Offline restore preparation — no restore was executed

Use a dedicated local, non-synchronized working directory outside the repository
for recovery files and working private-key copies. Never use OneDrive, Dropbox,
Google Drive or any other cloud-synchronized folder, including Desktop/Documents
folders redirected into those services. Keep the workspace encrypted and private;
replace the example paths below consistently with that local directory.

1. Authorize a restore rehearsal separately. Download one retained encrypted archive
   and its matching complete.json into a private directory **outside Git** using
   owner-approved R2 tooling. Do not log keys, object paths, download URLs or data.
   Preserve the originals and completion record. Never use the existing shared
   staging database as a disposable restore target.

   Practical download example using the **existing installed Node/AWS SDK**, from
   the repository root on a trusted operator machine. This is an operator example,
   not a new CLI mode or an automatically executed job. Supply only the documented
   staging identities and a dedicated R2 read-only credential through protected
   process settings; no Render API token or database URL is required. Replace the
   example UTC day and private local directory. The directory must not exist yet:

   ```bash
   node --import tsx --input-type=module - staging 2026-11-04 /private/peritio-rehearsal <<'NODE'
   import { mkdir, readFile } from 'node:fs/promises';
   import path from 'node:path';
   import { backupPrefix, createIndependentBackupStorage, loadPostgresBackupConfig,
     validateBackupManifest } from './api/src/services/postgresBackup.ts';
   import { digestArchive, requireBackup } from './api/src/services/postgresBackupArchive.ts';
   let storage;
   try {
     const [environment, day, destination] = process.argv.slice(2);
     requireBackup(/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') && destination, 'invalid_download_arguments');
     const directory = path.resolve(destination), relative = path.relative(process.cwd(), directory);
     requireBackup(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'outside_repository_required');
     const config = loadPostgresBackupConfig(environment);
     storage = createIndependentBackupStorage(config);
     await mkdir(directory, { mode: 0o700 });
     const prefix = backupPrefix(config) + day + '/';
     const signal = AbortSignal.timeout(300000);
     const manifestFile = path.join(directory, 'complete.json');
     await storage.download(prefix + 'complete.json', manifestFile, 32768, signal);
     const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
     validateBackupManifest(manifest, config, day, new Date());
     const archive = path.join(directory, 'archive.pgbak');
     await storage.download(prefix + 'archive.pgbak', archive, config.maxBytes + 32768, signal);
     const digest = await digestArchive(archive, config.maxBytes + 32768, signal);
     requireBackup(digest.bytes === manifest.bytes && digest.sha256 === manifest.sha256, 'archive_checksum_mismatch');
     console.log('encrypted_archive_downloaded_and_checksum_verified');
   } catch {
     console.error('encrypted_archive_download_or_verification_failed'); process.exitCode = 1;
   } finally { storage?.close(); }
   NODE
   ```

   Retain the matching originals; do not treat a failed/partial download as verified.
   Checksum agreement with a manifest from the same bucket does not prove producer
   authenticity. Establish provenance through the approved operator/provider record
   and, if adopted, the separately trusted signing verifier before restoration.
2. On a trusted isolated local machine, make the matching private key available
   from escrow as a protected file. Set `PERITIO_ENV=development`,
   `PG_BACKUP_PRIVATE_KEY_FILE` to that local file, and a local-only target URL such
   as `PG_BACKUP_RESTORE_URL=postgresql://localhost:55432/peritio_restore_a22`.
   Those are process settings; do not source hosted application .env files.
   Recover the private key for the manifest's `keyId`, not automatically the newest
   key. Put the working key on the protected local volume, limit access to the
   operator (0600 on POSIX, restrictive ACL on Windows), and do not print it. The
   file must be readable by this offline command; encrypted vault storage is escrow,
   not a directly supported passphrase-input feature of the CLI.
3. Prepare/decrypt locally; this command **does not connect to or restore a DB**:

   ```bash
   npm run backup:postgres -- --target scratch --decrypt \
     --archive /private/peritio-rehearsal/archive.pgbak \
     --manifest /private/peritio-rehearsal/complete.json \
     --output /private/peritio-rehearsal/export.dir.tar.gz
   ```

   It verifies SHA-256/size, matching key ID, RSA unwrap, GCM tag/header binding,
   tar readability and the directory TOC. It refuses output overwrite, repository
   artifact paths, hosted contexts, live database names, remote hosts, URL options
   and any target port other than 55432. Decryption uses a private 0700 staging
   directory beside the output, with 0600 plaintext. Manifest/header agreement,
   ciphertext integrity, GCM authentication and tar/TOC validation must all pass
   before create-only atomic publication. The output filesystem must support
   atomic hard-link publication from the adjacent staging directory. Unsupported
   filesystems may cause publication to fail safely; choose a compatible local
   filesystem rather than bypassing this protection. An output appearing
   concurrently is preserved. Both System32 bsdtar and Git Bash GNU tar use an
   archive basename and explicit working directory; no drive-qualified Windows
   path is passed to tar.
   Handled errors and cooperative SIGINT/SIGTERM cancellation remove staging
   plaintext. SIGKILL, power loss or OS cleanup failure cannot be guaranteed away:
   after abrupt OS termination, confirm the interrupted process has stopped, then
   inspect the dedicated workspace for `.peritio-pg-restore-*` directories and any
   published plaintext output. Remove that plaintext under the disposal procedure
   below before reusing the workspace. Never put plaintext or keys in general logs.
   This is not a database restore, schema check, producer-signature verification
   or secure-erase command.
4. Use the reported source PostgreSQL major to choose client/server tools. Start
   with the matching PostgreSQL major; pg_restore must understand the archive's
   actual dump version. Restore into the same or a compatible newer server, never
   assume older-server compatibility. Verify required extensions and collation.
   Server major in the header is metadata, not an executed compatibility proof.
5. Example **future, separately authorized** disposable rehearsal, with no host
   data mounts, no hosted credentials and no networking. Replace `17` below only
   with the verified compatible major. Never change these commands to use Render
   connection strings or a shared staging container:

   ```bash
   (
   set -eu
   # An existing container with this name makes docker run fail; set -e stops here.
   docker run --name peritio-a22-restore --network none \
     -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17
   ready=0
   for attempt in $(seq 1 30); do
     if docker exec peritio-a22-restore pg_isready -h /var/run/postgresql -U postgres >/dev/null 2>&1; then
       ready=1; break
     fi
     sleep 2
   done
   test "$ready" = 1
   docker exec peritio-a22-restore createdb -h /var/run/postgresql -U postgres peritio_restore_a22
   docker cp /private/peritio-rehearsal/export.dir.tar.gz peritio-a22-restore:/tmp/export.dir.tar.gz
   docker exec peritio-a22-restore mkdir -m 700 /tmp/peritio-restore
   docker exec peritio-a22-restore tar -xzf /tmp/export.dir.tar.gz -C /tmp/peritio-restore
   docker exec peritio-a22-restore sh -eu -c '
     test "$(find /tmp/peritio-restore -type f -name toc.dat | wc -l)" -eq 1
     toc="$(find /tmp/peritio-restore -type f -name toc.dat)"
     directory="${toc%/toc.dat}"
     pg_restore --list "$directory" >/dev/null
     pg_restore -h /var/run/postgresql -U postgres --dbname peritio_restore_a22 \
       --no-owner --no-privileges --exit-on-error "$directory"
   '
   )
   ```

   Container creation/pulls/restoration are not authorized or performed in this
   implementation task. The isolated container must be new/empty; never reuse an
   existing database. Do not run `--clean` against any existing database. Roles,
   ownership and grants omitted by `--no-owner --no-privileges` require deliberate
   reconstruction; logical exports do not preserve all cluster-global settings.
   The preparation URL is a nonconnecting guard; this procedure uses only the
   container's internal Unix socket and publishes no TCP port. Run in a private
   operator terminal and do not forward detailed restore errors to general logs.
   Keep the disposable container only for the remaining authorized validation
   steps. If any restore or validation step fails, or the rehearsal is aborted,
   stop the scratch process and perform the disposal below; do the same after
   successful validation and evidence capture. If container creation failed because
   the name already existed, do not remove that pre-existing container.
6. Before any API startup, use psql **inside that container** and a READ ONLY
   transaction to verify `current_database()='peritio_restore_a22'`, schema/table
   inventory, constraints, JSONB shape and representative aggregate counts. Check
   exactly one `app_state` primary row, `users` and `orgs` arrays, retained
   `organizationCreationReceipts`, scenarios/rubrics, Focus Topic assignments,
   dedicated history/usage/AI ledger, content metadata and their relationships.
   Compare with same-snapshot fixture/rehearsal evidence, not a newer live DB.
   The representative SQL in the existing recovery runbook is a starting point,
   not a substitute for all current schema checks. Do not print record contents.
7. Derive required immutable R2 asset versions from the **restored** metadata.
   Match each critical retained version to live or backup bytes; a PostgreSQL
   archive does not contain the R2 files. Test recovery into separate disposable
   R2 storage only after authorization. Preserve extra/newer objects; keep cleanup
   paused until consistency is approved. The DB export and R2 lane are not a
   coordinated cross-provider snapshot.
8. Only after pre-start checks, separately authorize a scratch API with throwaway
   secrets, disabled email/AI, no production connections, compatible source and
   networking appropriate to that isolated test. Compare data before/after startup
   and treat unexpected integrity cleanup as failure. Preserve historical support
   transcript-key recovery separately; do not overwrite it with a new backup key.
9. Record archive ID/time, checksum, key ID, compatible code, measured durations,
   aggregate validation, R2 coverage and operator approval without customer data.
   A real end-to-end recovery rehearsal remains outstanding. Dispose of scratch
   resources only through the owner's approved process.

### Dispose of plaintext and rotate keys (owner actions, not performed here)

- After successful rehearsal and approved evidence capture, or after any failed
  or aborted rehearsal, stop the scratch process. Confirm that
  `peritio-a22-restore` is the disposable container created for this rehearsal,
  then remove both it and its anonymous volumes:

  ```bash
  docker rm -f -v peritio-a22-restore
  ```

  The `postgres:17` image creates an anonymous PostgreSQL data volume; removing
  the container without `-v` can retain the restored plaintext database. Confirm
  cleanup succeeds; after an abrupt interruption or cleanup failure, repeat this
  identity check and cleanup before closing the rehearsal. Never target existing
  Peritio staging/production containers or remove unrelated volumes; do not use
  volume-pruning commands.
- Remove `export.dir.tar.gz`, the working private-key copy and any stopped-job
  plaintext staging directory from the protected local workspace. Keep encrypted
  archive/manifest originals and encrypted escrow copies according to retention.
  Do not claim that `rm`, unlink, deleting a container, or overwriting a file reliably
  sanitizes SSD/COW/snapshot storage; use encrypted storage and its approved disposal
  controls. Never recursively delete a computed directory without checking its exact
  resolved path and contents. This implementation does not perform operator cleanup.
- For rotation, generate a new pair in a **new** private directory, verify new
  encrypted escrow/recovery access, then replace only the job's public-key file.
  Preserve old private keys in escrow while any retained archive or hold uses them.
  Do not overwrite or delete old escrow entries. The header's keyId selects the
  recovery key. Same-day retries can legitimately retain the old key; key rotation
  does not re-encrypt existing artifacts, overwrite a locked slot or add a new
  producer-authenticity guarantee. Remove each unencrypted working private-key copy
  after verified escrow/use. Losing the matching private key is irreversible loss
  of access to those archives.

## Deferred audit findings — not implemented in this correction batch

| Finding | Disposition |
| --- | --- |
| F2 — transient retry/backoff and polling redesign | **Release recommendation resolved:** retain bounded fail-fast transport behavior and existing export polling, with tested failure/freshness alerts and one supervised same-day rerun after a transient failure. No automatic POST retry or general backoff loop. Required operational controls are listed below; activation is not claimed. |
| Archive signing / F4 producer trust | **Release recommendation resolved:** unsigned encrypted archives with restricted identities, immutable retention and independently preserved run/digest/source provenance. No cryptographic producer-authenticity claim or signing infrastructure. Required operational controls are listed below; activation is not claimed. |
| F5 — maintenance-scheduled status handling | Deferred; current availability check remains unchanged. |
| F7 — larger archive transfer budgets | Deferred; current size and request/job budgets remain. |
| F8 — monitoring schedule tuning | Deferred; example schedules and owner setup remain examples, not activated controls. |
| F9 — unused restore URL guard | Deferred; the guard is nonconnecting and is not proof of a target database's identity/emptiness. |
| Second cloud backup provider | Deferred; no additional provider or infrastructure introduced. |

Staging owner configuration, real provider integration, notification delivery and
a real isolated restore rehearsal remain separate, explicitly authorized tasks.

## Cost, ownership and remaining activation work

- No extra always-running service or paid database is required. The selected
  Render Cron Job **is a new billable scheduled service**, with a $1/month minimum
  plus measured runtime. Budget roughly $1–3/month for a small staging job before
  storage/bandwidth; this is an estimate, not a quote or cap.
- Thirty daily encrypted archives of average compressed size D GB use roughly
  `30 × D` GB. R2 Standard published storage is $0.015/GB-month before shared free
  allowances; D=1 GB implies about $0.45/month in raw storage. Requests and existing
  account usage may alter the bill. R2 direct egress is free; Render-to-R2 uploads
  consume Render outbound bandwidth. Check the workspace's remaining allowance.
- Existing GitHub Actions capacity can provide the independent freshness check
  without a new monitoring subscription, subject to the owner's actual quota.
- Production activation remains an owner operation after independent review: explicit production mode is now implemented, but this work creates no production job/configuration. No SQL migration is needed. Never copy staging credentials or keys into production.
- Cloudflare account loss still affects this same-account archive and media lanes.
  Recovery keys and source/configuration access must survive either provider loss.
- Owner must configure identities/permissions, private bucket/lifecycle/lock, public
  key, schedules, notifications and an independent freshness check, then authorize
  a first staging run and isolated restore drill. None is claimed complete here.

Sources: [Render cron](https://render.com/docs/cronjobs),
[Render API authentication](https://render.com/docs/api),
[Render notifications](https://render.com/docs/notifications),
[Render pricing](https://render.com/pricing),
[R2 conditional PUT](https://developers.cloudflare.com/r2/api/s3/api/),
[R2 retention](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
[R2 locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Local implementation validation

Initial implementation validation: 58 focused offline tests passed, including 23 new A2.2 cases and the existing
A2.1 backup/reconciliation regressions. Tests use synthetic archives/keys, mocked
Render/R2, blocked dotenv loading and blocked sockets/fetch. They cover target
guards, export failures, ambiguous creation, interrupted transfers/completion,
concurrent retries, authenticated encryption/decryption, wrong keys, corruption,
missing/stale/expired artifacts, restore safeguards and sanitized CLI failures.
API and CLI TypeScript no-emit checks and whitespace checks passed. No dependency
installation, real pg_dump, provider export/download, database restore or provider
mutation was used to validate this batch. No migration is required. Independent
review and authorized staging integration/restore evidence are still required.

Audit-remediation validation (November 4, 2026): **80/80 tests passed with Windows
System32 bsdtar 3.8.9 and 80/80 with Git Bash GNU tar 1.35**, with API and CLI
TypeScript checks passing. Each run contains the same 45 A2.2 tests and 35 existing
A2.1 regressions, not 160 distinct test cases. Regression coverage includes the
actual configuration loader's Render-ID acceptance/rejection, Windows drive/space
paths, complete CLI decryption, invalid tar, malformed/mismatched manifests,
truncation, GCM failure, cooperative interruption and output-publication races.
Failure tests assert both absent final plaintext and a directory listing identical
to the encrypted inputs/key fixture baseline (no residual plaintext staging
directory). The in-memory R2 mock now evaluates create-only writes after its
awaited body read, matching atomic provider commit semantics. Fixed error-category
tests exercise actual Render/R2 adapters without exposing synthetic secrets.
All runs block dotenv, sockets and fetch; only synthetic files/keys and mocked
provider responses are used. No hosted backup, restore, cron, bucket configuration,
signing implementation or production operation was run. Native Linux/Render
integration and a real restore remain separate tasks.

## Production parity: exact owner activation procedure

Implementation date: November 13, 2026. This extends the same exporter, encryption/container format, immutable R2 writer, verification and isolated local recovery tools; it is not a second backup architecture. Application startup, SQL migrations, hosted services and all existing retention policies are unchanged. Staging keeps its current credentials, bucket, `0 9 */5 * *` schedule and 144-hour freshness threshold.

### Environment separation and limits

- Production network operations require `--target production`, `PERITIO_ENV=production` and `PG_BACKUP_PRODUCTION_AUTHORIZATION=production:<exact-production-dpg-id>`. There is no default target and no production fallback. This is an operator confirmation tied to a particular resource, not a replacement for provider permissions.
- Common identity settings must identify only production. Actual Render metadata must match configured resource ID, workspace/owner, display name **peritio-db-prod**, SQL database **peritio_db_prod** and available PostgreSQL 11-18 before a new export. Staging remains bound to **voicepractice_db**. A copied staging ID in production configuration fails the actual source metadata check before export/upload. Repository names are pins, not proof of current hosted values; the owner confirms them in Render before activation.
- Exact destination is **peritio-postgres-backups-production**, with `postgres/production/<production-dpg-id>/<UTC-day>/archive.pgbak` and `complete.json`. Staging and media bucket names are rejected in production. Completion headers must match environment, SQL name, source ID and day. Cross-environment retained objects fail closed instead of completing a wrong slot.
- Production reads ONLY the production-prefixed credential/public-key variables listed below. Nonempty staging-family credential variables in a production job, and production-family variables in a staging job, are rejected. Never attach shared application/staging environment groups. Variable-family isolation cannot prove a provider token is narrowly scoped or detect an operator placing the same token in both families: distinct principals/tokens, bucket restrictions and owner verification remain necessary.
- There is **no direct PostgreSQL connection**: no `DATABASE_URL`, SQL login, pool or pg_dump process is added. The separate source is the production Render export resource and its dedicated API credential. All network operations retain their existing deadlines, size limits, read-back checks and client closure. The tool has no deletion/overwrite or bucket-policy operation.
- `--dry-run` performs source-identity GET, local public-key validation and destination List only. It does not request/list/download exports or write any remote object. Success does not prove PUT permission, sufficient disk for a real export, retention configuration, GCM restore or actual database restore. `--check` and `--verify` remain read-only and need no Render API token/public key.
- Production freshness defaults to 36 hours, allowed 25-48. Copying the staging value 144 into production is rejected. Staging's default/range and exact 144-hour boundary are preserved. Retention remains default 30 days (existing 7-90 range) with no policy changes.

### Required external resources (not created here)

1. Confirm the existing paid production PostgreSQL resource **peritio-db-prod**, SQL name **peritio_db_prod**, its exact `dpg-...` ID, owner/workspace ID, export permission and privately verified signed-download hostname. Do not create a second production database just for this job.
2. Create a **new private R2 Standard bucket `peritio-postgres-backups-production`**, with public/r2.dev/custom-domain access disabled. It is separate from `peritio-training-content-backup-production` and from staging. Retain the existing 30-day policy intent for this new lane; the owner must approve/configure its lifecycle and recommended minimum lock together. Do not change any existing bucket policy. A lock is not required by the code; without a lock, a broad Read & Write token may delete data outside this tool.
3. Issue a new production-bucket-only writer token and a separate production-bucket-only read token for the independent monitor/operator. Required writer operations: List/Head/Get/Put. Do not grant bucket administration or staging/media access. Provider Object Read & Write permissions may include Delete; document and mitigate that actual capability with the new bucket lock. Use a dedicated production Render API principal/token with the narrowest available access; do not assume endpoint/resource scoping is available on the current account.
4. Generate a **separate production RSA-4096 pair locally**, outside Git and synchronized folders, using the existing key-generation procedure with a distinct `peritio-postgres-production-recovery` directory. Verify encrypted escrow and independent recovery of the private key before activation. Keep it only in the owner vault/offline escrow; upload only the SPKI public PEM as the Render secret file **`postgres-production-public.pem`**. No key is generated or accessed by this implementation.

### Exact Render Cron Job settings

Do not create/deploy the job until this reviewed patch is committed and separately promoted to main, and the required activation controls below are established. Creating the job enables future scheduled exports.

| Setting | Value |
| --- | --- |
| Name | `peritio-postgres-backup-production` |
| Repository | Existing Peritio Git repository |
| Branch | `main`, after this patch is separately approved/promoted |
| Runtime | Node; `NODE_VERSION=24.22.2` |
| Root Directory | Blank (repository root) |
| Region | Same as the production database |
| Build Command | `tar --version && npm ci --include=dev` |
| Command | `npm run backup:postgres -- --target production --run` |
| Schedule | `0 9 * * *` (daily 09:00 UTC) |
| Compute | Start with smallest available Cron compute; measure actual runtime/RSS/free disk (roughly 3x export cap) |
| Persistent disk | None |
| Notifications | Only failure notifications, delivered to the owner and tested |
| Environment groups | None shared with application, media, staging or recovery-private-key settings |

No API build is needed for this TSX CLI. Keeping the already-working `npm install --include=dev && npm run build:api` build command is also compatible but performs additional unrelated API/native checks. Required backup runtime tools are Node, installed dependencies and `tar`; pg_dump/pg_restore are not required on the Cron host.

Configure these exact names on the production job. These are new owner settings, not existing secret values inspected here:

| Name | Value/source and placement |
| --- | --- |
| `NODE_VERSION` | Environment variable: `24.22.2` |
| `PERITIO_ENV` | Environment variable: `production` |
| `PG_BACKUP_PRODUCTION_AUTHORIZATION` | Nonsecret environment variable: `production:<exact-production-dpg-id>` |
| `PG_BACKUP_RENDER_POSTGRES_ID` | Nonsecret environment variable: exact production resource ID from Render |
| `PG_BACKUP_RENDER_OWNER_ID` | Nonsecret environment variable: exact production owner/workspace ID |
| `PG_BACKUP_RENDER_DATABASE_NAME` | Environment variable: `peritio-db-prod` (also the production default) |
| `PG_BACKUP_PRODUCTION_RENDER_API_KEY` | Secret environment variable: dedicated production Render API token |
| `PG_BACKUP_DOWNLOAD_HOSTS` | Environment variable: privately verified production export HTTPS hostname(s), never a signed URL |
| `PG_BACKUP_R2_ACCOUNT_ID` | Nonsecret environment variable: account containing the new PostgreSQL bucket |
| `PG_BACKUP_R2_ENDPOINT` | Environment variable: `https://<account-id>.r2.cloudflarestorage.com` |
| `PG_BACKUP_R2_BUCKET` | Environment variable: `peritio-postgres-backups-production` |
| `PG_BACKUP_PRODUCTION_R2_ACCESS_KEY_ID` | Secret environment variable: dedicated production bucket writer access ID |
| `PG_BACKUP_PRODUCTION_R2_SECRET_ACCESS_KEY` | Secret environment variable: matching production bucket writer secret |
| `PG_BACKUP_PRODUCTION_PUBLIC_KEY_FILE` | Environment variable: `/etc/secrets/postgres-production-public.pem`; contents supplied as the **public-only Render secret file** above |
| `PG_BACKUP_RETENTION_DAYS` | Environment variable: `30`; does not install/change lifecycle or locks |
| `PG_BACKUP_MAX_AGE_HOURS` | Environment variable: `36`; also configure 36 on independent monitor |
| `PG_BACKUP_MAX_BYTES` | Environment variable: `536870912` initially (512 MiB); review size/15-minute budget if actual export exceeds it |

`RENDER_GIT_COMMIT` is optional platform-provided revision evidence, not another secret to create. Do not supply canonical staging variables `PG_BACKUP_RENDER_API_KEY`, `PG_BACKUP_R2_ACCESS_KEY_ID`, `PG_BACKUP_R2_SECRET_ACCESS_KEY` or `PG_BACKUP_PUBLIC_KEY_FILE` to production. Do not supply private-key, `DATABASE_URL`, OpenAI/email/application auth or media-storage settings.

### Freshness monitoring and final release policy

Use the existing independent-check workflow template in this guide with checkout ref **main**, target **production**, `PERITIO_ENV=production`, production ID/owner/confirmation and production bucket/account/endpoint. Replace the R2 variables with **`PG_BACKUP_PRODUCTION_R2_ACCESS_KEY_ID` / `PG_BACKUP_PRODUCTION_R2_SECRET_ACCESS_KEY`**, populated from the separate read-only token, and set `PG_BACKUP_MAX_AGE_HOURS=36`. Schedule every six hours (`0 */6 * * *`); command **`npm run backup:postgres -- --target production --check`**. No Render API token, public key or private key belongs in the monitor. The staging monitor/template remains unchanged with staging-only read credentials and 144 hours. GitHub schedules require an owner-configured workflow on the default branch, Actions availability and tested failure notifications; this work does not create/activate one. Test empty-bucket check failure/notification before the first archive, then demonstrate healthy status after it.

**Selected recommendation at the owner's staging-finalization request:** retain fail-fast transport behavior and unsigned encrypted archives, subject to the following concrete production controls. This resolves the release design recommendations; it does not claim that the controls are configured, notifications are delivered, or production recovery is proven. No executable change is required.

**Failure/retry policy.** Retain the current 15-minute run deadline, bounded export polling (at most 60 polls), per-request/transfer deadlines and fixed nonzero failure codes. There is no general automatic transport retry. Never automatically repeat an ambiguous Render export POST: Render might already have accepted it, and starting another export adds database/provider work without guaranteeing recovery. Create-only R2 slots and verified same-day reuse remain unchanged; they prevent replacement of a completed archive, not all possible duplicate provider exports.

Enable and test Render failure notifications before scheduling the writer. On a transient timeout, rate limit, network failure or provider 5xx, the owner checks provider health and the safe error code, waits 10-15 minutes and performs **at most one supervised same-UTC-day rerun** using the unchanged `--run` command. If it fails again, escalate and investigate rather than starting a retry loop or waiting silently for tomorrow. Authentication, environment/identity, checksum, encryption or retention failures require investigation/correction before a rerun; never delete a slot or remove locks to make it pass. The independent six-hour `--check` with a 36-hour threshold is mandatory for production: a stopped writer may not alert through Render itself. Nominal stale detection is within six hours after the threshold (up to about 42 hours since export, plus scheduler/notification delays), not a 36-hour delivery guarantee. Assign the owner to receive/respond to alerts and test both a deliberately failing read-only check on an empty backup bucket and recovery to healthy status.

**Unsigned-provenance policy.** Keep AES-GCM/RSA encryption, ciphertext hash/read-back verification and the existing format; do not introduce a signing service or another online private key. Use distinct narrowly restricted Render/R2 principals, separate read-only monitoring credentials, MFA on operator accounts, and a private dedicated production bucket. For this unsigned-production recommendation, establish the new bucket's minimum 30-day retention lock before the first archive, with its owner-approved lifecycle aligned to the existing 30-day retention intent. This is an activation control; the code does not enforce/query the lock and no existing bucket policy is changed by this release.

After an authorized successful run and `--verify`, independently preserve the run/deployed-revision evidence, source/export identity and creation time, key fingerprint, ciphertext SHA-256/size and UTC slot in the owner's protected recovery record outside the writer's bucket/credential authority (for example, an access-controlled recovery-vault note). Values copied only from a later object in the same potentially compromised bucket are not independent provenance. Validate that record against the matching archive/manifest during the isolated restore, and retain the offline private-key escrow separately. Use provider/run evidence together; a checksum or public-key envelope alone does not identify Peritio as producer.

This is the smallest defensible initial approach for the current owner-operated system. A signing key stored in the same compromised job would not solve a compromised-writer threat by itself; independently protected signing would add a new key/trust lifecycle. Residual risk remains: an attacker with writer/principal access can preempt future slots with a fabricated archive, and anyone with the public key can construct a decryptable envelope. Do not silently trust a suspect run or archive. Revisit independently protected signing if stronger adversarial origin proof, multiple untrusted writers or customer/compliance obligations require it. Actual least-privilege permissions, lock/privacy, protected provenance records, tested independent alerts and a real production isolated restore remain activation prerequisites.

### First encrypted production backup and isolated restore (future authorization)

1. After independent review and separate commit/promotion approval, configure only the resources/settings above. Verify source identity, credential isolation, public-key fingerprint/escrow, bucket privacy/retention and export host privately. Do not attach the private key or a database connection. Authorize the first export before enabling a scheduled writer.
2. From the configured owner-authorized job environment, run **`npm run backup:postgres -- --target production --dry-run`**. Require `outcome=dry_run_validated`, `environment=production`, all three validation booleans true and `mutationsPerformed=false`. It succeeds against an empty bucket. On any mismatch, correct configuration after checking the intended resource; never weaken the guards.
3. Authorize/run **`npm run backup:postgres -- --target production --run`** once. Require `outcome=archived`, `environment=production` and positive bytes, with one `archive.pgbak` and final `complete.json` under that UTC-day production prefix. Same-day rerun should return `already_complete`; do not delete/replace an existing slot to force a new export.
4. Run **`npm run backup:postgres -- --target production --check`**, then **`npm run backup:postgres -- --target production --verify`**. Require `healthy`, age <=36 hours, and `checksumVerified=true` for verify. Record only aggregate outcome/time/bytes and the independently trusted expected digest/source/key identity in the protected owner recovery record, not general logs. Check that the independent monitor/notifications work even when the writer schedule stops.
5. With read-only production R2 credentials, use the existing bounded downloader example above, changing its first positional argument from `staging` to **`production`**, the UTC day to the chosen completed slot, and the local destination to a new dedicated encrypted, non-synchronized directory outside Git. It loads only the production config and validates manifest/header/checksum. Alternatively privately download the exact archive/manifest pair in Cloudflare. Preserve both encrypted originals.
6. Recover the matching **production** private key locally from escrow, never to Render/R2. In that isolated local process set `PERITIO_ENV=development`, `PG_BACKUP_RESTORE_ENVIRONMENT=production`, `PG_BACKUP_RESTORE_POSTGRES_ID=<independently recorded production dpg-id>`, `PG_BACKUP_PRIVATE_KEY_FILE=<local private.pem path>` and `PG_BACKUP_RESTORE_URL=postgresql://127.0.0.1:55432/peritio_restore_a22`. Then run from the repository root (actual downloaded filenames are supported):

   ```sh
   npm run backup:postgres -- --target scratch --decrypt --archive /private/peritio-production-rehearsal/archive.pgbak --manifest /private/peritio-production-rehearsal/complete.json --output /private/peritio-production-rehearsal/export.dir.tar.gz
   ```

   All paths are placeholders replaced with the protected actual local paths. No secret value appears in the command. The CLI refuses hosted mode, non-loopback destinations and wrong source environment/ID before decryption. GCM/header/digest/tar checks precede atomic, create-only plaintext publication. The restore URL remains a **nonconnecting guard**, not proof of an empty database.
7. Use the existing isolated restore/disposal procedure above in a **new** disposable container/cluster, never any existing DB. Choose PostgreSQL 18 (or a compatible pg_restore major supported by the actual archive TOC); use container-internal Unix socket/no published port, or the previously validated new local cluster exclusively at `127.0.0.1:55432` with verified PID/data-directory identity. For the container procedure, replace `postgres:17` with `postgres:18`; keep all name-existence checks and scope cleanup to the container actually created. Run `pg_restore --no-owner --no-privileges --exit-on-error` into new `peritio_restore_a22`. Require exit 0; SQL READ ONLY checks must verify required tables/constraints, exactly one primary `app_state`, JSONB types/arrays, aggregate users/orgs/sessions/scores/AI usage/content counts and key relationships. No records, passwords or credentials in output; compare same-snapshot evidence, not a later live database. Do not start the application against restored customer data as part of this check.
8. Capture sanitized evidence; stop only the disposable instance, verify its listener/process is gone, remove only its data and any anonymous volume (`docker rm -f -v peritio-a22-restore` only after verifying it is the newly created rehearsal container). Remove decrypted output, interrupted `.peritio-pg-restore-*` plaintext and working private-key copy from the checked local workspace after success **or failure**. Preserve encrypted originals, manifest, trusted provenance record and all escrow copies. A real production rehearsal is not established by these offline fixture tests.

### Incremental recurring cost estimate

Checked public pricing November 13, 2026: [Render Cron](https://render.com/docs/cronjobs) has a **$1/month minimum per job**, otherwise billed for active compute time. [R2 Standard](https://developers.cloudflare.com/r2/pricing/) is **$0.015/GB-month**, with account-shared 10 GB-month storage and request allowances and free direct egress. Daily 30-day retention uses roughly `30 * D` GB for average encrypted archive size D GB. At the initial 512 MiB export ceiling, this is about 16.1 GB (roughly $0.24 storage before free allowances/rounding), plus small request usage. Allow roughly **$1-5/month for a small backup job and storage**, as an unmeasured planning estimate, not a quote/cap. Render outbound bandwidth, actual job plan/runtime, account-wide free allowances, build usage and independent monitor quotas can change the bill. No second paid database or always-on monitoring service is required; local disposable restore adds no ongoing cloud database charge. Owner operations/recovery time is additional. No paid resource was created here.

### Local validation and independent review — November 13, 2026

- **54/54 focused offline tests passed**, zero failures/skips, with Node **24.22.2**, synthetic keys/archives and mocked Render/R2. No production credential, database, export, bucket or real restore was accessed. Tests include explicit authorization/credential-family guards, cross-wired source identities, cross-environment retained objects, production archive/check/verify/decrypt, unchanged staging 144-hour behavior, read-only dry-run, cleanup/error handling and source-pinned offline recovery.
- API TypeScript and separate CLI/test TypeScript no-emit checks passed. `git diff --check` passed. No package/dependency, migration, application startup or broad regression changes were needed.
- One separate Codex review agent independently inspected the eight-file diff and relevant unchanged encryption/storage paths, reran **54/54** offline tests and checked whitespace. Verdict: **PASS WITH MINOR FINDINGS; no new implementation blocker**. This is an independent agent review, not a claim of another Claude/external-human audit.
- Both low-severity findings were documentation inconsistencies: the owner-identity row still implied production was always forbidden, and the deferred F2 retry policy was inconsistent across sections. Both were corrected at review. The subsequent staging-finalization request selected the recommendations documented in the final release policy above; no production activation/control validation is presumed.
- Actual token scopes, identities, bucket privacy/retention, failure notification delivery, independent monitoring and the first production backup/isolated restore remain owner activation requirements. At this review checkpoint the production release on main was untouched and changes were uncommitted; six historical reports retained their recorded hashes.

### Staging finalization

The owner requested the final retry/provenance recommendations and a staging-only commit/push. The policies above are now the recommended production approach; activation remains a later owner operation. Only the setup guide, configuration inventory and recovery runbook were refined in finalization. The five reviewed code/test files are byte-for-byte unchanged, so the existing 54/54 focused test results and API/CLI TypeScript results remain applicable; no test rerun or executable change was needed. Final checks cover the eight-file scope, documentation/code agreement, whitespace, normal staging push ancestry and all six historical report hashes. Main must remain at production release `9e0cdbaf4de82ea98d19dfc325fd141744678f7a`.
