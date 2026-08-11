# Peritio Training Content Storage

Training Content file assets use a private Cloudflare R2 bucket through its S3-compatible
API. The API owns authorization, relational state, object keys, and presigning. File bytes
travel directly between the browser and R2.

## Storage Lanes

The lanes are locked in application configuration:

| `PERITIO_ENV` | R2 environment | Required bucket |
| --- | --- | --- |
| `staging` | `staging` | `peritio-training-content-staging` |
| `production` | `production` | `peritio-training-content-production` |

Use separate least-privilege R2 API credentials for each bucket. A staging process cannot
be configured with the production environment marker or bucket, and the inverse is also
rejected. Keep both buckets private; do not enable an `r2.dev` public URL or public custom
domain.

Required when `TRAINING_CONTENT_STORAGE_PROVIDER=r2`:

```dotenv
TRAINING_CONTENT_STORAGE_PROVIDER=r2
TRAINING_CONTENT_R2_ENVIRONMENT=staging
TRAINING_CONTENT_R2_ACCOUNT_ID=<cloudflare-account-id>
TRAINING_CONTENT_R2_BUCKET=peritio-training-content-staging
TRAINING_CONTENT_R2_ACCESS_KEY_ID=<staging-only-access-key>
TRAINING_CONTENT_R2_SECRET_ACCESS_KEY=<staging-only-secret>
TRAINING_CONTENT_R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
```

Optional bounded settings:

```dotenv
TRAINING_CONTENT_UPLOAD_URL_TTL_SECONDS=600
TRAINING_CONTENT_DOWNLOAD_URL_TTL_SECONDS=300
TRAINING_CONTENT_MEDIA_ACCESS_URL_TTL_SECONDS=3600
TRAINING_CONTENT_MAX_PENDING_UPLOAD_BYTES=1073741824
TRAINING_CONTENT_MAX_VIDEO_BYTES=
TRAINING_CONTENT_MAX_AUDIO_BYTES=
TRAINING_CONTENT_MAX_PDF_BYTES=
TRAINING_CONTENT_MAX_DOCX_BYTES=
TRAINING_CONTENT_MAX_IMAGE_BYTES=
TRAINING_CONTENT_FINALIZATION_LEASE_SECONDS=300
TRAINING_CONTENT_ORPHAN_GRACE_SECONDS=86400
TRAINING_CONTENT_SUPERSEDED_RETENTION_DAYS=30
```

File-size overrides may lower, but cannot raise, the platform limits.

## Readiness

Unsafe or ambiguous R2 configuration fails API startup. This includes unsupported providers,
missing credentials, environment mismatches, wrong lane buckets, and non-account-scoped
endpoints.

`GET /ready/training-content-storage` performs and reports the separate provider readiness
state. A temporary R2 failure makes Training Content storage operations return a structured
unavailable response, while the main API and simulation routes remain available. The
readiness response never includes a bucket, endpoint, credentials, provider error text, or
signed URL.

## Browser CORS

Configure CORS manually on each private bucket. Use the exact deployed Dashboard origin for
that environment; never use `*`. The staging origin is intentionally not guessed here. Replace
the staging placeholder only after that deployment has a stable HTTPS origin.

Staging bucket example:

```json
[
  {
    "AllowedOrigins": ["https://<exact-staging-dashboard-origin>"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Production uses the same policy with only `https://app.peritio.ai` in `AllowedOrigins`.
The presigned PUT binds the declared byte length and content type. Browser code sends the
returned `Content-Type`; the browser computes `Content-Length` from the upload body.

Cloudflare references:

- <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- <https://developers.cloudflare.com/r2/buckets/cors/>

## Lifecycle

1. An authenticated `org_admin` or explicitly scoped super user initiates an upload for an
   existing, unarchived content item.
2. The API derives organization and actor, verifies entitlement and
   `manageOrganizationContent`, validates filename/type/size/role, reserves pending bytes,
   and creates a `pending` asset with a server-generated temporary key.
3. The browser uploads directly to the short-lived presigned R2 PUT URL.
4. Finalization reauthorizes, re-reads the asset, verifies expiry, performs HEAD and bounded
   signature/container reads, and rejects type or size mismatches.
5. Non-video assets retain the synchronous finalization path: a valid temporary object
   progresses through `uploaded` and `processing`, is copied once to its immutable final key,
   is verified again, and becomes `ready`.
6. Video finalization stops after the bounded validation and durable `processing` transition.
   A separate PostgreSQL-backed worker inspects and, only when necessary, losslessly remuxes
   the private temporary MP4 before publishing an immutable final object.
7. The relational ready transition and replacement selection commit atomically. Temporary
   deletion follows; a failed delete is retained as cleanup work.

Finalization retries reuse the stored finalization nonce and final key. A copied object with
an uncommitted database transition can therefore be reconciled without creating another
version. Existing current assets remain active until a replacement is fully ready; the old
row then becomes `superseded` and remains stored for the configured retention period.

Admin preview access is authorized from current database state and returns a temporary GET
URL only for current, ready assets on unarchived content. Documents and images default to
five minutes. Media defaults to, and is capped at, one hour. A URL already issued is a bearer
token and remains usable until it expires; deactivation does not revoke it instantly.
Ordinary-user asset access is intentionally absent until assignment authorization exists.

## File Policy

| Kind | Accepted files | Maximum |
| --- | --- | --- |
| Video | MP4 (`ftyp`; H.264/AAC expected) | 500 MB |
| Audio | MP3, M4A | 100 MB |
| Document | PDF | 50 MB |
| Document | DOCX storage only | 25 MB |
| Image | JPG/JPEG, PNG, WebP | 20 MB |

The API compares filename extension, declared MIME, R2 metadata, actual byte size, and magic
bytes/container structure. DOCX central-directory inspection requires expected Word OOXML
entries and bounds entry count, expansion size, compression ratio, encryption, and unsafe
paths without extracting files.

Legacy DOC, executables, scripts, HTML, SVG, archives, spreadsheets, presentations, and
unknown binary types are rejected. DOCX conversion and video transcoding are not implemented.
Video codec/container metadata inspection and lossless MP4 remuxing are performed by the
worker described below.

Malware scanning is also not implemented. Current compensating controls are private
quarantine objects, no access before `ready`, a strict allowlist, hard size limits,
signature/container checks, short-lived access, and auditable state. Add scanning later
between `processing` and `ready`; do not represent this release as malware-scanned.

## Cleanup And Recovery

The manual cleanup command finds expired pending uploads, leftover temporary objects,
rejected assets, unreferenced copied final objects beyond the grace period, and superseded
objects beyond retention. It is dry-run by default and never deletes a current ready asset.

```bash
npm run cleanup:training-content --workspace api -- --target staging
npm run cleanup:training-content --workspace api -- --target staging --apply
```

The target must match `PERITIO_ENV`, `DATABASE_URL`, and the R2 environment. Production apply
also requires the repository-standard production confirmation. No recurring production job
is enabled in Batch 2.

## Optional Staging Smoke

After the staging bucket, credentials, and exact CORS origin are configured:

```bash
TRAINING_CONTENT_R2_SMOKE_ORIGIN=https://<exact-staging-dashboard-origin>
npm run smoke:training-content-r2 --workspace api -- --target staging --apply
```

The command is staging-only. It verifies provider readiness, browser-style PUT CORS, upload,
HEAD, byte-range read, immutable copy, overwrite prevention, temporary GET access/CORS, and
deletion. It prints no signed URLs, object keys, or credentials. Automated tests do not
depend on live R2.

## Video Processing Worker

Video assets remain private and non-current while `uploadState` is `processing`. The worker:

1. claims one eligible video row with PostgreSQL `FOR UPDATE SKIP LOCKED`;
2. records a bounded lease and attempt count on that asset row;
3. downloads the temporary R2 object into a unique ephemeral working directory;
4. inspects FFprobe stream metadata and MP4 `tkhd`/H.264 sample-entry dimensions;
5. accepts only one H.264 video stream with optional AAC audio streams;
6. compares decoded dimensions with MP4 sample-entry and track dimensions, accounting for
   valid quarter-turn display rotation;
7. copies a healthy MP4 directly to its immutable final key, or runs an FFmpeg `-c copy`
   remux when dimensions disagree;
8. re-inspects the candidate, verifies duration and stream preservation, performs a complete
   packet-read pass, then publishes and confirms the immutable R2 object;
9. atomically commits `ready` only while it still owns the processing lease.

Temporary local files are removed in a `finally` path. The worker checks available disk before
downloading, accepts at most the configured 500 MB platform limit, processes one asset at a
time, and aborts work that exceeds 20 minutes. Transient failures use bounded PostgreSQL retry
state; permanent media failures or an exhausted third attempt become `rejected` with a safe
error category and remain unavailable to clients.

An authorized administrator can inspect safe state without receiving object keys or URLs:

```text
GET /dashboard/admin/training-content/:contentId/assets/:assetId
```

The response distinguishes `pending`, `processing`, `ready`, and `rejected`, and exposes only
the attempt count, next retry time, and allowlisted error category.

### Render Runtime

The staging worker is declared in the repository `render.yaml` as a single-instance Docker
background worker. `api/Dockerfile.video-worker` pins Node 24.18.0 and Debian FFmpeg/FFprobe
5.1.9. Worker startup verifies both tool versions before claiming any work.

The worker uses Render's ephemeral filesystem only as scratch space; PostgreSQL and private R2
remain the durable sources of truth. Configure the worker with the same staging database and
R2 lane as the staging API. Do not attach production credentials to the staging worker.

Worker-only bounded settings:

```dotenv
TRAINING_CONTENT_VIDEO_WORKER_CONCURRENCY=1
TRAINING_CONTENT_VIDEO_POLL_INTERVAL_MS=2000
TRAINING_CONTENT_VIDEO_MAX_ATTEMPTS=3
TRAINING_CONTENT_VIDEO_JOB_TIMEOUT_SECONDS=1200
TRAINING_CONTENT_VIDEO_LEASE_SECONDS=1800
TRAINING_CONTENT_VIDEO_MINIMUM_FREE_DISK_BYTES=268435456
TRAINING_CONTENT_FFMPEG_PATH=ffmpeg
TRAINING_CONTENT_FFPROBE_PATH=ffprobe
TRAINING_CONTENT_MEDIA_TOOL_VERSION_PREFIX=5.1.9
```
